namespace AltBoardSync.Core.Discovery;

/// <summary>Un fichier AltBoard.lua trouvé pour un compte WoW.</summary>
public sealed record AccountSource(string AccountFolder, string Flavor, string FlavorPath, string FilePath)
{
    /// <summary>Fichier de l'addon Allemano Ledger du même compte, s'il existe (temps de jeu par niveau).</summary>
    public string? LedgerFilePath { get; init; }
}

/// <summary>
/// Découvre les comptes sous <c>WTF\Account\</c>. Lecture seule : rien n'est créé, modifié ni
/// supprimé dans le dossier de World of Warcraft.
/// </summary>
public static class AccountScanner
{
    public const string DefaultWowPath = @"C:\Program Files (x86)\World of Warcraft\_classic_beta_";
    public const string SavedVariablesFile = "AltBoard.lua";
    public const string LedgerFile = "AllemanoLedger.lua";

    /// <param name="wowPath">Dossier d'un client (<c>…\_classic_beta_</c>) ou racine World of Warcraft contenant plusieurs clients.</param>
    public static IReadOnlyList<AccountSource> Scan(string wowPath)
    {
        if (!Directory.Exists(wowPath))
            throw new DirectoryNotFoundException($"Dossier World of Warcraft introuvable : {wowPath}");

        var sources = new List<AccountSource>();
        foreach (var flavorPath in FlavorPaths(wowPath))
        {
            var flavor = Path.GetFileName(Path.TrimEndingDirectorySeparator(flavorPath));
            foreach (var accountPath in Directory.EnumerateDirectories(Path.Combine(flavorPath, "WTF", "Account")))
            {
                // Seule la présence du fichier désigne un compte : WTF\Account contient aussi des
                // dossiers techniques, et un compte peut ne pas utiliser AltBoard.
                var file = Path.Combine(accountPath, "SavedVariables", SavedVariablesFile);
                if (!File.Exists(file)) continue;
                var ledger = Path.Combine(accountPath, "SavedVariables", LedgerFile);
                sources.Add(new AccountSource(Path.GetFileName(accountPath), flavor, flavorPath, file) { LedgerFilePath = File.Exists(ledger) ? ledger : null });
            }
        }

        sources.Sort((a, b) =>
        {
            var byFlavor = string.CompareOrdinal(a.Flavor, b.Flavor);
            return byFlavor != 0 ? byFlavor : string.Compare(a.AccountFolder, b.AccountFolder, StringComparison.OrdinalIgnoreCase);
        });
        return sources;
    }

    private static IEnumerable<string> FlavorPaths(string wowPath)
    {
        if (HasAccounts(wowPath))
        {
            yield return wowPath;
            yield break;
        }

        foreach (var candidate in Directory.EnumerateDirectories(wowPath, "_*_").Order(StringComparer.OrdinalIgnoreCase))
        {
            if (HasAccounts(candidate)) yield return candidate;
        }
    }

    private static bool HasAccounts(string flavorPath) => Directory.Exists(Path.Combine(flavorPath, "WTF", "Account"));

    /// <summary>Version de l'addon installé (ligne <c>## Version:</c> du .toc), absente du fichier de données.</summary>
    public static string? ReadAddonVersion(string flavorPath)
    {
        var toc = Path.Combine(flavorPath, "Interface", "AddOns", "AltBoard", "AltBoard.toc");
        try
        {
            if (!File.Exists(toc)) return null;
            foreach (var line in File.ReadLines(toc).Take(50))
            {
                const string prefix = "## Version:";
                if (!line.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
                var version = line[prefix.Length..].Trim();
                return version.Length is > 0 and <= 40 ? version : null;
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Information facultative : son absence ne bloque pas la synchronisation.
        }

        return null;
    }
}
