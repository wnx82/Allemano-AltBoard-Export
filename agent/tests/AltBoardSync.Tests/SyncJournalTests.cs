using AltBoardSync.Core.App;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Tests;

public class SyncJournalTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 6, 0, 30, 0, TimeSpan.Zero);

    private static CharacterPayload Character(string name, int level = 28, long money = 100_000) => new()
    {
        Guid = $"Player-1-{name}",
        Name = name,
        Realm = "Sulfuron",
        LastSeen = 1_700_000_000,
        Level = level,
        Xp = 1_000,
        MoneyCopper = money,
        ItemLevel = 31.5,
        Zone = "Les Carmines",
        Guild = "Allemano",
        Professions = [new ProfessionPayload(186, "Minage", 120, 150, true, null)],
        Gear = [new GearPayload(1, 100, null, "Casque", 2, 30, null, null)],
        Playtime = new PlaytimePayload(3_600, null, null, []),
    };

    private static SyncPayload Document(params CharacterPayload[] characters) => new(
        SyncPayload.CurrentSchemaVersion, "0.0.0", Now, new MachinePayload(Guid.NewGuid(), "PC-TEST", null),
        [new AccountPayload("clé", "11…#1", "_classic_", 2, "0.8.3", new SourceFilePayload("empreinte", Now, 10), characters, [], [])]);

    private static IReadOnlyList<string> Details(CharacterPayload before, CharacterPayload after)
    {
        using var temp = new TempDirectory();
        var journal = new SyncJournal(temp.Path, () => Now);
        journal.Synced(Document(before), "premier envoi");
        return Assert.Single(journal.Synced(Document(after), "second envoi")).Details;
    }

    [Fact]
    public void The_first_send_has_nothing_to_compare_to()
    {
        using var temp = new TempDirectory();
        var journal = new SyncJournal(temp.Path, () => Now);

        Assert.Empty(journal.Synced(Document(Character("Aedot"), Character("Thalindra")), "2 personnages synchronisés, 2 mis à jour."));

        var entry = Assert.Single(journal.ReadLatest());
        Assert.Equal(JournalEntry.Synced, entry.Kind);
        Assert.Equal(2, entry.Characters);
        Assert.Equal(Now, entry.At);
        Assert.Empty(entry.Changes);
    }

    [Fact]
    public void Reports_only_the_characters_that_changed_since_the_previous_send()
    {
        using var temp = new TempDirectory();
        var journal = new SyncJournal(temp.Path, () => Now);
        journal.Synced(Document(Character("Aedot"), Character("Thalindra")), "premier envoi");

        var changes = journal.Synced(Document(Character("Aedot", level: 30), Character("Thalindra"), Character("Bankalt", level: 4)), "second envoi");

        Assert.Equal(["Aedot", "Bankalt"], changes.Select(c => c.Name));
        Assert.Equal(["niveau 28 → 30"], changes[0].Details);
        Assert.Equal("Sulfuron", changes[0].Realm);
        Assert.Equal(["nouveau personnage, niveau 4"], changes[1].Details);

        // Le plus récent en premier, avec son détail ; puis plus rien à signaler.
        var latest = journal.ReadLatest();
        Assert.Equal(["second envoi", "premier envoi"], latest.Select(e => e.Message));
        Assert.Equal(["Aedot", "Bankalt"], latest[0].Changes.Select(c => c.Name));
        Assert.Empty(journal.Synced(Document(Character("Aedot", level: 30), Character("Thalindra"), Character("Bankalt", level: 4)), "troisième envoi"));
    }

    [Fact]
    public void Describes_every_kind_of_change()
    {
        var before = Character("Aedot");
        var after = before with
        {
            Level = 30,
            MoneyCopper = 224_000,
            ItemLevel = 34,
            Zone = "Vallée de Strangleronce",
            Professions = [new ProfessionPayload(186, "Minage", 141, 150, true, null), new ProfessionPayload(182, "Herboristerie", 1, 75, true, null)],
            Gear = [new GearPayload(1, 200, null, "Heaume", 3, 34, null, null)],
            Playtime = new PlaytimePayload(3_600 + 11_520, null, null, []),
        };

        Assert.Equal(
            [
                "niveau 28 → 30", "niveau d'objet 31,5 → 34", "+12 po 40 pa", "+3 h 12 de jeu", "Minage 120 → 141",
                "nouveau métier : Herboristerie", "zone : Vallée de Strangleronce", "équipement mis à jour",
            ],
            Details(before, after));
    }

    [Fact]
    public void Describes_experience_losses_and_leaving_a_guild()
    {
        var before = Character("Aedot");

        Assert.Equal(["+4 250 XP"], Details(before, before with { Xp = 5_250 }));
        Assert.Equal(["−85 pa 12 pc"], Details(before, before with { MoneyCopper = 100_000 - 8_512 }));
        Assert.Equal(["+151 po 2 pa"], Details(before, before with { MoneyCopper = 100_000 + 1_510_200 }));
        Assert.Equal(["+50 pc"], Details(before, before with { MoneyCopper = 100_050 }));
        Assert.Equal(["a quitté sa guilde"], Details(before, before with { Guild = null }));
        Assert.Equal(["+45 min de jeu"], Details(before, before with { Playtime = new PlaytimePayload(3_600 + 2_700, null, null, []) }));
        Assert.Equal(
            ["sacs, réputations mis à jour"],
            Details(before, before with
            {
                Bags = new ContainerPayload(1, 3, 16, [new ItemCountPayload("2589", 4)]),
                Reputations = [new ReputationPayload(72, "Hurlevent", null, 5, 1_200, 0, 6_000)],
            }));
    }

    [Fact]
    public void A_change_outside_what_is_tracked_is_still_reported()
    {
        var before = Character("Aedot");

        Assert.Equal(["données mises à jour"], Details(before, before with { LastSeen = before.LastSeen + 60 }));
    }

    [Fact]
    public void Failures_and_notes_are_recorded()
    {
        using var temp = new TempDirectory();
        var journal = new SyncJournal(temp.Path, () => Now);

        journal.Info("Synchronisation automatique démarrée.");
        journal.Failed("Serveur injoignable");

        Assert.Equal(
            [(JournalEntry.Failed, "Serveur injoignable"), (JournalEntry.Info, "Synchronisation automatique démarrée.")],
            journal.ReadLatest().Select(e => (e.Kind, e.Message)));
    }

    [Fact]
    public void Reads_around_lines_it_did_not_write_itself()
    {
        using var temp = new TempDirectory();
        var journal = new SyncJournal(temp.Path, () => Now);
        File.WriteAllLines(journal.JournalPath,
        [
            """{"at":"2026-10-05T20:00:00+00:00","kind":"info","message":"sans le champ changes"}""",
            """{"at":"2026-10-05T21:00:00+00:00","kind":"synced","message":"champs nuls","changes":null}""",
            """{"at":"2026-10-05T22:00:00+00:00","kind":"synced","message":"ligne tronq""",
            "",
            """{"at":"2026-10-05T23:00:00+00:00","kind":"failed"}""",
        ]);

        var entries = journal.ReadLatest();

        Assert.Equal(["champs nuls", "sans le champ changes"], entries.Select(e => e.Message));
        Assert.All(entries, e => Assert.Empty(e.Changes));
    }

    [Fact]
    public void Keeps_only_the_latest_entries_once_the_file_grows()
    {
        using var temp = new TempDirectory();
        var journal = new SyncJournal(temp.Path, () => Now);
        var padding = new string('x', 1_200);

        for (var i = 1; i <= 260; i++) journal.Info($"entrée {i} {padding}");

        // 260 entrées feraient plus de 330 Ko : les plus anciennes ont été retirées du fichier.
        Assert.InRange(new FileInfo(journal.JournalPath).Length, 1, 280 * 1024);
        var entries = journal.ReadLatest();
        Assert.Equal(200, entries.Count);
        Assert.StartsWith("entrée 260 ", entries[0].Message);
        Assert.StartsWith("entrée 61 ", entries[^1].Message);
    }

    [Fact]
    public void An_unusable_folder_never_fails_a_synchronisation()
    {
        using var temp = new TempDirectory();
        // Un fichier à la place du dossier : rien ne peut y être écrit.
        var blocked = temp.Combine("occupé");
        File.WriteAllText(blocked, "");
        var journal = new SyncJournal(blocked, () => Now);

        Assert.Empty(journal.Synced(Document(Character("Aedot")), "envoi"));
        journal.Failed("échec");
        Assert.Empty(journal.ReadLatest());
    }
}
