using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.AltBoard;

/// <summary>
/// Lit le temps de jeu enregistré par l'addon Allemano Ledger (structure documentée dans
/// docs/LEDGER-DATA-MODEL.md) : <c>AllemanoLedgerDB.chars[guid]</c>, mêmes GUID qu'AltBoard.
/// Seuls <c>played</c>, <c>levelStart</c> et <c>levelLog</c> sont lus ; le reste (or, sessions,
/// historique) n'est pas transmis.
/// </summary>
public static class LedgerReader
{
    public const string GlobalName = "AllemanoLedgerDB";

    private const int MaxLevels = 200;

    /// <summary>Temps de jeu par GUID. Vide si l'addon n'a encore rien enregistré.</summary>
    public static IReadOnlyDictionary<string, PlaytimePayload> Read(IReadOnlyDictionary<string, LuaValue> globals, ICollection<string> warnings)
    {
        var result = new Dictionary<string, PlaytimePayload>(StringComparer.Ordinal);
        if (!globals.TryGetValue(GlobalName, out var root)) return result;
        if (root is not LuaTable db)
        {
            warnings.Add($"{GlobalName} n'est pas une table : temps de jeu non transmis");
            return result;
        }

        if (db.Get("chars") is not LuaTable chars) return result;
        foreach (var (key, value) in chars.Entries)
        {
            if (key.Kind != LuaKeyKind.String || value is not LuaTable character) continue;
            var playtime = ReadCharacter(character);
            if (playtime is not null) result[key.Text!] = playtime;
        }

        return result;
    }

    private static PlaytimePayload? ReadCharacter(LuaTable character)
    {
        var played = character.Get("played")?.AsTable();
        var total = AltBoardReader.NonNegative(played?.Get("total")?.AsInt32());
        // Une mesure sans date n'est pas comparable à celle d'un autre PC : elle est écartée.
        var measuredAt = AltBoardReader.Timestamp(played?.Get("at"));
        if (measuredAt is null) total = null;

        CurrentLevelPayload? current = null;
        if (character.Get("levelStart") is LuaTable start && AltBoardReader.Small(start.Get("level")) is { } level)
        {
            current = new CurrentLevelPayload(
                level,
                AltBoardReader.NonNegative(start.Get("playedTotal")?.AsInt32()),
                AltBoardReader.Timestamp(start.Get("wallStart")));
        }

        var levels = new List<LevelTimePayload>();
        if (character.Get("levelLog") is LuaTable log)
        {
            foreach (var (key, value) in log.Entries)
            {
                // La clé est le niveau quitté : numérique, ou chaîne si le client l'a écrite ainsi.
                var logLevel = key.AsInt64() ?? (long.TryParse(key.Text, out var parsed) ? parsed : null);
                if (logLevel is null or < 0 or > short.MaxValue || value is not LuaTable entry) continue;
                levels.Add(new LevelTimePayload(
                    (int)logLevel.Value,
                    AltBoardReader.NonNegative(entry.Get("played")?.AsInt32()),
                    AltBoardReader.NonNegative(entry.Get("wall")?.AsInt32()),
                    AltBoardReader.Timestamp(entry.Get("reached")),
                    AltBoardReader.Text(entry.Get("zone"), AltBoardReader.MaxName)));
            }
        }

        levels.Sort((a, b) => a.Level.CompareTo(b.Level));
        if (levels.Count > MaxLevels) levels.RemoveRange(0, levels.Count - MaxLevels);

        if (total is null && current is null && levels.Count == 0) return null;
        return new PlaytimePayload(total, total is null ? null : measuredAt, current, levels);
    }
}
