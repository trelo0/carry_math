import type { FinanceChartDay } from '@/lib/admin/bepaid-journal-data';

type Props = {
  days: FinanceChartDay[];
  currency: string;
};

const W = 860;
const H = 280;
const PAD = { l: 56, r: 14, t: 14, b: 30 };

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function smoothPath(points: Array<[number, number]>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function formatAxis(minor: number): string {
  const v = minor / 100;
  if (v >= 1000) return `${(v / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}k`;
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

export default function AdminFinanceChart({ days, currency }: Props) {
  const max = niceMax(days.reduce((m, d) => Math.max(m, d.site, d.product), 0));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const n = days.length;
  const x = (i: number) => PAD.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.t + innerH - (v / max) * innerH;

  const series = [
    { key: 'site' as const, color: '#2cc8f0', id: 'fin-grad-site' },
    { key: 'product' as const, color: '#8a6bff', id: 'fin-grad-product' },
  ].map((s) => {
    const pts = days.map((d, i) => [x(i), y(d[s.key])] as [number, number]);
    const line = smoothPath(pts);
    const area = pts.length > 1 ? `${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z` : '';
    return { ...s, line, area };
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => p * max);
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  return (
    <svg className="admin-fin__chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Динамика поступлений, ${currency}`}>
      <defs>
        {series.map((s) => (
          <linearGradient key={s.id} id={s.id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.38" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>

      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(120,170,255,0.16)" strokeDasharray="3 5" />
          <text x={PAD.l - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#9cb4d8">
            {formatAxis(t)}
          </text>
        </g>
      ))}

      {days.map((d, i) =>
        i % labelEvery === 0 || i === n - 1 ? (
          <text key={d.label + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#9cb4d8">
            {d.label}
          </text>
        ) : null,
      )}

      {series.map((s) =>
        s.area ? <path key={`${s.id}-a`} d={s.area} fill={`url(#${s.id})`} /> : null,
      )}
      {series.map((s) => (
        <path
          key={`${s.id}-l`}
          d={s.line}
          fill="none"
          stroke={s.color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: `drop-shadow(0 0 5px ${s.color}88)` }}
        />
      ))}
      {n <= 31
        ? series.map((s) =>
            days.map((d, i) =>
              d[s.key] > 0 ? (
                <circle key={`${s.id}-${i}`} cx={x(i)} cy={y(d[s.key])} r="3" fill="#071a44" stroke={s.color} strokeWidth="1.8">
                  <title>{`${d.label}: ${(d[s.key] / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ${currency}`}</title>
                </circle>
              ) : null,
            ),
          )
        : null}
    </svg>
  );
}
