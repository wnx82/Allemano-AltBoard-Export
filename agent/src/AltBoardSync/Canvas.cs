using System.Runtime.Versioning;
using static Win32;

[Flags]
internal enum TextLayout
{
    Left = 0,
    Center = 1,
    Right = 2,

    /// <summary>Centré verticalement, sur une seule ligne.</summary>
    Middle = 4,

    /// <summary>Retour à la ligne entre les mots, aligné en haut.</summary>
    Wrap = 8,
    Ellipsis = 16,
}

/// <summary>
/// Surface de dessin d'un rendu de la fenêtre. Les formes passent par GDI+, pour l'anticrénelage ;
/// le texte par GDI, dont le rendu ClearType est celui du reste de Windows. Couleurs en 0xAARRGGBB,
/// coordonnées en pixels.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class Canvas : IDisposable
{
    private static nuint _gdiplus;

    private readonly IntPtr _graphics;
    private RectF? _clip;

    public Canvas(IntPtr dc)
    {
        if (_gdiplus == 0)
        {
            var input = new GdiplusStartupInput { GdiplusVersion = 1 };
            GdiplusStartup(out _gdiplus, ref input, 0);
        }

        GdipCreateFromHDC(dc, out _graphics);
        GdipSetSmoothingMode(_graphics, 4); // anticrénelage
        GdipSetPixelOffsetMode(_graphics, 4); // demi-pixel : les bords tombent sur la grille
    }

    public void Dispose() => GdipDeleteGraphics(_graphics);

    public void Fill(RectF bounds, uint color)
    {
        GdipCreateSolidFill(color, out var brush);
        GdipFillRectangle(_graphics, brush, bounds.X, bounds.Y, bounds.Width, bounds.Height);
        GdipDeleteBrush(brush);
    }

    /// <summary>Dégradé vertical.</summary>
    public void Fill(RectF bounds, uint top, uint bottom)
    {
        // Mode 1 : vertical. Enroulement 3 (miroir) : pas de liseré de la couleur opposée au bord.
        GdipCreateLineBrushFromRect(ref bounds, top, bottom, 1, 3, out var brush);
        GdipFillRectangle(_graphics, brush, bounds.X, bounds.Y, bounds.Width, bounds.Height);
        GdipDeleteBrush(brush);
    }

    public void FillRound(RectF bounds, float radius, uint color)
    {
        if (bounds.Width <= 0 || bounds.Height <= 0) return;
        var path = RoundedPath(bounds, radius);
        GdipCreateSolidFill(color, out var brush);
        GdipFillPath(_graphics, brush, path);
        GdipDeleteBrush(brush);
        GdipDeletePath(path);
    }

    /// <summary>Contour tracé à l'intérieur de <paramref name="bounds"/>.</summary>
    public void StrokeRound(RectF bounds, float radius, uint color, float width = 1)
    {
        var inset = width / 2;
        var inner = new RectF(bounds.X + inset, bounds.Y + inset, bounds.Width - width, bounds.Height - width);
        if (inner.Width <= 0 || inner.Height <= 0) return;
        var path = RoundedPath(inner, Math.Max(0, radius - inset));
        GdipCreatePen1(color, width, 2, out var pen); // unité 2 : pixel
        GdipDrawPath(_graphics, pen, path);
        GdipDeletePen(pen);
        GdipDeletePath(path);
    }

    public void FillCircle(float centerX, float centerY, float radius, uint color)
    {
        GdipCreateSolidFill(color, out var brush);
        GdipFillEllipse(_graphics, brush, centerX - radius, centerY - radius, radius * 2, radius * 2);
        GdipDeleteBrush(brush);
    }

    public void Text(string text, IntPtr font, uint color, RectF bounds, TextLayout layout = TextLayout.Left)
    {
        if (text.Length == 0 || bounds.Width <= 0) return;
        WithDc(dc =>
        {
            SelectObject(dc, font);
            SetBkMode(dc, TransparentBackground);
            // COLORREF : 0x00BBGGRR.
            SetTextColor(dc, ((color & 0xFF) << 16) | (color & 0xFF00) | ((color >> 16) & 0xFF));
            var rectangle = ToRect(bounds);
            DrawTextW(dc, text, text.Length, ref rectangle, Format(layout));
        });
    }

    /// <summary>Taille du texte ; avec <see cref="TextLayout.Wrap"/>, hauteur une fois replié dans <paramref name="maxWidth"/>.</summary>
    public (float Width, float Height) Measure(string text, IntPtr font, float maxWidth = 100_000, TextLayout layout = TextLayout.Left)
    {
        var rectangle = new RECT { Right = (int)maxWidth };
        WithDc(dc =>
        {
            SelectObject(dc, font);
            // Un texte vide mesure une ligne : les blocs gardent leur hauteur.
            var measured = text.Length == 0 ? " " : text;
            DrawTextW(dc, measured, measured.Length, ref rectangle, Format(layout & TextLayout.Wrap) | DtCalcRect);
        });
        return (rectangle.Right, rectangle.Bottom);
    }

    public void Icon(IntPtr icon, float x, float y, float size) =>
        WithDc(dc => DrawIconEx(dc, (int)x, (int)y, icon, (int)size, (int)size, 0, 0, DiNormal));

    /// <summary>Limite les dessins suivants à <paramref name="bounds"/>, jusqu'à <see cref="Unclip"/>.</summary>
    public void Clip(RectF bounds)
    {
        _clip = bounds;
        GdipSetClipRect(_graphics, bounds.X, bounds.Y, bounds.Width, bounds.Height, 0);
    }

    public void Unclip()
    {
        _clip = null;
        GdipResetClip(_graphics);
    }

    /// <summary>GDI dessine sur le contexte que GDI+ prête ; la zone de découpe y est reportée à la main.</summary>
    private void WithDc(Action<IntPtr> draw)
    {
        GdipGetDC(_graphics, out var dc);
        var saved = SaveDC(dc);
        if (_clip is { } clip) IntersectClipRect(dc, (int)clip.X, (int)clip.Y, (int)MathF.Ceiling(clip.Right), (int)MathF.Ceiling(clip.Bottom));
        draw(dc);
        RestoreDC(dc, saved);
        GdipReleaseDC(_graphics, dc);
    }

    private static uint Format(TextLayout layout)
    {
        var format = DtNoPrefix;
        if (layout.HasFlag(TextLayout.Center)) format |= DtCenter;
        if (layout.HasFlag(TextLayout.Right)) format |= DtRight;
        // DtEditControl : un mot plus long que la ligne (un chemin de dossier) est coupé au lieu de déborder.
        if (layout.HasFlag(TextLayout.Wrap)) format |= DtWordBreak | DtEditControl;
        else format |= DtSingleLine;
        if (layout.HasFlag(TextLayout.Middle)) format |= DtVCenter;
        if (layout.HasFlag(TextLayout.Ellipsis)) format |= DtEndEllipsis;
        return format;
    }

    private static RECT ToRect(RectF bounds) => new()
    {
        Left = (int)MathF.Round(bounds.X),
        Top = (int)MathF.Round(bounds.Y),
        Right = (int)MathF.Round(bounds.Right),
        Bottom = (int)MathF.Round(bounds.Bottom),
    };

    private static IntPtr RoundedPath(RectF bounds, float radius)
    {
        GdipCreatePath(0, out var path);
        // Un arc de diamètre nul est refusé : le rayon reste strictement positif.
        var diameter = Math.Max(0.5f, Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height)));
        GdipAddPathArc(path, bounds.X, bounds.Y, diameter, diameter, 180, 90);
        GdipAddPathArc(path, bounds.Right - diameter, bounds.Y, diameter, diameter, 270, 90);
        GdipAddPathArc(path, bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        GdipAddPathArc(path, bounds.X, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        GdipClosePathFigure(path);
        return path;
    }
}
