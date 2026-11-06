import { addDays } from "./days";
import { itemLabel, type EconomyContext } from "./load";
import type { ItemStats } from "./prices";

// Vue de la page Marché : recherche, tri, pagination, plus fortes variations et prix anormaux.
// Fonction pure du contexte du moteur : aucune valeur n'y est calculée qui ne vienne des relevés.

export const PAGE_SIZE = 50;
const MOVERS = 8;
/** Confiance minimale d'une variation mise en avant : un marché trop étroit varie pour rien. */
const MOVER_MIN_CONFIDENCE = 40;

export const SORTS = [
  { key: "held", label: "Valeur détenue" },
  { key: "value", label: "Valeur de marché" },
  { key: "change", label: "Variation 7 j" },
  { key: "name", label: "Nom" },
] as const;

export type MarketSort = (typeof SORTS)[number]["key"];

export type MarketRow = {
  itemKey: string;
  label: string;
  stats: ItemStats;
  owned: number;
  heldValue: number | null;
  vendorPrice: number | null;
  /** Plus bas journaliers des 30 derniers jours relevés, pour la tendance miniature. */
  spark: number[];
};

export type MarketView = {
  rows: MarketRow[];
  total: number;
  page: number;
  pages: number;
  rising: MarketRow[];
  falling: MarketRow[];
  anomalies: MarketRow[];
  anomalyCount: number;
  tracked: number;
  held: number;
};

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export function buildMarketView(
  context: EconomyContext,
  options: { query: string; owned: boolean; sort: MarketSort; page: number },
): MarketView {
  const from = addDays(context.today, -29);
  const all: MarketRow[] = [...context.stats.values()].map((stats) => {
    const owned = context.stock.get(stats.itemKey) ?? 0;
    return {
      itemKey: stats.itemKey,
      label: itemLabel(context.names, stats.itemKey),
      stats,
      owned,
      heldValue: stats.marketValue === null || owned === 0 ? null : stats.marketValue * owned,
      vendorPrice: context.vendor.get(stats.itemKey) ?? null,
      spark: (context.days.get(stats.itemKey) ?? []).filter((d) => d.day >= from && (context.historyFrom === null || d.day >= context.historyFrom)).map((d) => d.low),
    };
  });

  const needle = options.query.trim().toLocaleLowerCase("fr");
  const filtered = all.filter(
    (row) => (!options.owned || row.owned > 0) && (needle === "" || row.label.toLocaleLowerCase("fr").includes(needle) || row.itemKey === needle),
  );
  const byName = (a: MarketRow, b: MarketRow) => collator.compare(a.label, b.label) || a.itemKey.localeCompare(b.itemKey);
  const desc = (pick: (row: MarketRow) => number | null) => (a: MarketRow, b: MarketRow) =>
    (pick(b) ?? -Infinity) - (pick(a) ?? -Infinity) || byName(a, b);
  const sorters: Record<MarketSort, (a: MarketRow, b: MarketRow) => number> = {
    held: (a, b) => desc((row) => row.heldValue)(a, b) || desc((row) => row.stats.marketValue)(a, b),
    value: desc((row) => row.stats.marketValue),
    change: desc((row) => row.stats.change7d),
    name: byName,
  };
  filtered.sort(sorters[options.sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, options.page), pages);

  const movers = all.filter((row) => row.stats.change7d !== null && row.stats.confidence >= MOVER_MIN_CONFIDENCE && row.stats.daysObserved30 >= 3);
  return {
    rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: filtered.length,
    page,
    pages,
    rising: movers.filter((row) => row.stats.change7d! > 0).sort(desc((row) => row.stats.change7d)).slice(0, MOVERS),
    falling: movers
      .filter((row) => row.stats.change7d! < 0)
      .sort((a, b) => a.stats.change7d! - b.stats.change7d! || byName(a, b))
      .slice(0, MOVERS),
    anomalies: all.filter((row) => row.stats.outlier).sort(desc((row) => row.stats.outlierScore)).slice(0, MOVERS),
    anomalyCount: all.filter((row) => row.stats.outlier).length,
    tracked: all.length,
    held: all.filter((row) => row.owned > 0).length,
  };
}
