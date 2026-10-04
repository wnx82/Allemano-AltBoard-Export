using AltBoardSync.Core.AltBoard;
using AltBoardSync.Core.Lua;

namespace AltBoardSync.Tests;

internal static class Fixture
{
    public static string PathOf(string name) => Path.Combine(AppContext.BaseDirectory, "fixtures", name);

    public static byte[] Bytes(string name) => File.ReadAllBytes(PathOf(name));

    public static IReadOnlyDictionary<string, LuaValue> Parse(string name) => SavedVariablesParser.Parse(Bytes(name));

    public static AltBoardDocument Read(string name) => AltBoardReader.Read(Parse(name));
}
