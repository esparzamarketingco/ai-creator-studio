/** Single-series line chart (server-rendered SVG). Each point has a hover tooltip via <title>. */
export function LineChart({ points, label, format }: { points: { x: string; y: number }[]; label: string; format: (n: number) => string }) {
  if (points.length < 2) return <p className="py-8 text-center text-sm text-ink-400">Not enough data points to chart.</p>;
  const W = 600, H = 180, P = { l: 44, r: 10, t: 10, b: 22 };
  const max = Math.max(...points.map((p) => p.y), 1);
  const x = (i: number) => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const ticks = [0, max / 2, max];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label}: ${points.length} points from ${points[0].x} to ${points.at(-1)!.x}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--color-ink-700)" strokeWidth={1} />
            <text x={P.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--color-ink-400)">{format(t)}</text>
          </g>
        ))}
        <text x={P.l} y={H - 6} fontSize={10} fill="var(--color-ink-400)">{points[0].x}</text>
        <text x={W - P.r} y={H - 6} fontSize={10} textAnchor="end" fill="var(--color-ink-400)">{points.at(-1)!.x}</text>
        <path d={d} fill="none" stroke="var(--color-gold-400)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.x}>
            <circle cx={x(i)} cy={y(p.y)} r={10} fill="transparent"><title>{`${p.x}: ${format(p.y)}`}</title></circle>
            <circle cx={x(i)} cy={y(p.y)} r={2} fill="var(--color-gold-400)" pointerEvents="none" />
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
