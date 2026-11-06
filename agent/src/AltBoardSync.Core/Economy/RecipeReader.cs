using System.Globalization;
using System.Text.RegularExpressions;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.Economy;

/// <summary>
/// Lit les recettes apprises par chaque personnage dans les SavedVariables de NaowhForever
/// (<c>NaowhForeverDB.account.profMakes</c>, voir docs/PROFESSIONS-DATA-MODEL.md). L'addon les relève
/// dans la fenêtre de métier, depuis l'API du jeu : objet produit, quantité produite, composants.
/// Rien n'est déduit ici ; une recette incomplète est ignorée.
/// </summary>
public static partial class RecipeReader
{
    public const int MaxCharacters = 200;
    public const int MaxRecipesPerCharacter = 2_000;
    public const int MaxReagents = 20;
    public const int MaxQuantity = 10_000;

    [GeneratedRegex(@"^Player-\d{1,10}-[0-9A-F]{1,16}$", RegexOptions.CultureInvariant)]
    private static partial Regex GuidPattern();

    public static IReadOnlyList<CharacterRecipesPayload> Read(IReadOnlyDictionary<string, LuaValue> globals, List<string> warnings)
    {
        var result = new List<CharacterRecipesPayload>();
        if (!globals.TryGetValue("NaowhForeverDB", out var root)
            || root.AsTable()?.Get("account")?.AsTable()?.Get("profMakes")?.AsTable() is not { } byCharacter)
        {
            return result;
        }

        var ignored = 0;
        foreach (var (key, value) in byCharacter.Entries)
        {
            if (key.Kind != LuaKeyKind.String || key.Text is not { } guid || !GuidPattern().IsMatch(guid) || value.AsTable() is not { } makes) continue;
            if (result.Count == MaxCharacters)
            {
                warnings.Add($"NaowhForever : plus de {MaxCharacters} personnages, les suivants sont ignorés.");
                break;
            }

            var recipes = new List<RecipePayload>();
            foreach (var (outputKey, raw) in makes.Entries)
            {
                if (recipes.Count == MaxRecipesPerCharacter) break;
                var recipe = ReadRecipe(outputKey, raw);
                if (recipe is null) ignored++;
                else recipes.Add(recipe);
            }

            recipes.Sort((a, b) => a.SpellId.CompareTo(b.SpellId));
            result.Add(new CharacterRecipesPayload(guid, recipes));
        }

        if (ignored > 0) warnings.Add($"NaowhForever : {ignored} recettes incomplètes ou mal formées, ignorées.");
        return result;
    }

    private static RecipePayload? ReadRecipe(LuaKey outputKey, LuaValue raw)
    {
        var output = outputKey.Kind == LuaKeyKind.String
            ? int.TryParse(outputKey.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) ? parsed : (int?)null
            : outputKey.AsInt64() is { } n and > 0 and <= int.MaxValue ? (int)n : null;
        if (output is not > 0 || raw.AsTable() is not { } make) return null;

        var spell = make.Get("recipe")?.AsInt32();
        var made = make.Get("made")?.AsInt32() ?? 1;
        if (spell is not > 0 || made is < 1 or > MaxQuantity || make.Get("need")?.AsTable() is not { } need) return null;

        var reagents = new List<ReagentPayload>();
        foreach (var (reagentKey, quantity) in need.Entries)
        {
            var item = reagentKey.AsInt64() ?? (reagentKey.Kind == LuaKeyKind.String && long.TryParse(reagentKey.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var k) ? k : null);
            var count = quantity.AsInt32();
            if (item is not (> 0 and <= int.MaxValue) || count is not (> 0 and <= MaxQuantity)) return null;
            reagents.Add(new ReagentPayload((int)item, count.Value));
        }

        if (reagents.Count is 0 or > MaxReagents) return null;
        reagents.Sort((a, b) => a.ItemId.CompareTo(b.ItemId));
        var skillLine = make.Get("prof")?.AsInt32() is { } prof and > 0 ? prof : (int?)null;
        return new RecipePayload(spell.Value, skillLine, output.Value, made, make.Get("cooldown")?.AsBoolean() ?? false, reagents);
    }
}
