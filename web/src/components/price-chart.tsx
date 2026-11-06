"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { niceTicks } from "@/components/trend-chart";

/** Relevé d'un jour : prix en pièces de cuivre, libellés déjà formatés par la page. */
export type PricePoint = { day: string; low: number; high: number; dateLabel: string; lowLabel: string; highLabel: string; availableLabel: string };

type Props = { title: string; note: string; points: PricePoint[] };

const HEIGHT = 220;
const MARGIN = { top: 16, right: 74, bottom: 28, left: 58 };
const DAY_MS = 86_400_000;
const tickNumber = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** Graduations dans l'unité de la plus grande : po, pa ou pc. */
function tickFormatter(max: number): (copper: number) => string {
  if (max >= 10_000) return (copper) => `${tickNumber.format(copper / 10_000)} po`;
  if (max >= 100) return (copper) => `${tickNumber.format(copper / 100)} pa`;
  return (copper) => `${tickNumber.format(copper)} pc`;
}

/**
 * Prix d'un objet jour par jour : la courbe suit le plus bas du jour (prix de référence), la bande
 * l'écart entre le plus bas et le plus haut des prix minimums vus ce jour-là. Un seul axe, une seule
 * mesure. Un jour sans relevé n'est pas tracé : la courbe relie les jours relevés, les marques les
 * situent. Chaque valeur reste lisible sans survol (points focalisables, tableau sous le graphique).
 */
export function PriceChart({ title, note, points }: Props) {
  const titleId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    const times = points.map((point) => Date.parse(`${point.day}T00:00:00Z`));
    const ticks = niceTicks(Math.min(...points.map((p) => p.low)), Math.max(...points.map((p) => p.high)), false).filter((tick) => tick >= 0);
    const [yMin, yMax] = [ticks[0], ticks[ticks.length - 1]];
    const [tMin, tMax] = [Math.min(...times), Math.max(times[times.length - 1], Math.min(...times) + DAY_MS)];
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = (time: number) => MARGIN.left + ((time - tMin) / (tMax - tMin)) * plotWidth;
    const y = (value: number) => MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight;
    const coordinates = points.map((point, index) => ({ x: x(times[index]), low: y(point.low), high: y(point.high) }));
    const band = [...coordinates.map((c) => `${c.x},${c.high}`), ...coordinates.toReversed().map((c) => `${c.x},${c.low}`)].join(" ");
    return { ticks, y, coordinates, band, plotWidth, plotHeight, format: tickFormatter(yMax) };
  }, [points, width]);

  const { coordinates } = layout;
  const last = coordinates[coordinates.length - 1];
  const current = active === null ? null : { point: points[active], ...coordinates[active] };

  const nearest = (clientX: number, target: SVGRectElement) => {
    const pointerX = clientX - target.getBoundingClientRect().left + MARGIN.left;
    let best = 0;
    coordinates.forEach((coordinate, index) => {
      if (Math.abs(coordinate.x - pointerX) < Math.abs(coordinates[best].x - pointerX)) best = index;
    });
    setActive(best);
  };

  const tooltipWidth = 196;
  const tooltipHeight = 74;
  const tooltipX = current ? Math.min(Math.max(current.x - tooltipWidth / 2, 4), width - tooltipWidth - 4) : 0;
  const tooltipY = current ? (current.high > MARGIN.top + tooltipHeight + 8 ? current.high - tooltipHeight - 8 : current.low + 12) : 0;

  return (
    <figure className="panel p-4" data-series="gold">
      <figcaption id={titleId} className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="eyebrow">{title}</span>
        <span className="text-xs text-muted">{note}</span>
      </figcaption>
      <div ref={frame}>
        <svg className="trend-chart" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="group" aria-labelledby={titleId}>
          {layout.ticks.map((tick) => (
            <g key={tick}>
              <line className="trend-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={layout.y(tick)} y2={layout.y(tick)} />
              <text className="trend-axis" x={MARGIN.left - 8} y={layout.y(tick)} textAnchor="end" dominantBaseline="middle">
                {layout.format(tick)}
              </text>
            </g>
          ))}
          <text className="trend-axis" x={MARGIN.left} y={HEIGHT - 8} textAnchor="start">
            {points[0].dateLabel}
          </text>
          {points.length > 1 && (
            <text className="trend-axis" x={last.x} y={HEIGHT - 8} textAnchor="end">
              {points[points.length - 1].dateLabel}
            </text>
          )}

          <polygon className="price-band" points={layout.band} />
          {current && <line className="trend-crosshair" x1={current.x} x2={current.x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />}
          <polyline className="trend-line" points={coordinates.map((c) => `${c.x},${c.low}`).join(" ")} />
          {coordinates.map((coordinate, index) => (
            <circle
              key={points[index].day}
              className="trend-marker"
              cx={coordinate.x}
              cy={coordinate.low}
              r={active === index ? 5.5 : points.length > 45 ? 2.5 : 4}
              tabIndex={0}
              role="img"
              aria-label={`${points[index].dateLabel} : plus bas ${points[index].lowLabel}, plus haut ${points[index].highLabel}, ${points[index].availableLabel}`}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            />
          ))}
          <text className="trend-value" x={last.x + 10} y={last.low} dominantBaseline="middle">
            {points[points.length - 1].lowLabel}
          </text>

          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={Math.max(layout.plotWidth, 0)}
            height={layout.plotHeight}
            fill="transparent"
            onPointerMove={(event) => nearest(event.clientX, event.currentTarget)}
            onPointerLeave={() => setActive(null)}
          />

          {current && (
            <g className="trend-tooltip" transform={`translate(${tooltipX}, ${tooltipY})`} pointerEvents="none">
              <rect width={tooltipWidth} height={tooltipHeight} rx={8} />
              <text className="trend-tooltip-value" x={10} y={18}>
                Plus bas {current.point.lowLabel}
              </text>
              <text className="trend-tooltip-date" x={10} y={34}>
                Plus haut {current.point.highLabel}
              </text>
              <text className="trend-tooltip-date" x={10} y={50}>
                {current.point.availableLabel}
              </text>
              <text className="trend-tooltip-date" x={10} y={66}>
                {current.point.dateLabel}
              </text>
            </g>
          )}
        </svg>
      </div>
    </figure>
  );
}
