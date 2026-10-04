using System.Text;
using AltBoardSync.Core.App;
using AltBoardSync.Core.Config;

Console.OutputEncoding = Encoding.UTF8;

using var cancellation = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cancellation.Cancel();
};

// « token set » en console interactive : saisie masquée, le jeton ne s'affiche jamais.
TextReader input = Console.In;
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

var app = new AgentApp(new AgentEnvironment
{
    HomeDirectory = AgentConfigStore.DefaultDirectory,
    Out = Console.Out,
    Error = Console.Error,
    In = input,
});

try
{
    return await app.RunAsync(args, cancellation.Token);
}
catch (OperationCanceledException)
{
    Console.Error.WriteLine("Interrompu.");
    return AgentApp.ExitFailed;
}
