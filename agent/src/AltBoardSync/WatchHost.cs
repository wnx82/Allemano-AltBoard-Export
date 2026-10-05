using System.Diagnostics;
using System.Runtime.Versioning;
using AltBoardSync.Core.App;
using AltBoardSync.Core.Config;

/// <summary>
/// Ce qui entoure « watch » sous Windows : une seule surveillance par session, son arrêt depuis
/// une autre commande, et l'icône de la zone de notification.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class WatchHost : IDisposable
{
    // Objets nommés propres à la session Windows : leur existence signale une surveillance en cours.
    private const string RunningName = @"Local\AltBoardSync.Watch";
    private const string StopName = @"Local\AltBoardSync.Watch.Stop";

    private readonly Mutex _running;
    private readonly EventWaitHandle _stop;
    private readonly RegisteredWaitHandle _stopWait;
    private readonly TrayIcon _tray;
    private string? _lastError;

    public WatchControl Control { get; } = new();

    private WatchHost(Mutex running, CancellationTokenSource cancellation, string homeDirectory)
    {
        _running = running;
        _stop = new EventWaitHandle(false, EventResetMode.ManualReset, StopName);
        _stopWait = ThreadPool.RegisterWaitForSingleObject(_stop, (_, _) => Cancel(cancellation), null, Timeout.Infinite, executeOnlyOnce: true);
        _tray = new TrayIcon("AltBoard Sync — synchronisation automatique",
        [
            new TrayIcon.MenuItem("Synchroniser maintenant", Control.RequestSync),
            new TrayIcon.MenuItem("Ouvrir le tableau de bord", () => OpenDashboard(homeDirectory)),
            new TrayIcon.MenuItem("Ouvrir le journal", () => Open(Path.Combine(homeDirectory, "logs", "altboardsync.log"))),
            null,
            new TrayIcon.MenuItem("Quitter", () => Cancel(cancellation)),
        ]);
    }

    /// <returns>Null si une surveillance tourne déjà dans cette session Windows.</returns>
    public static WatchHost? TryStart(CancellationTokenSource cancellation, string homeDirectory)
    {
        var running = new Mutex(initiallyOwned: false, RunningName, out var created);
        if (created) return new WatchHost(running, cancellation, homeDirectory);
        running.Dispose();
        return null;
    }

    public static bool IsRunning()
    {
        if (!Mutex.TryOpenExisting(RunningName, out var running)) return false;
        running.Dispose();
        return true;
    }

    /// <summary>Demande son arrêt à la surveillance de cette session.</summary>
    /// <returns>Faux si aucune ne tourne.</returns>
    public static bool StopRunning()
    {
        if (!EventWaitHandle.TryOpenExisting(StopName, out var stop)) return false;
        using (stop) stop.Set();
        return true;
    }

    /// <summary>Lance « watch » dans un nouveau processus, sans fenêtre.</summary>
    public static void StartInBackground()
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Emplacement de l'exécutable inconnu.");
        using var process = Process.Start(new ProcessStartInfo(executable, "watch") { UseShellExecute = false, CreateNoWindow = true });
    }

    public void OnEvent(WatchEvent watchEvent)
    {
        switch (watchEvent)
        {
            case WatchEvent.Synced synced:
                _lastError = null;
                _tray.SetTooltip($"AltBoard Sync — synchronisé à {DateTime.Now:HH:mm}");
                _tray.Notify("Synchronisation réussie", synced.Summary, error: false);
                break;
            case WatchEvent.Failed failed:
                _tray.SetTooltip("AltBoard Sync — dernière synchronisation en échec");
                // Une bulle par panne, pas une à chaque nouvel essai.
                if (failed.Error != _lastError) _tray.Notify("Échec de la synchronisation", failed.Error, error: true);
                _lastError = failed.Error;
                break;
        }
    }

    public void Dispose()
    {
        _stopWait.Unregister(null);
        _stop.Dispose();
        _tray.Dispose();
        _running.Dispose();
    }

    private static void Cancel(CancellationTokenSource cancellation)
    {
        try
        {
            cancellation.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // Le programme se termine déjà.
        }
    }

    private static void OpenDashboard(string homeDirectory)
    {
        try
        {
            var server = new Uri(new AgentConfigStore(homeDirectory).LoadOrCreate().ServerUrl);
            Open(server.GetLeftPart(UriPartial.Authority));
        }
        catch (Exception e) when (e is InvalidDataException or UriFormatException)
        {
            // Configuration illisible : la surveillance l'a déjà signalé.
        }
    }

    private static void Open(string target)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or FileNotFoundException)
        {
            // Rien pour l'ouvrir, ou journal pas encore créé.
        }
    }
}
