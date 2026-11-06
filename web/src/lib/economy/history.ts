import type { Recipe } from "./craft";
import { addDays } from "./days";
import type { DayObservation } from "./prices";

// Historiques dérivés des relevés journaliers : périodes d'affichage et rentabilité passée d'une
// recette. Fonctions pures ; un jour sans relevé reste un trou, il n'est jamais interpolé.

export const PERIODS = [
  { key: "7", label: "7 jours", days: 7 },
  { key: "30", label: "30 jours", days: 30 },
  { key: "90", label: "90 jours", days: 90 },
  { key: "all", label: "Tout", days: null },
] as const;

export type Period = (typeof PERIODS)[number];

export const DEFAULT_PERIOD: Period = PERIODS[1];

export function findPeriod(key: string | string[] | undefined): Period {
  return PERIODS.find((period) => period.key === key) ?? DEFAULT_PERIOD;
}

/** Relevés de la période (jours inclus jusqu'à aujourd'hui) et postérieurs au début de l'historique. */
export function withinPeriod<T extends { day: string }>(days: readonly T[], period: Period, today: string, historyFrom: string | null): T[] {
  const from = period.days === null ? null : addDays(today, -(period.days - 1));
  return days.filter((d) => (from === null || d.day >= from) && (historyFrom === null || d.day >= historyFrom) && d.day <= today);
}

export type CraftHistoryPoint = { day: string; outputNet: number; cost: number; profit: number };

/**
 * Rentabilité passée d'une recette, jour par jour, au plus bas du jour : seuls les jours où le
 * produit ET chaque composant non vendu par un marchand ont un relevé sont calculés.
 */
export function craftHistory(
  recipe: Recipe,
  daysOf: (itemKey: string) => readonly DayObservation[],
  vendorPriceOf: (itemKey: string) => number | undefined,
  auctionCut: number,
): CraftHistoryPoint[] {
  const lowByDay = (itemKey: string) => new Map(daysOf(itemKey).map((d) => [d.day, d.low]));
  const output = lowByDay(String(recipe.outputItemId));
  const reagents = recipe.reagents.map((r) => {
    const itemKey = String(r.itemId);
    return { quantity: r.quantity, vendor: vendorPriceOf(itemKey), lows: lowByDay(itemKey) };
  });
  const points: CraftHistoryPoint[] = [];
  for (const [day, low] of [...output].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let cost = 0;
    let complete = true;
    for (const reagent of reagents) {
      const market = reagent.lows.get(day);
      // Même règle que le moteur : le prix du marchand s'il est connu et moins cher.
      const unit = reagent.vendor !== undefined && (market === undefined || reagent.vendor <= market) ? reagent.vendor : market;
      if (unit === undefined) {
        complete = false;
        break;
      }
      cost += unit * reagent.quantity;
    }
    if (!complete) continue;
    const outputNet = low * recipe.outputQuantity * (1 - auctionCut);
    points.push({ day, outputNet, cost, profit: outputNet - cost });
  }
  return points;
}
