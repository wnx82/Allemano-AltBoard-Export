import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { askAssistant, assistantConfig, ungroundedNumbers, type AssistantConfig } from "./assistant";
import type { EconomyFacts } from "./facts";

const FACTS = {
  version: 1,
  rules: ["Montants en pièces de cuivre : 1 po = 100 pa = 10 000 pc."],
  market: { label: "PvE · WoW Forever", lastScanDay: "2026-11-06", auctionCutPercent: 5 },
  opportunities: [{ rank: 1, kind: "SELL", name: "Lingot de fer", valueCopper: 123_456, confidence: 82, change7d: 0.125 }],
} as unknown as EconomyFacts;

const CONFIG: AssistantConfig = { url: "http://llm.test/v1", model: "test", apiKey: null, timeoutMs: 1_000 };

const reply = (content: string, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })) as unknown as typeof fetch;

describe("assistant", () => {
  test("désactivé sans adresse ni modèle ; seule une adresse http(s) est acceptée", () => {
    assert.equal(assistantConfig({}), null);
    assert.equal(assistantConfig({ WOW_AI_URL: "http://10.0.0.5:11434/v1" }), null);
    assert.equal(assistantConfig({ WOW_AI_URL: "file:///etc/passwd", WOW_AI_MODEL: "m" }), null);
    assert.deepEqual(assistantConfig({ WOW_AI_URL: "http://10.0.0.5:11434/v1/", WOW_AI_MODEL: "qwen" }), {
      url: "http://10.0.0.5:11434/v1",
      model: "qwen",
      apiKey: null,
      timeoutMs: 60_000,
    });
  });

  test("les nombres des faits sont reconnus sous toutes leurs écritures", () => {
    const answer = "Vendez le Lingot de fer : 12 po 34 pa 56 pc (123 456 pc, soit 12,35 po), confiance 82, +12,5 % sur 7 jours, relevé du 06/11/2026.";

    assert.deepEqual(ungroundedNumbers(answer, FACTS), []);
  });

  test("un nombre absent des faits est signalé ; les petits entiers restent libres", () => {
    assert.deepEqual(ungroundedNumbers("Comptez 3 crafts et 4 500 po/h.", FACTS), ["4500"]);
  });

  test("réponse fondée transmise ; réponse inventée refusée ; panne signalée", async () => {
    const good = await askAssistant(CONFIG, FACTS, "Que vendre ?", reply("Vendez le Lingot de fer, confiance 82."));
    assert.deepEqual(good, { ok: true, answer: "Vendez le Lingot de fer, confiance 82." });

    const invented = await askAssistant(CONFIG, FACTS, "Que vendre ?", reply("Le farm rapporte 987 po/h."));
    assert.equal(invented.ok, false);
    assert.match(invented.ok ? "" : invented.error, /987/);

    const down = await askAssistant(CONFIG, FACTS, "?", (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);
    assert.deepEqual(down, { ok: false, error: "L'assistant ne répond pas." });

    const refused = await askAssistant(CONFIG, FACTS, "?", reply("", 500));
    assert.equal(refused.ok, false);
  });

  test("la question elle-même peut fournir un nombre que la réponse reprend", async () => {
    const answer = await askAssistant(CONFIG, FACTS, "Ai-je 250 lingots ?", reply("Les faits ne montrent pas vos 250 lingots : données insuffisantes."));

    assert.equal(answer.ok, true);
  });
});
