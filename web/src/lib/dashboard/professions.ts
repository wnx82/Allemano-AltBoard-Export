import type { CharacterListItem } from "./queries";

type Learner = Pick<CharacterListItem, "id" | "name" | "level" | "professions">;

export type ProfessionHolder<T> = { character: T; rank: number | null; maxRank: number | null };

export type ProfessionRow<T> = {
  skillLine: number;
  name: string;
  /** Du plus avancé au moins avancé. */
  holders: ProfessionHolder<T>[];
};

export type ProfessionComparison<T> = {
  primary: ProfessionRow<T>[];
  secondary: ProfessionRow<T>[];
  /** Personnages à qui il reste au moins un emplacement de métier principal. */
  openSlots: { character: T; open: number }[];
};

/** Un personnage apprend au plus deux métiers principaux, dans toutes les versions du jeu. */
export const PRIMARY_SLOTS = 2;

/**
 * Métiers de tous les personnages, mis côte à côte : qui exerce quoi, à quel rang. L'ordre reçu
 * départage les personnages de même rang et ordonne les emplacements libres.
 */
export function compareProfessions<T extends Learner>(characters: T[], compareNames: (a: string, b: string) => number): ProfessionComparison<T> {
  const rows = new Map<number, ProfessionRow<T> & { isPrimary: boolean }>();
  const openSlots: ProfessionComparison<T>["openSlots"] = [];

  for (const character of characters) {
    for (const profession of character.professions) {
      let row = rows.get(profession.skillLine);
      if (!row) {
        row = { skillLine: profession.skillLine, name: profession.name, isPrimary: profession.isPrimary, holders: [] };
        rows.set(profession.skillLine, row);
      }
      row.holders.push({ character, rank: profession.rank, maxRank: profession.maxRank });
    }
    const open = PRIMARY_SLOTS - character.professions.filter((profession) => profession.isPrimary).length;
    if (open > 0) openSlots.push({ character, open });
  }

  const sorted = [...rows.values()].sort((a, b) => compareNames(a.name, b.name) || a.skillLine - b.skillLine);
  // Tri stable : à rang égal, l'ordre reçu est conservé. Un rang inconnu passe après tous les autres.
  for (const row of sorted) row.holders.sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1));

  const strip = ({ skillLine, name, holders }: ProfessionRow<T>): ProfessionRow<T> => ({ skillLine, name, holders });
  return {
    primary: sorted.filter((row) => row.isPrimary).map(strip),
    secondary: sorted.filter((row) => !row.isPrimary).map(strip),
    openSlots,
  };
}
