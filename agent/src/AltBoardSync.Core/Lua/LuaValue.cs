using System.Diagnostics.CodeAnalysis;

namespace AltBoardSync.Core.Lua;

/// <summary>Valeur Lua lue dans un fichier SavedVariables. Purement des données : rien n'est exécuté.</summary>
public abstract class LuaValue
{
    public LuaTable? AsTable() => this as LuaTable;

    public string? AsString() => (this as LuaString)?.Value;

    public bool? AsBoolean() => (this as LuaBoolean)?.Value;

    /// <summary>Nombre fini, ou null (autre type, NaN, infini).</summary>
    public double? AsDouble() => this is LuaNumber { Value: var v } && double.IsFinite(v) ? v : null;

    /// <summary>Entier exact, ou null si la valeur n'est pas un nombre entier représentable.</summary>
    public long? AsInt64()
    {
        if (this is not LuaNumber { Value: var v } || !double.IsFinite(v) || v != Math.Floor(v)) return null;
        // Au-delà de 2^63 la conversion déborderait.
        return v is >= -9.2233720368547758E+18 and < 9.2233720368547758E+18 ? (long)v : null;
    }

    public int? AsInt32() => AsInt64() is { } v and >= int.MinValue and <= int.MaxValue ? (int)v : null;
}

public sealed class LuaBoolean(bool value) : LuaValue
{
    public bool Value { get; } = value;
}

public sealed class LuaNumber(double value) : LuaValue
{
    public double Value { get; } = value;
}

public sealed class LuaString(string value) : LuaValue
{
    public string Value { get; } = value;
}

public enum LuaKeyKind
{
    String,
    Number,
    Boolean,
}

/// <summary>Clé de table : chaîne, nombre ou booléen. <c>["36"]</c> et <c>[36]</c> sont deux clés distinctes.</summary>
public readonly record struct LuaKey(LuaKeyKind Kind, string? Text, double Number)
{
    public static LuaKey Of(string text) => new(LuaKeyKind.String, text, 0);

    public static LuaKey Of(double number) => new(LuaKeyKind.Number, null, number);

    public static LuaKey Of(bool value) => new(LuaKeyKind.Boolean, null, value ? 1 : 0);

    /// <summary>Clé numérique entière, ou null.</summary>
    public long? AsInt64() =>
        Kind == LuaKeyKind.Number && Number == Math.Floor(Number) && Math.Abs(Number) < 9.0E+18 ? (long)Number : null;

    public override string ToString() => Kind switch
    {
        LuaKeyKind.String => Text ?? "",
        LuaKeyKind.Number => Number.ToString(System.Globalization.CultureInfo.InvariantCulture),
        _ => Number != 0 ? "true" : "false",
    };
}

/// <summary>Table Lua. Conserve l'ordre du fichier ; une clé répétée garde sa dernière valeur.</summary>
public sealed class LuaTable : LuaValue
{
    private readonly Dictionary<LuaKey, LuaValue> _values = [];
    private readonly List<LuaKey> _order = [];

    public int Count => _values.Count;

    public IEnumerable<KeyValuePair<LuaKey, LuaValue>> Entries
    {
        get
        {
            foreach (var key in _order)
            {
                if (_values.TryGetValue(key, out var value)) yield return new(key, value);
            }
        }
    }

    internal void Set(LuaKey key, LuaValue value)
    {
        if (!_values.ContainsKey(key)) _order.Add(key);
        _values[key] = value;
    }

    public LuaValue? Get(string key) => _values.GetValueOrDefault(LuaKey.Of(key));

    public LuaValue? Get(long index) => _values.GetValueOrDefault(LuaKey.Of((double)index));

    public bool TryGet(string key, [NotNullWhen(true)] out LuaValue? value) =>
        _values.TryGetValue(LuaKey.Of(key), out value);
}
