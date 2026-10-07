using System.Runtime.InteropServices;

/// <summary>
/// API Windows partagée par l'icône de la zone de notification et la fenêtre. En Win32 direct :
/// Windows Forms ou WPF interdiraient de réduire l'exécutable.
/// </summary>
internal static class Win32
{
    public const uint WmDestroy = 0x0002, WmSize = 0x0005, WmSetFocus = 0x0007, WmPaint = 0x000F, WmClose = 0x0010, WmEraseBackground = 0x0014;
    public const uint WmSetCursor = 0x0020, WmGetMinMaxInfo = 0x0024, WmSetFont = 0x0030, WmKeyDown = 0x0100, WmChar = 0x0102;
    public const uint WmCommand = 0x0111, WmTimer = 0x0113, WmCtlColorEdit = 0x0133, WmPaste = 0x0302;
    public const uint WmMouseMove = 0x0200, WmLButtonDown = 0x0201, WmLButtonUp = 0x0202, WmLButtonDoubleClick = 0x0203, WmRButtonUp = 0x0205;
    public const uint WmMouseWheel = 0x020A, WmCaptureChanged = 0x0215, WmMouseLeave = 0x02A3, WmDpiChanged = 0x02E0;

    public const int IconResource = 32512, ImageIcon = 1, LoadShared = 0x8000;
    public const int SmCxSmIcon = 49, SmCySmIcon = 50;
    public const int SwHide = 0, SwShow = 5, SwRestore = 9;
    public const int CursorArrow = 32512, CursorHand = 32649;
    public const uint WsOverlappedWindow = 0x00CF0000, WsClipChildren = 0x02000000, WsChild = 0x40000000, CsDoubleClicks = 0x0008;

    // Champ de saisie (classe EDIT) : styles, messages, notifications reçues par WmCommand.
    public const uint EsPassword = 0x0020, EsAutoHScroll = 0x0080;
    public const uint EmSetSel = 0x00B1, EmSetLimitText = 0x00C5, EmSetPasswordChar = 0x00CC;
    public const uint EnSetFocus = 0x0100, EnKillFocus = 0x0200, EnChange = 0x0300;
    public const int GwlpWndProc = -4;
    public const uint SwpNoZOrder = 0x0004, SwpNoActivate = 0x0010;
    public const uint SrcCopy = 0x00CC0020, DiNormal = 0x0003;
    public const int HtClient = 1, TransparentBackground = 1;
    public const uint MbIconError = 0x10;

    // DrawTextW
    public const uint DtCenter = 0x1, DtRight = 0x2, DtVCenter = 0x4, DtWordBreak = 0x10, DtSingleLine = 0x20;
    public const uint DtCalcRect = 0x400, DtNoPrefix = 0x800, DtEditControl = 0x2000, DtEndEllipsis = 0x8000;

    // Touches
    public const int VkTab = 0x09, VkReturn = 0x0D, VkShift = 0x10, VkEscape = 0x1B, VkSpace = 0x20;
    public const int VkPrior = 0x21, VkNext = 0x22, VkEnd = 0x23, VkHome = 0x24, VkUp = 0x26, VkDown = 0x28, VkF5 = 0x74;

    public delegate IntPtr WindowProcedure(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    // Structures de l'API Windows : leurs champs sont lus ou écrits par le système, pas par ce code.
#pragma warning disable CS0649
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WNDCLASSEXW
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
    public struct NOTIFYICONDATAW
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

    public struct POINT
    {
        public int X;
        public int Y;
    }

    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    public struct PAINTSTRUCT
    {
        public IntPtr hdc;
        public int fErase;
        public RECT rcPaint;
        public int fRestore;
        public int fIncUpdate;
        public long reserved1, reserved2, reserved3, reserved4;
    }

    public struct TRACKMOUSEEVENT
    {
        public uint cbSize;
        public uint dwFlags;
        public IntPtr hwndTrack;
        public uint dwHoverTime;
    }

    public struct MONITORINFO
    {
        public uint cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    public struct RectF(float x, float y, float width, float height)
    {
        public float X = x;
        public float Y = y;
        public float Width = width;
        public float Height = height;

        public readonly float Right => X + Width;

        public readonly float Bottom => Y + Height;

        public readonly bool Contains(float x, float y) => x >= X && x < Right && y >= Y && y < Bottom;
    }

    public struct GdiplusStartupInput
    {
        public uint GdiplusVersion;
        public IntPtr DebugEventCallback;
        public int SuppressBackgroundThread;
        public int SuppressExternalCodecs;
    }

    public struct STARTUPINFOW
    {
        public uint cb;
        public IntPtr lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public ushort wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public uint dwProcessId, dwThreadId;
    }
#pragma warning restore CS0649

    public const uint DetachedProcess = 0x00000008;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcessW(
        string? applicationName, char[] commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
        uint creationFlags, IntPtr environment, string? currentDirectory, ref STARTUPINFOW startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);

    // ---------------------------------------------------------------------------
    // Fenêtres et messages
    // ---------------------------------------------------------------------------

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr GetModuleHandleW(string? moduleName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern ushort RegisterClassExW(ref WNDCLASSEXW windowClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern uint RegisterWindowMessageW(string name);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateWindowExW(
        uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height,
        IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);

    [DllImport("user32.dll")]
    public static extern IntPtr DefWindowProcW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool DestroyWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool AllowSetForegroundWindow(uint processId);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr window, out RECT rectangle);

    [DllImport("user32.dll")]
    public static extern bool AdjustWindowRectExForDpi(ref RECT rectangle, uint style, bool menu, uint exStyle, uint dpi);

    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromPoint(POINT point, uint flags);

    [DllImport("user32.dll")]
    public static extern bool GetMonitorInfoW(IntPtr monitor, ref MONITORINFO info);

    [DllImport("shcore.dll")]
    public static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);

    [DllImport("user32.dll")]
    public static extern int GetMessageW(out MSG message, IntPtr window, uint filterMin, uint filterMax);

    [DllImport("user32.dll")]
    public static extern bool TranslateMessage(ref MSG message);

    [DllImport("user32.dll")]
    public static extern IntPtr DispatchMessageW(ref MSG message);

    [DllImport("user32.dll")]
    public static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr SetWindowLongPtrW(IntPtr window, int index, IntPtr value);

    [DllImport("user32.dll")]
    public static extern IntPtr CallWindowProcW(IntPtr previous, IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLengthW(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr window, [Out] char[] text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool SetWindowTextW(IntPtr window, string text);

    [DllImport("user32.dll")]
    public static extern void PostQuitMessage(int exitCode);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int MessageBoxW(IntPtr owner, string text, string caption, uint type);

    // ---------------------------------------------------------------------------
    // Souris, clavier, minuteries
    // ---------------------------------------------------------------------------

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    public static extern IntPtr LoadCursorW(IntPtr instance, IntPtr name);

    [DllImport("user32.dll")]
    public static extern IntPtr SetCursor(IntPtr cursor);

    [DllImport("user32.dll")]
    public static extern IntPtr SetCapture(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    public static extern bool TrackMouseEvent(ref TRACKMOUSEEVENT track);

    [DllImport("user32.dll")]
    public static extern short GetKeyState(int key);

    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr window);

    [DllImport("user32.dll")]
    public static extern IntPtr GetFocus();

    [DllImport("user32.dll")]
    public static extern nuint SetTimer(IntPtr window, nuint id, uint milliseconds, IntPtr callback);

    [DllImport("user32.dll")]
    public static extern bool KillTimer(IntPtr window, nuint id);

    // ---------------------------------------------------------------------------
    // Icônes et menus
    // ---------------------------------------------------------------------------

    [DllImport("user32.dll")]
    public static extern IntPtr LoadImageW(IntPtr instance, IntPtr name, uint type, int width, int height, uint load);

    [DllImport("user32.dll")]
    public static extern IntPtr LoadIconW(IntPtr instance, IntPtr name);

    [DllImport("user32.dll")]
    public static extern bool DestroyIcon(IntPtr icon);

    [DllImport("user32.dll")]
    public static extern bool DrawIconEx(IntPtr dc, int x, int y, IntPtr icon, int width, int height, uint step, IntPtr brush, uint flags);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    public static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool AppendMenuW(IntPtr menu, uint flags, nuint id, string? label);

    [DllImport("user32.dll")]
    public static extern bool TrackPopupMenu(IntPtr menu, uint flags, int x, int y, int reserved, IntPtr window, IntPtr rectangle);

    [DllImport("user32.dll")]
    public static extern bool DestroyMenu(IntPtr menu);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern bool Shell_NotifyIconW(uint message, ref NOTIFYICONDATAW data);

    // ---------------------------------------------------------------------------
    // Dessin : GDI pour le texte, GDI+ pour les formes
    // ---------------------------------------------------------------------------

    [DllImport("user32.dll")]
    public static extern IntPtr BeginPaint(IntPtr window, out PAINTSTRUCT paint);

    [DllImport("user32.dll")]
    public static extern bool EndPaint(IntPtr window, ref PAINTSTRUCT paint);

    [DllImport("user32.dll")]
    public static extern bool InvalidateRect(IntPtr window, IntPtr rectangle, bool erase);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int DrawTextW(IntPtr dc, string text, int length, ref RECT rectangle, uint format);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr dc);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);

    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr dc, IntPtr gdiObject);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr gdiObject);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr dc);

    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr target, int x, int y, int width, int height, IntPtr source, int sourceX, int sourceY, uint operation);

    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateFontW(
        int height, int width, int escapement, int orientation, int weight, uint italic, uint underline, uint strikeOut,
        uint charSet, uint outputPrecision, uint clipPrecision, uint quality, uint pitchAndFamily, string face);

    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetTextFaceW(IntPtr dc, int count, [Out] char[] face);

    [DllImport("gdi32.dll")]
    public static extern uint SetTextColor(IntPtr dc, uint color);

    [DllImport("gdi32.dll")]
    public static extern int SetBkMode(IntPtr dc, int mode);

    [DllImport("gdi32.dll")]
    public static extern uint SetBkColor(IntPtr dc, uint color);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateSolidBrush(uint color);

    [DllImport("gdi32.dll")]
    public static extern int SaveDC(IntPtr dc);

    [DllImport("gdi32.dll")]
    public static extern bool RestoreDC(IntPtr dc, int saved);

    [DllImport("gdi32.dll")]
    public static extern int IntersectClipRect(IntPtr dc, int left, int top, int right, int bottom);

    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr window, uint attribute, ref int value, int size);

    [DllImport("gdiplus.dll")]
    public static extern int GdiplusStartup(out nuint token, ref GdiplusStartupInput input, IntPtr output);

    [DllImport("gdiplus.dll")]
    public static extern int GdipCreateFromHDC(IntPtr dc, out IntPtr graphics);

    [DllImport("gdiplus.dll")]
    public static extern int GdipDeleteGraphics(IntPtr graphics);

    [DllImport("gdiplus.dll")]
    public static extern int GdipSetSmoothingMode(IntPtr graphics, int mode);

    [DllImport("gdiplus.dll")]
    public static extern int GdipSetPixelOffsetMode(IntPtr graphics, int mode);

    [DllImport("gdiplus.dll")]
    public static extern int GdipGetDC(IntPtr graphics, out IntPtr dc);

    [DllImport("gdiplus.dll")]
    public static extern int GdipReleaseDC(IntPtr graphics, IntPtr dc);

    [DllImport("gdiplus.dll")]
    public static extern int GdipSetClipRect(IntPtr graphics, float x, float y, float width, float height, int combineMode);

    [DllImport("gdiplus.dll")]
    public static extern int GdipResetClip(IntPtr graphics);

    [DllImport("gdiplus.dll")]
    public static extern int GdipCreateSolidFill(uint argb, out IntPtr brush);

    [DllImport("gdiplus.dll")]
    public static extern int GdipCreateLineBrushFromRect(ref RectF rectangle, uint argb1, uint argb2, int mode, int wrap, out IntPtr brush);

    [DllImport("gdiplus.dll")]
    public static extern int GdipDeleteBrush(IntPtr brush);

    [DllImport("gdiplus.dll")]
    public static extern int GdipCreatePen1(uint argb, float width, int unit, out IntPtr pen);

    [DllImport("gdiplus.dll")]
    public static extern int GdipDeletePen(IntPtr pen);

    [DllImport("gdiplus.dll")]
    public static extern int GdipCreatePath(int fillMode, out IntPtr path);

    [DllImport("gdiplus.dll")]
    public static extern int GdipAddPathArc(IntPtr path, float x, float y, float width, float height, float startAngle, float sweepAngle);

    [DllImport("gdiplus.dll")]
    public static extern int GdipClosePathFigure(IntPtr path);

    [DllImport("gdiplus.dll")]
    public static extern int GdipDeletePath(IntPtr path);

    [DllImport("gdiplus.dll")]
    public static extern int GdipFillPath(IntPtr graphics, IntPtr brush, IntPtr path);

    [DllImport("gdiplus.dll")]
    public static extern int GdipDrawPath(IntPtr graphics, IntPtr pen, IntPtr path);

    [DllImport("gdiplus.dll")]
    public static extern int GdipFillRectangle(IntPtr graphics, IntPtr brush, float x, float y, float width, float height);

    [DllImport("gdiplus.dll")]
    public static extern int GdipFillEllipse(IntPtr graphics, IntPtr brush, float x, float y, float width, float height);
}
