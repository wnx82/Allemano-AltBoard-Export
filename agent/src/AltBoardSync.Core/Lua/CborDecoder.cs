using System.Buffers.Binary;
using System.Text;

namespace AltBoardSync.Core.Lua;

public sealed class CborFormatException(string message, int offset) : Exception($"{message} (octet {offset})")
{
    public int Offset { get; } = offset;
}

/// <summary>
/// Décodeur CBOR (RFC 8949) restreint à ce que produit <c>C_EncodingUtil.SerializeCBOR</c> du
/// client WoW pour une table Lua : entiers, flottants, chaînes, booléens, tableaux et tables. Le
/// résultat est l'arbre <see cref="LuaValue"/> qu'aurait donné la même table écrite en clair, pour
/// que les lecteurs traitent les deux formes de la même façon. Longueurs et profondeur sont bornées
/// par le contenu reçu : un document hostile ne peut ni faire déborder la pile ni réserver plus de
/// mémoire que sa propre taille.
/// </summary>
public static class CborDecoder
{
    public const int MaxDepth = 32;

    private static readonly UTF8Encoding LenientUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: false);

    /// <summary>Décode un document qui doit être entièrement consommé. <c>null</c> représente <c>nil</c>.</summary>
    public static LuaValue? Decode(ReadOnlySpan<byte> data)
    {
        var position = 0;
        var value = ReadValue(data, ref position, 0);
        if (position != data.Length) throw new CborFormatException("données en trop après la valeur", position);
        return value;
    }

    private static LuaValue? ReadValue(ReadOnlySpan<byte> data, ref int position, int depth)
    {
        if (depth > MaxDepth) throw new CborFormatException("imbrication trop profonde", position);
        if (position >= data.Length) throw new CborFormatException("fin de données inattendue", position);

        var start = position;
        var initial = data[position++];
        var major = initial >> 5;
        var info = initial & 0x1F;

        switch (major)
        {
            case 0:
                return new LuaNumber(ReadArgument(data, ref position, info, start));
            case 1:
                return new LuaNumber(-1d - ReadArgument(data, ref position, info, start));
            case 2:
            case 3:
                return new LuaString(LenientUtf8.GetString(ReadBytes(data, ref position, info, start)));
            case 4:
            {
                var count = ReadLength(data, ref position, info, start);
                var table = new LuaTable();
                for (var i = 1; i <= count; i++)
                {
                    var item = ReadValue(data, ref position, depth + 1);
                    if (item is not null) table.Set(LuaKey.Of(i), item);
                }

                return table;
            }
            case 5:
            {
                var count = ReadLength(data, ref position, info, start);
                var table = new LuaTable();
                for (var i = 0; i < count; i++)
                {
                    var keyStart = position;
                    var key = ReadValue(data, ref position, depth + 1) switch
                    {
                        LuaString s => LuaKey.Of(s.Value),
                        LuaNumber n when double.IsFinite(n.Value) => LuaKey.Of(n.Value),
                        LuaBoolean b => LuaKey.Of(b.Value),
                        _ => throw new CborFormatException("clé de table non prise en charge", keyStart),
                    };
                    var item = ReadValue(data, ref position, depth + 1);
                    if (item is not null) table.Set(key, item);
                }

                return table;
            }
            case 6:
                // Étiquette sémantique : ignorée, seule la valeur étiquetée compte.
                ReadArgument(data, ref position, info, start);
                return ReadValue(data, ref position, depth + 1);
            default:
                return ReadSimple(data, ref position, info, start);
        }
    }

    private static LuaValue? ReadSimple(ReadOnlySpan<byte> data, ref int position, int info, int start)
    {
        switch (info)
        {
            case 20: return new LuaBoolean(false);
            case 21: return new LuaBoolean(true);
            case 22:
            case 23: return null;
            case 25: return new LuaNumber((double)BinaryPrimitives.ReadHalfBigEndian(Take(data, ref position, 2, start)));
            case 26: return new LuaNumber(BinaryPrimitives.ReadSingleBigEndian(Take(data, ref position, 4, start)));
            case 27: return new LuaNumber(BinaryPrimitives.ReadDoubleBigEndian(Take(data, ref position, 8, start)));
            default: throw new CborFormatException($"valeur simple non prise en charge ({info})", start);
        }
    }

    private static double ReadArgument(ReadOnlySpan<byte> data, ref int position, int info, int start)
    {
        if (info < 24) return info;
        return info switch
        {
            24 => Take(data, ref position, 1, start)[0],
            25 => BinaryPrimitives.ReadUInt16BigEndian(Take(data, ref position, 2, start)),
            26 => BinaryPrimitives.ReadUInt32BigEndian(Take(data, ref position, 4, start)),
            27 => BinaryPrimitives.ReadUInt64BigEndian(Take(data, ref position, 8, start)),
            _ => throw new CborFormatException("longueur indéfinie ou réservée non prise en charge", start),
        };
    }

    /// <summary>Nombre d'éléments annoncé ; chacun occupe au moins un octet, d'où la borne.</summary>
    private static int ReadLength(ReadOnlySpan<byte> data, ref int position, int info, int start)
    {
        var length = ReadArgument(data, ref position, info, start);
        if (length > data.Length - position) throw new CborFormatException("longueur annoncée supérieure aux données", start);
        return (int)length;
    }

    private static ReadOnlySpan<byte> ReadBytes(ReadOnlySpan<byte> data, ref int position, int info, int start) =>
        Take(data, ref position, ReadLength(data, ref position, info, start), start);

    private static ReadOnlySpan<byte> Take(ReadOnlySpan<byte> data, ref int position, int count, int start)
    {
        if (count > data.Length - position) throw new CborFormatException("fin de données inattendue", start);
        var slice = data.Slice(position, count);
        position += count;
        return slice;
    }
}
