using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace AltBoardSync.Core.Sync;

/// <summary>Ce qui a changé pour un personnage entre deux envois acceptés.</summary>
public sealed record CharacterChange(string Name, string Realm, IReadOnlyList<string> Details);

/// <summary>Ce que l'agent retient d'un personnage envoyé, pour dire ce qui a changé à l'envoi suivant.</summary>
public sealed record CharacterDigest
{
    public required string Name { get; init; }
    public required string Realm { get; init; }

    /// <summary>Empreinte de tout le personnage : inchangée, rien n'est à signaler.</summary>
    public required string Hash { get; init; }

    public int? Level { get; init; }
    public int? Xp { get; init; }
    public long? MoneyCopper { get; init; }
    public double? ItemLevel { get; init; }
    public string? Zone { get; init; }
    public string? Guild { get; init; }
    public int? PlayedSeconds { get; init; }

    /// <summary>Rang par nom de métier.</summary>
    public Dictionary<string, int> Professions { get; init; } = new();

    /// <summary>Empreinte par partie du personnage (équipement, sacs…) : dit laquelle a changé, sans en garder le contenu.</summary>
    public Dictionary<string, string> Sections { get; init; } = new();
}

/// <summary>Compare les personnages d'un envoi à ceux de l'envoi accepté précédent.</summary>
public static class ChangeDetector
{
    private const int CopperPerSilver = 100, CopperPerGold = 10_000;

    /// <summary>Clé d'un personnage : son identifiant n'est unique qu'au sein d'un client.</summary>
    public static string Key(AccountPayload account, CharacterPayload character) => $"{account.Flavor}/{character.Guid}";

    public static CharacterDigest Digest(CharacterPayload character) => new()
    {
        Name = character.Name,
        Realm = character.Realm,
        Hash = Hash([character], SyncJsonContext.Default.CharacterPayload),
        Level = character.Level,
        Xp = character.Xp,
        MoneyCopper = character.MoneyCopper,
        ItemLevel = character.ItemLevel,
        Zone = character.Zone,
        Guild = character.Guild,
        PlayedSeconds = character.Playtime?.TotalSeconds,
        Professions = character.Professions
            .Where(p => p.Rank is not null)
            .GroupBy(p => p.Name)
            .ToDictionary(g => g.Key, g => g.First().Rank!.Value),
        Sections = new Dictionary<string, string>
        {
            ["équipement"] = Hash(character.Gear, SyncJsonContext.Default.GearPayload),
            ["sacs"] = Hash(character.Bags?.Items ?? [], SyncJsonContext.Default.ItemCountPayload),
            ["banque"] = Hash(character.Bank?.Items ?? [], SyncJsonContext.Default.ItemCountPayload),
            ["réputations"] = Hash(character.Reputations, SyncJsonContext.Default.ReputationPayload),
            ["monnaies"] = Hash(character.Currencies, SyncJsonContext.Default.CurrencyPayload),
        },
    };

    /// <param name="known">Personnages de l'envoi précédent ; null au tout premier envoi, où rien n'est comparable.</param>
    /// <returns>Un élément par personnage nouveau ou modifié, dans l'ordre de l'envoi.</returns>
    public static IReadOnlyList<CharacterChange> Compare(
        IReadOnlyDictionary<string, CharacterDigest>? known, IEnumerable<(string Key, CharacterDigest Digest)> current)
    {
        if (known is null) return [];
        var changes = new List<CharacterChange>();
        foreach (var (key, digest) in current)
        {
            if (!known.TryGetValue(key, out var previous))
            {
                var introduction = digest.Level is { } level ? $"nouveau personnage, niveau {level}" : "nouveau personnage";
                changes.Add(new CharacterChange(digest.Name, digest.Realm, [introduction]));
            }
            else if (previous.Hash != digest.Hash)
            {
                changes.Add(new CharacterChange(digest.Name, digest.Realm, Describe(previous, digest)));
            }
        }

        return changes;
    }

    private static IReadOnlyList<string> Describe(CharacterDigest before, CharacterDigest after)
    {
        var details = new List<string>();
        if (after.Level is { } level && before.Level is { } previousLevel && level != previousLevel)
            details.Add($"niveau {previousLevel} → {level}");
        else if (after.Xp is { } xp && before.Xp is { } previousXp && xp > previousXp)
            details.Add($"+{Thousands(xp - previousXp)} XP");

        if (after.ItemLevel is { } itemLevel && before.ItemLevel is { } previousItemLevel && Math.Abs(itemLevel - previousItemLevel) >= 0.05)
            details.Add($"niveau d'objet {Decimal(previousItemLevel)} → {Decimal(itemLevel)}");
        if (after.MoneyCopper is { } money && before.MoneyCopper is { } previousMoney && money != previousMoney)
            details.Add(Money(money - previousMoney));
        if (after.PlayedSeconds is { } played && before.PlayedSeconds is { } previousPlayed && played - previousPlayed >= 60)
            details.Add($"+{Duration(played - previousPlayed)} de jeu");

        foreach (var (name, rank) in after.Professions)
        {
            if (!before.Professions.TryGetValue(name, out var previousRank)) details.Add($"nouveau métier : {name}");
            else if (rank != previousRank) details.Add($"{name} {previousRank} → {rank}");
        }

        if (after.Zone is { Length: > 0 } zone && zone != before.Zone) details.Add($"zone : {zone}");
        if ((after.Guild ?? "") != (before.Guild ?? "")) details.Add(after.Guild is { Length: > 0 } guild ? $"guilde : {guild}" : "a quitté sa guilde");

        var sections = after.Sections.Where(s => before.Sections.GetValueOrDefault(s.Key) != s.Value).Select(s => s.Key).ToList();
        if (sections.Count > 0) details.Add($"{string.Join(", ", sections)} mis à jour");

        // Le reste (caractéristiques, dernière connexion, sessions) change à chaque connexion.
        if (details.Count == 0) details.Add("données mises à jour");
        return details;
    }

    /// <summary>Les deux unités les plus fortes suffisent : « +12 po 40 pa », « −85 pa 12 pc ».</summary>
    internal static string Money(long deltaCopper)
    {
        var amount = Math.Abs(deltaCopper);
        long gold = amount / CopperPerGold, silver = amount % CopperPerGold / CopperPerSilver, copper = amount % CopperPerSilver;
        var text = gold > 0 ? (silver > 0 ? $"{Thousands(gold)} po {silver} pa" : $"{Thousands(gold)} po")
            : silver > 0 ? (copper > 0 ? $"{silver} pa {copper} pc" : $"{silver} pa")
            : $"{copper} pc";
        return (deltaCopper < 0 ? "−" : "+") + text;
    }

    internal static string Duration(int seconds)
    {
        int hours = seconds / 3600, minutes = seconds % 3600 / 60;
        return hours > 0 ? $"{hours} h {minutes:00}" : $"{minutes} min";
    }

    // Écrits à la main : l'agent est publié sans données de culture (InvariantGlobalization).
    private static string Thousands(long value) => value.ToString("#,0", CultureInfo.InvariantCulture).Replace(',', ' ');

    private static string Decimal(double value) => value.ToString("0.#", CultureInfo.InvariantCulture).Replace('.', ',');

    private static string Hash<T>(IEnumerable<T> items, JsonTypeInfo<T> typeInfo)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var item in items) hash.AppendData(JsonSerializer.SerializeToUtf8Bytes(item, typeInfo));
        return Convert.ToHexStringLower(hash.GetHashAndReset())[..16];
    }
}
