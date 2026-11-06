import type { CraftDecision, CraftEvaluation } from "./craft";
import type { KnownRecipe } from "./load";

// Vue de la page Craft : décisions classées et bilan par métier. Fonctions pures.

export const DECISION_ORDER: CraftDecision[] = ["CRAFT", "SELL_REAGENTS", "WAIT", "DONT_CRAFT"];

export type CraftRow = { craft: CraftEvaluation; recipe: KnownRecipe };

/** Crafts à faire d'abord (profit décroissant), puis composants à vendre, à attendre, à éviter. */
export function sortCrafts(rows: readonly CraftRow[]): CraftRow[] {
  return [...rows].sort(
    (a, b) =>
      DECISION_ORDER.indexOf(a.craft.decision) - DECISION_ORDER.indexOf(b.craft.decision) ||
      (b.craft.profit ?? -Infinity) - (a.craft.profit ?? -Infinity) ||
      a.craft.spellId - b.craft.spellId,
  );
}

export type ProfessionSummary = {
  skillLine: number | null;
  name: string;
  recipes: number;
  profitable: number;
  /** Meilleur profit unitaire parmi les crafts à faire. */
  bestProfit: number | null;
  /** Profit cumulé des lots faisables avec les stocks (composants de marchand achetés). */
  batchProfit: number;
};

export function summarizeProfessions(rows: readonly CraftRow[], professionName: (skillLine: number | null) => string): ProfessionSummary[] {
  const groups = new Map<number | null, ProfessionSummary>();
  for (const { craft, recipe } of rows) {
    const group = groups.get(recipe.skillLine) ?? {
      skillLine: recipe.skillLine,
      name: professionName(recipe.skillLine),
      recipes: 0,
      profitable: 0,
      bestProfit: null,
      batchProfit: 0,
    };
    group.recipes += 1;
    if (craft.decision === "CRAFT" && craft.profit !== null) {
      group.profitable += 1;
      group.bestProfit = Math.max(group.bestProfit ?? -Infinity, craft.profit);
      group.batchProfit += craft.batchProfit ?? 0;
    }
    groups.set(recipe.skillLine, group);
  }
  return [...groups.values()].sort((a, b) => b.batchProfit - a.batchProfit || (b.bestProfit ?? -Infinity) - (a.bestProfit ?? -Infinity) || a.name.localeCompare(b.name));
}
