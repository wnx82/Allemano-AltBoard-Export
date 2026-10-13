"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useTransition } from "react";
import type { RefreshState } from "@/lib/status/actions";
import { formatEvery } from "@/lib/status/status";

/**
 * Actualisation de la page d'état : relecture périodique de ce que le serveur a mesuré, et bouton
 * de contrôle à la demande. Le navigateur ne sonde rien lui-même.
 */
export function StatusRefresh({
  action,
  intervalSeconds,
  enabled,
}: {
  action: () => Promise<RefreshState>;
  intervalSeconds: number;
  /** Faux sans adresse configurée : il n'y a rien à relire ni à contrôler. */
  enabled: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  const [reloading, startReload] = useTransition();

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      // Onglet en arrière-plan : aucune requête ; l'affichage se rattrape au retour.
      if (document.visibilityState === "visible") startReload(() => router.refresh());
    }, intervalSeconds * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") startReload(() => router.refresh());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalSeconds, router]);

  const busy = pending || reloading;

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      <span className="flex items-center gap-1.5 text-xs text-faint">
        <span className="refresh-dot" data-busy={busy ? "" : undefined} aria-hidden="true" />
        {enabled ? `Actualisation automatique ${formatEvery(intervalSeconds)}` : "Actualisation automatique inactive"}
      </span>
      <button className="button" type="submit" disabled={pending || !enabled}>
        {pending ? "Contrôle…" : "Actualiser"}
      </button>
      <span className="basis-full text-right text-xs" role="status">
        {state.error && <span className="text-danger">{state.error}</span>}
        {state.message && <span className="text-muted">{state.message}</span>}
      </span>
    </form>
  );
}
