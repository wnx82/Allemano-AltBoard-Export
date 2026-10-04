"use client";

import { ErrorPanel } from "@/components/error-panel";

// Erreur survenue plus haut que les pages : typiquement la vérification de session du layout
// quand la base est injoignable.
export default function RootError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="px-4">
      <ErrorPanel {...props} />
    </main>
  );
}
