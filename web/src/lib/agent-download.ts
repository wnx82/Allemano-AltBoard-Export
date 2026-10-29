import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { zip } from "@/lib/zip";

// Exécutable de l'agent offert au téléchargement (page Machines). Publié à la construction de
// l'image depuis les sources du dépôt (Dockerfile, étape « agent ») dans WOW_AGENT_DIR : il porte
// donc la version de l'agent affichée en pied de page. Hors de l'image, rien à télécharger.

export const AGENT_FILE_NAME = "AltBoardSync.exe";
export const AGENT_ARCHIVE_NAME = "AltBoardSync.zip";
export const README_FILE_NAME = "LISEZMOI.txt";

export type AgentFile = { path: string; size: number; sha256: string };
export type AgentArchive = { data: Buffer; size: number; sha256: string };

// L'empreinte d'un fichier de 12 Mo n'est calculée qu'une fois par version du fichier.
const digests = new Map<string, string>();
// Une seule archive gardée en mémoire : celle de l'exécutable en service.
let archive: { key: string; value: AgentArchive } | null = null;

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

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
  let digest = digests.get(key);
  if (!digest) {
    digest = sha256(await readFile(file));
    digests.set(key, digest);
  }
  return { path: file, size: info.size, sha256: digest };
}

/**
 * L'agent compressé, avec ses instructions : 40 % plus léger que l'exécutable seul. Construit au
 * premier appel pour cet exécutable, puis gardé en mémoire.
 */
export async function archiveAgent(agent: AgentFile, version: string | null): Promise<AgentArchive> {
  const key = `${agent.sha256}:${version ?? ""}`;
  if (archive?.key === key) return archive.value;
  const data = zip([
    { name: AGENT_FILE_NAME, data: await readFile(agent.path) },
    { name: README_FILE_NAME, data: readme(agent, version) },
  ]);
  const value = { data, size: data.length, sha256: sha256(data) };
  archive = { key, value };
  return value;
}

/** Instructions jointes à l'archive, lisibles dans le Bloc-notes (fins de ligne Windows). */
export function readme(agent: AgentFile, version: string | null): string {
  return [
    `AltBoard Sync${version ? ` ${version}` : ""}`,
    "",
    "1. Installez les addons AltBoard et Allemano Ledger dans le jeu :",
    "   World of Warcraft\\_forever_\\Interface\\AddOns",
    `2. Copiez ${AGENT_FILE_NAME} où vous voulez sur le PC. Aucune installation, aucun prérequis.`,
    "3. Créez un jeton dans la page Machines du tableau de bord. Il n'est affiché qu'une fois.",
    "   Un jeton par PC.",
    `4. Double-cliquez sur ${AGENT_FILE_NAME} : sa fenêtre demande le jeton. Collez-le, puis`,
    "   Enregistrer. La première synchronisation part aussitôt.",
    "5. Dans la fenêtre, activez « Démarrage avec Windows ».",
    "6. En jeu, faites /reload ou déconnectez-vous : le jeu n'écrit ses données qu'à ce moment-là.",
    "",
    `SHA-256 de ${AGENT_FILE_NAME} : ${agent.sha256}`,
    "",
  ].join("\r\n");
}

/** Taille lisible, en mégaoctets : « 11,8 Mo ». */
export function formatAgentSize(bytes: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} Mo`;
}
