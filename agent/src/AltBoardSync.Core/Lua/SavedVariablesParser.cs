using System.Globalization;
using System.Text;

namespace AltBoardSync.Core.Lua;

public sealed class LuaParseException(string message, int line, int column)
    : Exception($"{message} (ligne {line}, colonne {column})")
{
    public int Line { get; } = line;

    public int Column { get; } = column;
}

/// <summary>
/// Lecteur du format SavedVariables de World of Warcraft : une suite de <c>Nom = valeur</c> où
/// la valeur est un littéral (nil, booléen, nombre, chaîne, table). Le fichier n'est jamais
/// exécuté : toute construction qui n'est pas un littéral est refusée.
/// </summary>
public static class SavedVariablesParser
{
    /// <summary>Profondeur d'imbrication maximale, pour qu'un fichier hostile ne fasse pas déborder la pile.</summary>
    public const int MaxDepth = 100;

    private static readonly UTF8Encoding LenientUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: false);

    public static IReadOnlyDictionary<string, LuaValue> Parse(ReadOnlySpan<byte> utf8) => Parse(LenientUtf8.GetString(utf8));

    public static IReadOnlyDictionary<string, LuaValue> Parse(string source) => new Parser(source).ParseFile();

    private sealed class Parser(string source)
    {
        private readonly string _s = source;
        private int _pos;

        public Dictionary<string, LuaValue> ParseFile()
        {
            var globals = new Dictionary<string, LuaValue>(StringComparer.Ordinal);
            if (_s.Length > 0 && _s[0] == '﻿') _pos = 1;

            while (true)
            {
                SkipTrivia();
                if (AtEnd) break;
                if (Current == ';')
                {
                    _pos++;
                    continue;
                }

                var name = ReadName() ?? throw Error("nom de variable attendu");
                SkipTrivia();
                Expect('=');
                var value = ParseValue(0);
                if (value is null) globals.Remove(name);
                else globals[name] = value;
            }

            return globals;
        }

        private bool AtEnd => _pos >= _s.Length;

        private char Current => _s[_pos];

        private char PeekAt(int offset) => _pos + offset < _s.Length ? _s[_pos + offset] : '\0';

        private LuaParseException Error(string message)
        {
            int line = 1, column = 1;
            var end = Math.Min(_pos, _s.Length);
            for (var i = 0; i < end; i++)
            {
                if (_s[i] == '\n')
                {
                    line++;
                    column = 1;
                }
                else
                {
                    column++;
                }
            }

            return new LuaParseException(message, line, column);
        }

        private void Expect(char expected)
        {
            if (AtEnd) throw Error($"fin de fichier inattendue, '{expected}' attendu");
            if (Current != expected) throw Error($"'{expected}' attendu, '{Current}' trouvé");
            _pos++;
        }

        private void SkipTrivia()
        {
            while (!AtEnd)
            {
                var c = Current;
                if (char.IsWhiteSpace(c))
                {
                    _pos++;
                }
                else if (c == '-' && PeekAt(1) == '-')
                {
                    _pos += 2;
                    if (TryLongBracketLevel(out var level))
                    {
                        ReadLongBracketBody(level);
                    }
                    else
                    {
                        while (!AtEnd && Current != '\n') _pos++;
                    }
                }
                else
                {
                    break;
                }
            }
        }

        /// <summary>Si la position courante ouvre un crochet long (<c>[[</c>, <c>[=[</c>…), donne son niveau sans avancer.</summary>
        private bool TryLongBracketLevel(out int level)
        {
            level = 0;
            if (AtEnd || Current != '[') return false;
            var i = _pos + 1;
            while (i < _s.Length && _s[i] == '=') i++;
            if (i >= _s.Length || _s[i] != '[') return false;
            level = i - _pos - 1;
            return true;
        }

        private string ReadLongBracketBody(int level)
        {
            _pos += level + 2;
            // Lua ignore un saut de ligne placé juste après l'ouverture.
            if (!AtEnd && Current == '\r') _pos++;
            if (!AtEnd && Current == '\n') _pos++;

            var close = "]" + new string('=', level) + "]";
            var end = _s.IndexOf(close, _pos, StringComparison.Ordinal);
            if (end < 0)
            {
                _pos = _s.Length;
                throw Error("chaîne ou commentaire long non terminé");
            }

            var body = _s[_pos..end];
            _pos = end + close.Length;
            return body;
        }

        private string? ReadName()
        {
            if (AtEnd || !(char.IsAsciiLetter(Current) || Current == '_')) return null;
            var start = _pos;
            while (!AtEnd && (char.IsAsciiLetterOrDigit(Current) || Current == '_')) _pos++;
            return _s[start.._pos];
        }

        /// <summary>Lit une valeur. <c>null</c> représente <c>nil</c>.</summary>
        private LuaValue? ParseValue(int depth)
        {
            SkipTrivia();
            if (AtEnd) throw Error("fin de fichier inattendue, valeur attendue");

            var c = Current;
            if (c == '{') return ParseTable(depth + 1);
            if (c is '"' or '\'') return new LuaString(ReadQuotedString());
            if (c == '[' && TryLongBracketLevel(out var level)) return new LuaString(ReadLongBracketBody(level));
            if (c == '-' || c == '.' || char.IsAsciiDigit(c)) return new LuaNumber(ReadNumber());

            var name = ReadName();
            return name switch
            {
                "nil" => null,
                "true" => new LuaBoolean(true),
                "false" => new LuaBoolean(false),
                "inf" => new LuaNumber(double.PositiveInfinity),
                "nan" => new LuaNumber(double.NaN),
                null => throw Error($"caractère inattendu '{c}'"),
                _ => throw Error($"valeur non prise en charge : '{name}' (seuls les littéraux sont acceptés)"),
            };
        }

        private double ReadNumber()
        {
            var negative = false;
            if (Current == '-')
            {
                negative = true;
                _pos++;
                if (AtEnd) throw Error("nombre incomplet");
                var word = ReadName();
                if (word == "inf") return double.NegativeInfinity;
                if (word == "nan") return double.NaN;
                if (word is not null) throw Error($"nombre attendu, '{word}' trouvé");
            }

            double value;
            if (Current == '0' && PeekAt(1) is 'x' or 'X')
            {
                _pos += 2;
                var start = _pos;
                while (!AtEnd && char.IsAsciiHexDigit(Current)) _pos++;
                if (_pos == start || _pos - start > 16) throw Error("nombre hexadécimal invalide");
                value = ulong.Parse(_s.AsSpan(start, _pos - start), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture);
            }
            else
            {
                var start = _pos;
                var digits = 0;
                while (!AtEnd && char.IsAsciiDigit(Current))
                {
                    _pos++;
                    digits++;
                }

                if (!AtEnd && Current == '.')
                {
                    _pos++;
                    // Le client Windows écrit les valeurs non finies sous la forme 1.#INF, -1.#IND, 1.#QNAN.
                    if (!AtEnd && Current == '#')
                    {
                        _pos++;
                        var special = ReadName();
                        if (special == "INF") return negative ? double.NegativeInfinity : double.PositiveInfinity;
                        if (special is "IND" or "QNAN" or "SNAN" or "NAN") return double.NaN;
                        throw Error("nombre invalide");
                    }

                    while (!AtEnd && char.IsAsciiDigit(Current))
                    {
                        _pos++;
                        digits++;
                    }
                }

                if (digits == 0) throw Error("nombre invalide");

                if (!AtEnd && Current is 'e' or 'E')
                {
                    _pos++;
                    if (!AtEnd && Current is '+' or '-') _pos++;
                    var exponentStart = _pos;
                    while (!AtEnd && char.IsAsciiDigit(Current)) _pos++;
                    if (_pos == exponentStart) throw Error("exposant invalide");
                }

                value = double.Parse(_s.AsSpan(start, _pos - start), NumberStyles.Float, CultureInfo.InvariantCulture);
            }

            if (!AtEnd && (char.IsAsciiLetterOrDigit(Current) || Current == '_')) throw Error("nombre invalide");
            return negative ? -value : value;
        }

        private string ReadQuotedString()
        {
            var quote = _s[_pos++];
            var chars = new StringBuilder();
            // Les échappements \ddd et \xHH désignent des octets : ils sont accumulés puis décodés en UTF-8.
            List<byte>? bytes = null;

            void FlushChars()
            {
                if (chars.Length == 0) return;
                bytes!.AddRange(Encoding.UTF8.GetBytes(chars.ToString()));
                chars.Clear();
            }

            void AppendByte(int value)
            {
                bytes ??= [];
                FlushChars();
                bytes.Add((byte)value);
            }

            while (true)
            {
                if (AtEnd) throw Error("chaîne non terminée");
                var c = _s[_pos++];
                if (c == quote) break;
                if (c != '\\')
                {
                    chars.Append(c);
                    continue;
                }

                if (AtEnd) throw Error("chaîne non terminée");
                var escape = _s[_pos++];
                switch (escape)
                {
                    case 'n': chars.Append('\n'); break;
                    case 't': chars.Append('\t'); break;
                    case 'r': chars.Append('\r'); break;
                    case 'a': chars.Append('\a'); break;
                    case 'b': chars.Append('\b'); break;
                    case 'f': chars.Append('\f'); break;
                    case 'v': chars.Append('\v'); break;
                    case '\\': chars.Append('\\'); break;
                    case '"': chars.Append('"'); break;
                    case '\'': chars.Append('\''); break;
                    case '\n': chars.Append('\n'); break;
                    case '\r':
                        if (!AtEnd && Current == '\n') _pos++;
                        chars.Append('\n');
                        break;
                    case 'z':
                        while (!AtEnd && char.IsWhiteSpace(Current)) _pos++;
                        break;
                    case 'x':
                    {
                        if (_pos + 2 > _s.Length || !char.IsAsciiHexDigit(_s[_pos]) || !char.IsAsciiHexDigit(_s[_pos + 1]))
                            throw Error("séquence d'échappement \\x invalide");
                        AppendByte(int.Parse(_s.AsSpan(_pos, 2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture));
                        _pos += 2;
                        break;
                    }
                    default:
                    {
                        if (!char.IsAsciiDigit(escape)) throw Error($"séquence d'échappement invalide '\\{escape}'");
                        var code = escape - '0';
                        for (var i = 0; i < 2 && !AtEnd && char.IsAsciiDigit(Current); i++) code = code * 10 + (_s[_pos++] - '0');
                        if (code > 255) throw Error("séquence d'échappement décimale hors limites");
                        AppendByte(code);
                        break;
                    }
                }
            }

            if (bytes is null) return chars.ToString();
            FlushChars();
            return LenientUtf8.GetString(bytes.ToArray());
        }

        private LuaTable ParseTable(int depth)
        {
            if (depth > MaxDepth) throw Error($"imbrication trop profonde (plus de {MaxDepth} niveaux)");
            _pos++; // '{'
            var table = new LuaTable();
            long nextIndex = 1;

            while (true)
            {
                SkipTrivia();
                if (AtEnd) throw Error("fin de fichier inattendue, table non fermée");
                if (Current == '}')
                {
                    _pos++;
                    return table;
                }

                if (Current == '[' && !TryLongBracketLevel(out _))
                {
                    _pos++;
                    var keyValue = ParseValue(depth) ?? throw Error("une clé de table ne peut pas être nil");
                    SkipTrivia();
                    Expect(']');
                    SkipTrivia();
                    Expect('=');
                    var key = ToKey(keyValue);
                    var value = ParseValue(depth);
                    if (value is not null) table.Set(key, value);
                }
                else if (TryReadFieldName(out var fieldName))
                {
                    var value = ParseValue(depth);
                    if (value is not null) table.Set(LuaKey.Of(fieldName), value);
                }
                else
                {
                    // Entrée positionnelle : un nil consomme quand même son index.
                    var value = ParseValue(depth);
                    if (value is not null) table.Set(LuaKey.Of((double)nextIndex), value);
                    nextIndex++;
                }

                SkipTrivia();
                if (AtEnd) throw Error("fin de fichier inattendue, table non fermée");
                if (Current is ',' or ';') _pos++;
                else if (Current != '}') throw Error($"',' ou '}}' attendu, '{Current}' trouvé");
            }
        }

        /// <summary>Reconnaît <c>nom =</c> ; ne consomme rien si ce n'est pas un champ nommé.</summary>
        private bool TryReadFieldName(out string name)
        {
            var start = _pos;
            var candidate = ReadName();
            if (candidate is not null)
            {
                SkipTrivia();
                if (!AtEnd && Current == '=' && PeekAt(1) != '=')
                {
                    _pos++;
                    name = candidate;
                    return true;
                }
            }

            _pos = start;
            name = "";
            return false;
        }

        private LuaKey ToKey(LuaValue value) => value switch
        {
            LuaString s => LuaKey.Of(s.Value),
            LuaNumber n when !double.IsNaN(n.Value) => LuaKey.Of(n.Value),
            LuaBoolean b => LuaKey.Of(b.Value),
            _ => throw Error("type de clé non pris en charge"),
        };
    }
}
