import { getDatabase } from "@/db/client";
import { loadStatusConfig, type StatusConfig } from "./config";
import { StatusMonitor } from "./monitor";
import { probeTcp } from "./probe";
import { pruneChecks, recordChecks } from "./store";

type StatusRuntime = { config: StatusConfig; monitor: StatusMonitor };

type GlobalWithStatus = typeof globalThis & { __wowAltboardStatus?: StatusRuntime };

// Singleton sur globalThis : instrumentation.ts et les pages sont compilées séparément, elles ne
// partagent pas l'état d'un module. Un seul moniteur doit exister par processus.
export function getStatusRuntime(): StatusRuntime {
  const holder = globalThis as GlobalWithStatus;
  if (!holder.__wowAltboardStatus) {
    const config = loadStatusConfig();
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
    holder.__wowAltboardStatus = { config, monitor };
  }
  return holder.__wowAltboardStatus;
}
