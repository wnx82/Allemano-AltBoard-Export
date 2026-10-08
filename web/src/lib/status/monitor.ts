import { isConfigured, MAX_BACKOFF_MS, SERVICE_KEYS, type ServiceKey, type StatusConfig, type Target } from "./config";
import type { ProbeOptions, ProbeResult } from "./probe";
import { evaluateService, type Evaluation, type Status } from "./status";

// Ordonnanceur des contrôles. Un seul tour à la fois ; un service en échec répété est contrôlé
// moins souvent ; une demande manuelle rejoint le tour en cours au lieu d'en lancer un second.

export type CheckRecord = Evaluation & { service: ServiceKey; checkedAt: Date; source: string };

export type MonitorStore = {
  record(checks: CheckRecord[]): Promise<void>;
  prune(before: Date): Promise<void>;
};

export type MonitorDeps = {
  config: StatusConfig;
  probe: (target: Target, options: ProbeOptions) => Promise<ProbeResult>;
  store: MonitorStore;
  now?: () => Date;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  log?: (event: Record<string, unknown>) => void;
};

/** Échecs consécutifs tolérés au rythme normal avant d'espacer les contrôles. */
export const BACKOFF_AFTER = 3;
/** Deux demandes manuelles rapprochées ne valent qu'un contrôle. */
export const MANUAL_COOLDOWN_MS = 10_000;
/** L'historique affiché couvre sept jours : un jour de marge. */
export const RETENTION_MS = 8 * 24 * 3_600_000;
const PRUNE_EVERY_MS = 3_600_000;

/** Délai avant le prochain contrôle d'un service : il double à chaque échec au-delà du seuil. */
export function nextDelay(failures: number, intervalMs: number): number {
  if (failures < BACKOFF_AFTER) return intervalMs;
  return Math.min(intervalMs * 2 ** (failures - BACKOFF_AFTER + 1), Math.max(intervalMs, MAX_BACKOFF_MS));
}

/** checked : contrôle fait ; joined : celui en cours a été attendu ; recent : le dernier suffit. */
export type RefreshResult = "checked" | "joined" | "recent" | "unconfigured";

export class StatusMonitor {
  private readonly now: () => Date;
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly log: (event: Record<string, unknown>) => void;

  private started = false;
  private timer: unknown;
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private lastRoundAt: number | null = null;
  private lastPruneAt: number | null = null;
  private readonly failures = new Map<ServiceKey, number>();
  private readonly dueAt = new Map<ServiceKey, number>();
  private readonly lastStatus = new Map<ServiceKey, Status>();

  constructor(private readonly deps: MonitorDeps) {
    this.now = deps.now ?? (() => new Date());
    this.setTimer =
      deps.setTimer ??
      ((callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        // Le minuteur ne doit jamais retenir l'arrêt du serveur.
        timer.unref();
        return timer;
      });
    this.clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as NodeJS.Timeout));
    this.log = deps.log ?? ((event) => console.log(JSON.stringify(event)));
  }

  get active(): boolean {
    return this.started;
  }

  /** Lance les contrôles périodiques. Sans adresse configurée, rien ne démarre. */
  start(): void {
    if (this.started || !isConfigured(this.deps.config)) return;
    this.started = true;
    this.schedule(0);
  }

  /** Arrête le minuteur, interrompt les connexions en cours et attend leur fermeture. */
  async stop(): Promise<void> {
    this.started = false;
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.running;
  }

  /** Contrôle à la demande : tous les services, quel que soit leur backoff. */
  async refresh(): Promise<RefreshResult> {
    if (!isConfigured(this.deps.config)) return "unconfigured";
    if (this.running) {
      await this.running;
      return "joined";
    }
    if (this.lastRoundAt !== null && this.now().getTime() - this.lastRoundAt < MANUAL_COOLDOWN_MS) return "recent";
    await this.round(true);
    return "checked";
  }

  private schedule(delayMs: number): void {
    if (!this.started) return;
    this.timer = this.setTimer(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    const startedAt = this.now().getTime();
    // Un contrôle manuel en cours tient lieu de ce passage.
    if (!this.running) await this.round(false);
    // Cadence tenue depuis le début du tour, pas depuis sa fin.
    this.schedule(Math.max(1_000, this.deps.config.intervalMs - (this.now().getTime() - startedAt)));
  }

  private round(force: boolean): Promise<void> {
    this.running = this.execute(force).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async execute(force: boolean): Promise<void> {
    const { config, probe, store } = this.deps;
    const startedAt = this.now();
    const due = SERVICE_KEYS.filter(
      (service) => config.targets[service].length > 0 && (force || (this.dueAt.get(service) ?? 0) <= startedAt.getTime()),
    );
    if (due.length === 0) return;

    const controller = new AbortController();
    this.controller = controller;
    try {
      const checks: CheckRecord[] = await Promise.all(
        due.map(async (service) => {
          const results = await Promise.all(
            config.targets[service].map((target) =>
              probe(target, { timeoutMs: config.timeoutMs, signal: controller.signal }).catch(
                (): ProbeResult => ({ outcome: "error", latencyMs: null, error: "UNKNOWN" }),
              ),
            ),
          );
          return { service, checkedAt: startedAt, source: "tcp", ...evaluateService(results, config.degradedMs) };
        }),
      );
      // Arrêt demandé : des sondes interrompues ne sont pas des mesures.
      if (controller.signal.aborted) return;

      for (const check of checks) this.remember(check);
      this.lastRoundAt = this.now().getTime();
      try {
        await store.record(checks);
        if (this.lastPruneAt === null || startedAt.getTime() - this.lastPruneAt >= PRUNE_EVERY_MS) {
          this.lastPruneAt = startedAt.getTime();
          await store.prune(new Date(startedAt.getTime() - RETENTION_MS));
        }
      } catch {
        // Base indisponible : la mesure est perdue, la surveillance continue.
        this.log({ event: "server_status.store_failed" });
      }
    } finally {
      this.controller = null;
    }
  }

  private remember(check: CheckRecord): void {
    const failed = check.status === "down" || check.status === "unknown";
    const failures = failed ? (this.failures.get(check.service) ?? 0) + 1 : 0;
    this.failures.set(check.service, failures);
    // Demi-intervalle de marge : un passage légèrement en avance reste éligible.
    const delay = nextDelay(failures, this.deps.config.intervalMs);
    this.dueAt.set(check.service, check.checkedAt.getTime() + delay - this.deps.config.intervalMs / 2);

    const previous = this.lastStatus.get(check.service);
    this.lastStatus.set(check.service, check.status);
    if (previous !== undefined && previous !== check.status) {
      this.log({ event: "server_status.changed", service: check.service, from: previous, to: check.status, outcome: check.outcome });
    }
  }
}
