namespace AltBoardSync.Core.App;

/// <summary>Lancement de « watch » à l'ouverture de session. Propre au système : fourni par l'exécutable.</summary>
public interface IAutostart
{
    bool IsEnabled { get; }

    void Enable();

    void Disable();
}
