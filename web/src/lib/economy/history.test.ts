import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { craftHistory, findPeriod, withinPeriod } from "./history";
import type { DayObservation } from "./prices";

const day = (d: string, low: number): DayObservation => ({ day: d, low, high: low, available: 10 });

describe("historiques", () => {
  test("période demandée, sinon 30 jours ; jours de la bêta exclus", () => {
    const days = [day("2026-10-01", 1), day("2026-11-01", 2), day("2026-11-03", 3), day("2026-11-06", 4)];

    assert.equal(findPeriod("90").days, 90);
    assert.equal(findPeriod("n'importe quoi").key, "30");
    assert.deepEqual(withinPeriod(days, findPeriod("7"), "2026-11-06", null).map((d) => d.low), [2, 3, 4]);
    assert.deepEqual(withinPeriod(days, findPeriod("all"), "2026-11-06", "2026-11-03").map((d) => d.low), [3, 4]);
  });

  test("rentabilité passée : seuls les jours complets sont calculés, le marchand prime s'il est moins cher", () => {
    const series: Record<string, DayObservation[]> = {
      "20": [day("2026-11-01", 1_000), day("2026-11-02", 1_200), day("2026-11-03", 900)],
      "10": [day("2026-11-01", 100), day("2026-11-03", 150)],
      "99": [day("2026-11-01", 40)],
    };
    const recipe = {
      spellId: 1,
      skillLine: null,
      outputItemId: 20,
      outputQuantity: 1,
      cooldown: false,
      reagents: [
        { itemId: 10, quantity: 2 },
        { itemId: 99, quantity: 3 },
      ],
    };

    const points = craftHistory(recipe, (k) => series[k] ?? [], (k) => (k === "99" ? 25 : undefined), 0.05);

    // Le 2 novembre manque le composant 10 : pas de point inventé.
    assert.deepEqual(points.map((p) => p.day), ["2026-11-01", "2026-11-03"]);
    assert.deepEqual(points[0], { day: "2026-11-01", outputNet: 950, cost: 275, profit: 675 });
    assert.equal(points[1].cost, 375);
  });
});
