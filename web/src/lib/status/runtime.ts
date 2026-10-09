import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { getDatabase } from "@/db/client";
import { readSettings } from "@/lib/settings/store";
import { loadStatusConfig, type SiteStatusSettings, type StatusConfig } from "./config";
import { StatusMonitor } from "./monitor";
import { probeTcp } from "./probe";
import { pruneChecks, recordChecks } from "./store";

export type StatusRuntime = { config: StatusConfig; monitor: StatusMonitor };

type Holder = {
  runtime: StatusRuntime;
  /** Réglages du site appliqués, tels que lus en base ; null tant que la base n'a pas été lue. */
  applied: string | null;
  /** File des applications : une à la fois. */
  queue: Promise<unknown>;
};

type GlobalWithStatus = typeof globalThis & { __wowAltboardStatus?: Holder };

function build(site?: SiteStatusSettings): StatusRuntime {
  const config = loadStatusConfig(process.env, site);
  const monitor = new StatusMonitor({
    config,
    probe: probeTcp,
    // La base n'est ouverte qu'au premier contrôle, jamais à la création du moniteur.
    store: {
      record: (checks) => recordChecks(getDatabase(), checks),
      prune: async (before) => {
        await pruneChecks(getDatabase(), before);
      },
    },
  });
  return { config, monitor };
}

// Singleton sur globalThis : instrumentation.ts et les pages sont compilées séparément, elles ne
// partagent pas l'état d'un module. Un seul moniteur doit exister par processus.
function holder(): Holder {
  const global = globalThis as GlobalWithStatus;
  global.__wowAltboardStatus ??= { runtime: build(), applied: null, queue: Promise.resolve() };
  return global.__wowAltboardStatus;
}

async function apply(held: Holder): Promise<StatusRuntime> {
  let site: SiteStatusSettings;
  try {
    const settings = await readSettings(getDatabase());
    site = { authTargets: settings.statusAuthTargets, gameTargets: settings.statusGameTargets, label: settings.statusLabel };
  } catch {
    // Base injoignable : la configuration en place continue de servir, la lecture sera retentée
    // au prochain appel.
    console.log(JSON.stringify({ event: "server_status.settings_unavailable" }));
    held.runtime.monitor.start();
    return held.runtime;
  }

  const key = JSON.stringify(site);
  if (key !== held.applied) {
    // L'ancien moniteur est arrêté avant que le nouveau ne démarre : jamais deux à la fois.
    await held.runtime.monitor.stop();
    held.runtime = build(site);
    held.applied = key;
  }
  held.runtime.monitor.start();
  return held.runtime;
}

/**
 * Configuration et moniteur en service, réglages de la page Paramètres compris. Ces réglages sont
 * lus en base au premier appel, puis seulement avec `force` (après un enregistrement) : si les
 * adresses ou le libellé ont changé, le moniteur est remplacé et relancé, sans redémarrer le
 * serveur.
 */
export function syncStatusRuntime(force = false): Promise<StatusRuntime> {
  const held = holder();
  // À la construction, Next évalue les pages sans base ni réseau : ni lecture, ni moniteur.
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return Promise.resolve(held.runtime);
  if (held.applied !== null && !force) return Promise.resolve(held.runtime);
  // Une application à la fois : deux lectures concurrentes laisseraient tourner deux moniteurs.
  const next = held.queue.then(() => (held.applied !== null && !force ? held.runtime : apply(held)));
  held.queue = next.catch(() => undefined);
  return next;
}
