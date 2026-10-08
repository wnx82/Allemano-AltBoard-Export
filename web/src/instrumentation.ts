import { PHASE_PRODUCTION_BUILD } from "next/constants";

// Appelé une fois au démarrage du serveur : lance la surveillance des serveurs de jeu
// (voir docs/SERVER-STATUS.md). Sans adresse configurée, rien ne démarre.
export async function register() {
  // Sondes TCP et base de données : runtime Node.js seulement, jamais pendant la construction.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
  const { getStatusRuntime } = await import("@/lib/status/runtime");
  getStatusRuntime().monitor.start();
}
