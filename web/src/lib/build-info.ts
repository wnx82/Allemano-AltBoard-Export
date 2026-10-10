// Ce que le site affiche de sa propre construction. Lu une fois par next.config.ts, qui fige ces
// valeurs dans le code construit : importé par Node sans transformation, donc sans alias « @/ ».
import { readFileSync } from "node:fs";
import path from "node:path";

export type BuildInfo = {
  /** Version du site (web/package.json). */
  siteVersion: string | null;
  /** Commit construit, abrégé ; absent si le dépôt n'est pas fourni à la construction. */
  commit: string | null;
  /** Dernière version de l'agent (agent/Directory.Build.props) ; absente de même. */
  agentVersion: string | null;
  /** Instant de la construction (ISO). */
  builtAt: string;
};

function read(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Commit extrait d'un dépôt, lu dans .git sans l'exécutable git : l'image de construction ne l'a pas. */
export function readCommit(repoDir: string): string | null {
  const git = (file: string) => read(path.join(repoDir, ".git", file));
  const head = git("HEAD")?.trim();
  if (!head) return null;

  // Une branche : sa référence est un fichier, ou une ligne de packed-refs après un « git gc ».
  const ref = /^ref: (refs\/[\w./-]+)$/.exec(head)?.[1];
  const hash = ref
    ? (git(ref)?.trim() ??
      git("packed-refs")
        ?.split(/\r?\n/)
        .find((line) => line.endsWith(` ${ref}`))
        ?.split(" ")[0])
    : head;
  return hash && /^[0-9a-f]{40,64}$/.test(hash) ? hash.slice(0, 7) : null;
}

/** Version de l'agent : celle que la prochaine publication portera. */
export function readAgentVersion(repoDir: string): string | null {
  return /<Version>\s*([\w.+-]+)\s*<\/Version>/.exec(read(path.join(repoDir, "agent", "Directory.Build.props")) ?? "")?.[1] ?? null;
}

export function readBuildInfo(webDir: string, repoDir: string, now: Date): BuildInfo {
  let siteVersion: unknown;
  try {
    siteVersion = JSON.parse(read(path.join(webDir, "package.json")) ?? "null")?.version;
  } catch {
    siteVersion = null;
  }
  return {
    siteVersion: typeof siteVersion === "string" ? siteVersion : null,
    commit: readCommit(repoDir),
    agentVersion: readAgentVersion(repoDir),
    builtAt: now.toISOString(),
  };
}
