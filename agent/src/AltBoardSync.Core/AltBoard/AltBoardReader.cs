using System.Text.RegularExpressions;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.AltBoard;

public sealed class AltBoardFormatException(string message) : Exception(message);

public sealed record AltBoardDocument(
    int? Schema,
    IReadOnlyList<CharacterPayload> Characters,
    IReadOnlyList<ItemPayload> Items,
    IReadOnlyList<string> Warnings);

/// <summary>
/// Convertit <c>AltBoardDB</c> (structure documentée dans docs/ALTBOARD-DATA-MODEL.md) vers le modèle
/// de synchronisation. Tolérant : un champ absent, mal typé ou inconnu produit un avertissement,
/// jamais un échec ; seul un personnage sans identité exploitable est écarté.
/// </summary>
public static partial class AltBoardReader
{
    public const string GlobalName = "AltBoardDB";
    public const int SupportedSchema = 2;

    private const int MaxName = 120;
    private const int MaxLink = 600;
    private const int MaxWarnings = 50;

    private static readonly HashSet<string> KnownRootKeys =
        ["schema", "chars", "items", "errors", "order", "settings", "launcher", "window", "itemsWindow", "probe"];

    private static readonly HashSet<string> KnownCharacterKeys =
    [
        "name", "realm", "class", "race", "faction", "level", "xp", "xpMax", "rested", "guild", "zone", "money",
        "ilvl", "lastSeen", "hidden", "stats", "statsAt", "gear", "profs", "reps", "currency", "bags", "bagSlots",
        "bagsAt", "bank", "bankSlots", "bankAt",
    ];

    [GeneratedRegex(@"^[A-Za-z0-9-]{1,64}$")]
    private static partial Regex GuidPattern();

    [GeneratedRegex(@"^(\d{1,9})(?::(-?\d{1,9}))?$")]
    private static partial Regex ItemKeyPattern();

    // "item:ID:enchant:..." : le premier champ est l'objet, le deuxième l'enchantement.
    [GeneratedRegex(@"item:(\d{1,9}):(\d{0,9})")]
    private static partial Regex ItemLinkPattern();

    public static AltBoardDocument Read(IReadOnlyDictionary<string, LuaValue> globals)
    {
        if (!globals.TryGetValue(GlobalName, out var root))
            throw new AltBoardFormatException($"{GlobalName} est absente du fichier");
        if (root is not LuaTable db)
            throw new AltBoardFormatException($"{GlobalName} n'est pas une table");

        var warnings = new Warnings();

        foreach (var (key, _) in db.Entries)
        {
            if (key.Kind != LuaKeyKind.String || !KnownRootKeys.Contains(key.Text!))
                warnings.Add($"clé racine inconnue ignorée : {key}");
        }

        var schema = db.Get("schema")?.AsInt32();
        if (schema is null) warnings.Add("version de schéma AltBoard absente");
        else if (schema != SupportedSchema) warnings.Add($"version de schéma AltBoard inconnue ({schema}) : lecture au mieux");

        var characters = new List<CharacterPayload>();
        if (db.Get("chars") is LuaTable chars)
        {
            foreach (var (key, value) in chars.Entries)
            {
                var character = ReadCharacter(key, value, warnings);
                if (character is not null) characters.Add(character);
            }
        }
        else if (db.Get("chars") is not null)
        {
            warnings.Add("chars n'est pas une table : aucun personnage lu");
        }

        var items = new List<ItemPayload>();
        if (db.Get("items") is LuaTable itemTable)
        {
            foreach (var (key, value) in itemTable.Entries)
            {
                var item = ReadItem(key, value, warnings);
                if (item is not null) items.Add(item);
            }
        }

        // Ordre déterministe : le client réécrit ses tables dans un ordre variable.
        characters.Sort((a, b) => string.CompareOrdinal(a.Guid, b.Guid));
        items.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        return new AltBoardDocument(schema, characters, items, warnings.ToList());
    }

    private static CharacterPayload? ReadCharacter(LuaKey key, LuaValue value, Warnings warnings)
    {
        if (key.Kind != LuaKeyKind.String || !GuidPattern().IsMatch(key.Text!))
        {
            warnings.Add("personnage ignoré : identifiant (GUID) invalide");
            return null;
        }

        var guid = key.Text!;
        if (value is not LuaTable c)
        {
            warnings.Add($"personnage {guid} ignoré : valeur inattendue");
            return null;
        }

        var name = Text(c.Get("name"), MaxName);
        var realm = Text(c.Get("realm"), MaxName);
        var lastSeen = c.Get("lastSeen")?.AsInt64();
        if (name is null || realm is null || lastSeen is null or <= 0)
        {
            // L'addon lui-même ignore un personnage sans nom (entrée créée avant la première collecte).
            warnings.Add($"personnage {guid} ignoré : nom, royaume ou lastSeen absent");
            return null;
        }

        foreach (var (fieldKey, _) in c.Entries)
        {
            if (fieldKey.Kind != LuaKeyKind.String || !KnownCharacterKeys.Contains(fieldKey.Text!))
                warnings.Add($"champ de personnage inconnu ignoré : {fieldKey}");
        }

        return new CharacterPayload
        {
            Guid = guid,
            Name = name,
            Realm = realm,
            LastSeen = lastSeen.Value,
            Class = Text(c.Get("class"), MaxName),
            Race = Text(c.Get("race"), MaxName),
            Faction = Text(c.Get("faction"), MaxName),
            Level = NonNegative(c.Get("level")?.AsInt32()),
            Xp = NonNegative(c.Get("xp")?.AsInt64()),
            XpMax = NonNegative(c.Get("xpMax")?.AsInt64()),
            RestedXp = NonNegative(c.Get("rested")?.AsInt64()),
            Guild = Text(c.Get("guild"), MaxName),
            Zone = Text(c.Get("zone"), MaxName),
            MoneyCopper = NonNegative(c.Get("money")?.AsInt64()),
            ItemLevel = c.Get("ilvl")?.AsDouble(),
            Hidden = c.Get("hidden")?.AsBoolean() ?? false,
            Stats = ReadStats(c.Get("stats")?.AsTable()),
            StatsAt = Positive(c.Get("statsAt")?.AsInt64()),
            Gear = ReadGear(c.Get("gear")?.AsTable()),
            Professions = ReadProfessions(c.Get("profs")?.AsTable(), guid, warnings),
            Reputations = ReadReputations(c.Get("reps")?.AsTable()),
            Currencies = ReadCurrencies(c.Get("currency")?.AsTable()),
            Bags = ReadContainer(c, "bags", "bagSlots", "bagsAt"),
            Bank = ReadContainer(c, "bank", "bankSlots", "bankAt"),
        };
    }

    private static StatsPayload? ReadStats(LuaTable? s)
    {
        if (s is null) return null;
        var res = s.Get("res")?.AsTable();
        return new StatsPayload
        {
            Strength = s.Get("str")?.AsInt32(),
            Agility = s.Get("agi")?.AsInt32(),
            Stamina = s.Get("sta")?.AsInt32(),
            Intellect = s.Get("int")?.AsInt32(),
            Spirit = s.Get("spi")?.AsInt32(),
            Armor = s.Get("armor")?.AsInt32(),
            Health = s.Get("health")?.AsInt32(),
            Power = s.Get("power")?.AsInt32(),
            PowerType = Text(s.Get("powerType"), MaxName),
            AttackPower = s.Get("ap")?.AsInt32(),
            RangedAttackPower = s.Get("rap")?.AsInt32(),
            Crit = s.Get("crit")?.AsDouble(),
            RangedCrit = s.Get("rcrit")?.AsDouble(),
            Hit = s.Get("hit")?.AsDouble(),
            Dodge = s.Get("dodge")?.AsDouble(),
            Parry = s.Get("parry")?.AsDouble(),
            Block = s.Get("block")?.AsDouble(),
            Defense = s.Get("defense")?.AsInt32(),
            SpellPower = s.Get("sp")?.AsInt32(),
            SpellCrit = s.Get("scrit")?.AsDouble(),
            Healing = s.Get("heal")?.AsInt32(),
            SpellHit = s.Get("shit")?.AsDouble(),
            // Index 2 à 6 : feu, nature, givre, ombre, arcane (Data.lua de l'addon).
            ResFire = res?.Get(2)?.AsInt32(),
            ResNature = res?.Get(3)?.AsInt32(),
            ResFrost = res?.Get(4)?.AsInt32(),
            ResShadow = res?.Get(5)?.AsInt32(),
            ResArcane = res?.Get(6)?.AsInt32(),
        };
    }

    private static List<GearPayload> ReadGear(LuaTable? gear)
    {
        var result = new List<GearPayload>();
        if (gear is null) return result;

        foreach (var (key, value) in gear.Entries)
        {
            // Emplacements d'inventaire 1 à 19 (tête … tabard).
            var slot = key.AsInt64();
            if (slot is null or < 1 or > 19 || value is not LuaTable g) continue;
            var link = Text(g.Get("link"), MaxLink);
            var (itemId, enchantId) = ParseItemLink(link);
            result.Add(new GearPayload(
                (int)slot.Value,
                itemId,
                enchantId,
                Text(g.Get("name"), MaxName),
                g.Get("q")?.AsInt32(),
                g.Get("ilvl")?.AsInt32(),
                g.Get("icon")?.AsInt32(),
                link));
        }

        result.Sort((a, b) => a.Slot.CompareTo(b.Slot));
        return result;
    }

    private static List<ProfessionPayload> ReadProfessions(LuaTable? profs, string guid, Warnings warnings)
    {
        var result = new List<ProfessionPayload>();
        if (profs is null) return result;

        var seen = new HashSet<int>();
        foreach (var (_, value) in profs.Entries.OrderBy(e => e.Key.AsInt64() ?? long.MaxValue))
        {
            if (value is not LuaTable p) continue;
            var name = Text(p.Get("name"), MaxName);
            var skillLine = p.Get("skillLine")?.AsInt32();
            if (name is null || skillLine is null || !seen.Add(skillLine.Value))
            {
                warnings.Add($"métier ignoré pour {guid} : nom ou skillLine absent, ou doublon");
                continue;
            }

            result.Add(new ProfessionPayload(
                skillLine.Value,
                name,
                p.Get("rank")?.AsInt32(),
                p.Get("max")?.AsInt32(),
                p.Get("primary")?.AsBoolean() ?? false,
                p.Get("icon")?.AsInt32()));
        }

        return result;
    }

    private static List<ReputationPayload> ReadReputations(LuaTable? reps)
    {
        var result = new List<ReputationPayload>();
        if (reps is null) return result;

        foreach (var (key, value) in reps.Entries)
        {
            var factionId = key.AsInt64();
            if (factionId is null or <= 0 or > int.MaxValue || value is not LuaTable r) continue;
            var name = Text(r.Get("name"), MaxName);
            if (name is null) continue;
            result.Add(new ReputationPayload(
                (int)factionId.Value,
                name,
                Text(r.Get("group"), MaxName),
                r.Get("reaction")?.AsInt32(),
                r.Get("cur")?.AsInt32(),
                r.Get("min")?.AsInt32(),
                r.Get("max")?.AsInt32()));
        }

        result.Sort((a, b) => a.FactionId.CompareTo(b.FactionId));
        return result;
    }

    private static List<CurrencyPayload> ReadCurrencies(LuaTable? currency)
    {
        var result = new List<CurrencyPayload>();
        if (currency is null) return result;

        foreach (var (key, value) in currency.Entries)
        {
            if (key.Kind != LuaKeyKind.String || value is not LuaTable cur) continue;
            var name = Truncate(key.Text!, MaxName);
            var quantity = NonNegative(cur.Get("qty")?.AsInt32());
            if (name.Length == 0 || quantity is null) continue;
            result.Add(new CurrencyPayload(name, quantity.Value, cur.Get("max")?.AsInt32(), cur.Get("icon")?.AsInt32()));
        }

        result.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
        return result;
    }

    /// <summary>Sacs ou banque. Absent tant que l'addon n'a jamais daté ce bloc (banque jamais ouverte).</summary>
    private static ContainerPayload? ReadContainer(LuaTable c, string itemsKey, string slotsKey, string atKey)
    {
        var at = Positive(c.Get(atKey)?.AsInt64());
        if (at is null || c.Get(itemsKey) is not LuaTable counts) return null;

        var items = new List<ItemCountPayload>();
        foreach (var (key, value) in counts.Entries)
        {
            var itemKey = key.ToString();
            var count = NonNegative(value.AsInt32());
            if (!ItemKeyPattern().IsMatch(itemKey) || count is null) continue;
            items.Add(new ItemCountPayload(itemKey, count.Value));
        }

        items.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        var slots = c.Get(slotsKey)?.AsTable();
        return new ContainerPayload(at.Value, NonNegative(slots?.Get("used")?.AsInt32()), NonNegative(slots?.Get("total")?.AsInt32()), items);
    }

    private static ItemPayload? ReadItem(LuaKey key, LuaValue value, Warnings warnings)
    {
        var itemKey = key.ToString();
        var match = ItemKeyPattern().Match(itemKey);
        if (!match.Success || value is not LuaTable item)
        {
            warnings.Add("objet du référentiel ignoré : clé ou valeur inattendue");
            return null;
        }

        return new ItemPayload(
            itemKey,
            int.Parse(match.Groups[1].ValueSpan),
            match.Groups[2].Success ? int.Parse(match.Groups[2].ValueSpan) : null,
            Text(item.Get("n"), MaxName),
            item.Get("q")?.AsInt32(),
            item.Get("i")?.AsInt32(),
            Text(item.Get("l"), MaxLink));
    }

    internal static (int? ItemId, int? EnchantId) ParseItemLink(string? link)
    {
        if (link is null) return (null, null);
        var match = ItemLinkPattern().Match(link);
        if (!match.Success) return (null, null);
        var itemId = int.Parse(match.Groups[1].ValueSpan);
        var enchantId = match.Groups[2].Length > 0 ? int.Parse(match.Groups[2].ValueSpan) : 0;
        return (itemId, enchantId > 0 ? enchantId : null);
    }

    private static string? Text(LuaValue? value, int maxLength)
    {
        var text = value?.AsString();
        if (string.IsNullOrWhiteSpace(text)) return null;
        return Truncate(text, maxLength);
    }

    private static string Truncate(string text, int maxLength)
    {
        if (text.Length <= maxLength) return text;
        // Ne pas couper une paire de substitution UTF-16 en deux.
        var length = char.IsHighSurrogate(text[maxLength - 1]) ? maxLength - 1 : maxLength;
        return text[..length];
    }

    private static int? NonNegative(int? value) => value is >= 0 ? value : null;

    private static long? NonNegative(long? value) => value is >= 0 ? value : null;

    private static long? Positive(long? value) => value is > 0 ? value : null;

    private sealed class Warnings
    {
        private readonly List<string> _list = [];
        private readonly HashSet<string> _seen = [];

        public void Add(string message)
        {
            if (_list.Count < MaxWarnings && _seen.Add(message)) _list.Add(message);
        }

        public List<string> ToList() => _list;
    }
}
