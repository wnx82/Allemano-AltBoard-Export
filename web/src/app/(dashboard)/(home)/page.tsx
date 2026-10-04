import type { Metadata } from "next";
import { CharacterBrowser } from "@/components/character-browser";
import { Money, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { getOverview, listCharacters } from "@/lib/dashboard/queries";
import { formatDateTime, formatRelative } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Mes personnages" };

export default async function CharactersPage() {
  const db = getDatabase();
  const [characters, overview] = await Promise.all([listCharacters(db), getOverview(db)]);
  const now = new Date();

  const levels = characters.map((character) => character.level).filter((level): level is number => level !== null);
  const averageLevel = levels.length > 0 ? levels.reduce((total, level) => total + level, 0) / levels.length : null;
  const totalCopper = characters.reduce((total, character) => total + (character.moneyCopper ?? 0), 0);
  const professions = characters.reduce((total, character) => total + character.professions.length, 0);
  const distinctProfessions = new Set(characters.flatMap((character) => character.professions.map((profession) => profession.name))).size;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-gold">World of Warcraft</p>
          <h1 className="display mt-1 text-3xl font-bold sm:text-4xl">Mes personnages</h1>
        </div>
        <p className="text-sm text-muted">
          {overview.lastSync ? (
            <>
              Dernière synchronisation{" "}
              <time dateTime={overview.lastSync.at} title={formatDateTime(overview.lastSync.at)} className="text-text">
                {formatRelative(overview.lastSync.at, now)}
              </time>{" "}
              depuis <span className="text-text">{overview.lastSync.machine}</span>
            </>
          ) : (
            "Aucune synchronisation reçue"
          )}
        </p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Personnages" value={characters.length} />
        <StatTile label="Comptes" value={overview.accounts} />
        <StatTile label="PC" value={overview.machines} />
        <StatTile
          label="Niveau moyen"
          value={averageLevel === null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(averageLevel)}
        />
        <StatTile label="Or cumulé" value={<Money copper={characters.length > 0 ? totalCopper : null} />} />
        <StatTile
          label="Métiers"
          value={professions}
          hint={professions > 0 ? `${distinctProfessions} différent${distinctProfessions > 1 ? "s" : ""}` : undefined}
        />
      </div>

      <CharacterBrowser characters={characters} now={now.toISOString()} />
    </>
  );
}
