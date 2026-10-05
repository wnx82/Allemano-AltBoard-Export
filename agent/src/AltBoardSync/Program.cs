using System.Text;
using AltBoardSync.Core.App;
using AltBoardSync.Core.Config;

Console.OutputEncoding = Encoding.UTF8;

var ownsConsole = NativeConsole.BelongsToThisProcessOnly();

// Double-clic depuis l'Explorateur : aucune commande, et une console ouverte pour ce seul processus.
// On synchronise, puis la fenêtre attend une touche : sinon elle se ferme avant qu'on ait pu lire
// le résultat. Depuis un terminal ou une tâche planifiée, rien ne change.
var doubleClick = args.Length == 0 && ownsConsole;
if (doubleClick) args = ["sync"];

// « watch » sans terminal (ouverture de session, « autostart on ») : tâche de fond. Elle quitte sa
// console, qui se ferme, et ne parle plus que par la zone de notification et le journal.
var watching = args.Length > 0 && args[0].Equals("watch", StringComparison.OrdinalIgnoreCase);
var background = watching && ownsConsole;
if (background) NativeConsole.Detach();

using var cancellation = new CancellationTokenSource();
if (!background)
{
    Console.CancelKeyPress += (_, e) =>
    {
        e.Cancel = true;
        cancellation.Cancel();
    };
}

// « token set » en console interactive : saisie masquée, le jeton ne s'affiche jamais.
var input = background ? TextReader.Null : Console.In;
if (args is ["token", "set"] && !Console.IsInputRedirected)
{
    Console.Write("Jeton d'agent : ");
    var typed = new StringBuilder();
    while (true)
    {
        var key = Console.ReadKey(intercept: true);
        if (key.Key == ConsoleKey.Enter) break;
        if (key.Key == ConsoleKey.Backspace)
        {
            if (typed.Length > 0) typed.Length--;
        }
        else if (!char.IsControl(key.KeyChar))
        {
            typed.Append(key.KeyChar);
        }
    }

    Console.WriteLine();
    input = new StringReader(typed.ToString());
}

var environment = new AgentEnvironment
{
    HomeDirectory = AgentConfigStore.DefaultDirectory,
    Out = background ? TextWriter.Null : Console.Out,
    Error = background ? TextWriter.Null : Console.Error,
    In = input,
    Autostart = OperatingSystem.IsWindows() ? new RegistryAutostart() : null,
};

WatchHost? host = null;
if (watching && OperatingSystem.IsWindows())
{
    host = WatchHost.TryStart(cancellation, environment.HomeDirectory);
    if (host is null)
    {
        environment.Error.WriteLine("La synchronisation automatique tourne déjà dans cette session.");
        return AgentApp.ExitFailed;
    }

    environment = environment with { WatchControl = host.Control, OnWatchEvent = host.OnEvent };
}

int exitCode;
try
{
    exitCode = await new AgentApp(environment).RunAsync(args, cancellation.Token);
}
catch (OperationCanceledException)
{
    environment.Error.WriteLine("Interrompu.");
    exitCode = AgentApp.ExitFailed;
}
finally
{
    if (OperatingSystem.IsWindows()) host?.Dispose();
}

// « autostart on » lance aussi la surveillance tout de suite, « autostart off » arrête celle qui tourne.
if (OperatingSystem.IsWindows() && exitCode == AgentApp.ExitOk && args is [var command, var action]
    && command.Equals("autostart", StringComparison.OrdinalIgnoreCase))
{
    if (action == "on")
    {
        if (WatchHost.IsRunning())
        {
            Console.WriteLine("La synchronisation automatique tourne déjà.");
        }
        else
        {
            WatchHost.StartInBackground();
            Console.WriteLine("Synchronisation automatique démarrée en arrière-plan : son icône est dans la zone de notification.");
        }
    }
    else if (action == "off" && WatchHost.StopRunning())
    {
        Console.WriteLine("Synchronisation automatique en cours arrêtée.");
    }
}

if (doubleClick)
{
    Console.WriteLine();
    Console.Write("Appuyez sur une touche pour fermer cette fenêtre.");
    Console.ReadKey(intercept: true);
}

return exitCode;
