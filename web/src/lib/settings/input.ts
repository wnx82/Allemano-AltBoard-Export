import { isIP } from "node:net";
import { formatTarget, MAX_LABEL_LENGTH, MAX_TARGETS, parseTarget, splitTargets, type Target } from "@/lib/status/config";
import { isPublicAddress } from "@/lib/status/guard";

// Validation des saisies de la page Paramètres. Une valeur refusée n'est jamais enregistrée : la
// configuration lue au démarrage reste toujours exploitable.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Adresses saisies pour un service. Renvoie la forme enregistrée : « hôte:port » séparées par des
 * virgules, chaîne vide quand rien n'est à surveiller.
 */
export function parseTargetsInput(raw: string): Parsed<string> {
  const targets: Target[] = [];
  for (const [index, entry] of splitTargets(raw).entries()) {
    const target = parseTarget(entry);
    if (!target) return { ok: false, error: `Adresse n° ${index + 1} : la forme attendue est hôte:port, par exemple 203.0.113.10:3724.` };
    // Un nom d'hôte est jugé à sa résolution, au moment de la sonde (guard.ts).
    if (isIP(target.host) !== 0 && !isPublicAddress(target.host)) {
      return { ok: false, error: `Adresse n° ${index + 1} : seule une adresse publique peut être surveillée, pas une adresse locale ou privée.` };
    }
    if (!targets.some((known) => known.host === target.host && known.port === target.port)) targets.push(target);
  }
  if (targets.length > MAX_TARGETS) return { ok: false, error: `${MAX_TARGETS} adresses au plus par service.` };
  return { ok: true, value: targets.map(formatTarget).join(",") };
}

/** Libellé d'environnement. Vide : null, le libellé par défaut s'applique. */
export function parseLabelInput(raw: string): Parsed<string | null> {
  const label = raw.trim();
  // Caractères de contrôle refusés : PostgreSQL n'accepte pas l'octet nul dans un texte.
  if (label.length > MAX_LABEL_LENGTH || /[\u0000-\u001f\u007f]/.test(label)) {
    return { ok: false, error: `Libellé invalide (${MAX_LABEL_LENGTH} caractères maximum).` };
  }
  return { ok: true, value: label || null };
}

/**
 * Date limite d'une réinitialisation, reçue en ISO 8601 avec fuseau. Vide : maintenant. Une date
 * future est refusée : elle ferait ignorer tous les personnages jusqu'à cette date.
 */
export function parseCutoffInput(raw: string, now: Date): Parsed<Date> {
  if (raw.trim() === "") return { ok: true, value: now };
  const cutoff = new Date(raw);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw.trim()) || Number.isNaN(cutoff.getTime())) {
    return { ok: false, error: "Date invalide." };
  }
  if (cutoff.getTime() > now.getTime()) return { ok: false, error: "La date ne peut pas être dans le futur." };
  return { ok: true, value: cutoff };
}

/**
 * Premier jour des prix pris en compte (AAAA-MM-JJ, jour du joueur). Vide : null, la date limite
 * des personnages s'applique. Enregistré à midi UTC : le même jour à Bruxelles, été comme hiver.
 */
export function parseHistoryDayInput(raw: string, now: Date): Parsed<Date | null> {
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  const date = new Date(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { ok: false, error: "Date invalide." };
  }
  if (date.getTime() - 12 * 3600_000 > now.getTime()) return { ok: false, error: "La date ne peut pas être dans le futur." };
  return { ok: true, value: date };
}

export const MAX_AUCTION_CUT_PERCENT = 50;

/** Commission de l'hôtel des ventes, en pourcentage (virgule acceptée). Vide : null, 5 % s'applique. */
export function parseAuctionCutInput(raw: string): Parsed<number | null> {
  const value = raw.trim().replace(",", ".");
  if (value === "") return { ok: true, value: null };
  const percent = Number(value);
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value) || !Number.isFinite(percent) || percent > MAX_AUCTION_CUT_PERCENT) {
    return { ok: false, error: `Commission invalide : un pourcentage de 0 à ${MAX_AUCTION_CUT_PERCENT}.` };
  }
  return { ok: true, value: percent };
}
