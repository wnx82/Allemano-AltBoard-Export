using System.Runtime.InteropServices;

internal static class NativeConsole
{
    /// <summary>Vrai si aucun terminal ni script ne partage la console : elle a été ouverte pour ce processus.</summary>
    public static bool BelongsToThisProcessOnly() =>
        OperatingSystem.IsWindows() && !Console.IsInputRedirected && GetConsoleProcessList(new uint[2], 2) == 1;

    /// <summary>Quitte la console : sa fenêtre se ferme si ce processus y était seul.</summary>
    public static void Detach()
    {
        if (OperatingSystem.IsWindows()) FreeConsole();
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetConsoleProcessList(uint[] processList, uint processCount);

    [DllImport("kernel32.dll")]
    private static extern bool FreeConsole();
}
