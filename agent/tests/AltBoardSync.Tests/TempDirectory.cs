namespace AltBoardSync.Tests;

/// <summary>Dossier temporaire supprimé en fin de test.</summary>
internal sealed class TempDirectory : IDisposable
{
    public string Path { get; } = Directory.CreateTempSubdirectory("altboardsync-tests-").FullName;

    public string Combine(params string[] parts) => System.IO.Path.Combine([Path, .. parts]);

    /// <summary>Crée <c>WTF\Account\&lt;compte&gt;\SavedVariables\AltBoard.lua</c> sous un client WoW factice.</summary>
    public string AddAccount(string flavorPath, string accountFolder, string? fixture)
    {
        var savedVariables = System.IO.Path.Combine(flavorPath, "WTF", "Account", accountFolder, "SavedVariables");
        Directory.CreateDirectory(savedVariables);
        var file = System.IO.Path.Combine(savedVariables, "AltBoard.lua");
        if (fixture is not null) File.Copy(Fixture.PathOf(fixture), file);
        return file;
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
            // Un fichier encore ouvert par le test : le dossier temporaire sera nettoyé par le système.
        }
    }
}
