using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.AltBoard;

/// <summary>Ce que Ledger sait d'un personnage : temps de jeu par niveau et sessions.</summary>
public sealed record LedgerCharacter(PlaytimePayload? Playtime, IReadOnlyList<SessionPayload> Sessions);

/// <summary>
/// Lit ce qu'enregistre l'addon Allemano Ledger (structure documentée dans
/// docs/LEDGER-DATA-MODEL.md) : <c>AllemanoLedgerDB.chars[guid]</c>, mêmes GUID qu'AltBoard.
/// Sont lus <c>played</c>, <c>levelStart</c>, <c>levelLog</c> (temps de jeu), <c>history</c> et
/// <c>current</c> (sessions : dates, durée, expérience). L'or et son détail ne sont pas transmis.
/// </summary>
public static class LedgerReader
{
    public const string GlobalName = "AllemanoLedgerDB";

    private const int MaxLevels = 200;
    // L'addon garde 50 sessions par personnage, plus celle en cours.
    private const int MaxSessions = 60;
    private const int MaxTag = 40;

    /// <summary>Données par GUID. Vide si l'addon n'a encore rien enregistré.</summary>
    public static IReadOnlyDictionary<string, LedgerCharacter> Read(IReadOnlyDictionary<string, LuaValue> globals, ICollection<string> warnings)
    {
        var result = new Dictionary<string, LedgerCharacter>(StringComparer.Ordinal);
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
            var playtime = ReadPlaytime(character);
            var sessions = ReadSessions(character);
            if (playtime is not null || sessions.Count > 0) result[key.Text!] = new LedgerCharacter(playtime, sessions);
        }

        return result;
    }

    private static PlaytimePayload? ReadPlaytime(LuaTable character)
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

    /// <summary>Sessions terminées (<c>history</c>) puis session en cours (<c>current</c>), de la plus ancienne à la plus récente.</summary>
    private static List<SessionPayload> ReadSessions(LuaTable character)
    {
        // Le début identifie la session : il ne change pas quand la session en cours est archivée.
        var sessions = new Dictionary<long, SessionPayload>();
        if (character.Get("history") is LuaTable history)
        {
            foreach (var (_, value) in history.Entries)
            {
                // Un « run » d'instance recoupe la session qui le contient : le compter doublerait l'expérience.
                if (value is not LuaTable entry || entry.Get("kind")?.AsString() == "run") continue;
                if (AltBoardReader.Timestamp(entry.Get("start")) is not { } start) continue;
                sessions[start] = new SessionPayload(
                    start,
                    AltBoardReader.Timestamp(entry.Get("stop")),
                    AltBoardReader.NonNegative(entry.Get("duration")?.AsInt32()),
                    AltBoardReader.NonNegative(entry.Get("xpGained")?.AsInt32()),
                    AltBoardReader.Small(entry.Get("levels")),
                    AltBoardReader.Text(entry.Get("zone"), AltBoardReader.MaxName),
                    AltBoardReader.Text(entry.Get("tag"), MaxTag),
                    InProgress: false);
            }
        }

        if (character.Get("current") is LuaTable current && AltBoardReader.Timestamp(current.Get("start")) is { } currentStart)
        {
            var lastSeen = AltBoardReader.Timestamp(current.Get("lastSeen"));
            // Une session terminée de même début fait foi : l'addon l'a déjà close.
            sessions.TryAdd(currentStart, new SessionPayload(
                currentStart,
                lastSeen,
                OnlineSeconds(current, currentStart, lastSeen),
                AltBoardReader.NonNegative(current.Get("xpGained")?.AsInt32()),
                AltBoardReader.Small(current.Get("level")) is { } level && AltBoardReader.Small(current.Get("startLevel")) is { } startLevel && level >= startLevel
                    ? level - startLevel
                    : null,
                AltBoardReader.Text(current.Get("zone"), AltBoardReader.MaxName),
                AltBoardReader.Text(current.Get("tag"), MaxTag) ?? AltBoardReader.Text(current.Get("autoTag"), MaxTag),
                InProgress: true));
        }

        var ordered = sessions.Values.OrderBy(session => session.StartedAt).ToList();
        if (ordered.Count > MaxSessions) ordered.RemoveRange(0, ordered.Count - MaxSessions);
        return ordered;
    }

    /// <summary>
    /// Temps connecté d'une session en cours, comme le calcule l'addon : les connexions précédentes
    /// (<c>active</c>) plus la connexion courante, figée pendant une pause.
    /// </summary>
    private static int? OnlineSeconds(LuaTable current, long start, long? lastSeen)
    {
        var active = AltBoardReader.NonNegative(current.Get("active")?.AsInt32()) ?? 0;
        if (current.Get("paused")?.AsBoolean() == true) return active;
        if (lastSeen is null) return null;
        var stintStart = AltBoardReader.Timestamp(current.Get("stintStart")) ?? start;
        var seconds = active + Math.Max(0, lastSeen.Value - stintStart);
        return seconds <= int.MaxValue ? (int)seconds : null;
    }
}
