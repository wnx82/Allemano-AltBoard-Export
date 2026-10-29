import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// Exécutable de l'agent offert au téléchargement (page Machines). Publié à la construction de
// l'image depuis les sources du dépôt (Dockerfile, étape « agent ») dans WOW_AGENT_DIR : il porte
// donc la version de l'agent affichée en pied de page. Hors de l'image, rien à télécharger.

export const AGENT_FILE_NAME = "AltBoardSync.exe";

export type AgentFile = { path: string; size: number; sha256: string };

// L'empreinte d'un fichier de 12 Mo n'est calculée qu'une fois par version du fichier.
const digests = new Map<string, string>();

export function agentDirectory(env: Record<string, string | undefined> = process.env): string | null {
  return env.WOW_AGENT_DIR || null;
}

/** L'exécutable disponible, avec sa taille et son empreinte SHA-256 ; null s'il n'y en a pas. */
export async function findAgent(directory: string | null): Promise<AgentFile | null> {
  if (!directory) return null;
  const file = path.join(directory, AGENT_FILE_NAME);
  let info;
  try {
    info = await stat(file);
  } catch {
    return null;
  }
  if (!info.isFile() || info.size === 0) return null;

  const key = `${file}:${info.size}:${info.mtimeMs}`;
  let sha256 = digests.get(key);
  if (!sha256) {
    sha256 = createHash("sha256").update(await readFile(file)).digest("hex");
    digests.set(key, sha256);
  }
  return { path: file, size: info.size, sha256 };
}

/** Taille lisible, en mégaoctets : « 11,8 Mo ». */
export function formatAgentSize(bytes: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} Mo`;
}
