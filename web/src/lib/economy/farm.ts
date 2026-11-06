import type { ItemStats } from "./prices";

// Moteur de farm (voir docs/ECONOMY-ENGINE.md).
// V1 : signal de marché — une ressource chère par rapport à son historique, peu offerte et stable
//      vaut d'être récoltée maintenant. Ce n'est PAS un rendement : aucun po/h n'en est déduit.
// V2 : rendement personnel — différence d'inventaire entre deux relevés réels, valorisée au marché.

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export type FarmSignal = {
  itemKey: string;
  score: number;
  premium: number;
  supplyRatio: number | null;
  priceScore: number;
  supplyScore: number;
  stabilityScore: number;
  unitValue: number;
  confidence: number;
  reasons: string[];
};

export function farmSignal(stats: ItemStats): FarmSignal | null {
  if (stats.current === null || stats.median30 === null || stats.marketValue === null || stats.median30 <= 0) return null;
  const premium = stats.current.minCopper / stats.median30 - 1;
  const supplyRatio = stats.lastAvailable !== null && stats.medianAvailable30 ? stats.lastAvailable / stats.medianAvailable30 : null;
  // −10 % sous la médiane : 0 ; +40 % au-dessus : 1.
  const priceScore = clamp((premium + 0.1) / 0.5);
  // Offre moitié moindre que d'habitude : 1 ; moitié plus abondante : 0.
  const supplyScore = supplyRatio === null ? 0.5 : clamp(1.5 - supplyRatio);
  const stabilityScore = stats.confidenceFactors.stability;
  const reasons: string[] = [];
  if (premium >= 0.1) reasons.push("PRICE_ABOVE_MEDIAN");
  if (premium <= -0.1) reasons.push("PRICE_BELOW_MEDIAN");
  if (supplyRatio !== null && supplyRatio <= 0.7) reasons.push("LOW_SUPPLY");
  if (stabilityScore >= 0.8) reasons.push("STABLE_MARKET");
  if (stats.thinMarket) reasons.push("THIN_MARKET");
  if (stats.outlier) reasons.push("PRICE_OUTLIER");
  return {
    itemKey: stats.itemKey,
    score: Math.round(100 * (0.5 * priceScore + 0.25 * supplyScore + 0.25 * stabilityScore)),
    premium,
    supplyRatio,
    priceScore,
    supplyScore,
    stabilityScore,
    unitValue: stats.marketValue,
    confidence: stats.confidence,
    reasons,
  };
}

export type SessionItem = { itemKey: string; delta: number; unitValue: number | null; value: number | null };

export type SessionValuation = {
  durationSeconds: number;
  moneyDelta: number;
  items: SessionItem[];
  itemsValue: number;
  /** Objets gagnés ou perdus sans prix de marché connu : listés, jamais valorisés. */
  unvaluedItems: number;
  totalValue: number;
  perHour: number | null;
};

/**
 * @param valueOf valeur réalisable d'une unité (prix de marché, commission déduite), ou null
 */
export function valueSession(
  start: ReadonlyMap<string, number>,
  end: ReadonlyMap<string, number>,
  moneyDelta: number,
  durationSeconds: number,
  valueOf: (itemKey: string) => number | null,
): SessionValuation {
  const keys = new Set([...start.keys(), ...end.keys()]);
  const items: SessionItem[] = [];
  for (const itemKey of keys) {
    const delta = (end.get(itemKey) ?? 0) - (start.get(itemKey) ?? 0);
    if (delta === 0) continue;
    const unitValue = valueOf(itemKey);
    items.push({ itemKey, delta, unitValue, value: unitValue === null ? null : Math.round(unitValue * delta) });
  }
  items.sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0) || a.itemKey.localeCompare(b.itemKey));
  const itemsValue = items.reduce((total, item) => total + (item.value ?? 0), 0);
  const totalValue = itemsValue + moneyDelta;
  return {
    durationSeconds,
    moneyDelta,
    items,
    itemsValue,
    unvaluedItems: items.filter((item) => item.value === null).length,
    totalValue,
    perHour: durationSeconds > 0 ? Math.round((totalValue * 3600) / durationSeconds) : null,
  };
}
