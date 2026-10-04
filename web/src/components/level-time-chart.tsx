"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatDuration, type LevelTime } from "@/lib/dashboard/level-times";
import { formatDateTime } from "@/lib/wow/format";

const HEIGHT = 240;
const MARGIN = { top: 26, right: 12, bottom: 30, left: 48 };
const MAX_BAR = 24;

/** Graduations de 0 à un maximum « rond », en trois ou quatre pas. */
function scale(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? rough;
  const ticks: number[] = [];
  for (let tick = 0; tick < max + step; tick += step) ticks.push(Number(tick.toFixed(6)));
  return ticks;
}

/** Colonne à sommet arrondi et base droite, posée sur l'axe. */
function column(x: number, top: number, width: number, baseline: number): string {
  const radius = Math.min(4, width / 2, Math.max(baseline - top, 0));
  return `M${x},${baseline} V${top + radius} Q${x},${top} ${x + radius},${top} H${x + width - radius} Q${x + width},${top} ${x + width},${top + radius} V${baseline} Z`;
}

/**
 * Temps de jeu par niveau : une colonne par niveau, une seule mesure, un seul axe. Chaque valeur
 * reste accessible sans survol, au clavier (colonnes focalisables) et dans le tableau qui suit.
 */
export function LevelTimeChart({ levels }: { levels: LevelTime[] }) {
  const titleId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    const longest = Math.max(0, ...levels.map((entry) => entry.playedSeconds ?? 0));
    // Minutes tant que tout tient en moins de deux heures, heures au-delà.
    const unit = longest < 2 * 3600 ? { seconds: 60, suffix: "min" } : { seconds: 3600, suffix: "h" };
    const ticks = scale(longest / unit.seconds);
    const top = ticks[ticks.length - 1];
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const band = plotWidth / levels.length;
    const barWidth = Math.min(MAX_BAR, band * 0.62);
    const baseline = MARGIN.top + plotHeight;
    const y = (seconds: number) => baseline - (seconds / unit.seconds / top) * plotHeight;
    // Une étiquette de niveau tous les k niveaux quand les colonnes se resserrent.
    const every = Math.max(1, Math.ceil(26 / band));
    return { unit, ticks, band, barWidth, baseline, y, every, plotHeight };
  }, [levels, width]);

  const { band, barWidth, baseline } = layout;
  const center = (index: number) => MARGIN.left + band * (index + 0.5);
  const current = active === null ? null : levels[active];

  const tooltipLines = current
    ? [
        current.current ? `Niveau ${current.level} (en cours)` : `Niveau ${current.level} → ${current.level + 1}`,
        current.playedSeconds === null ? "Temps de jeu non mesuré" : `Temps de jeu : ${formatDuration(current.playedSeconds)}`,
        ...(current.wallSeconds === null ? [] : [`Temps réel : ${formatDuration(current.wallSeconds)}`]),
        ...(current.reachedAt === null ? [] : [`Terminé le ${formatDateTime(current.reachedAt)}`]),
        ...(current.zone === null ? [] : [current.zone]),
      ]
    : [];
  const tooltipWidth = 214;
  const tooltipHeight = 12 + tooltipLines.length * 16;
  const tooltipX = active === null ? 0 : Math.min(Math.max(center(active) - tooltipWidth / 2, 4), width - tooltipWidth - 4);

  return (
    <figure className="panel p-4" data-series="level">
      <figcaption id={titleId} className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="eyebrow">Temps de jeu par niveau</span>
        <span className="text-xs text-muted">Temps /played passé sur chaque niveau. Colonne claire : niveau en cours.</span>
      </figcaption>
      <div ref={frame}>
        <svg className="trend-chart" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="group" aria-labelledby={titleId}>
          {layout.ticks.map((tick) => (
            <g key={tick}>
              <line className="trend-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={layout.y(tick * layout.unit.seconds)} y2={layout.y(tick * layout.unit.seconds)} />
              <text className="trend-axis" x={MARGIN.left - 8} y={layout.y(tick * layout.unit.seconds)} textAnchor="end" dominantBaseline="middle">
                {new Intl.NumberFormat("fr-FR").format(tick)} {layout.unit.suffix}
              </text>
            </g>
          ))}

          {levels.map((entry, index) => {
            const x = center(index) - barWidth / 2;
            const labelled = index % layout.every === 0 || index === levels.length - 1;
            return (
              <g key={entry.level}>
                {entry.playedSeconds === null ? (
                  // Niveau gagné sans mesure : marque creuse sur l'axe, jamais une durée inventée.
                  <circle className="level-unknown" cx={center(index)} cy={baseline - 5} r={3.5} />
                ) : (
                  <path
                    className="level-bar"
                    data-current={entry.current || undefined}
                    data-active={active === index || undefined}
                    d={column(x, Math.min(layout.y(entry.playedSeconds), baseline - 1), barWidth, baseline)}
                  />
                )}
                {levels.length <= 14 && entry.playedSeconds !== null && (
                  <text className="trend-value" x={center(index)} y={layout.y(entry.playedSeconds) - 7} textAnchor="middle">
                    {formatDuration(entry.playedSeconds)}
                  </text>
                )}
                {labelled && (
                  <text className="trend-axis" x={center(index)} y={HEIGHT - 10} textAnchor="middle">
                    {entry.level}
                  </text>
                )}
                {/* Zone de survol : toute la bande, bien plus large que la colonne. */}
                <rect
                  x={MARGIN.left + band * index}
                  y={MARGIN.top}
                  width={band}
                  height={layout.plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={`Niveau ${entry.level}${entry.current ? " en cours" : ""} : ${entry.playedSeconds === null ? "temps de jeu non mesuré" : formatDuration(entry.playedSeconds)}`}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
          <line className="trend-baseline" x1={MARGIN.left} x2={width - MARGIN.right} y1={baseline} y2={baseline} />

          {current && (
            <g className="trend-tooltip" transform={`translate(${tooltipX}, ${MARGIN.top - 6})`} pointerEvents="none">
              <rect width={tooltipWidth} height={tooltipHeight} rx={8} />
              {tooltipLines.map((line, index) => (
                <text key={line} className={index === 0 ? "trend-tooltip-value" : "trend-tooltip-date"} x={10} y={19 + index * 16}>
                  {line}
                </text>
              ))}
            </g>
          )}
        </svg>
      </div>
    </figure>
  );
}
