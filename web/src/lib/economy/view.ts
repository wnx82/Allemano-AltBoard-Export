import type { MarketSummary } from "./load";

// Aides d'affichage communes aux pages de l'économie : paramètres d'URL, liens et formats.

/** Marché demandé dans l'URL (?market=) : seul un entier positif est accepté. */
export function marketParam(value: string | string[] | undefined): number | undefined {
  return typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : undefined;
}

/** Suffixe d'URL du marché affiché : vide pour le marché par défaut (le plus récemment relevé). */
export function marketQuery(market: MarketSummary, markets: readonly MarketSummary[], separator: "?" | "&" = "?"): string {
  return markets[0]?.id === market.id ? "" : `${separator}market=${market.id}`;
}

export const ITEM_KEY_PATTERN = /^(\d{1,9}|g:\d{1,9}:\d{1,5}|p:\d{1,9})$/;

export function itemHref(itemKey: string, query = ""): string {
  return `/market/${encodeURIComponent(itemKey)}${query}`;
}

const percentFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
const plainPercent = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** Variation en fraction (0,1) → « +10 % ». */
export function formatChange(value: number | null): string {
  return value === null ? "—" : `${percentFormat.format(value * 100)} %`;
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${plainPercent.format(value * 100)} %`;
}

export function confidenceTone(confidence: number): "ok" | "warn" | "danger" {
  return confidence >= 70 ? "ok" : confidence >= 40 ? "warn" : "danger";
}

const dayFormat = new Intl.DateTimeFormat("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const shortDayFormat = new Intl.DateTimeFormat("fr-BE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Jour Auctionator (AAAA-MM-JJ) → « 06/11/2026 ». */
export function formatDay(day: string | null): string {
  return day ? dayFormat.format(new Date(`${day}T00:00:00Z`)) : "—";
}

export function formatShortDay(day: string): string {
  return shortDayFormat.format(new Date(`${day}T00:00:00Z`));
}

/** Montant court pour un libellé de graphique : « 12,5 po », « 40 pa », « 7 pc ». */
export function formatCopperShort(copper: number): string {
  const sign = copper < 0 ? "−" : "";
  const value = Math.abs(copper);
  const format = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  if (value >= 10_000) return `${sign}${format.format(value / 10_000)} po`;
  if (value >= 100) return `${sign}${format.format(value / 100)} pa`;
  return `${sign}${format.format(Math.round(value))} pc`;
}
