/**
 * Tendance miniature d'une liste : le plus bas de chaque jour relevé, sans axe. Le résumé chiffré
 * est porté par l'étiquette accessible et par les colonnes voisines du tableau.
 */
export function Sparkline({ values, label, width = 96, height = 26 }: { values: number[]; label: string; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-faint">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (index: number) => 1 + (index / (values.length - 1)) * (width - 2);
  const y = (value: number) => (max === min ? height / 2 : 2 + (1 - (value - min) / (max - min)) * (height - 4));
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return (
    <svg className="sparkline" data-series="gold" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={points} />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2} />
    </svg>
  );
}
