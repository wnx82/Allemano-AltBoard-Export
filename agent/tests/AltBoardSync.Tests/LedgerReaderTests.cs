using System.Text.Json;
using AltBoardSync.Core.AltBoard;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Tests;

public class LedgerReaderTests
{
    private static IReadOnlyDictionary<string, PlaytimePayload> Read(string lua, List<string>? warnings = null) =>
        LedgerReader.Read(SavedVariablesParser.Parse(lua), warnings ?? []);

    [Fact]
    public void Playtime_is_read_per_character()
    {
        var playtimes = LedgerReader.Read(Fixture.Parse("ledger-two-characters.lua"), []);

        // Un personnage sans aucune mesure n'est pas transmis.
        Assert.Equal(["Player-9999-00000002", "Player-9999-00000009", "Player-9999-000000EE"], playtimes.Keys.Order(StringComparer.Ordinal));

        var hunter = playtimes["Player-9999-00000002"];
        Assert.Equal((36000, 1791118570L), (hunter.TotalSeconds, hunter.MeasuredAt));
        Assert.Equal(new CurrentLevelPayload(12, 33300, 1791100000), hunter.Current);
        Assert.Equal(
            [
                new LevelTimePayload(10, 5400, 90000, 1791050000, "Dun Morogh"),
                // Niveau gagné sans mesure de /played : le temps réel reste connu.
                new LevelTimePayload(11, null, 50000, 1791100000, "Loch Modan"),
            ],
            hunter.Levels);

        var warlock = playtimes["Player-9999-00000009"];
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
            """)["Player-1-A"];

        Assert.Null(playtime.TotalSeconds);
        Assert.Null(playtime.Current);
        Assert.Equal([new LevelTimePayload(5, null, null, null, null), new LevelTimePayload(6, 120, null, null, null)], playtime.Levels);
    }

    [Fact]
    public void A_total_without_its_date_is_not_sent()
    {
        var playtime = Read("""AllemanoLedgerDB = { chars = { ["Player-1-A"] = { played = { total = 500 }, levelLog = { [3] = { played = 60 } } } } }""")["Player-1-A"];

        Assert.Null(playtime.TotalSeconds);
        Assert.Null(playtime.MeasuredAt);
        Assert.Single(playtime.Levels);
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
        Assert.False(JsonDocument.Parse(JsonSerializer.Serialize(withoutLedger.Characters[0], SyncJsonContext.Default.CharacterPayload)).RootElement.TryGetProperty("playtime", out _));
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
        Assert.Contains(result.Payload.Warnings, w => w.StartsWith("Allemano Ledger illisible"));
    }
}
