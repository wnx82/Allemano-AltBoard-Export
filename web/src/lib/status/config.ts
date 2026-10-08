// Configuration de la surveillance des serveurs. Les adresses viennent uniquement de
// l'environnement du serveur : aucune requête, aucun formulaire ne peut en fournir. Sans adresse,
// rien n'est sondé et le service reste « Inconnu ».

export type ServiceKey = "auth" | "game";

export const SERVICE_KEYS: ServiceKey[] = ["auth", "game"];

export type Target = { host: string; port: number };

export type StatusConfig = {
  targets: Record<ServiceKey, Target[]>;
  intervalMs: number;
  timeoutMs: number;
  /** Latence à partir de laquelle un service qui répond est dit dégradé. */
  degradedMs: number;
  /** Âge au-delà duquel le dernier contrôle ne dit plus rien de l'état présent. */
  staleAfterMs: number;
  /** Valeurs refusées, sans leur contenu : la page les signale au lieu de les ignorer en silence. */
  errors: string[];
};

export const MAX_TARGETS = 8;
/** Plafond de l'espacement des contrôles d'un service en échec répété. */
export const MAX_BACKOFF_MS = 5 * 60_000;

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_DEGRADED_MS = 400;

const TARGET_VARIABLES: Record<ServiceKey, string> = {
  auth: "WOW_STATUS_AUTH_TARGETS",
  game: "WOW_STATUS_GAME_TARGETS",
};

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IPV6 = /^[0-9a-f:.]{2,45}$/i;

/** « hôte:port » ou « [IPv6]:port ». Null si la valeur n'en est pas une. */
export function parseTarget(value: string): Target | null {
  const match = /^(?:\[([^\]]+)\]|([^:\s]+)):(\d{1,5})$/.exec(value.trim());
  if (!match) return null;
  const port = Number(match[3]);
  if (port < 1 || port > 65_535) return null;
  if (match[1] !== undefined) return IPV6.test(match[1]) && match[1].includes(":") ? { host: match[1], port } : null;
  return HOSTNAME.test(match[2]) ? { host: match[2].toLowerCase(), port } : null;
}

function parseTargets(name: string, raw: string | undefined, errors: string[]): Target[] {
  const targets: Target[] = [];
  const entries = (raw ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const target = parseTarget(entry);
    if (!target) {
      errors.push(`${name} : une adresse n'a pas la forme hôte:port et n'est pas surveillée.`);
    } else if (targets.length >= MAX_TARGETS) {
      errors.push(`${name} : ${MAX_TARGETS} adresses au plus, les suivantes ne sont pas surveillées.`);
      break;
    } else if (!targets.some((known) => known.host === target.host && known.port === target.port)) {
      targets.push(target);
    }
  }
  return targets;
}

function parseInteger(name: string, raw: string | undefined, fallback: number, min: number, max: number, errors: string[]): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} : valeur hors de ${min}–${max}, ${fallback} est utilisé.`);
    return fallback;
  }
  return value;
}

export function loadStatusConfig(env: Record<string, string | undefined> = process.env): StatusConfig {
  const errors: string[] = [];
  const targets = {
    auth: parseTargets(TARGET_VARIABLES.auth, env[TARGET_VARIABLES.auth], errors),
    game: parseTargets(TARGET_VARIABLES.game, env[TARGET_VARIABLES.game], errors),
  };
  const intervalMs = parseInteger("WOW_STATUS_INTERVAL_SECONDS", env.WOW_STATUS_INTERVAL_SECONDS, DEFAULT_INTERVAL_SECONDS, 30, 3_600, errors) * 1_000;
  // Un contrôle doit être fini avant le suivant : le délai reste sous l'intervalle le plus court.
  const timeoutMs = parseInteger("WOW_STATUS_TIMEOUT_MS", env.WOW_STATUS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 500, 10_000, errors);
  const degradedMs = parseInteger("WOW_STATUS_DEGRADED_MS", env.WOW_STATUS_DEGRADED_MS, DEFAULT_DEGRADED_MS, 50, 10_000, errors);
  return {
    targets,
    intervalMs,
    timeoutMs,
    degradedMs,
    // Un service en échec n'est recontrôlé qu'au rythme du backoff : son dernier contrôle reste
    // valable jusque-là.
    staleAfterMs: Math.max(3 * intervalMs, MAX_BACKOFF_MS + intervalMs),
    errors,
  };
}

export function isConfigured(config: StatusConfig): boolean {
  return SERVICE_KEYS.some((service) => config.targets[service].length > 0);
}
