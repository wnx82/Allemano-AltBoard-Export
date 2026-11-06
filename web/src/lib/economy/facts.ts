import { DECISION_LABELS } from "./craft";
import { itemLabel, type EconomyContext } from "./load";
import { KIND_LABELS, REASON_LABELS } from "./opportunities";
import type { OpportunityRun } from "./runs";
import type { FarmComparison } from "./sessions";

// Faits structurés (P11) : tout ce qu'une explication peut citer, et rien d'autre. Produits par le
// moteur déterministe ; l'assistant ne reçoit que ce document, jamais la base ni du SQL.

export const FACTS_VERSION = 1;
const TOP = 15;

export const FACT_RULES = [
  "Ne cite que des valeurs présentes dans ces faits ; n'invente aucun prix, volume ni po/h.",
  "Montants en pièces de cuivre : 1 po = 100 pa = 10 000 pc.",
  "Cite la date du dernier relevé (market.lastScanDay) et la confiance (0 à 100) de chaque recommandation.",
  "Si les faits ne permettent pas de répondre, réponds « données insuffisantes ».",
  "Un po/h ne vient que de farmSessions ; farmSignals est un signal de marché, pas un rendement.",
];

const round = (value: number | null) => (value === null ? null : Math.round(value));

export function buildFacts(context: EconomyContext, run: Omit<OpportunityRun, "reused">, farm: { byLabel: FarmComparison[] }, now: Date) {
  const name = (key: string | null) => (key === null ? null : itemLabel(context.names, key));
  const stats = [...context.stats.values()];
  const movers = stats.filter((s) => s.change7d !== null && s.confidence >= 40 && s.daysObserved30 >= 3);
  const statFacts = (s: (typeof stats)[number]) => ({
    item: s.itemKey,
    name: name(s.itemKey),
    currentCopper: s.current?.minCopper ?? null,
    marketValueCopper: round(s.marketValue),
    change7d: s.change7d === null ? null : Math.round(s.change7d * 1000) / 1000,
    available: s.lastAvailable,
    liquidity: s.liquidity,
    confidence: s.confidence,
    lastDay: s.lastDay,
  });

  return {
    version: FACTS_VERSION,
    generatedAt: now.toISOString(),
    rules: FACT_RULES,
    market: {
      label: context.market.label,
      lastScanDay: context.lastImport?.lastDay ?? null,
      fileModifiedAt: context.lastImport?.fileModifiedAt.toISOString() ?? null,
      receivedAt: context.lastImport?.receivedAt.toISOString() ?? null,
      itemsTracked: context.stats.size,
      historyFrom: context.historyFrom,
      auctionCutPercent: Math.round(context.auctionCut * 10_000) / 100,
    },
    engine: { run: run.id, version: run.engineVersion, computedAt: run.computedAt.toISOString(), dataThrough: run.dataThrough },
    opportunities: run.opportunities.slice(0, TOP).map((o, index) => ({
      rank: index + 1,
      kind: o.kind,
      label: KIND_LABELS[o.kind],
      item: o.itemKey,
      name: name(o.itemKey),
      valueCopper: o.valueCopper,
      confidence: o.confidence,
      horizon: o.horizon,
      reasons: o.reasonCodes.map((code) => REASON_LABELS[code] ?? code),
      lastDay: (o.inputs.lastDay as string | null | undefined) ?? run.dataThrough,
    })),
    crafts: context.crafts
      .filter((c) => c.profit !== null)
      .sort((a, b) => b.profit! - a.profit!)
      .slice(0, TOP)
      .map((c) => ({
        spell: c.spellId,
        output: c.outputKey,
        name: name(c.outputKey),
        decision: DECISION_LABELS[c.decision],
        profitCopper: round(c.profit),
        costCopper: round(c.costMarket),
        outputNetCopper: round(c.outputNet),
        confidence: c.confidence,
        reasons: c.reasons.map((code) => REASON_LABELS[code] ?? code),
      })),
    rising: movers
      .filter((s) => s.change7d! > 0)
      .sort((a, b) => b.change7d! - a.change7d!)
      .slice(0, 10)
      .map(statFacts),
    falling: movers
      .filter((s) => s.change7d! < 0)
      .sort((a, b) => a.change7d! - b.change7d!)
      .slice(0, 10)
      .map(statFacts),
    anomalies: stats
      .filter((s) => s.outlier)
      .sort((a, b) => (b.outlierScore ?? 0) - (a.outlierScore ?? 0))
      .slice(0, 10)
      .map(statFacts),
    farmSignals: context.farmSignals.slice(0, 10).map((f) => ({
      item: f.itemKey,
      name: name(f.itemKey),
      score: f.score,
      unitValueCopper: round(f.unitValue),
      confidence: f.confidence,
      reasons: f.reasons.map((code) => REASON_LABELS[code] ?? code),
    })),
    farmSessions: farm.byLabel.map((g) => ({ label: g.label, sessions: g.sessions, seconds: g.seconds, totalCopper: g.totalValue, perHourCopper: g.perHour })),
  };
}

export type EconomyFacts = ReturnType<typeof buildFacts>;
