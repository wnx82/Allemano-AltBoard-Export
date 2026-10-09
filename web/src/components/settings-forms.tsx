"use client";

import { useActionState } from "react";
import type { ResetState, StatusSettingsState } from "@/lib/settings/actions";

type StatusAction = (previous: StatusSettingsState, formData: FormData) => Promise<StatusSettingsState>;

/** Serveurs surveillés : libellé d'environnement et adresses de chaque service, une par ligne. */
export function StatusSettingsForm({
  action,
  label,
  defaultLabel,
  authTargets,
  gameTargets,
  maxLabelLength,
  fromSite,
}: {
  action: StatusAction;
  label: string | null;
  defaultLabel: string;
  authTargets: string;
  gameTargets: string;
  maxLabelLength: number;
  /** Vrai quand des adresses sont définies ici : l'environnement du serveur peut reprendre la main. */
  fromSite: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  // Saisie refusée : elle reste affichée pour être corrigée, au lieu de revenir aux valeurs en service.
  const entered = state.entered;

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="eyebrow">Environnement affiché</span>
        <input className="field mt-1.5 block max-w-xs" name="label" defaultValue={entered?.label ?? label ?? ""} placeholder={defaultLabel} maxLength={maxLabelLength} />
        <span className="mt-1 block text-xs text-faint">
          Écrit à côté des serveurs, par exemple « Bêta » ou « EU ». Vide : « {defaultLabel} ».
        </span>
      </label>
      <label className="block">
        <span className="eyebrow">Serveur de connexion</span>
        <textarea
          className="field mt-1.5 font-mono"
          name="authTargets"
          rows={2}
          defaultValue={entered?.authTargets ?? authTargets}
          placeholder="test.actual.battle.net:1119"
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className="eyebrow">Serveurs de jeu</span>
        <textarea
          className="field mt-1.5 font-mono"
          name="gameTargets"
          rows={5}
          defaultValue={entered?.gameTargets ?? gameTargets}
          placeholder="203.0.113.10:3724"
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="flex items-start gap-2 text-sm text-muted">
        <input className="mt-0.5" type="checkbox" name="clearHistory" />
        <span>Effacer l&apos;historique des contrôles : disponibilité et changements d&apos;état repartent de zéro.</span>
      </label>
      {/* Deux boutons, un seul formulaire : après l'un comme l'autre, les champs reprennent les valeurs en service. */}
      <div className="flex flex-wrap items-center gap-3">
        <button className="button" data-variant="primary" type="submit" name="intent" value="save" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {fromSite && (
          <button
            className="button"
            type="submit"
            name="intent"
            value="restore"
            disabled={pending}
            title="Les adresses de WOW_STATUS_AUTH_TARGETS et WOW_STATUS_GAME_TARGETS s'appliquent de nouveau"
          >
            Revenir aux adresses de l&apos;environnement
          </button>
        )}
        <span className="basis-full text-sm" role="status">
          {state.error && <span className="text-danger">{state.error}</span>}
          {state.saved && <span className="text-ok">Enregistré : la surveillance repart sur ces adresses.</span>}
          {state.restored && <span className="text-ok">Les adresses de l&apos;environnement du serveur s&apos;appliquent de nouveau.</span>}
        </span>
      </div>
    </form>
  );
}

type ResetAction = (previous: ResetState, formData: FormData) => Promise<ResetState>;

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

/** Réinitialisation des personnages : date limite facultative, mot de passe exigé. */
export function ResetCharactersForm({ action }: { action: ResetAction }) {
  const [state, formAction, pending] = useActionState(action, {});

  // Le champ donne une heure locale, sans fuseau : c'est ici, dans le navigateur, qu'elle devient
  // un instant. Le serveur ne connaît pas le fuseau de la personne qui saisit.
  const submit = (formData: FormData) => {
    const local = formData.get("cutoffLocal");
    formData.delete("cutoffLocal");
    if (typeof local === "string" && local !== "") {
      const date = new Date(local);
      formData.set("cutoff", Number.isNaN(date.getTime()) ? local : date.toISOString());
    }
    return formAction(formData);
  };

  return (
    <form action={submit} className="space-y-4">
      <label className="block">
        <span className="eyebrow">Garder les personnages vus en jeu depuis</span>
        <input className="field mt-1.5 block max-w-xs" type="datetime-local" name="cutoffLocal" />
        <span className="mt-1 block text-xs text-faint">
          Facultatif, par exemple l&apos;heure d&apos;ouverture des serveurs. Vide : tous les personnages sont supprimés.
        </span>
      </label>
      <label className="block">
        <span className="eyebrow">Mot de passe</span>
        <input className="field mt-1.5 block max-w-xs" type="password" name="password" autoComplete="current-password" required />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="button" data-variant="danger" type="submit" disabled={pending}>
          {pending ? "Suppression…" : "Réinitialiser les personnages"}
        </button>
        <span className="text-sm" role="status">
          {state.error && <span className="text-danger">{state.error}</span>}
          {state.deleted !== undefined && (
            <span className="text-ok">
              {plural(state.deleted, "personnage supprimé", "personnages supprimés")}, {plural(state.kept ?? 0, "conservé", "conservés")}.
            </span>
          )}
        </span>
      </div>
    </form>
  );
}
