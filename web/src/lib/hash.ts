import { createHash } from "node:crypto";

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * JSON canonique : clés triées, valeurs undefined omises. Deux objets de même contenu donnent la
 * même chaîne quel que soit l'ordre de leurs clés (le client WoW réécrit ses tables dans un ordre
 * variable à chaque sauvegarde).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry ?? null)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${fields.join(",")}}`;
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
