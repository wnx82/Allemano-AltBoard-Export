using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

/// <summary>
/// Icône de la zone de notification pendant « watch » : état en infobulle, bulle à chaque
/// synchronisation ou échec, menu par clic droit. En Win32 direct : Windows Forms interdirait de
/// réduire l'exécutable.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class TrayIcon : IDisposable
{
    /// <summary>Entrée de menu ; un élément null de la liste est un séparateur.</summary>
    public sealed record MenuItem(string Label, Action Action);

    private const uint WmDestroy = 0x0002, WmClose = 0x0010, WmCommand = 0x0111, WmRButtonUp = 0x0205;
    private const uint WmTray = 0x8001, WmInvoke = 0x8002;
    private const uint NimAdd = 0, NimModify = 1, NimDelete = 2;
    private const uint NifMessage = 0x01, NifIcon = 0x02, NifTip = 0x04, NifInfo = 0x10;
    private const uint NiifInfo = 0x01, NiifError = 0x03;
    private const uint MfString = 0x0000, MfSeparator = 0x0800, TpmRightButton = 0x0002;
    private const int IconResource = 32512, SmCxSmIcon = 49, SmCySmIcon = 50;

    private readonly IReadOnlyList<MenuItem?> _menu;
    private readonly ConcurrentQueue<Action> _pending = new();
    private readonly ManualResetEventSlim _ready = new();
    private readonly Thread _thread;
    // Gardé en champ : Windows détient un pointeur vers ce délégué tant que la fenêtre existe.
    private readonly WindowProcedure _procedure;
    private IntPtr _window, _icon;
    private uint _taskbarCreated;
    private string _tooltip;

    public TrayIcon(string tooltip, IReadOnlyList<MenuItem?> menu)
    {
        _tooltip = Fit(tooltip, 127);
        _menu = menu;
        _procedure = Handle;
        _thread = new Thread(Run) { IsBackground = true, Name = "zone de notification" };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        _ready.Wait();
    }

    public void SetTooltip(string text) => Post(() =>
    {
        _tooltip = Fit(text, 127);
        var data = Data(NifTip);
        Shell_NotifyIconW(NimModify, ref data);
    });

    public void Notify(string title, string text, bool error) => Post(() =>
    {
        var data = Data(NifInfo);
        data.szInfoTitle = Fit(title, 63);
        data.szInfo = Fit(text, 255);
        data.dwInfoFlags = error ? NiifError : NiifInfo;
        Shell_NotifyIconW(NimModify, ref data);
    });

    public void Dispose()
    {
        PostMessageW(_window, WmClose, 0, 0);
        _thread.Join(TimeSpan.FromSeconds(2));
    }

    /// <summary>Toute modification de l'icône passe par le fil qui possède la fenêtre.</summary>
    private void Post(Action action)
    {
        _pending.Enqueue(action);
        PostMessageW(_window, WmInvoke, 0, 0);
    }

    private void Run()
    {
        const string className = "AltBoardSyncTray";
        var instance = GetModuleHandleW(null);
        var windowClass = new WNDCLASSEXW
        {
            cbSize = (uint)Marshal.SizeOf<WNDCLASSEXW>(),
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_procedure),
            hInstance = instance,
            lpszClassName = className,
        };
        RegisterClassExW(ref windowClass);
        _taskbarCreated = RegisterWindowMessageW("TaskbarCreated");
        // L'icône de l'exécutable, à la taille de la zone de notification pour l'échelle d'affichage.
        _icon = LoadImageW(instance, IconResource, 1, GetSystemMetrics(SmCxSmIcon), GetSystemMetrics(SmCySmIcon), 0x8000);
        if (_icon == 0) _icon = LoadIconW(0, IconResource);
        // Fenêtre jamais affichée : elle ne sert qu'à recevoir les messages de l'icône.
        _window = CreateWindowExW(0, className, className, 0, 0, 0, 0, 0, 0, 0, instance, 0);
        AddIcon();
        _ready.Set();

        while (GetMessageW(out var message, 0, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessageW(ref message);
        }
    }

    private IntPtr Handle(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
    {
        switch (message)
        {
            case WmTray when (uint)(long)lParam == WmRButtonUp:
                ShowMenu();
                return 0;
            case WmCommand:
                var index = (int)((long)wParam & 0xFFFF) - 1;
                // Hors du fil de l'icône : une action lente ne doit pas figer le menu.
                if (index >= 0 && index < _menu.Count && _menu[index] is { } item) Task.Run(item.Action);
                return 0;
            case WmInvoke:
                while (_pending.TryDequeue(out var action)) action();
                return 0;
            case WmClose:
                DestroyWindow(window);
                return 0;
            case WmDestroy:
                var data = Data(0);
                Shell_NotifyIconW(NimDelete, ref data);
                PostQuitMessage(0);
                return 0;
            default:
                // L'Explorateur a redémarré, ou n'était pas prêt à l'ouverture de session.
                if (message == _taskbarCreated && _taskbarCreated != 0) AddIcon();
                return DefWindowProcW(window, message, wParam, lParam);
        }
    }

    private void AddIcon()
    {
        var data = Data(NifMessage | NifIcon | NifTip);
        Shell_NotifyIconW(NimAdd, ref data);
    }

    private void ShowMenu()
    {
        var menu = CreatePopupMenu();
        for (var i = 0; i < _menu.Count; i++)
        {
            if (_menu[i] is { } item) AppendMenuW(menu, MfString, (nuint)(i + 1), item.Label);
            else AppendMenuW(menu, MfSeparator, 0, null);
        }

        GetCursorPos(out var cursor);
        // Sans quoi le menu ne se referme pas quand on clique ailleurs.
        SetForegroundWindow(_window);
        TrackPopupMenu(menu, TpmRightButton, cursor.X, cursor.Y, 0, _window, 0);
        PostMessageW(_window, 0, 0, 0);
        DestroyMenu(menu);
    }

    private NOTIFYICONDATAW Data(uint flags) => new()
    {
        cbSize = (uint)Marshal.SizeOf<NOTIFYICONDATAW>(),
        hWnd = _window,
        uID = 1,
        uFlags = flags,
        uCallbackMessage = WmTray,
        hIcon = _icon,
        szTip = _tooltip,
        szInfo = "",
        szInfoTitle = "",
    };

    private static string Fit(string text, int maxLength) => text.Length <= maxLength ? text : text[..(maxLength - 1)] + "…";

    private delegate IntPtr WindowProcedure(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    // Structures de l'API Windows : leurs champs sont lus ou écrits par le système, pas par ce code.
#pragma warning disable CS0649
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSEXW
    {
        public uint cbSize;
        public uint style;
        public IntPtr lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string? lpszMenuName;
        public string lpszClassName;
        public IntPtr hIconSm;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATAW
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
        public uint uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    private struct POINT
    {
        public int X;
        public int Y;
    }

    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }
#pragma warning restore CS0649

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandleW(string? moduleName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassExW(ref WNDCLASSEXW windowClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessageW(string name);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowExW(
        uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height,
        IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProcW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern int GetMessageW(out MSG message, IntPtr window, uint filterMin, uint filterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessageW(ref MSG message);

    [DllImport("user32.dll")]
    private static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern void PostQuitMessage(int exitCode);

    [DllImport("user32.dll")]
    private static extern IntPtr LoadImageW(IntPtr instance, IntPtr name, uint type, int width, int height, uint load);

    [DllImport("user32.dll")]
    private static extern IntPtr LoadIconW(IntPtr instance, IntPtr name);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool AppendMenuW(IntPtr menu, uint flags, nuint id, string? label);

    [DllImport("user32.dll")]
    private static extern bool TrackPopupMenu(IntPtr menu, uint flags, int x, int y, int reserved, IntPtr window, IntPtr rectangle);

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(IntPtr menu);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIconW(uint message, ref NOTIFYICONDATAW data);
}
