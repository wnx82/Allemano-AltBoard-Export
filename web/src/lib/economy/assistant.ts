import { formatCopperShort } from "./view";
import type { EconomyFacts } from "./facts";

// Assistant facultatif (P11) : explique les faits du moteur en langage naturel. Désactivé tant que
// WOW_AI_URL et WOW_AI_MODEL ne sont pas définis. Il ne reçoit que les faits structurés, ne lance
// aucune requête, et toute réponse qui cite un nombre absent des faits est refusée.
// Protocole : API « chat completions » compatible OpenAI (Ollama, LM Studio, vLLM…).

export type AssistantConfig = { url: string; model: string; apiKey: string | null; timeoutMs: number };

/** Un modèle local de 14 milliards de paramètres, chargé à froid, a mis 51 s à répondre (Ollama, 2026-11-06). */
const TIMEOUT_MS = 120_000;

export function assistantConfig(env: Record<string, string | undefined> = process.env): AssistantConfig | null {
  const url = env.WOW_AI_URL?.trim();
  const model = env.WOW_AI_MODEL?.trim();
  if (!url || !model) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ""), model, apiKey: env.WOW_AI_API_KEY?.trim() || null, timeoutMs: TIMEOUT_MS };
}

export const MAX_QUESTION_LENGTH = 500;
const MAX_ANSWER_LENGTH = 4_000;
/** Petits entiers toujours admis : énumérations (« 3 crafts »), numéros de liste. */
const FREE_INTEGER_MAX = 10;

/** Nombres d'un texte, zéros de tête retirés ; « 12 345 » (espace fine ou insécable de milliers) compte pour un seul. */
function numbersIn(text: string): string[] {
  const grouped = text.replace(/(\d)[   ](?=\d{3}\b)/g, "$1");
  return (grouped.match(/\d+/g) ?? []).map((token) => token.replace(/^0+(?=\d)/, ""));
}

/** Toutes les écritures possibles des nombres des faits : brute, en pièces, en pourcentage. */
export function allowedNumbers(facts: unknown): Set<string> {
  const allowed = new Set<string>();
  const addText = (text: string) => {
    for (const token of numbersIn(text)) allowed.add(token);
  };
  const visit = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      addText(String(value));
      addText(formatCopperShort(value));
      const coins = Math.abs(Math.round(value));
      addText(`${Math.floor(coins / 10_000)} ${Math.floor((coins % 10_000) / 100)} ${coins % 100}`);
      addText(String(Math.round(value * 100)));
      addText((value * 100).toFixed(1));
      addText(String(Math.round(value / 3600)));
      addText(String(Math.round(value / 60)));
    } else if (typeof value === "string") {
      addText(value);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  visit(facts);
  return allowed;
}

/** Nombres de la réponse absents des sources (faits et question). Vide : réponse fondée. */
export function ungroundedNumbers(answer: string, sources: unknown): string[] {
  const allowed = allowedNumbers(sources);
  const unknown = new Set<string>();
  for (const value of numbersIn(answer)) {
    if (Number(value) <= FREE_INTEGER_MAX || allowed.has(value)) continue;
    unknown.add(value);
  }
  return [...unknown];
}

export type AssistantAnswer = { ok: true; answer: string } | { ok: false; error: string };

export async function askAssistant(
  config: AssistantConfig,
  facts: EconomyFacts,
  question: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AssistantAnswer> {
  const system = [
    "Tu expliques les recommandations d'un moteur économique World of Warcraft, en français, en quelques phrases.",
    "Tu ne calcules rien : tu cites et reformules uniquement les faits JSON fournis.",
    ...facts.rules,
  ].join("\n");
  let response: Response;
  try {
    response = await fetchImpl(`${config.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Faits :\n${JSON.stringify(facts)}\n\nQuestion : ${question}` },
        ],
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    return { ok: false, error: "L'assistant ne répond pas." };
  }
  if (!response.ok) return { ok: false, error: `L'assistant a refusé la demande (HTTP ${response.status}).` };
  const body = (await response.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") return { ok: false, error: "Réponse de l'assistant illisible." };
  const answer = content.trim().slice(0, MAX_ANSWER_LENGTH);
  const unknown = ungroundedNumbers(answer, { facts, question });
  if (unknown.length > 0) {
    return { ok: false, error: `Réponse refusée : elle cite des valeurs absentes des faits du moteur (${unknown.slice(0, 5).join(", ")}).` };
  }
  return { ok: true, answer };
}
