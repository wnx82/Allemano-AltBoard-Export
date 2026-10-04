"use client";

import { ErrorPanel } from "@/components/error-panel";

// Erreur d'une page du tableau de bord : l'en-tête et la navigation restent affichés.
export default function DashboardError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel {...props} />;
}
