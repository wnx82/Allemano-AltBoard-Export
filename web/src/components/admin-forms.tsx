"use client";

import { useActionState, useState } from "react";
import type { ActionState, TokenState } from "@/lib/dashboard/actions";

type RenameAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

/** Nom d'affichage modifiable d'un compte ou d'une machine. Vide = libellé par défaut. */
export function RenameForm({ id, name, placeholder, action, label }: { id: number; name: string | null; placeholder: string; action: RenameAction; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input className="field min-w-40 flex-1" name="name" defaultValue={name ?? ""} placeholder={placeholder} maxLength={60} aria-label={label} />
      <button className="button" type="submit" disabled={pending}>
        {pending ? "…" : "Renommer"}
      </button>
      <span className="basis-full text-xs" role="status">
        {state.error && <span className="text-danger">{state.error}</span>}
        {state.saved && <span className="text-ok">Enregistré.</span>}
      </span>
    </form>
  );
}

type TokenAction = (previous: TokenState, formData: FormData) => Promise<TokenState>;

/** Création d'un jeton d'agent. Le jeton n'est affiché qu'une fois, juste après sa création. */
export function TokenForm({ action }: { action: TokenAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input className="field min-w-48 flex-1" name="label" placeholder="Nom du PC, par exemple PC-Gaming" maxLength={60} required aria-label="Libellé du jeton" />
        <button className="button" data-variant="primary" type="submit" disabled={pending}>
          {pending ? "Création…" : "Créer un jeton"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.token && (
        <div role="status" className="mt-4 rounded-xl border border-gold/40 bg-gold/10 p-4">
          <p className="text-sm font-semibold text-gold">Jeton créé pour « {state.label} »</p>
          <p className="mt-1 text-xs text-muted">Copiez-le maintenant : il ne sera plus jamais affiché. Seule son empreinte est conservée.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-ink/70 px-3 py-2 text-sm">{state.token}</code>
            <button
              type="button"
              className="button"
              onClick={async () => {
                await navigator.clipboard.writeText(state.token!);
                setCopied(true);
              }}
            >
              {copied ? "Copié" : "Copier"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
