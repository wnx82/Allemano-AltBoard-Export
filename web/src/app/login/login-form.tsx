"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/lib/auth/actions";

const initialState: LoginState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="eyebrow">Adresse e-mail</span>
        <input className="field mt-1.5" type="email" name="email" autoComplete="username" required autoFocus />
      </label>
      <label className="block">
        <span className="eyebrow">Mot de passe</span>
        <input className="field mt-1.5" type="password" name="password" autoComplete="current-password" required />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <button className="button w-full" data-variant="primary" type="submit" disabled={pending}>
        {pending ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
