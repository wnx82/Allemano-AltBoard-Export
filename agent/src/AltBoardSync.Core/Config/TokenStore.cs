using System.Buffers;
using System.Security.Cryptography;
using System.Text;

namespace AltBoardSync.Core.Config;

/// <summary>
/// Jeton d'agent. Sur Windows il est chiffré par DPAPI pour l'utilisateur courant : le fichier est
/// inutilisable sur un autre compte ou une autre machine. Il n'est jamais écrit dans config.json ni
/// dans les journaux.
/// </summary>
public sealed class TokenStore(string directory, Func<string, string?>? getEnvironmentVariable = null)
{
    public const string EnvironmentVariable = "ALTBOARDSYNC_TOKEN";

    /// <summary>Dit aussi où l'enregistrer : la fenêtre de l'agent, ou la ligne de commande.</summary>
    public const string MissingMessage =
        "Aucun jeton d'agent enregistré. Saisissez-le dans la fenêtre de l'agent (bouton Jeton), ou lancez « AltBoardSync token set ».";

    private const string Prefix = "wab_";

    private static readonly byte[] Entropy = "AltBoardSync.AgentToken.v1"u8.ToArray();
    private static readonly SearchValues<char> Base64Url = SearchValues.Create("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");

    /// <summary>
    /// Forme des jetons émis par le serveur (web/src/lib/agent-tokens.ts) : « wab_ » puis 43
    /// caractères base64url. Un texte d'une autre forme est une erreur de copie : la fenêtre le
    /// refuse avant de l'enregistrer.
    /// </summary>
    public static bool IsWellFormed(string token) =>
        token.Length == Prefix.Length + 43
        && token.StartsWith(Prefix, StringComparison.Ordinal)
        && !token.AsSpan(Prefix.Length).ContainsAnyExcept(Base64Url);

    public string TokenPath => Path.Combine(directory, "token.dat");

    /// <summary>La variable d'environnement prime (tests, exécution ponctuelle), sinon le fichier protégé.</summary>
    public string? Read()
    {
        if ((getEnvironmentVariable ?? Environment.GetEnvironmentVariable)(EnvironmentVariable) is { Length: > 0 } fromEnvironment)
            return fromEnvironment.Trim();
        if (!File.Exists(TokenPath)) return null;
        if (!OperatingSystem.IsWindows()) throw WindowsRequired();

        try
        {
            var token = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(TokenPath), Entropy, DataProtectionScope.CurrentUser));
            return token.Length > 0 ? token : null;
        }
        catch (CryptographicException e)
        {
            throw new InvalidDataException("Jeton illisible : il a été enregistré par un autre utilisateur ou une autre machine. Enregistrez-le à nouveau, dans la fenêtre de l'agent ou par « token set ».", e);
        }
    }

    public void Save(string token)
    {
        if (!OperatingSystem.IsWindows()) throw WindowsRequired();
        Directory.CreateDirectory(directory);
        File.WriteAllBytes(TokenPath, ProtectedData.Protect(Encoding.UTF8.GetBytes(token.Trim()), Entropy, DataProtectionScope.CurrentUser));
    }

    public bool Delete()
    {
        if (!File.Exists(TokenPath)) return false;
        File.Delete(TokenPath);
        return true;
    }

    private static PlatformNotSupportedException WindowsRequired() =>
        new($"Le stockage protégé du jeton nécessite Windows ; utilisez la variable {EnvironmentVariable}.");
}
