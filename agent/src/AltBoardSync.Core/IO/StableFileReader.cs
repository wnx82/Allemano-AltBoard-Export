namespace AltBoardSync.Core.IO;

public sealed record StableReadOptions
{
    public int MaxAttempts { get; init; } = 5;

    /// <summary>Délai pendant lequel taille et date doivent rester inchangées avant lecture.</summary>
    public TimeSpan SettleDelay { get; init; } = TimeSpan.FromMilliseconds(300);

    public long MaxBytes { get; init; } = 64L * 1024 * 1024;
}

public sealed record FileSnapshot(byte[] Content, DateTimeOffset ModifiedAt);

public sealed class UnstableFileException(string message, Exception? inner = null) : IOException(message, inner);

/// <summary>
/// Lit un fichier que le client WoW peut être en train d'écrire. Le fichier n'est lu que si sa
/// taille et sa date sont stables avant et après la lecture. Il est ouvert en lecture seule et en
/// partage total : l'agent ne bloque jamais l'écriture du jeu et ne modifie jamais le fichier.
/// </summary>
public sealed class StableFileReader(StableReadOptions? options = null, Func<TimeSpan, CancellationToken, Task>? delay = null)
{
    private readonly StableReadOptions _options = options ?? new StableReadOptions();
    private readonly Func<TimeSpan, CancellationToken, Task> _delay = delay ?? Task.Delay;

    public async Task<FileSnapshot> ReadAsync(string path, CancellationToken cancellationToken = default)
    {
        Exception? lastError = null;

        for (var attempt = 1; attempt <= _options.MaxAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var before = Stat(path);
            if (before.Size > _options.MaxBytes)
                throw new InvalidDataException($"Fichier trop volumineux ({before.Size} octets, maximum {_options.MaxBytes})");

            await _delay(_options.SettleDelay, cancellationToken).ConfigureAwait(false);
            if (Stat(path) != before) continue;

            byte[] content;
            try
            {
                await using var stream = new FileStream(
                    path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 81920, FileOptions.SequentialScan);
                content = new byte[stream.Length];
                await stream.ReadExactlyAsync(content, cancellationToken).ConfigureAwait(false);
            }
            catch (FileNotFoundException)
            {
                throw;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // Verrou exclusif ou fichier raccourci pendant la lecture : nouvelle tentative.
                lastError = e;
                continue;
            }

            if (Stat(path) == before && content.LongLength == before.Size)
                return new FileSnapshot(content, before.ModifiedAt);
        }

        throw new UnstableFileException(
            $"Fichier verrouillé ou en cours d'écriture après {_options.MaxAttempts} tentatives", lastError);
    }

    private readonly record struct FileStat(long Size, DateTimeOffset ModifiedAt);

    private static FileStat Stat(string path)
    {
        var info = new FileInfo(path);
        if (!info.Exists) throw new FileNotFoundException("Fichier introuvable", path);
        return new FileStat(info.Length, info.LastWriteTimeUtc);
    }
}
