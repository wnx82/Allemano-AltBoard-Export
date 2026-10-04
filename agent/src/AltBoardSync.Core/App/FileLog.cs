using System.Globalization;

namespace AltBoardSync.Core.App;

/// <summary>
/// Journal local (<c>logs\altboardsync.log</c>). N'y figurent ni le jeton, ni le nom réel des
/// dossiers de compte : seulement des compteurs, des libellés masqués et des messages d'erreur.
/// </summary>
public sealed class FileLog(string directory, Func<DateTimeOffset> now)
{
    private const long MaxBytes = 1024 * 1024;

    public string LogPath => Path.Combine(directory, "logs", "altboardsync.log");

    public void Info(string message) => Write("INFO", message);

    public void Warn(string message) => Write("WARN", message);

    public void Error(string message) => Write("ERROR", message);

    private void Write(string level, string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
            var file = new FileInfo(LogPath);
            if (file.Exists && file.Length > MaxBytes) File.Move(LogPath, LogPath + ".1", overwrite: true);
            var line = $"{now().UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture)} {level} {message.ReplaceLineEndings(" ")}";
            File.AppendAllText(LogPath, line + Environment.NewLine);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Un journal indisponible ne doit jamais faire échouer une synchronisation.
        }
    }
}
