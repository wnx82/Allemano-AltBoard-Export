using System.Security.Cryptography;
using System.Text;

namespace AltBoardSync.Core.Sync;

/// <summary>
/// Identité d'un compte WoW. Le seul identifiant disponible est le nom du dossier
/// <c>WTF\Account\&lt;COMPTE&gt;</c> ; il n'est jamais transmis tel quel. Le serveur reçoit une empreinte
/// stable (identique sur tous les PC, pour qu'un compte vu depuis deux machines reste unique) et un
/// libellé masqué pour le reconnaître. C'est une pseudonymisation, pas un secret.
/// </summary>
public static class AccountKey
{
    private const string Namespace = "wow-altboard-account:";

    public static string Compute(string accountFolder)
    {
        var normalized = Namespace + accountFolder.Trim().ToUpperInvariant();
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)));
    }

    public static string Hint(string accountFolder)
    {
        var name = accountFolder.Trim();
        return name.Length <= 6 ? "…" : $"{name[..2]}…{name[^2..]}";
    }
}
