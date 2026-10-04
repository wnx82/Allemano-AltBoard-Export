using System.Text.Json.Serialization;

namespace AltBoardSync.Core.Sync;

// Document envoyé à POST /api/sync. Toute évolution incompatible incrémente SchemaVersion.
// Les horodatages issus d'AltBoard restent des secondes Unix, telles qu'écrites par l'addon.

public sealed record SyncPayload(
    int SchemaVersion,
    string AgentVersion,
    DateTimeOffset GeneratedAt,
    MachinePayload Machine,
    IReadOnlyList<AccountPayload> Accounts)
{
    public const int CurrentSchemaVersion = 1;
}

public sealed record MachinePayload(Guid Uuid, string Hostname, string? DisplayName);

public sealed record AccountPayload(
    string AccountKey,
    string FolderHint,
    string Flavor,
    int? AddonSchema,
    string? AddonVersion,
    SourceFilePayload File,
    IReadOnlyList<CharacterPayload> Characters,
    IReadOnlyList<ItemPayload> Items,
    IReadOnlyList<string> Warnings);

public sealed record SourceFilePayload(string Hash, DateTimeOffset ModifiedAt, long Size);

public sealed record CharacterPayload
{
    public required string Guid { get; init; }
    public required string Name { get; init; }
    public required string Realm { get; init; }
    public required long LastSeen { get; init; }
    public string? Class { get; init; }
    public string? Race { get; init; }
    public string? Faction { get; init; }
    public int? Level { get; init; }
    public int? Xp { get; init; }
    public int? XpMax { get; init; }
    public int? RestedXp { get; init; }
    public string? Guild { get; init; }
    public string? Zone { get; init; }
    public long? MoneyCopper { get; init; }
    public double? ItemLevel { get; init; }
    public bool Hidden { get; init; }
    public StatsPayload? Stats { get; init; }
    public long? StatsAt { get; init; }
    public IReadOnlyList<GearPayload> Gear { get; init; } = [];
    public IReadOnlyList<ProfessionPayload> Professions { get; init; } = [];
    public IReadOnlyList<ReputationPayload> Reputations { get; init; } = [];
    public IReadOnlyList<CurrencyPayload> Currencies { get; init; } = [];
    public ContainerPayload? Bags { get; init; }
    public ContainerPayload? Bank { get; init; }

    /// <summary>Temps de jeu relevé par l'addon Allemano Ledger ; absent si l'addon n'est pas installé.</summary>
    public PlaytimePayload? Playtime { get; init; }

    /// <summary>Sessions de jeu relevées par l'addon Allemano Ledger ; absent si l'addon n'en a enregistré aucune.</summary>
    public IReadOnlyList<SessionPayload>? Sessions { get; init; }
}

public sealed record StatsPayload
{
    public int? Strength { get; init; }
    public int? Agility { get; init; }
    public int? Stamina { get; init; }
    public int? Intellect { get; init; }
    public int? Spirit { get; init; }
    public int? Armor { get; init; }
    public int? Health { get; init; }
    public int? Power { get; init; }
    public string? PowerType { get; init; }
    public int? AttackPower { get; init; }
    public int? RangedAttackPower { get; init; }
    public double? Crit { get; init; }
    public double? RangedCrit { get; init; }
    public double? Hit { get; init; }
    public double? Dodge { get; init; }
    public double? Parry { get; init; }
    public double? Block { get; init; }
    public int? Defense { get; init; }
    public int? SpellPower { get; init; }
    public double? SpellCrit { get; init; }
    public int? Healing { get; init; }
    public double? SpellHit { get; init; }
    public int? ResFire { get; init; }
    public int? ResNature { get; init; }
    public int? ResFrost { get; init; }
    public int? ResShadow { get; init; }
    public int? ResArcane { get; init; }
}

public sealed record GearPayload(int Slot, int? ItemId, int? EnchantId, string? Name, int? Quality, int? ItemLevel, int? Icon, string? Link);

public sealed record ProfessionPayload(int SkillLine, string Name, int? Rank, int? Max, bool Primary, int? Icon);

public sealed record ReputationPayload(int FactionId, string Name, string? Group, int? Reaction, int? Current, int? Min, int? Max);

public sealed record CurrencyPayload(string Name, int Quantity, int? Max, int? Icon);

public sealed record ContainerPayload(long At, int? SlotsUsed, int? SlotsTotal, IReadOnlyList<ItemCountPayload> Items);

public sealed record ItemCountPayload(string Key, int Count);

/// <summary>Dernier /played connu, début du niveau en cours et niveaux terminés.</summary>
public sealed record PlaytimePayload(int? TotalSeconds, long? MeasuredAt, CurrentLevelPayload? Current, IReadOnlyList<LevelTimePayload> Levels);

public sealed record CurrentLevelPayload(int Level, int? StartTotalSeconds, long? StartedAt);

/// <summary>Un niveau terminé. PlayedSeconds est absent quand plusieurs niveaux ont été gagnés d'un coup.</summary>
public sealed record LevelTimePayload(int Level, int? PlayedSeconds, int? WallSeconds, long? ReachedAt, string? Zone);

/// <summary>
/// Une session de jeu, identifiée par son début. DurationSeconds est le temps connecté, pauses exclues.
/// InProgress : session encore ouverte quand le jeu a écrit le fichier, donc valeurs provisoires.
/// </summary>
public sealed record SessionPayload(long StartedAt, long? StoppedAt, int? DurationSeconds, int? XpGained, int? Levels, string? Zone, string? Tag, bool InProgress);

public sealed record ItemPayload(string Key, int ItemId, int? SuffixId, string? Name, int? Quality, int? Icon, string? Link);

/// <summary>Réponse de l'API à une synchronisation.</summary>
public sealed record SyncResponse
{
    public long? RunId { get; init; }
    public string? Status { get; init; }
    public int AccountsReceived { get; init; }
    public int CharactersReceived { get; init; }
    public int CharactersCreated { get; init; }
    public int CharactersUpdated { get; init; }
    public int CharactersUnchanged { get; init; }
    public int CharactersStale { get; init; }
    public int SnapshotsCreated { get; init; }
    public IReadOnlyList<SyncResponseError> Errors { get; init; } = [];
    public string? Error { get; init; }
}

public sealed record SyncResponseError(string Code, string Message);

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(SyncPayload))]
[JsonSerializable(typeof(SyncResponse))]
public sealed partial class SyncJsonContext : JsonSerializerContext;
