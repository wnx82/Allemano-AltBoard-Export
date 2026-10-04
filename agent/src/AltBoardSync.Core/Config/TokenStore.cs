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

    private static readonly byte[] Entropy = "AltBoardSync.AgentToken.v1"u8.ToArray();

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
            throw new InvalidDataException("Jeton illisible : il a été enregistré par un autre utilisateur ou une autre machine. Relancez « token set ».", e);
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
