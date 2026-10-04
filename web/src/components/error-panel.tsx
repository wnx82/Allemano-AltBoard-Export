"use client";

import { useEffect } from "react";

// Affiché quand une page ne peut pas lire ses données (base indisponible, par exemple).
// Le détail technique reste dans les journaux du serveur : rien n'en est montré ici.
export function ErrorPanel({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="panel mx-auto mt-10 max-w-xl px-6 py-10 text-center" role="alert">
      <p className="display text-lg font-bold text-gold">Les données sont momentanément indisponibles</p>
      <p className="mt-2 text-sm text-muted">Le serveur n&apos;a pas pu lire la base. Vos personnages ne sont pas perdus : réessayez dans un instant.</p>
      {error.digest && <p className="mt-2 text-xs text-faint">Référence : {error.digest}</p>}
      <button type="button" className="button mt-5" data-variant="primary" onClick={() => retry()}>
        Réessayer
      </button>
    </div>
  );
}
