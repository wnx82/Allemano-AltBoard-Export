import type { ItemStats } from "./prices";

// Moteur de craft : rentabilité d'une recette connue, au prix du marché (voir docs/ECONOMY-ENGINE.md).
// Calcul central : profit = valeur nette du produit − coût d'opportunité des composants. Un
// composant déjà possédé coûte ce qu'il rapporterait vendu : il n'est jamais compté gratuit.

export type Recipe = {
  spellId: number;
  skillLine: number | null;
  outputItemId: number;
  outputQuantity: number;
  cooldown: boolean;
  reagents: { itemId: number; quantity: number }[];
};

export type CraftDecision = "CRAFT" | "DONT_CRAFT" | "WAIT" | "SELL_REAGENTS";

export const DECISION_LABELS: Record<CraftDecision, string> = {
  CRAFT: "Crafter",
  DONT_CRAFT: "Ne pas crafter",
  WAIT: "Attendre",
  SELL_REAGENTS: "Vendre les compos",
};

export type ReagentCost = {
  itemKey: string;
  quantity: number;
  source: "marchand" | "hôtel des ventes" | "inconnu";
  unitMarket: number | null;
  unitPrudent: number | null;
  /** Ce que rapporterait le composant vendu à l'hôtel des ventes, à l'unité, commission déduite. */
  unitSellNet: number | null;
  owned: number;
  confidence: number;
};

export type CraftEvaluation = {
  spellId: number;
  outputKey: string;
  outputQuantity: number;
  reagents: ReagentCost[];
  costMarket: number | null;
  costPrudent: number | null;
  outputUnitValue: number | null;
  outputGross: number | null;
  outputNet: number | null;
  profit: number | null;
  profitPrudent: number | null;
  roi: number | null;
  margin: number | null;
  reagentsSellNet: number | null;
  /** Fabrications possibles avec les seuls stocks des personnages (sacs et banques). */
  craftableFromStock: number;
  /** Fabrications possibles en achetant les composants vendus par un marchand. */
  craftableWithVendor: number;
  batchProfit: number | null;
  ownedReagentsValue: number;
  confidence: number;
  decision: CraftDecision;
  reasons: string[];
  isTransformation: boolean;
};

export type CraftOptions = { auctionCut: number; minRoi: number; minConfidence: number };

export const DEFAULT_CRAFT_OPTIONS: CraftOptions = { auctionCut: 0.05, minRoi: 0.1, minConfidence: 35 };

export function evaluateRecipe(
  recipe: Recipe,
  statsOf: (itemKey: string) => ItemStats | undefined,
  vendorPriceOf: (itemKey: string) => number | undefined,
  stockOf: (itemKey: string) => number,
  options: CraftOptions = DEFAULT_CRAFT_OPTIONS,
): CraftEvaluation {
  const keep = 1 - options.auctionCut;
  const reasons: string[] = [];

  const reagents: ReagentCost[] = recipe.reagents.map(({ itemId, quantity }) => {
    const itemKey = String(itemId);
    const stats = statsOf(itemKey);
    const vendor = vendorPriceOf(itemKey);
    const market = stats?.marketValue ?? null;
    const sellNet = market === null ? null : market * keep;
    const owned = stockOf(itemKey);
    if (vendor !== undefined && (market === null || vendor <= market)) {
      // Vendu sans limite par un marchand : le prix est connu et certain.
      return { itemKey, quantity, source: "marchand", unitMarket: vendor, unitPrudent: vendor, unitSellNet: sellNet, owned, confidence: 100 };
    }
    if (market === null) {
      return { itemKey, quantity, source: "inconnu", unitMarket: null, unitPrudent: null, unitSellNet: null, owned, confidence: 0 };
    }
    // Prudent : le plus cher du prix de marché et du dernier prix minimum vu.
    const prudent = Math.max(market, stats?.current?.minCopper ?? market);
    return { itemKey, quantity, source: "hôtel des ventes", unitMarket: market, unitPrudent: prudent, unitSellNet: sellNet, owned, confidence: stats!.confidence };
  });

  const outputKey = String(recipe.outputItemId);
  const output = statsOf(outputKey);
  const outputUnitValue = output?.marketValue ?? null;
  const missing = reagents.some((r) => r.unitMarket === null) || outputUnitValue === null;

  const sum = (pick: (r: ReagentCost) => number | null) =>
    reagents.reduce<number | null>((total, r) => (total === null || pick(r) === null ? null : total + pick(r)! * r.quantity), 0);
  const costMarket = sum((r) => r.unitMarket);
  const costPrudent = sum((r) => r.unitPrudent);
  const outputGross = outputUnitValue === null ? null : outputUnitValue * recipe.outputQuantity;
  const outputNet = outputGross === null ? null : outputGross * keep;
  const profit = outputNet !== null && costMarket !== null ? outputNet - costMarket : null;
  const profitPrudent = outputNet !== null && costPrudent !== null ? outputNet - costPrudent : null;
  const roi = profit !== null && costMarket ? profit / costMarket : null;
  const margin = profit !== null && outputGross ? profit / outputGross : null;
  const reagentsSellNet = sum((r) => (r.source === "marchand" ? 0 : r.unitSellNet));

  const craftableFromStock = Math.min(...reagents.map((r) => Math.floor(r.owned / r.quantity)));
  const auctionReagents = reagents.filter((r) => r.source !== "marchand");
  const craftableWithVendor = auctionReagents.length === 0 ? Infinity : Math.min(...auctionReagents.map((r) => Math.floor(r.owned / r.quantity)));
  // Tous les composants chez un marchand : aucune limite de stock, le lot n'a pas de taille naturelle.
  const batch = Number.isFinite(craftableWithVendor) ? craftableWithVendor : 0;
  const ownedReagentsValue = reagents.reduce((total, r) => total + Math.min(r.owned, r.quantity * batch) * (r.unitMarket ?? 0), 0);
  const confidence = Math.min(output?.confidence ?? 0, ...reagents.map((r) => r.confidence));

  let decision: CraftDecision;
  if (missing) {
    decision = "WAIT";
    // Prix vu mais trop peu de jours pour une valeur de marché : l'historique manque, pas le prix.
    if (outputUnitValue === null) reasons.push(output?.current ? "OUTPUT_HISTORY_SHORT" : "OUTPUT_PRICE_UNKNOWN");
    const missingReagents = reagents.filter((r) => r.unitMarket === null);
    if (missingReagents.some((r) => !statsOf(r.itemKey)?.current)) reasons.push("REAGENT_PRICE_UNKNOWN");
    if (missingReagents.some((r) => statsOf(r.itemKey)?.current)) reasons.push("REAGENT_HISTORY_SHORT");
  } else if (confidence < options.minConfidence) {
    decision = "WAIT";
    reasons.push("LOW_CONFIDENCE");
  } else if (profit! <= 0) {
    const ownsReagents = auctionReagents.some((r) => r.owned >= r.quantity);
    decision = ownsReagents && reagentsSellNet! > outputNet! ? "SELL_REAGENTS" : "DONT_CRAFT";
    reasons.push(reagentsSellNet! > outputNet! ? "REAGENTS_WORTH_MORE" : "NEGATIVE_MARGIN");
    if (ownsReagents) reasons.push("OWNED_REAGENTS");
  } else if (roi! < options.minRoi) {
    decision = "WAIT";
    reasons.push("THIN_MARGIN");
  } else if (profitPrudent! < 0) {
    decision = "WAIT";
    reasons.push("PROFIT_NOT_ROBUST");
  } else {
    decision = "CRAFT";
    reasons.push("PROFITABLE");
    if (batch > 0) reasons.push("CRAFTABLE_FROM_STOCK");
  }
  if (output?.thinMarket) reasons.push("THIN_OUTPUT_MARKET");
  if (output?.outlier) reasons.push("OUTPUT_PRICE_OUTLIER");
  if (reagents.some((r) => r.source === "marchand")) reasons.push("VENDOR_REAGENT");
  if (recipe.cooldown) reasons.push("COOLDOWN");

  return {
    spellId: recipe.spellId,
    outputKey,
    outputQuantity: recipe.outputQuantity,
    reagents,
    costMarket,
    costPrudent,
    outputUnitValue,
    outputGross,
    outputNet,
    profit,
    profitPrudent,
    roi,
    margin,
    reagentsSellNet,
    craftableFromStock: Number.isFinite(craftableFromStock) ? craftableFromStock : 0,
    craftableWithVendor: batch,
    batchProfit: profit === null ? null : profit * batch,
    ownedReagentsValue,
    confidence,
    decision,
    reasons,
    // Un seul composant transformé en un autre objet : minerai en barre, étoffe en rouleau.
    isTransformation: recipe.reagents.length === 1,
  };
}
