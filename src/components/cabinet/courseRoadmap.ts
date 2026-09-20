type RoadStop = { module: number };

type RoadModule = { color: string };

const RM_STEP_X = 118;
const RM_LEFT = 100;
const RM_GAP = 88;
const RM_CANVAS_H = 336;
const DEFAULT_LANE_Y = [162, 108, 204, 128, 212, 150, 178];

export type RmPt = { x: number; y: number };
export type RoadTone = 'passed' | 'active' | 'future';

export type RoadmapGeometry = {
  moduleRanges: { start: number; end: number }[];
  moduleBreaks: Set<number>;
  rmPts: RmPt[];
  rmStart: RmPt;
  rmLast: RmPt;
  rmFinish: RmPt;
  canvasW: number;
  canvasH: number;
  laneY: number[];
};

function generateLaneY(moduleCount: number): number[] {
  if (moduleCount <= 0) return [162];
  if (moduleCount === DEFAULT_LANE_Y.length) return DEFAULT_LANE_Y;
  const out: number[] = [];
  for (let i = 0; i < moduleCount; i += 1) {
    const t = moduleCount === 1 ? 0 : i / (moduleCount - 1);
    const srcIdx = t * (DEFAULT_LANE_Y.length - 1);
    const lo = Math.floor(srcIdx);
    const hi = Math.min(DEFAULT_LANE_Y.length - 1, lo + 1);
    const frac = srcIdx - lo;
    out.push(Math.round(DEFAULT_LANE_Y[lo] + (DEFAULT_LANE_Y[hi] - DEFAULT_LANE_Y[lo]) * frac));
  }
  return out;
}

function buildModuleRanges(stops: RoadStop[]): { start: number; end: number }[] {
  if (stops.length === 0) return [];
  const moduleCount = stops[stops.length - 1].module + 1;
  const ranges: { start: number; end: number }[] = Array.from({ length: moduleCount }, () => ({
    start: 0,
    end: 0,
  }));
  let currentModule = stops[0].module;
  let start = 0;
  for (let i = 1; i <= stops.length; i += 1) {
    if (i === stops.length || stops[i].module !== currentModule) {
      ranges[currentModule] = { start, end: i - 1 };
      if (i < stops.length) {
        currentModule = stops[i].module;
        start = i;
      }
    }
  }
  return ranges;
}

function rmStopX(i: number, moduleBreaks: Set<number>): number {
  let gaps = 0;
  for (let k = 0; k < i; k += 1) if (moduleBreaks.has(k)) gaps += 1;
  return RM_LEFT + i * RM_STEP_X + gaps * RM_GAP;
}

function rmStopY(
  i: number,
  stop: RoadStop,
  moduleRanges: { start: number; end: number }[],
  laneY: number[],
): number {
  const range = moduleRanges[stop.module] ?? { start: i, end: i };
  const span = Math.max(1, range.end - range.start);
  const t = (i - range.start) / span;
  const ease = t * t * (3 - 2 * t);
  const y0 = laneY[stop.module] ?? 162;
  const y1 = stop.module < laneY.length - 1 ? (laneY[stop.module + 1] ?? y0) : y0;
  return Math.round(y0 + (y1 - y0) * ease);
}

export function buildRoadmapGeometry(stops: RoadStop[], moduleCount: number): RoadmapGeometry {
  const laneY = generateLaneY(Math.max(moduleCount, 1));
  const moduleRanges = buildModuleRanges(stops);
  const moduleBreaks = new Set(
    stops.slice(0, -1).map((s, i) => (s.module !== stops[i + 1].module ? i : -1)).filter((i) => i >= 0),
  );
  const rmPts = stops.map((s, i) => ({
    x: rmStopX(i, moduleBreaks),
    y: rmStopY(i, s, moduleRanges, laneY),
  }));
  const rmLast = rmPts[rmPts.length - 1] ?? { x: RM_LEFT, y: laneY[0] };
  const rmStart: RmPt = { x: 28, y: laneY[0] };
  const rmFinish: RmPt = { x: rmLast.x + 72, y: laneY[laneY.length - 1] ?? laneY[0] };
  const canvasW =
    stops.length > 0
      ? RM_LEFT * 2 + (stops.length - 1) * RM_STEP_X + moduleBreaks.size * RM_GAP + 110
      : RM_LEFT * 2 + 110;

  return {
    moduleRanges,
    moduleBreaks,
    rmPts,
    rmStart,
    rmLast,
    rmFinish,
    canvasW,
    canvasH: RM_CANVAS_H,
    laneY,
  };
}

export function rmDensePath(pts: RmPt[]): string {
  if (pts.length < 2) return '';
  let d = '';
  for (let k = 0; k < pts.length - 1; k += 1) {
    const a = pts[Math.max(0, k - 1)];
    const b = pts[k];
    const c = pts[k + 1];
    const e = pts[Math.min(pts.length - 1, k + 2)];
    const steps = 10;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * b.x + (-a.x + c.x) * t + (2 * a.x - 5 * b.x + 4 * c.x - e.x) * t2 + (-a.x + 3 * b.x - 3 * c.x + e.x) * t3);
      const y = 0.5 * (2 * b.y + (-a.y + c.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - e.y) * t2 + (-a.y + 3 * b.y - 3 * c.y + e.y) * t3);
      d += `${k === 0 && s === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    }
  }
  return d.trim();
}

export function rmPathSlice(
  rmPts: RmPt[],
  rmStart: RmPt,
  rmFinish: RmPt,
  laneY: number[],
  from: number,
  to: number,
  lead?: RmPt[],
  tail?: RmPt[],
): string {
  const pts: RmPt[] = [...(lead ?? []), ...rmPts.slice(from, to + 1), ...(tail ?? [])];
  if (pts.length < 2) return '';
  return rmDensePath(pts);
}

export function rmSegTone(segIndex: number, nowIndex: number, locked: boolean): RoadTone {
  if (locked) return 'future';
  if (nowIndex < 0) return 'future';
  if (segIndex < nowIndex - 1) return 'passed';
  if (segIndex <= nowIndex) return 'active';
  return 'future';
}

export function rmStopTone(stopIndex: number, nowIndex: number, locked: boolean): RoadTone {
  if (locked) return 'future';
  if (nowIndex < 0) return 'future';
  if (stopIndex < nowIndex) return 'passed';
  if (stopIndex === nowIndex) return 'active';
  return 'future';
}

export function buildRoadSegments(
  stops: RoadStop[],
  geometry: RoadmapGeometry,
  nowIndex: number,
  locked: boolean,
): { d: string; tone: RoadTone }[] {
  const { rmPts, rmStart, rmFinish, laneY } = geometry;
  const lastSeg = stops.length - 2;
  if (lastSeg < 0) return [];
  const segments: { d: string; tone: RoadTone }[] = [];
  let i = 0;
  while (i <= lastSeg) {
    const tone = rmSegTone(i, nowIndex, locked);
    let j = i;
    while (j < lastSeg && rmSegTone(j + 1, nowIndex, locked) === tone) j += 1;
    const lead = i === 0 ? [rmStart, { x: rmPts[0].x - 24, y: rmPts[0].y }] : undefined;
    const tail =
      j === lastSeg
        ? [{ x: geometry.rmLast.x + 34, y: geometry.rmLast.y }, rmFinish]
        : undefined;
    segments.push({
      d: rmPathSlice(rmPts, rmStart, rmFinish, laneY, i, j + 1, lead, tail),
      tone,
    });
    i = j + 1;
  }
  return segments;
}

export function moduleColorAt(modules: RoadModule[], moduleIndex: number): string {
  return modules[moduleIndex]?.color ?? '#4f7cff';
}
