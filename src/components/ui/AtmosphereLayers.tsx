'use client';

// Общие фоновые слои «гильдии» для главной и страницы /individual:
// звёзды, геометрия, созвездия, HUD-скобки, парящие символы.
// Стили живут в main.css (классы не привязаны к странице).

type BgShape = {
  top: string;
  left?: string;
  right?: string;
  size: number;
  kind: 'ring' | 'orbit' | 'diamond' | 'ring-dashed';
  tone: 'blue' | 'amber';
  duration: number;
  reverse?: boolean;
};

const BG_SHAPES: BgShape[] = [
  { top: '6%', left: '5%', size: 210, kind: 'ring', tone: 'blue', duration: 90 },
  { top: '15%', right: '9%', size: 150, kind: 'orbit', tone: 'amber', duration: 70, reverse: true },
  { top: '29%', left: '4%', size: 90, kind: 'diamond', tone: 'blue', duration: 60 },
  { top: '44%', right: '5%', size: 250, kind: 'ring-dashed', tone: 'blue', duration: 140 },
  { top: '59%', left: '7%', size: 130, kind: 'orbit', tone: 'blue', duration: 80 },
  { top: '73%', right: '6%', size: 80, kind: 'diamond', tone: 'amber', duration: 55, reverse: true },
  { top: '87%', left: '5%', size: 180, kind: 'ring', tone: 'amber', duration: 110 },
];

type Constellation = {
  cls: string;
  style: React.CSSProperties;
  points: string;
  extra: Array<[number, number]>;
};

const CONSTELLATIONS: Constellation[] = [
  {
    cls: 'const--1',
    style: { top: '10%', left: '5%' },
    points: '10,95 45,42 80,82 115,30 150,72 185,45',
    extra: [],
  },
  {
    cls: 'const--2',
    style: { top: '42%', right: '6%' },
    points: '15,62 50,55 85,66 115,60 132,96 92,106 57,96 15,62',
    extra: [[178, 30]],
  },
  {
    cls: 'const--3',
    style: { top: '76%', left: '7%' },
    points: '30,100 100,20 172,90 30,100',
    extra: [
      [60, 40],
      [140, 112],
    ],
  },
];

const HUD_MARKS = [
  { top: '4%', right: '3%', kind: 'bracket-tr' },
  { top: '26%', right: '4%', kind: 'bracket-br' },
  { top: '52%', right: '2.5%', kind: 'bracket-tr' },
  { top: '76%', right: '3%', kind: 'bracket-br' },
];

type DecoSymbol = {
  top: string;
  left?: string;
  right?: string;
  s: string;
  size: number;
  rot: number;
  accent?: boolean;
};

const DECO_SYMBOLS: DecoSymbol[] = [
  { top: '5%', left: '4%', s: '∑', size: 44, rot: -8 },
  { top: '11%', right: '6%', s: 'π', size: 34, rot: 6, accent: true },
  { top: '21%', left: '7%', s: '∫', size: 52, rot: 4 },
  { top: '29%', right: '4%', s: '√x', size: 30, rot: -5 },
  { top: '39%', left: '3%', s: 'Δ', size: 40, rot: 8, accent: true },
  { top: '47%', right: '8%', s: '∞', size: 36, rot: -6 },
  { top: '56%', left: '6%', s: '±', size: 30, rot: 5 },
  { top: '63%', right: '5%', s: 'ƒ(x)', size: 26, rot: -4, accent: true },
  { top: '72%', left: '4%', s: '≠', size: 34, rot: 7 },
  { top: '80%', right: '7%', s: 'x²', size: 30, rot: -7 },
  { top: '88%', left: '8%', s: '÷', size: 36, rot: 4, accent: true },
  { top: '94%', right: '4%', s: 'θ', size: 30, rot: -6 },
];

export default function AtmosphereLayers() {
  return (
    <>
      <div className="starfield" aria-hidden="true">
        <span className="stars stars--far" />
        <span className="stars stars--near" />
      </div>

      <div className="bg-shapes" aria-hidden="true">
        {BG_SHAPES.map((shape, i) => (
          <span
            className={`bg-shape bg-shape--${shape.kind} bg-shape--${shape.tone}`}
            key={i}
            style={{
              top: shape.top,
              left: shape.left,
              right: shape.right,
              width: shape.size,
              height: shape.size,
              animationDuration: `${shape.duration}s`,
              animationDirection: shape.reverse ? 'reverse' : 'normal',
            }}
          />
        ))}
      </div>

      <div className="constellations" aria-hidden="true">
        {CONSTELLATIONS.map((c, ci) => {
          const stars: Array<[number, number]> = c.points
            .split(' ')
            .map((p) => {
              const [x, y] = p.split(',').map(Number);
              return [x, y] as [number, number];
            })
            .concat(c.extra);
          return (
            <svg className={`const ${c.cls}`} viewBox="0 0 200 130" style={c.style} key={ci}>
              <polyline className="const-lines" points={c.points} />
              {stars.map(([cx, cy], si) => (
                <circle
                  className="const-star"
                  cx={cx}
                  cy={cy}
                  r={si % 3 === 0 ? 2.4 : 1.7}
                  style={{ animationDelay: `${si * 0.6}s` }}
                  key={si}
                />
              ))}
            </svg>
          );
        })}
      </div>

      <div className="hud-layer" aria-hidden="true">
        {HUD_MARKS.map((mark, i) => (
          <span
            className={`hud-bracket hud-bracket--${mark.kind}`}
            key={i}
            style={{ top: mark.top, right: mark.right }}
          />
        ))}
      </div>

      <div className="page-deco" aria-hidden="true">
        {DECO_SYMBOLS.map((d, i) => (
          <span
            className={`deco-sym${d.accent ? ' deco-sym--accent' : ''}`}
            key={i}
            style={{
              top: d.top,
              left: d.left,
              right: d.right,
              fontSize: d.size,
              animationDelay: `${i * 0.7}s`,
              ['--rot' as string]: `${d.rot}deg`,
            }}
          >
            {d.s}
          </span>
        ))}
      </div>
    </>
  );
}
