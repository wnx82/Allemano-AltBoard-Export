"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDatabase } from "@/db/client";
import { adminUsers } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { requireSession } from "@/lib/auth/session";
import { RateLimiter } from "@/lib/rate-limit";
import { syncStatusRuntime } from "@/lib/status/runtime";
import { pruneChecks } from "@/lib/status/store";
import { parseCutoffInput, parseLabelInput, parseTargetsInput } from "./input";
import { resetCharacters } from "./reset";
import { writeSettings } from "./store";

// Chaque action vérifie la session elle-même : une Server Action est un point d'entrée HTTP à part
// entière, joignable sans passer par la page qui l'affiche.

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** entered : saisie refusée, renvoyée telle quelle pour être corrigée dans le formulaire. */
export type StatusSettingsState = {
  error?: string;
  saved?: boolean;
  restored?: boolean;
  entered?: { label: string; authTargets: string; gameTargets: string };
};

/**
 * Enregistre les serveurs surveillés et leur libellé. Les adresses saisies remplacent celles de
 * l'environnement ; une liste vide arrête la surveillance du service. Le moniteur repart aussitôt
 * sur la nouvelle configuration. Le bouton « restore » du même formulaire rend la main à
 * l'environnement du serveur : ses adresses s'appliquent de nouveau.
 */
export async function saveStatusSettingsAction(_previous: StatusSettingsState, formData: FormData): Promise<StatusSettingsState> {
  await requireSession();
  if (formData.get("intent") === "restore") {
    await writeSettings(getDatabase(), { statusAuthTargets: null, statusGameTargets: null }, new Date());
    await syncStatusRuntime(true);
    console.log(JSON.stringify({ event: "settings.status.restored" }));
    revalidatePath("/", "layout");
    return { restored: true };
  }

  const entered = {
    label: field(formData, "label").slice(0, 200),
    authTargets: field(formData, "authTargets").slice(0, 2_000),
    gameTargets: field(formData, "gameTargets").slice(0, 2_000),
  };
  const label = parseLabelInput(entered.label);
  if (!label.ok) return { error: label.error, entered };
  const auth = parseTargetsInput(entered.authTargets);
  if (!auth.ok) return { error: `Serveur de connexion — ${auth.error}`, entered };
  const game = parseTargetsInput(entered.gameTargets);
  if (!game.ok) return { error: `Serveurs de jeu — ${game.error}`, entered };

  const db = getDatabase();
  const now = new Date();
  await writeSettings(db, { statusAuthTargets: auth.value, statusGameTargets: game.value, statusLabel: label.value }, now);
  await syncStatusRuntime(true);
  const historyCleared = formData.get("clearHistory") === "on";
  // Après l'arrêt de l'ancien moniteur : ses derniers contrôles sont antérieurs à `now`, ceux du
  // nouveau lui sont postérieurs et restent.
  if (historyCleared) await pruneChecks(db, now);

  console.log(JSON.stringify({ event: "settings.status.saved", historyCleared }));
  revalidatePath("/", "layout");
  return { saved: true };
}

export type ResetState = { error?: string; deleted?: number; kept?: number };

const RESET_ATTEMPTS = { max: 5, windowMs: 15 * 60_000 };
const limiter = new RateLimiter();

/**
 * Réinitialise les personnages. Suppression définitive : le mot de passe est redemandé, une
 * session seule ne suffit pas.
 */
export async function resetCharactersAction(_previous: ResetState, formData: FormData): Promise<ResetState> {
  const session = await requireSession();
  const now = new Date();
  const cutoff = parseCutoffInput(field(formData, "cutoff"), now);
  if (!cutoff.ok) return { error: cutoff.error };
  const password = field(formData, "password");
  if (!password || password.length > 1024) return { error: "Saisissez votre mot de passe pour confirmer." };
  if (!limiter.consume(`reset:${session.userId}`, RESET_ATTEMPTS)) return { error: "Trop de tentatives. Réessayez dans quelques minutes." };

  const db = getDatabase();
  const [user] = await db.select({ passwordHash: adminUsers.passwordHash }).from(adminUsers).where(eq(adminUsers.id, session.userId));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    console.warn(JSON.stringify({ event: "settings.characters.reset_refused", userId: session.userId }));
    return { error: "Mot de passe incorrect." };
  }

  const result = await resetCharacters(db, cutoff.value, now);
  console.log(JSON.stringify({ event: "settings.characters.reset", userId: session.userId, deleted: result.deleted, kept: result.kept }));
  revalidatePath("/", "layout");
  return result;
}
