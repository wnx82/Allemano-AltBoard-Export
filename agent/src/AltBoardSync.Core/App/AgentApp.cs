using System.Reflection;
using System.Text.Json;
using AltBoardSync.Core.Config;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.App;

public sealed record AgentEnvironment
{
    public required string HomeDirectory { get; init; }

    public required TextWriter Out { get; init; }

    public required TextWriter Error { get; init; }

    public TextReader In { get; init; } = TextReader.Null;

    /// <summary>Substituable dans les tests ; en production, le gestionnaire HTTP par défaut.</summary>
    public HttpMessageHandler? HttpHandler { get; init; }

    public Func<DateTimeOffset> Now { get; init; } = () => DateTimeOffset.UtcNow;

    public StableReadOptions? ReadOptions { get; init; }

    public string Hostname { get; init; } = Environment.MachineName;

    public Func<string, string?> GetEnvironmentVariable { get; init; } = Environment.GetEnvironmentVariable;
}

/// <summary>
/// Ligne de commande de l'agent. La version 1 ne fait rien sans action humaine : chaque
/// synchronisation est déclenchée par <c>AltBoardSync sync</c>.
/// </summary>
public sealed class AgentApp(AgentEnvironment env)
{
    public const int ExitOk = 0;
    public const int ExitFailed = 1;
    public const int ExitUsage = 2;

    private readonly AgentConfigStore _configStore = new(env.HomeDirectory);
    private readonly TokenStore _tokenStore = new(env.HomeDirectory, env.GetEnvironmentVariable);
    private readonly FileLog _log = new(env.HomeDirectory, env.Now);

    public static string Version { get; } =
        (typeof(AgentApp).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0").Split('+')[0];

    public async Task<int> RunAsync(string[] args, CancellationToken cancellationToken = default)
    {
        try
        {
            var command = args.Length > 0 ? args[0].ToLowerInvariant() : "help";
            var rest = args.Skip(1).ToArray();
            return command switch
            {
                "sync" => await SyncAsync(rest, dryRun: false, cancellationToken).ConfigureAwait(false),
                "scan" => await SyncAsync(rest, dryRun: true, cancellationToken).ConfigureAwait(false),
                "config" => Config(rest),
                "token" => Token(rest),
                "version" or "--version" => Print(Version),
                "watch" => Usage("La synchronisation automatique (watch) n'est pas disponible dans cette version."),
                "help" or "--help" or "-h" => Help(),
                _ => Usage($"Commande inconnue : {args[0]}"),
            };
        }
        catch (Exception e) when (e is InvalidDataException or ArgumentException or DirectoryNotFoundException or PlatformNotSupportedException)
        {
            _log.Error(e.Message);
            env.Error.WriteLine($"Erreur : {e.Message}");
            return ExitUsage;
        }
    }

    private int Print(string text)
    {
        env.Out.WriteLine(text);
        return ExitOk;
    }

    private int Usage(string message)
    {
        env.Error.WriteLine(message);
        env.Error.WriteLine("AltBoardSync help affiche les commandes disponibles.");
        return ExitUsage;
    }

    private int Help()
    {
        env.Out.WriteLine($"""
            AltBoardSync {Version} — synchronise les données de l'addon AltBoard vers le serveur.

            Commandes :
              sync [options]            lit les fichiers AltBoard.lua et les envoie au serveur
              scan [options]            lit et affiche, sans rien envoyer (équivaut à sync --dry-run)
              config                    affiche la configuration
              config set <clé> <valeur> modifie wowPath, serverUrl ou machineName
              token set                 enregistre le jeton d'agent (lu sur l'entrée standard)
              token clear               supprime le jeton enregistré
              version                   affiche la version

            Options de sync et scan :
              --dry-run                 n'envoie rien
              --wow-path <dossier>      dossier World of Warcraft (remplace la configuration)
              --server <url>            URL de synchronisation (remplace la configuration)
              --out <fichier>           écrit le document JSON produit dans un fichier

            Configuration : {_configStore.ConfigPath}
            Journal       : {_log.LogPath}
            """);
        return ExitOk;
    }

    // ---------------------------------------------------------------------------
    // sync / scan
    // ---------------------------------------------------------------------------

    private async Task<int> SyncAsync(string[] args, bool dryRun, CancellationToken cancellationToken)
    {
        string? wowPath = null, server = null, outFile = null;
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--dry-run": dryRun = true; break;
                case "--wow-path" when i + 1 < args.Length: wowPath = args[++i]; break;
                case "--server" when i + 1 < args.Length: server = args[++i]; break;
                case "--out" when i + 1 < args.Length: outFile = args[++i]; break;
                default: return Usage($"Option inconnue ou incomplète : {args[i]}");
            }
        }

        var config = _configStore.LoadOrCreate();
        wowPath ??= config.WowPath;
        var machineName = string.IsNullOrWhiteSpace(config.MachineName) ? env.Hostname : config.MachineName;

        env.Out.WriteLine($"AltBoard Sync {Version}");
        env.Out.WriteLine();
        env.Out.WriteLine($"Machine : {machineName}");
        env.Out.WriteLine();

        var sources = AccountScanner.Scan(wowPath);
        var builder = new PayloadBuilder(new StableFileReader(env.ReadOptions));
        var results = new List<AccountReadResult>();
        foreach (var source in sources)
            results.Add(await builder.ReadAccountAsync(source, cancellationToken).ConfigureAwait(false));

        var accounts = results.Where(r => r.Succeeded).Select(r => r.Payload!).ToList();
        var failures = results.Count(r => !r.Succeeded);
        var characters = accounts.Sum(a => a.Characters.Count);

        env.Out.WriteLine(Plural(results.Count, "compte détecté", "comptes détectés"));
        env.Out.WriteLine(Plural(characters, "personnage détecté", "personnages détectés"));
        env.Out.WriteLine();
        for (var i = 0; i < results.Count; i++)
        {
            var result = results[i];
            var label = $"Compte {i + 1} ({AccountKey.Hint(result.Source.AccountFolder)})";
            if (result.Payload is { } payload)
            {
                env.Out.WriteLine($"{label} : {Plural(payload.Characters.Count, "personnage", "personnages")}");
                foreach (var warning in payload.Warnings) env.Out.WriteLine($"  avertissement : {warning}");
                _log.Info($"compte {payload.FolderHint} lu : {payload.Characters.Count} personnages, {payload.Warnings.Count} avertissements, fichier {payload.File.Hash[..12]}");
            }
            else
            {
                env.Out.WriteLine($"{label} : ERREUR — {result.Error}");
                _log.Error($"compte {AccountKey.Hint(result.Source.AccountFolder)} illisible : {result.Error}");
            }
        }

        env.Out.WriteLine();

        var document = PayloadBuilder.Build(new MachinePayload(config.MachineUuid, env.Hostname, config.MachineName), accounts, Version, env.Now());
        if (outFile is not null)
        {
            await File.WriteAllBytesAsync(outFile, JsonSerializer.SerializeToUtf8Bytes(document, SyncJsonContext.Default.SyncPayload), cancellationToken).ConfigureAwait(false);
            env.Out.WriteLine($"Document écrit dans {outFile}");
        }

        if (dryRun)
        {
            env.Out.WriteLine("Simulation : rien n'a été envoyé.");
            return failures == 0 ? ExitOk : ExitFailed;
        }

        if (accounts.Count == 0)
        {
            env.Out.WriteLine("Aucune donnée à envoyer.");
            return failures == 0 ? ExitOk : ExitFailed;
        }

        var endpoint = SyncClient.ValidateEndpoint(server ?? config.ServerUrl);
        var token = _tokenStore.Read();
        if (token is null)
        {
            env.Error.WriteLine("Aucun jeton d'agent enregistré. Lancez « AltBoardSync token set ».");
            return ExitUsage;
        }

        env.Out.WriteLine("Envoi vers le serveur...");
        env.Out.WriteLine();

        using var http = env.HttpHandler is null ? new HttpClient() : new HttpClient(env.HttpHandler, disposeHandler: false);
        http.Timeout = TimeSpan.FromSeconds(60);
        var outcome = await new SyncClient(http, Version).SendAsync(endpoint, token, document, cancellationToken).ConfigureAwait(false);

        if (!outcome.Succeeded)
        {
            env.Error.WriteLine($"Échec de la synchronisation : {outcome.Error ?? "réponse inattendue du serveur"}");
            _log.Error($"synchronisation refusée par {endpoint.Host} : {outcome.Error}");
            return ExitFailed;
        }

        var response = outcome.Response!;
        env.Out.WriteLine($"{Plural(response.CharactersReceived, "personnage synchronisé", "personnages synchronisés")}.");
        env.Out.WriteLine($"{Plural(response.CharactersCreated, "nouveau personnage", "nouveaux personnages")}, {Plural(response.CharactersUpdated, "mis à jour", "mis à jour")}.");
        env.Out.WriteLine($"{Plural(response.SnapshotsCreated, "nouveau snapshot", "nouveaux snapshots")}.");
        env.Out.WriteLine($"{Plural(response.CharactersUnchanged, "personnage inchangé", "personnages inchangés")}.");
        if (response.CharactersStale > 0)
            env.Out.WriteLine($"{Plural(response.CharactersStale, "personnage plus récent côté serveur, ignoré", "personnages plus récents côté serveur, ignorés")}.");
        foreach (var error in response.Errors) env.Out.WriteLine($"  erreur serveur : {error.Message}");
        env.Out.WriteLine();

        var clean = failures == 0 && response.Errors.Count == 0;
        env.Out.WriteLine(clean ? "Synchronisation terminée." : "Synchronisation terminée avec des erreurs.");
        _log.Info($"synchronisation {response.Status} (run {response.RunId}) : {response.CharactersReceived} personnages, " +
                  $"{response.CharactersCreated} créés, {response.CharactersUpdated} mis à jour, {response.CharactersUnchanged} inchangés, " +
                  $"{response.CharactersStale} anciens, {response.SnapshotsCreated} snapshots, {failures + response.Errors.Count} erreurs");
        return clean ? ExitOk : ExitFailed;
    }

    private static string Plural(int count, string singular, string plural) => $"{count} {(count > 1 ? plural : singular)}";

    // ---------------------------------------------------------------------------
    // config / token
    // ---------------------------------------------------------------------------

    private int Config(string[] args)
    {
        var config = _configStore.LoadOrCreate();
        if (args.Length == 0)
        {
            env.Out.WriteLine($"Fichier     : {_configStore.ConfigPath}");
            env.Out.WriteLine($"machineUuid : {config.MachineUuid}");
            env.Out.WriteLine($"machineName : {config.MachineName ?? $"(nom d'hôte : {env.Hostname})"}");
            env.Out.WriteLine($"wowPath     : {config.WowPath}");
            env.Out.WriteLine($"serverUrl   : {config.ServerUrl}");
            env.Out.WriteLine($"jeton       : {(_tokenStore.Read() is null ? "absent" : "enregistré")}");
            return ExitOk;
        }

        if (args.Length != 3 || args[0] != "set") return Usage("Usage : config set <wowPath|serverUrl|machineName> <valeur>");
        var value = args[2].Trim();
        switch (args[1].ToLowerInvariant())
        {
            case "wowpath":
                config = config with { WowPath = value };
                break;
            case "serverurl":
                SyncClient.ValidateEndpoint(value);
                config = config with { ServerUrl = value };
                break;
            case "machinename":
                config = config with { MachineName = value.Length > 0 ? value : null };
                break;
            default:
                return Usage($"Clé inconnue : {args[1]}");
        }

        _configStore.Save(config);
        env.Out.WriteLine("Configuration enregistrée.");
        return ExitOk;
    }

    private int Token(string[] args)
    {
        switch (args.FirstOrDefault())
        {
            case "set":
                var token = env.In.ReadLine()?.Trim();
                if (string.IsNullOrEmpty(token)) return Usage("Jeton vide : rien n'a été enregistré.");
                _tokenStore.Save(token);
                env.Out.WriteLine("Jeton enregistré (chiffré pour l'utilisateur Windows courant).");
                _log.Info("jeton d'agent enregistré");
                return ExitOk;
            case "clear":
                env.Out.WriteLine(_tokenStore.Delete() ? "Jeton supprimé." : "Aucun jeton enregistré.");
                return ExitOk;
            default:
                return Usage("Usage : token set | token clear");
        }
    }
}
