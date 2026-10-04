using System.Text;
using AltBoardSync.Core.Lua;

namespace AltBoardSync.Tests;

public class SavedVariablesParserTests
{
    private static LuaValue Value(string literal) => SavedVariablesParser.Parse($"X = {literal}")["X"];

    [Fact]
    public void Real_file_format_is_parsed()
    {
        var globals = Fixture.Parse("account-four-characters.lua");

        var db = Assert.IsType<LuaTable>(Assert.Single(globals).Value);
        Assert.Equal(2, db.Get("schema")!.AsInt32());
        Assert.Equal(4, db.Get("chars")!.AsTable()!.Count);
        Assert.Equal(418, db.Get("items")!.AsTable()!.Count);
    }

    [Fact]
    public void Empty_file_has_no_globals()
    {
        Assert.Empty(Fixture.Parse("empty.lua"));
        Assert.Empty(SavedVariablesParser.Parse("  \r\n\t\r\n"));
        Assert.Empty(SavedVariablesParser.Parse("-- seulement un commentaire"));
    }

    [Fact]
    public void Several_globals_are_read()
    {
        var globals = SavedVariablesParser.Parse("A = 1\r\nB = \"deux\"\nC = { 3 };\nD = nil\n");

        Assert.Equal(["A", "B", "C"], globals.Keys.Order());
        Assert.Equal("deux", globals["B"].AsString());
    }

    [Fact]
    public void Byte_order_mark_is_ignored()
    {
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes("X = 1")).ToArray();

        Assert.Equal(1, SavedVariablesParser.Parse(bytes)["X"].AsInt32());
    }

    [Theory]
    [InlineData("\"simple\"", "simple")]
    [InlineData("'apostrophes'", "apostrophes")]
    [InlineData("\"Bottes d'écuyer\"", "Bottes d'écuyer")]
    [InlineData("\"Éolide de l’Ordre suprême\"", "Éolide de l’Ordre suprême")]
    [InlineData("\"guillemets \\\"internes\\\"\"", "guillemets \"internes\"")]
    [InlineData("\"anti\\\\slash\"", "anti\\slash")]
    [InlineData("\"tab\\tligne\\nfin\"", "tab\tligne\nfin")]
    [InlineData("\"\\195\\137t\\195\\169\"", "Été")]
    [InlineData("\"\\xC3\\x89t\\xC3\\xA9\"", "Été")]
    [InlineData("\"日本語 🐉\"", "日本語 🐉")]
    [InlineData("\"|cnIQ2:|Hitem:4314::::::::25:1482|h[Épaulières]|h|r\"", "|cnIQ2:|Hitem:4314::::::::25:1482|h[Épaulières]|h|r")]
    [InlineData("[[chaîne longue]]", "chaîne longue")]
    [InlineData("[==[avec ]] dedans]==]", "avec ]] dedans")]
    public void Strings_are_decoded(string literal, string expected)
    {
        Assert.Equal(expected, Value(literal).AsString());
    }

    [Theory]
    [InlineData("0", 0d)]
    [InlineData("25", 25d)]
    [InlineData("-5", -5d)]
    [InlineData("5.072000026702881", 5.072000026702881d)]
    [InlineData("1.5e3", 1500d)]
    [InlineData("2E-2", 0.02d)]
    [InlineData(".5", 0.5d)]
    [InlineData("0x1F", 31d)]
    [InlineData("21474836470000", 21474836470000d)]
    [InlineData("9007199254740993", 9007199254740992d)]
    [InlineData("1.#INF", double.PositiveInfinity)]
    [InlineData("-1.#INF", double.NegativeInfinity)]
    public void Numbers_are_read(string literal, double expected)
    {
        Assert.Equal(expected, Assert.IsType<LuaNumber>(Value(literal)).Value);
    }

    [Fact]
    public void Non_finite_numbers_are_never_exposed_as_values()
    {
        Assert.True(double.IsNaN(Assert.IsType<LuaNumber>(Value("-1.#IND")).Value));
        Assert.Null(Value("-1.#IND").AsDouble());
        Assert.Null(Value("1.#INF").AsDouble());
        Assert.Null(Value("1.#INF").AsInt64());
    }

    [Fact]
    public void Integer_conversions_reject_fractions_and_overflow()
    {
        Assert.Equal(21474836470000L, Value("21474836470000").AsInt64());
        Assert.Null(Value("21474836470000").AsInt32());
        Assert.Null(Value("15.9375").AsInt64());
        Assert.Null(Value("1e30").AsInt64());
        Assert.Null(Value("\"12\"").AsInt64());
    }

    [Fact]
    public void Positional_nil_consumes_its_index()
    {
        var table = Value("{ nil, nil, \"trois\", [15] = \"quinze\" }").AsTable()!;

        Assert.Null(table.Get(1));
        Assert.Null(table.Get(2));
        Assert.Equal("trois", table.Get(3)!.AsString());
        Assert.Equal("quinze", table.Get(15)!.AsString());
        Assert.Equal(2, table.Count);
    }

    [Fact]
    public void String_and_numeric_keys_are_distinct()
    {
        var table = Value("{ [\"36\"] = \"chaîne\", [36] = \"nombre\", nom = true }").AsTable()!;

        Assert.Equal("chaîne", table.Get("36")!.AsString());
        Assert.Equal("nombre", table.Get(36)!.AsString());
        Assert.True(table.Get("nom")!.AsBoolean());
    }

    [Fact]
    public void Nested_tables_comments_and_separators_are_handled()
    {
        var table = Value("""
            {
                ["a"] = { -- commentaire de fin de ligne
                    1, -- [1]
                    2; -- [2]
                    { ["profond"] = { ["encore"] = "oui" } },
                },
                --[[ commentaire
                     sur plusieurs lignes ]]
                ["b"] = {},
            }
            """).AsTable()!;

        var a = table.Get("a")!.AsTable()!;
        Assert.Equal(2, a.Get(2)!.AsInt32());
        Assert.Equal("oui", a.Get(3)!.AsTable()!.Get("profond")!.AsTable()!.Get("encore")!.AsString());
        Assert.Equal(0, table.Get("b")!.AsTable()!.Count);
    }

    [Fact]
    public void Table_keeps_file_order()
    {
        var table = Value("{ [\"z\"] = 1, [\"a\"] = 2, [\"m\"] = 3 }").AsTable()!;

        Assert.Equal(["z", "a", "m"], table.Entries.Select(e => e.Key.Text!));
    }

    [Theory]
    [InlineData("X = os.execute(\"calc\")")]
    [InlineData("X = function() end")]
    [InlineData("X = 1 + 2")]
    [InlineData("X = { 1, print(\"x\") }")]
    [InlineData("X = Y")]
    [InlineData("os.execute(\"calc\")")]
    [InlineData("local X = 1")]
    public void Code_is_refused_not_executed(string source)
    {
        Assert.Throws<LuaParseException>(() => SavedVariablesParser.Parse(source));
    }

    [Theory]
    [InlineData("X = {")]
    [InlineData("X = { [\"a\"] = ")]
    [InlineData("X = { [\"a\" = 1 }")]
    [InlineData("X = \"non terminée")]
    [InlineData("X = { 1 2 }")]
    [InlineData("X = 12abc")]
    [InlineData("X = \"\\q\"")]
    [InlineData("X = \"\\999\"")]
    [InlineData("X = [[non terminée")]
    [InlineData("X =")]
    [InlineData("= 1")]
    public void Malformed_input_throws_a_parse_error(string source)
    {
        var error = Assert.Throws<LuaParseException>(() => SavedVariablesParser.Parse(source));
        Assert.True(error.Line >= 1);
    }

    [Fact]
    public void Parse_error_reports_the_line()
    {
        var error = Assert.Throws<LuaParseException>(() => SavedVariablesParser.Parse("X = {\r\n1,\r\n2,\r\n@\r\n}"));

        Assert.Equal(4, error.Line);
    }

    [Fact]
    public void Truncated_real_file_always_throws_a_parse_error()
    {
        var bytes = Fixture.Bytes("account-two-characters.lua");

        // Un fichier coupé pendant son écriture : toute coupure à l'intérieur de la table doit être détectée.
        for (var length = 20; length < bytes.Length - 4; length += 997)
        {
            var truncated = bytes.AsSpan(0, length).ToArray();
            Assert.Throws<LuaParseException>(() => SavedVariablesParser.Parse(truncated));
        }
    }

    [Fact]
    public void Excessive_nesting_is_refused_without_crashing()
    {
        var source = "X = " + new string('{', 5000) + new string('}', 5000);

        var error = Assert.Throws<LuaParseException>(() => SavedVariablesParser.Parse(source));
        Assert.Contains("imbrication", error.Message);
    }

    [Fact]
    public void Invalid_utf8_bytes_do_not_throw()
    {
        byte[] bytes = [.. "X = \""u8, 0xFF, 0xFE, 0xC3, .. "\""u8];

        Assert.NotNull(SavedVariablesParser.Parse(bytes)["X"].AsString());
    }
}
