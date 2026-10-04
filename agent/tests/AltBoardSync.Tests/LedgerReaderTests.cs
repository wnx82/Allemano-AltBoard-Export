using System.Text.Json;
using AltBoardSync.Core.AltBoard;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Tests;

public class LedgerReaderTests
{
    private static IReadOnlyDictionary<string, LedgerCharacter> Read(string lua, List<string>? warnings = null) =>
        LedgerReader.Read(SavedVariablesParser.Parse(lua), warnings ?? []);

    [Fact]
    public void Playtime_is_read_per_character()
    {
        var ledger = LedgerReader.Read(Fixture.Parse("ledger-two-characters.lua"), []);

        // Un personnage sans aucune mesure n'est pas transmis.
        Assert.Equal(["Player-9999-00000002", "Player-9999-00000009", "Player-9999-000000EE"], ledger.Keys.Order(StringComparer.Ordinal));

        var hunter = ledger["Player-9999-00000002"].Playtime!;
        Assert.Equal((36000, 1791118570L), (hunter.TotalSeconds, hunter.MeasuredAt));
        Assert.Equal(new CurrentLevelPayload(12, 33300, 1791100000), hunter.Current);
        Assert.Equal(
            [
                new LevelTimePayload(10, 5400, 90000, 1791050000, "Dun Morogh"),
                // Niveau gagné sans mesure de /played : le temps réel reste connu.
                new LevelTimePayload(11, null, 50000, 1791100000, "Loch Modan"),
            ],
            hunter.Levels);

        var warlock = ledger["Player-9999-00000009"].Playtime!;
        Assert.Equal(new CurrentLevelPayload(13, 52200, null), warlock.Current);
        Assert.Empty(warlock.Levels);
    }

    [Fact]
    public void Missing_or_empty_database_yields_nothing()
    {
        Assert.Empty(Read("SessionTrackerDB = nil"));
        Assert.Empty(Read("AllemanoLedgerDB = { chars = {} }"));
        Assert.Empty(Read("AllemanoLedgerDB = { firstSeen = 1 }"));

        var warnings = new List<string>();
        Assert.Empty(Read("AllemanoLedgerDB = 5", warnings));
        Assert.Contains(warnings, w => w.Contains("AllemanoLedgerDB"));
    }

    [Fact]
    public void Out_of_range_or_mistyped_values_are_dropped()
    {
        var playtime = Read("""
            AllemanoLedgerDB = { chars = { ["Player-1-A"] = {
              played = { total = -5, at = 1791000000 },
              levelStart = { level = 99999, playedTotal = 10 },
              levelLog = {
                [5] = { played = "long", wall = -1, reached = 1e15, zone = 42 },
                ["6"] = { played = 120 },
                [-1] = { played = 1 },
                [7] = "pas une table",
              },
            } } }
            """)["Player-1-A"].Playtime!;

        Assert.Null(playtime.TotalSeconds);
        Assert.Null(playtime.Current);
        Assert.Equal([new LevelTimePayload(5, null, null, null, null), new LevelTimePayload(6, 120, null, null, null)], playtime.Levels);
    }

    [Fact]
    public void A_total_without_its_date_is_not_sent()
    {
        var playtime = Read("""AllemanoLedgerDB = { chars = { ["Player-1-A"] = { played = { total = 500 }, levelLog = { [3] = { played = 60 } } } } }""")["Player-1-A"].Playtime!;

        Assert.Null(playtime.TotalSeconds);
        Assert.Null(playtime.MeasuredAt);
        Assert.Single(playtime.Levels);
    }

    [Fact]
    public void Sessions_are_read_oldest_first_and_the_open_one_is_flagged()
    {
        var ledger = LedgerReader.Read(Fixture.Parse("ledger-two-characters.lua"), []);

        Assert.Equal(
            [
                new SessionPayload(1791040000, 1791050400, 9000, 12400, 2, "Dun Morogh", "Dungeon", false),
                new SessionPayload(1791090000, 1791097200, 6900, 8200, 1, "Loch Modan", "Leveling", false),
                // Session ouverte : temps connecté = connexions précédentes (1200 s) + connexion courante (3570 s).
                new SessionPayload(1791110000, 1791118570, 4770, 5300, 1, "Loch Modan", "Leveling", true),
            ],
            // Le « run » d'instance (kind = "run") n'est pas une session : il recoupe celle qui le contient.
            ledger["Player-9999-00000002"].Sessions);

        // En pause : le temps connecté est figé ; l'étiquette choisie par le joueur prime sur l'automatique.
        Assert.Equal([new SessionPayload(1791095000, 1791097693, 900, 0, 0, null, "Farming", true)], ledger["Player-9999-00000009"].Sessions);
        Assert.Empty(ledger["Player-9999-000000EE"].Sessions);
    }

    [Fact]
    public void Malformed_sessions_are_dropped_and_bad_values_are_left_out()
    {
        var sessions = Read("""
            AllemanoLedgerDB = { chars = { ["Player-1-A"] = {
              history = {
                { start = 1791000300, stop = 1791000900, duration = -5, xpGained = "beaucoup", levels = 99999, zone = 42, tag = 7 },
                { stop = 1791000200, duration = 60, xpGained = 10 },
                { start = "hier", duration = 60 },
                "pas une table",
                { start = 1791000100, stop = 1791000200, duration = 100, xpGained = 50, levels = 0 },
              },
              current = { start = 1791000100, lastSeen = 1791009999, xpGained = 999, level = 3, startLevel = 5 },
            } } }
            """)["Player-1-A"].Sessions;

        Assert.Equal(
            [
                // Même début que la session en cours : la session terminée fait foi.
                new SessionPayload(1791000100, 1791000200, 100, 50, 0, null, null, false),
                new SessionPayload(1791000300, 1791000900, null, null, null, null, null, false),
            ],
            sessions);
    }

    [Fact]
    public void An_open_session_without_usable_dates_keeps_what_is_known()
    {
        var session = Assert.Single(Read("""AllemanoLedgerDB = { chars = { ["Player-1-A"] = { current = { start = 1791000100, xpGained = 40, level = 3, startLevel = 5 } } } }""")["Player-1-A"].Sessions);

        // Ni dernière activité ni niveaux cohérents : durée et niveaux restent inconnus plutôt qu'inventés.
        Assert.Equal(new SessionPayload(1791000100, null, null, 40, null, null, null, true), session);
    }

    [Fact]
    public void Only_the_most_recent_sessions_are_kept()
    {
        var entries = string.Join(",", Enumerable.Range(0, 70).Select(i => $"{{ start = {1791000000 + i * 1000}, duration = 600, xpGained = {i} }}"));

        var sessions = Read("AllemanoLedgerDB = { chars = { [\"Player-1-A\"] = { history = { " + entries + " } } } }")["Player-1-A"].Sessions;

        Assert.Equal(60, sessions.Count);
        Assert.Equal((10, 69), (sessions[0].XpGained, sessions[^1].XpGained));
    }

    [Fact]
    public async Task Playtime_is_attached_to_the_matching_altboard_characters()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_classic_beta_");
        var altBoard = temp.AddAccount(flavor, "222222222#1", "account-two-characters.lua");
        File.Copy(Fixture.PathOf("ledger-two-characters.lua"), Path.Combine(Path.GetDirectoryName(altBoard)!, "AllemanoLedger.lua"));
        temp.AddAccount(flavor, "111111111#1", "account-four-characters.lua");

        var sources = AccountScanner.Scan(flavor);
        Assert.Equal([null, "AllemanoLedger.lua"], sources.Select(s => s.LedgerFilePath is null ? null : Path.GetFileName(s.LedgerFilePath)));

        var builder = new PayloadBuilder(new StableFileReader(new StableReadOptions { SettleDelay = TimeSpan.Zero }));
        var withoutLedger = (await builder.ReadAccountAsync(sources[0])).Payload!;
        var withLedger = (await builder.ReadAccountAsync(sources[1])).Payload!;

        Assert.All(withoutLedger.Characters, c => Assert.Null(c.Playtime));
        Assert.All(withoutLedger.Characters, c => Assert.Null(c.Sessions));
        Assert.Empty(withLedger.Warnings);
        // Les personnages inconnus d'AltBoard ne sont pas ajoutés : seul le temps de jeu est repris.
        Assert.Equal(2, withLedger.Characters.Count);
        Assert.Equal(36000, withLedger.Characters[0].Playtime!.TotalSeconds);
        Assert.Equal(13, withLedger.Characters[1].Playtime!.Current!.Level);

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(withLedger.Characters[0], SyncJsonContext.Default.CharacterPayload));
        var playtime = json.RootElement.GetProperty("playtime");
        Assert.Equal(36000, playtime.GetProperty("totalSeconds").GetInt32());
        Assert.Equal(12, playtime.GetProperty("current").GetProperty("level").GetInt32());
        Assert.Equal(2, playtime.GetProperty("levels").GetArrayLength());
        Assert.False(playtime.GetProperty("levels")[1].TryGetProperty("playedSeconds", out _));
        var sessions = json.RootElement.GetProperty("sessions");
        Assert.Equal(3, sessions.GetArrayLength());
        Assert.Equal(
            (1791110000L, 4770, 5300, true),
            (sessions[2].GetProperty("startedAt").GetInt64(), sessions[2].GetProperty("durationSeconds").GetInt32(), sessions[2].GetProperty("xpGained").GetInt32(), sessions[2].GetProperty("inProgress").GetBoolean()));
        Assert.False(sessions[0].GetProperty("inProgress").GetBoolean());
        // Champ sans valeur : omis, jamais null.
        using var warlock = JsonDocument.Parse(JsonSerializer.Serialize(withLedger.Characters[1], SyncJsonContext.Default.CharacterPayload));
        Assert.False(warlock.RootElement.GetProperty("sessions")[0].TryGetProperty("zone", out _));

        using var bare = JsonDocument.Parse(JsonSerializer.Serialize(withoutLedger.Characters[0], SyncJsonContext.Default.CharacterPayload));
        Assert.False(bare.RootElement.TryGetProperty("playtime", out _));
        Assert.False(bare.RootElement.TryGetProperty("sessions", out _));
    }

    [Fact]
    public async Task Unreadable_ledger_file_never_blocks_the_altboard_sync()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_classic_beta_");
        var altBoard = temp.AddAccount(flavor, "222222222#1", "account-two-characters.lua");
        File.WriteAllText(Path.Combine(Path.GetDirectoryName(altBoard)!, "AllemanoLedger.lua"), "AllemanoLedgerDB = { chars = {");

        var result = await new PayloadBuilder(new StableFileReader(new StableReadOptions { SettleDelay = TimeSpan.Zero }))
            .ReadAccountAsync(AccountScanner.Scan(flavor)[0]);

        Assert.True(result.Succeeded);
        Assert.Equal(2, result.Payload!.Characters.Count);
        Assert.All(result.Payload.Characters, c => Assert.Null(c.Playtime));
        Assert.All(result.Payload.Characters, c => Assert.Null(c.Sessions));
        Assert.Contains(result.Payload.Warnings, w => w.StartsWith("Allemano Ledger illisible"));
    }
}
