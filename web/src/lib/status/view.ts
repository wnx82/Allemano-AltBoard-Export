import type { Database } from "@/db/client";
import { SERVICE_KEYS, type ServiceKey, type StatusConfig } from "./config";
import { describeOutcome, isStatus, serviceLabel, type Status } from "./status";
import { hourlyBuckets, lastAnswers, latestChecks, listTransitions, type CheckRow, type HourBucket, type TransitionRow } from "./store";

// Ce que la page affiche, calculé à partir de la base. Les fonctions build* sont pures.

export type ServiceView = {
  service: ServiceKey;
  label: string;
  /** Nombre d'adresses surveillées ; zéro = service non configuré. */
  targets: number;
  status: Status;
  detail: string;
  latencyMs: number | null;
  checkedAt: string | null;
  /** Dernier contrôle trop ancien pour valoir état présent. */
  stale: boolean;
  /** Dernière mesure valide, rappelée quand le service ne répond plus ou n'est plus mesuré. */
  lastAnswer: { at: string; latencyMs: number | null } | null;
};

export function buildServiceView(
  service: ServiceKey,
  config: StatusConfig,
  latest: CheckRow | undefined,
  answer: CheckRow | undefined,
  now: Date,
): ServiceView {
  const base = {
    service,
    label: serviceLabel(service, config.label),
    targets: config.targets[service].length,
    latencyMs: null,
    checkedAt: latest ? latest.checkedAt.toISOString() : null,
    stale: false,
    lastAnswer: answer ? { at: answer.checkedAt.toISOString(), latencyMs: answer.latencyMs } : null,
  };
  if (base.targets === 0) return { ...base, status: "unknown", detail: "Aucune adresse configurée" };
  if (!latest) return { ...base, status: "unknown", detail: "Aucun contrôle enregistré pour l'instant" };
  if (now.getTime() - latest.checkedAt.getTime() > config.staleAfterMs) {
    return { ...base, status: "unknown", stale: true, detail: "Dernier contrôle trop ancien : la surveillance ne tourne plus ou n'écrit plus" };
  }
  const status = isStatus(latest.status) ? latest.status : "unknown";
  const answering = status === "up" || status === "degraded";
  return {
    ...base,
    status,
    detail: describeOutcome(latest, config),
    latencyMs: answering ? latest.latencyMs : null,
    // Le service répond : sa dernière mesure valide est celle affichée.
    lastAnswer: answering ? null : base.lastAnswer,
  };
}

export type WindowKey = "24h" | "7d";

const HOUR_MS = 3_600_000;
export const WINDOW_HOURS: Record<WindowKey, number> = { "24h": 24, "7d": 7 * 24 };
/** Durée mesurée en deçà de laquelle un pourcentage ne voudrait rien dire. */
export const MIN_MEASURED_SECONDS: Record<WindowKey, number> = { "24h": 30 * 60, "7d": 24 * 3_600 };

export type Availability = {
  window: WindowKey;
  /** Null : échantillon insuffisant, aucun pourcentage n'est affiché. */
  percent: number | null;
  measuredSeconds: number;
  downSeconds: number;
};

const hourStart = (date: Date) => Math.floor(date.getTime() / HOUR_MS) * HOUR_MS;

/** Disponibilité sur les `WINDOW_HOURS` dernières heures pleines, heure en cours comprise. */
export function buildAvailability(buckets: HourBucket[], window: WindowKey, now: Date): Availability {
  const from = hourStart(now) - (WINDOW_HOURS[window] - 1) * HOUR_MS;
  let available = 0;
  let down = 0;
  for (const bucket of buckets) {
    if (bucket.hour.getTime() < from) continue;
    available += bucket.availableSeconds;
    down += bucket.downSeconds;
  }
  const measured = available + down;
  return {
    window,
    percent: measured >= MIN_MEASURED_SECONDS[window] ? (available / measured) * 100 : null,
    measuredSeconds: Math.round(measured),
    downSeconds: Math.round(down),
  };
}

export type HourCell = {
  start: string;
  /** Pire statut constaté dans l'heure ; null : aucune mesure. */
  status: Exclude<Status, "unknown"> | null;
  availableSeconds: number;
  downSeconds: number;
};

/** Les 24 dernières heures, de la plus ancienne à l'heure en cours. */
export function buildHours(buckets: HourBucket[], now: Date, hours = 24): HourCell[] {
  const byHour = new Map(buckets.map((bucket) => [bucket.hour.getTime(), bucket]));
  const last = hourStart(now);
  return Array.from({ length: hours }, (_, index) => {
    const start = last - (hours - 1 - index) * HOUR_MS;
    const bucket = byHour.get(start);
    const availableSeconds = Math.round(bucket?.availableSeconds ?? 0);
    const downSeconds = Math.round(bucket?.downSeconds ?? 0);
    let status: HourCell["status"] = null;
    if (downSeconds > 0) status = "down";
    else if ((bucket?.degradedSeconds ?? 0) > 0) status = "degraded";
    else if (availableSeconds > 0) status = "up";
    return { start: new Date(start).toISOString(), status, availableSeconds, downSeconds };
  });
}

export type TransitionView = {
  at: string;
  service: ServiceKey;
  label: string;
  from: Status;
  to: Status;
  detail: string;
};

export function buildTransitions(rows: TransitionRow[], config: StatusConfig): TransitionView[] {
  return rows
    .filter((row): row is TransitionRow & { service: ServiceKey } => (SERVICE_KEYS as string[]).includes(row.service))
    .map((row) => ({
      at: row.checkedAt.toISOString(),
      service: row.service,
      label: serviceLabel(row.service, config.label),
      from: isStatus(row.previous) ? row.previous : "unknown",
      to: isStatus(row.status) ? row.status : "unknown",
      detail: describeOutcome(row, config),
    }));
}

export type ServiceHistory = {
  service: ServiceKey;
  label: string;
  availability: Availability[];
  hours: HourCell[];
};

export type ServerStatusView = {
  configured: boolean;
  services: ServiceView[];
  history: ServiceHistory[];
  transitions: TransitionView[];
  /** Vrai si au moins un contrôle existe : sinon l'historique n'a rien à montrer. */
  hasHistory: boolean;
};

export const TRANSITIONS_SHOWN = 30;

/** État présent seul, en deux requêtes : pour un résumé hors de la page dédiée. */
export async function getServiceViews(db: Database, config: StatusConfig, now: Date): Promise<ServiceView[]> {
  const [latest, answers] = await Promise.all([latestChecks(db), lastAnswers(db)]);
  return SERVICE_KEYS.map((service) =>
    buildServiceView(
      service,
      config,
      latest.find((row) => row.service === service),
      answers.find((row) => row.service === service),
      now,
    ),
  );
}

/** Tout ce qu'affiche la page, en quatre requêtes quel que soit le volume d'historique. */
export async function getServerStatusView(db: Database, config: StatusConfig, now: Date): Promise<ServerStatusView> {
  const since = new Date(hourStart(now) - (WINDOW_HOURS["7d"] - 1) * HOUR_MS);
  const [services, buckets, transitions] = await Promise.all([
    getServiceViews(db, config, now),
    hourlyBuckets(db, since, now, config.staleAfterMs),
    listTransitions(db, since, TRANSITIONS_SHOWN),
  ]);
  const history = SERVICE_KEYS.map((service) => {
    const own = buckets.filter((bucket) => bucket.service === service);
    return {
      service,
      label: serviceLabel(service, config.label),
      availability: [buildAvailability(own, "24h", now), buildAvailability(own, "7d", now)],
      hours: buildHours(own, now),
    };
  });
  return {
    configured: services.some((service) => service.targets > 0),
    services,
    history,
    transitions: buildTransitions(transitions, config),
    hasHistory: buckets.length > 0 || services.some((service) => service.checkedAt !== null),
  };
}
