using System.Runtime.InteropServices;

internal static class NativeConsole
{
    private const int StandardOutput = -11;
    private const uint FileTypeDisk = 1, FileTypePipe = 3;

    /// <summary>
    /// Vrai si personne ne lit la sortie du programme : ni terminal, ni script, ni redirection. Il a
    /// été lancé depuis l'Explorateur, à l'ouverture de session ou par « autostart on ».
    /// </summary>
    public static bool IsDetached()
    {
        if (!OperatingSystem.IsWindows()) return false;
        return GetConsoleProcessList(new uint[2], 2) switch
        {
            // Aucune console (voir consoleAllocationPolicy dans app.manifest) : un programme qui
            // aurait lancé celui-ci pour lire sa sortie l'aurait branchée sur un tube ou un fichier.
            0 => GetFileType(GetStdHandle(StandardOutput)) is not (FileTypeDisk or FileTypePipe),
            // Une console ouverte pour ce seul processus.
            1 => !Console.IsInputRedirected,
            // Un terminal ou un script la partage.
            _ => false,
        };
    }

    /// <summary>Quitte la console : sa fenêtre se ferme si ce processus y était seul.</summary>
    public static void Detach()
    {
        if (OperatingSystem.IsWindows()) FreeConsole();
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetConsoleProcessList(uint[] processList, uint processCount);

    [DllImport("kernel32.dll")]
    private static extern bool FreeConsole();

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int handle);

    [DllImport("kernel32.dll")]
    private static extern uint GetFileType(IntPtr file);
}
