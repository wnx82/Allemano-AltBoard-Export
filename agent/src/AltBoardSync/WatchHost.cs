using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using AltBoardSync.Core.App;
using AltBoardSync.Core.Config;

/// <summary>
/// Ce qui entoure « watch » sous Windows : une seule surveillance par session, son arrêt et
/// l'ouverture de sa fenêtre depuis une autre commande, l'icône de la zone de notification.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class WatchHost : IDisposable
{
    // Objets nommés propres à la session Windows : leur existence signale une surveillance en cours.
    private const string RunningName = @"Local\AltBoardSync.Watch";
    private const string StopName = @"Local\AltBoardSync.Watch.Stop";
    private const string ShowName = @"Local\AltBoardSync.Watch.Show";

    private readonly Mutex _running;
    private readonly EventWaitHandle _stop, _show;
    private readonly RegisteredWaitHandle _stopWait, _showWait;
    private readonly TrayIcon _tray;
    private readonly MainWindow _window;
    private string? _lastError;
    private int _hiddenOnce;

    public WatchControl Control { get; } = new();

    private WatchHost(Mutex running, CancellationTokenSource cancellation, string homeDirectory, IAutostart autostart, bool showWindow)
    {
        _running = running;
        _stop = new EventWaitHandle(false, EventResetMode.ManualReset, StopName);
        _stopWait = ThreadPool.RegisterWaitForSingleObject(_stop, (_, _) => Cancel(cancellation), null, Timeout.Infinite, executeOnlyOnce: true);

        void OpenLog() => Open(Path.Combine(homeDirectory, "logs", "altboardsync.log"));
        _tray = new TrayIcon(
            "AltBoard Sync — synchronisation automatique",
            [
                new TrayIcon.MenuItem("Ouvrir AltBoard Sync", () => _window!.Show()),
                new TrayIcon.MenuItem("Synchroniser maintenant", Control.RequestSync),
                new TrayIcon.MenuItem("Ouvrir le tableau de bord", () => OpenDashboard(homeDirectory)),
                new TrayIcon.MenuItem("Ouvrir le fichier journal", OpenLog),
                null,
                new TrayIcon.MenuItem("Quitter", () => Cancel(cancellation)),
            ],
            onClick: () => _window!.Show());
        _window = new MainWindow(
            _tray.Post, homeDirectory, autostart,
            new MainWindow.Commands(Control.RequestSync, () => OpenDashboard(homeDirectory), OpenLog, () => Cancel(cancellation)),
            OnWindowHidden);

        _show = new EventWaitHandle(false, EventResetMode.AutoReset, ShowName);
        _showWait = ThreadPool.RegisterWaitForSingleObject(_show, (_, _) => _window.Show(), null, Timeout.Infinite, executeOnlyOnce: false);
        if (showWindow) _window.Show();
    }

    /// <param name="showWindow">Ouvre la fenêtre tout de suite ; sinon elle attend un clic sur l'icône.</param>
    /// <returns>Null si une surveillance tourne déjà dans cette session Windows.</returns>
    public static WatchHost? TryStart(CancellationTokenSource cancellation, string homeDirectory, IAutostart autostart, bool showWindow)
    {
        var running = new Mutex(initiallyOwned: false, RunningName, out var created);
        if (created) return new WatchHost(running, cancellation, homeDirectory, autostart, showWindow);
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

    /// <summary>Demande à la surveillance de cette session d'afficher sa fenêtre.</summary>
    /// <returns>Faux si aucune ne tourne.</returns>
    public static bool ShowRunning()
    {
        if (!EventWaitHandle.TryOpenExisting(ShowName, out var show)) return false;
        // Ce processus vient d'être lancé par l'utilisateur : lui seul peut céder le premier plan.
        Win32.AllowSetForegroundWindow(0xFFFFFFFF);
        using (show) show.Set();
        return true;
    }

    /// <summary>Lance la surveillance dans un nouveau processus, sans console.</summary>
    /// <param name="command">« watch » : en arrière-plan ; « ui » : avec sa fenêtre.</param>
    public static void StartInBackground(string command = "watch")
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Emplacement de l'exécutable inconnu.");
        // Par CreateProcess et non Process.Start, qui transmet toujours les handles hérités : la
        // surveillance garderait ouverte la sortie de cette commande, et un script qui la lit
        // (« AltBoardSync autostart on | … ») attendrait sans fin.
        var startup = new Win32.STARTUPINFOW { cb = (uint)Marshal.SizeOf<Win32.STARTUPINFOW>() };
        var commandLine = $"\"{executable}\" {command}\0".ToCharArray();
        if (!Win32.CreateProcessW(executable, commandLine, 0, 0, inheritHandles: false, Win32.DetachedProcess, 0, null, ref startup, out var created))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        Win32.CloseHandle(created.hThread);
        Win32.CloseHandle(created.hProcess);
    }

    public void OnEvent(WatchEvent watchEvent)
    {
        _window.Report(watchEvent);
        switch (watchEvent)
        {
            case WatchEvent.Synced synced:
                _lastError = null;
                _tray.SetTooltip($"AltBoard Sync — synchronisé à {DateTime.Now:HH:mm}");
                // La bulle dit aussi ce qui a changé, tant que cela tient en quelques lignes.
                var lines = synced.Changes.Take(3).Select(change => $"{change.Name} : {string.Join(", ", change.Details)}");
                _tray.Notify("Synchronisation réussie", string.Join('\n', [synced.Summary, .. lines]), error: false);
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
        _showWait.Unregister(null);
        _stop.Dispose();
        _show.Dispose();
        _tray.Dispose();
        _running.Dispose();
    }

    /// <summary>Fermer la fenêtre ne quitte pas l'agent : dit une fois où il reste.</summary>
    private void OnWindowHidden()
    {
        if (Interlocked.Exchange(ref _hiddenOnce, 1) == 0)
            _tray.Notify("AltBoard Sync reste actif", "La synchronisation continue. Cliquez sur cette icône pour rouvrir la fenêtre.", error: false);
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
