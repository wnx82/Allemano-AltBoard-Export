using System.Security.Cryptography;
using AltBoardSync.Core.AltBoard;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Lua;

namespace AltBoardSync.Core.Sync;

/// <summary>Résultat de la lecture d'un compte : un document prêt à envoyer, ou l'erreur rencontrée.</summary>
public sealed record AccountReadResult(AccountSource Source, AccountPayload? Payload, string? Error)
{
    public bool Succeeded => Payload is not null;

    /// <summary>
    /// Empreinte de tout ce qui a été lu pour le compte, Allemano Ledger compris : « watch » ne
    /// renvoie un compte que si elle a changé. Absente quand la lecture a échoué.
    /// </summary>
    public string? Fingerprint { get; init; }
}

public sealed class PayloadBuilder(StableFileReader reader)
{
    /// <summary>Lit un compte. Une erreur sur un compte n'empêche jamais la lecture des autres.</summary>
    public async Task<AccountReadResult> ReadAccountAsync(AccountSource source, CancellationToken cancellationToken = default)
    {
        try
        {
            var snapshot = await reader.ReadAsync(source.FilePath, cancellationToken).ConfigureAwait(false);
            var document = AltBoardReader.Read(SavedVariablesParser.Parse(snapshot.Content));
            var fileHash = Convert.ToHexStringLower(SHA256.HashData(snapshot.Content));
            var (characters, ledgerWarnings, ledgerHash) = await AttachLedgerAsync(source, document.Characters, cancellationToken).ConfigureAwait(false);
            var payload = new AccountPayload(
                AccountKey.Compute(source.AccountFolder),
                AccountKey.Hint(source.AccountFolder),
                source.Flavor,
                document.Schema,
                AccountScanner.ReadAddonVersion(source.FlavorPath),
                new SourceFilePayload(fileHash, snapshot.ModifiedAt, snapshot.Content.LongLength),
                characters,
                document.Items,
                [.. document.Warnings, .. ledgerWarnings]);
            return new AccountReadResult(source, payload, null) { Fingerprint = $"{fileHash}:{ledgerHash ?? "-"}" };
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException or LuaParseException or AltBoardFormatException)
        {
            return new AccountReadResult(source, null, e.Message);
        }
    }

    /// <summary>
    /// Complète les personnages avec le temps de jeu et les sessions d'Allemano Ledger, quand son fichier existe.
    /// Source facultative : illisible ou absente, elle ne fait jamais échouer la synchronisation.
    /// </summary>
    private async Task<(IReadOnlyList<CharacterPayload> Characters, IReadOnlyList<string> Warnings, string? FileHash)> AttachLedgerAsync(
        AccountSource source, IReadOnlyList<CharacterPayload> characters, CancellationToken cancellationToken)
    {
        if (source.LedgerFilePath is null) return (characters, [], null);
        try
        {
            var snapshot = await reader.ReadAsync(source.LedgerFilePath, cancellationToken).ConfigureAwait(false);
            var warnings = new List<string>();
            var ledger = LedgerReader.Read(SavedVariablesParser.Parse(snapshot.Content), warnings);
            var completed = characters
                .Select(c => ledger.TryGetValue(c.Guid, out var known) ? c with { Playtime = known.Playtime, Sessions = known.Sessions.Count > 0 ? known.Sessions : null } : c)
                .ToList();
            return (completed, warnings, Convert.ToHexStringLower(SHA256.HashData(snapshot.Content)));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException or LuaParseException)
        {
            var message = $"Allemano Ledger illisible, temps de jeu et sessions non transmis : {e.Message}";
            return (characters, [message.Length > 300 ? message[..300] : message], null);
        }
    }

    public static SyncPayload Build(MachinePayload machine, IEnumerable<AccountPayload> accounts, string agentVersion, DateTimeOffset now) =>
        new(SyncPayload.CurrentSchemaVersion, agentVersion, now, machine, accounts.ToList());
}
