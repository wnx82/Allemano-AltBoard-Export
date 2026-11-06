import type { Database } from "@/db/client";
import { buildFacts, type EconomyFacts } from "./facts";
import { loadEconomy, realizableValueOf, type EconomyContext } from "./load";
import { ensureOpportunityRun, type OpportunityRun } from "./runs";
import { compareSessions, listFarmSessions } from "./sessions";

/** Faits du moteur pour un marché, calcul d'opportunités compris ; null tant qu'aucun prix n'a été reçu. */
export async function loadFacts(
  db: Database,
  options: { marketId?: number; now: Date },
): Promise<{ context: EconomyContext; run: OpportunityRun; facts: EconomyFacts } | null> {
  const context = await loadEconomy(db, options);
  if (!context) return null;
  const [run, sessions] = await Promise.all([ensureOpportunityRun(db, context, options.now), listFarmSessions(db, realizableValueOf(context))]);
  const facts = buildFacts(context, run, { byLabel: compareSessions(sessions, "label") }, options.now);
  return { context, run, facts };
}
