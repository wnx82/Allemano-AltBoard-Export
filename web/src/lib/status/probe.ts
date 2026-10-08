import net from "node:net";
import type { Target } from "./config";

// Sonde TCP : ouvre une connexion, mesure le temps de la poignée de main, referme. Aucun octet
// n'est envoyé. Une connexion acceptée prouve qu'un service écoute, pas que le jeu fonctionne.

export type ProbeOutcome = "connected" | "refused" | "timeout" | "dns" | "network" | "error";

export type ProbeResult = { outcome: ProbeOutcome; latencyMs: number | null; error: string | null };

/** Ce que la sonde utilise d'une socket : de quoi la remplacer dans les tests. */
export type ProbeSocket = {
  once(event: "connect" | "lookup", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  destroy(): unknown;
};

export type ProbeOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  connect?: (target: Target) => ProbeSocket;
  clock?: () => number;
};

// Le serveur visé n'a jamais été joint : l'échec ne dit rien de son état.
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NODATA", "EAI_NONAME"]);
const NETWORK_CODES = new Set(["ENETUNREACH", "EHOSTUNREACH", "ENETDOWN", "EADDRNOTAVAIL", "EACCES", "EPERM"]);

function errorCode(error: unknown): string {
  const candidate = error as { code?: unknown; errors?: { code?: unknown }[] };
  // Plusieurs adresses essayées (IPv6 puis IPv4) : Node regroupe leurs erreurs.
  const code = candidate?.code ?? candidate?.errors?.[0]?.code;
  return typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code) ? code : "UNKNOWN";
}

export function classifyError(error: unknown): ProbeResult {
  const code = errorCode(error);
  // Seul le code est gardé : un message d'erreur contient l'adresse visée.
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return { outcome: "refused", latencyMs: null, error: code };
  if (code === "ETIMEDOUT") return { outcome: "timeout", latencyMs: null, error: code };
  if (DNS_CODES.has(code)) return { outcome: "dns", latencyMs: null, error: code };
  if (NETWORK_CODES.has(code)) return { outcome: "network", latencyMs: null, error: code };
  return { outcome: "error", latencyMs: null, error: code };
}

export function probeTcp(target: Target, options: ProbeOptions): Promise<ProbeResult> {
  const { timeoutMs, signal } = options;
  const clock = options.clock ?? (() => performance.now());
  const connect = options.connect ?? ((to: Target) => net.connect({ host: to.host, port: to.port }));

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ outcome: "error", latencyMs: null, error: "ABORTED" });
      return;
    }

    let settled = false;
    let started = clock();
    let socket: ProbeSocket | undefined;

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket?.destroy();
      resolve(result);
    };
    const abort = () => finish({ outcome: "error", latencyMs: null, error: "ABORTED" });
    const timer = setTimeout(() => finish({ outcome: "timeout", latencyMs: null, error: null }), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });

    try {
      socket = connect(target);
    } catch (error) {
      finish(classifyError(error));
      return;
    }
    // Le listener d'erreur reste en place après la fin : une erreur tardive d'une socket détruite
    // ne doit pas devenir une exception non interceptée.
    socket.on("error", (error) => finish(classifyError(error)));
    // La résolution du nom n'est pas de la latence du serveur : le chronomètre repart après elle.
    socket.once("lookup", () => {
      started = clock();
    });
    socket.once("connect", () => finish({ outcome: "connected", latencyMs: Math.max(0, Math.round(clock() - started)), error: null }));
  });
}
