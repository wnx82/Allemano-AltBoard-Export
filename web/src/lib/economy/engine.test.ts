import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateRecipe, type Recipe } from "./craft";
import { addDays, auctionDayToDate, dateToAuctionDay } from "./days";
import { farmSignal, valueSession } from "./farm";
import { buildOpportunities } from "./opportunities";
import { computeItemStats, type DayObservation, type ItemStats } from "./prices";

const TODAY = "2026-11-20";

/** n jours consécutifs jusqu'à aujourd'hui, prix et quantité donnés (ou fonctions du rang). */
function series(n: number, low: number | ((i: number) => number), available: number | null = 50, end = TODAY): DayObservation[] {
  return Array.from({ length: n }, (_, i) => {
    const price = typeof low === "function" ? low(i) : low;
    return { day: addDays(end, i - n + 1), low: price, high: price, available };
  });
}

const stable = (key: string, price: number, available: number | null = 50, n = 14) =>
  computeItemStats(key, series(n, price, available), { minCopper: price, day: TODAY }, TODAY, null);

describe("jours Auctionator", () => {
  test("jour 0 = 2020-01-01, conversion dans les deux sens", () => {
    assert.equal(auctionDayToDate(0), "2020-01-01");
    // Sortie officielle de WoW Forever : 2026-11-04, jour 2499 d'Auctionator.
    assert.equal(auctionDayToDate(2499), "2026-11-04");
    assert.equal(dateToAuctionDay("2026-11-04"), 2499);
  });
});

describe("moteur de prix", () => {
  test("marché stable et liquide : valeur, variations nulles, confiance élevée", () => {
    const s = stable("1", 1_000, 80);

    assert.equal(s.marketValue, 1_000);
    assert.equal(s.marketValueBasis, "médiane 14 j");
    assert.equal(s.median30, 1_000);
    assert.equal(s.change7d, 0);
    assert.equal(s.volatility30, 0);
    assert.equal(s.liquidity, "élevée");
    assert.equal(s.outlier, false);
    assert.equal(s.thinMarket, false);
    assert.equal(s.confidence, 100);
  });

  test("absence d'historique : aucune valeur, confiance nulle", () => {
    const s = computeItemStats("2", [], null, TODAY, null);

    assert.equal(s.marketValue, null);
    assert.equal(s.marketValueBasis, "insuffisant");
    assert.equal(s.current, null);
    assert.equal(s.confidence, 0);
  });

  test("moins de trois jours : prix vu, mais pas de valeur de marché", () => {
    const s = computeItemStats("3", series(2, 500), { minCopper: 500, day: TODAY }, TODAY, null);

    assert.equal(s.current?.minCopper, 500);
    assert.equal(s.marketValue, null);
    // Prix vu, mais trop peu de jours pour décider : confiance plafonnée.
    assert.ok(s.confidence <= 30);
  });

  test("un prix isolé est signalé et n'entre pas dans sa propre référence", () => {
    const days = series(10, (i) => (i === 9 ? 5_000 : 1_000 + (i % 3) * 10));
    const s = computeItemStats("4", days, { minCopper: 5_000, day: TODAY }, TODAY, null);

    assert.equal(s.outlier, true);
    // La médiane résiste au pic : la valeur de marché reste celle des autres jours.
    assert.equal(s.marketValue, 1_010);
  });

  test("marché à une ou deux unités : pénalisé", () => {
    const thin = stable("5", 1_000, 1);
    const liquid = stable("5", 1_000, 80);

    assert.equal(thin.thinMarket, true);
    assert.equal(thin.liquidity, "faible");
    assert.equal(thin.confidenceFactors.volume, 0.15);
    assert.ok(thin.confidence < liquid.confidence - 25);
  });

  test("relevé périmé : confiance nulle", () => {
    const old = series(10, 1_000, 50, "2026-10-30");
    const s = computeItemStats("6", old, { minCopper: 1_000, day: "2026-10-30" }, TODAY, null);

    assert.equal(s.confidenceFactors.freshness, 0);
    assert.equal(s.confidence, 0);
  });

  test("les jours antérieurs au début de l'historique (bêta) sont ignorés", () => {
    const beta = series(10, 9_999, 50, "2026-10-20");
    const live = series(5, 1_000, 50);
    const s = computeItemStats("7", [...beta, ...live], { minCopper: 1_000, day: TODAY }, TODAY, "2026-11-04");

    assert.equal(s.daysObserved30, 5);
    assert.equal(s.marketValue, 1_000);
  });

  test("variation sur sept jours", () => {
    const s = computeItemStats("8", series(15, (i) => (i < 8 ? 1_000 : 1_500)), { minCopper: 1_500, day: TODAY }, TODAY, null);

    assert.equal(s.change7d, 0.5);
    assert.equal(s.change1d, 0);
  });

  test("volatilité robuste : un marché agité perd en confiance", () => {
    const calm = stable("9", 1_000);
    const agitated = computeItemStats("9", series(14, (i) => [600, 1_000, 1_500, 900][i % 4]), { minCopper: 900, day: TODAY }, TODAY, null);

    assert.ok(agitated.volatility30! > 0.3);
    assert.ok(agitated.confidenceFactors.stability < 1);
    assert.ok(agitated.confidence < calm.confidence);
  });
});

describe("moteur de craft", () => {
  const prices = new Map<string, ItemStats>([
    ["10", stable("10", 100)], // composant
    ["11", stable("11", 50)], // composant
    ["20", stable("20", 1_000)], // produit cher
    ["21", stable("21", 200)], // produit bon marché
  ]);
  const recipe = (output: number, reagents: [number, number][], outputQuantity = 1): Recipe => ({
    spellId: output * 10,
    skillLine: 197,
    outputItemId: output,
    outputQuantity,
    cooldown: false,
    reagents: reagents.map(([itemId, quantity]) => ({ itemId, quantity })),
  });
  const run = (r: Recipe, stock: Record<string, number> = {}, vendor: Record<string, number> = {}) =>
    evaluateRecipe(r, (k) => prices.get(k), (k) => vendor[k], (k) => stock[k] ?? 0);

  test("craft rentable", () => {
    const e = run(recipe(20, [[10, 3], [11, 2]]), { "10": 9, "11": 10 });

    assert.equal(e.costMarket, 400);
    assert.equal(e.outputNet, 950);
    assert.equal(e.profit, 550);
    assert.equal(e.roi, 550 / 400);
    assert.equal(e.craftableFromStock, 3);
    assert.equal(e.batchProfit, 1_650);
    assert.equal(e.decision, "CRAFT");
    assert.deepEqual(e.reasons, ["PROFITABLE", "CRAFTABLE_FROM_STOCK"]);
  });

  test("craft non rentable", () => {
    const e = run(recipe(21, [[10, 3]]));

    assert.equal(e.profit, 190 - 300);
    assert.equal(e.decision, "DONT_CRAFT");
    assert.ok(e.isTransformation);
  });

  test("composants détenus qui valent plus vendus : vendre les compos", () => {
    const e = run(recipe(21, [[10, 3]]), { "10": 3 });

    // Le composant possédé coûte ce qu'il rapporterait : 3 × 100.
    assert.equal(e.costMarket, 300);
    assert.equal(e.reagentsSellNet, 285);
    assert.equal(e.decision, "SELL_REAGENTS");
    assert.ok(e.reasons.includes("OWNED_REAGENTS"));
  });

  test("composant vendu par un marchand : prix certain", () => {
    const e = run(recipe(20, [[10, 1], [99, 4]]), {}, { "99": 25 });

    assert.equal(e.reagents[1].source, "marchand");
    assert.equal(e.costMarket, 200);
    assert.equal(e.decision, "CRAFT");
    assert.ok(e.reasons.includes("VENDOR_REAGENT"));
  });

  test("prix inconnu : attendre, jamais deviner", () => {
    const e = run(recipe(30, [[10, 1]]));

    assert.equal(e.profit, null);
    assert.equal(e.decision, "WAIT");
    assert.deepEqual(e.reasons, ["OUTPUT_PRICE_UNKNOWN"]);
  });

  test("prix vu depuis moins de trois jours : attendre, faute d'historique", () => {
    prices.set("23", computeItemStats("23", series(2, 900), { minCopper: 900, day: TODAY }, TODAY, null));
    prices.set("12", computeItemStats("12", series(1, 40), { minCopper: 40, day: TODAY }, TODAY, null));
    const e = run(recipe(23, [[10, 1], [12, 2]]));

    assert.equal(e.decision, "WAIT");
    assert.deepEqual(e.reasons, ["OUTPUT_HISTORY_SHORT", "REAGENT_HISTORY_SHORT"]);
  });

  test("produit sur un marché illiquide : confiance faible, attendre", () => {
    prices.set("22", stable("22", 5_000, 1, 3));
    const e = run(recipe(22, [[10, 1]]));

    assert.ok(e.confidence < 35);
    assert.equal(e.decision, "WAIT");
    assert.ok(e.reasons.includes("LOW_CONFIDENCE"));
    assert.ok(e.reasons.includes("THIN_OUTPUT_MARKET"));
  });
});

describe("moteur de farm", () => {
  test("ressource chère et peu offerte : bon moment pour farmer", () => {
    const days = series(14, (i) => (i === 13 ? 1_500 : 1_000), 100);
    days[13].available = 30;
    const s = computeItemStats("40", days, { minCopper: 1_500, day: TODAY }, TODAY, null);

    const signal = farmSignal(s)!;

    assert.equal(signal.premium, 0.5);
    assert.deepEqual(signal.reasons.slice(0, 2), ["PRICE_ABOVE_MEDIAN", "LOW_SUPPLY"]);
    assert.ok(signal.score >= 80);
  });

  test("session : différence d'inventaire valorisée, po/h mesuré", () => {
    const start = new Map([["40", 10], ["41", 5]]);
    const end = new Map([["40", 30], ["41", 2], ["42", 1]]);

    const v = valueSession(start, end, 2_000, 1_800, (k) => (k === "40" ? 95 : k === "41" ? 10 : null));

    assert.deepEqual(v.items.map((i) => [i.itemKey, i.delta, i.value]), [["40", 20, 1_900], ["41", -3, -30], ["42", 1, null]]);
    assert.equal(v.itemsValue, 1_870);
    assert.equal(v.unvaluedItems, 1);
    assert.equal(v.totalValue, 3_870);
    assert.equal(v.perHour, 7_740);
  });
});

describe("opportunités", () => {
  test("vendre ce qui est cher, garder ce qui est bradé, acheter un composant bradé", () => {
    const high = computeItemStats("50", series(14, (i) => (i === 13 ? 1_300 : 1_000), 60), { minCopper: 1_300, day: TODAY }, TODAY, null);
    const low = computeItemStats("51", series(14, (i) => (i === 13 ? 700 : 1_000), 60), { minCopper: 700, day: TODAY }, TODAY, null);
    const stats = new Map([["50", high], ["51", low], ["10", stable("10", 100)], ["20", stable("20", 3_000)]]);
    const craft = evaluateRecipe(
      { spellId: 1, skillLine: null, outputItemId: 20, outputQuantity: 1, cooldown: false, reagents: [{ itemId: 51, quantity: 1 }] },
      (k) => stats.get(k),
      () => undefined,
      () => 0,
    );

    const list = buildOpportunities(stats, [craft], new Map([["50", 10], ["51", 4]]), []);

    const kinds = list.map((o) => `${o.kind}:${o.itemKey}`);
    assert.equal(craft.decision, "CRAFT");
    assert.deepEqual(kinds.toSorted(), ["BUY:51", "KEEP:51", "PROCESS:20", "SELL:50"]);
    // Deux jours relevés seulement : aucune valeur de marché, donc ni vente ni conservation conseillée.
    const young = computeItemStats("52", series(2, (i) => (i === 1 ? 2_000 : 1_000), 60), { minCopper: 2_000, day: TODAY }, TODAY, null);
    assert.equal(young.marketValue, null);
    assert.ok(young.confidence <= 30);
    assert.deepEqual(buildOpportunities(new Map([["52", young]]), [], new Map([["52", 10]]), []), []);
    const sell = list.find((o) => o.kind === "SELL")!;
    assert.equal(sell.valueCopper, Math.round(10 * 1_300 * 0.95));
    assert.ok(sell.inputs.lastDay);
  });
});
