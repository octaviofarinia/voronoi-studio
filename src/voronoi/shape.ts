// Sheets in any shape, such as an outline imported from an SVG, holes included. A shape is stored scaled to
// its bounding box (0–1 both ways), so it stretches with the sheet's width and height the way the ellipse does.
// Clipper2 does the polygon work (union, offsets, intersections). A grid of the outline's edges answers "is
// this point inside?" and "does the outline cross this box?" quickly, since seeding and clipping ask often.
// Rings follow geometry.ts: outer outlines have positive area, holes negative, and the last point isn't repeated.
import {
  booleanOpDWithPolyTree, ClipType, differenceD, EndType, FillRule, inflatePathsD, intersectD, JoinType, PolyTreeD, rectClip,
  simplifyPathsD, unionD, type PathD, type PathsD, type PolyPathD,
} from 'clipper2-ts'
import { perimeter, signedArea, type Polygon, type Segment, type Vec } from './geometry'

export type CustomShape = {
  name: string // where it came from, such as the file name
  width: number; height: number // its size when imported, in mm
  sized: 'file' | 'css' | 'illustrator' // whether the file gave its size, or 96 or 72 units per inch were assumed
  rings: number[][] // flat x, y pairs scaled to the bounding box, 0–1
}
export class ShapeError extends Error {}

const PRECISION = 4 // Clipper rounds to 0.1 µm
const ARC_TOLERANCE = 0.005 // mm: how far round offsets may stray from a true arc
export const MAX_SHAPE_POINTS = 20_000

const toPath = (poly: Polygon): PathD => poly.map(([x, y]) => ({ x, y }))
const toPaths = (rings: Polygon[]): PathsD => rings.map(toPath)
const fromPaths = (paths: PathsD): Polygon[] =>
  paths.filter(p => p.length >= 3).map(p => p.map(({ x, y }): Vec => [x, y])).filter(p => Math.abs(signedArea(p)) > 1e-9)

export type Box = [number, number, number, number] // x0, y0, x1, y1
export function boxOf(rings: Polygon[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const ring of rings) for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 0, 0]
}
const overlaps = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
const pointCount = (rings: Polygon[]) => rings.reduce((n, r) => n + r.length, 0)

// ---------- building shapes ----------

// A shape from closed outlines in millimetres. Outlines inside others become holes, the way laser software
// reads nested cut lines, and overlapping outlines cancel out where they overlap (even-odd).
export function shapeFromOutlines(outlines: Polygon[], name: string, sized: CustomShape['sized'] = 'file'): CustomShape {
  let rings = fromPaths(unionD(toPaths(outlines), FillRule.EvenOdd))
  let tolerance = 0.002
  rings = fromPaths(simplifyPathsD(toPaths(rings), tolerance, true))
  while (pointCount(rings) > MAX_SHAPE_POINTS && tolerance < 2) {
    tolerance *= 2
    rings = fromPaths(simplifyPathsD(toPaths(rings), tolerance, true))
  }
  const [x0, y0, x1, y1] = boxOf(rings)
  const w = x1 - x0, h = y1 - y0
  if (!rings.length || w < 1 || h < 1) throw new ShapeError('El contorno de este SVG es demasiado pequeño para usarlo como lámina (menos de 1 mm).')
  const round = (v: number) => Math.round(v * 1e6) / 1e6
  return { name, width: w, height: h, sized, rings: rings.map(ring => ring.flatMap(([x, y]) => [round((x - x0) / w), round((y - y0) / h)])) }
}

// Shapes from files and saved sessions are untrusted: anything malformed becomes null.
export function sanitizeShape(raw: unknown): CustomShape | null {
  if (!raw || typeof raw !== 'object') return null
  const { name, width, height, sized, rings } = raw as Record<string, unknown>
  if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0) || !Array.isArray(rings) || !rings.length) return null
  let total = 0
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2) return null
    total += ring.length / 2
    if (total > MAX_SHAPE_POINTS) return null
    if (!ring.every(v => typeof v === 'number' && Number.isFinite(v) && v >= -0.001 && v <= 1.001)) return null
  }
  return {
    name: typeof name === 'string' ? name.slice(0, 120) : 'Forma importada', width, height,
    sized: sized === 'css' || sized === 'illustrator' ? sized : 'file', rings: rings as number[][],
  }
}

// The shape at a sheet size, in millimetres. Cached so the same size gives the same array, which the other
// caches here are keyed on.
const scaled = new WeakMap<CustomShape, { w: number; h: number; rings: Polygon[] }>()
export function shapeRings(shape: CustomShape, width: number, height: number): Polygon[] {
  const hit = scaled.get(shape)
  if (hit && hit.w === width && hit.h === height) return hit.rings
  const rings = shape.rings.map(flat => {
    const ring: Polygon = []
    for (let i = 0; i + 1 < flat.length; i += 2) ring.push([flat[i] * width, flat[i + 1] * height])
    return ring
  })
  scaled.set(shape, { w: width, h: height, rings })
  return rings
}

// ---------- polygon operations ----------

// Grow (delta > 0) or shrink (delta < 0) every outline, holes the other way. Round corners keep a border the
// same width all round; miter corners stay sharp.
export function offset(rings: Polygon[], delta: number, join: 'round' | 'miter' = 'round'): Polygon[] {
  if (Math.abs(delta) < 1e-12) return rings
  const type = join === 'round' ? JoinType.Round : JoinType.Miter
  return fromPaths(inflatePathsD(toPaths(rings), delta, type, EndType.Polygon, 2, PRECISION, ARC_TOLERANCE))
}

const offsets = new WeakMap<Polygon[], Map<number, Polygon[]>>()
export function cachedOffset(rings: Polygon[], delta: number): Polygon[] {
  if (Math.abs(delta) < 1e-12) return rings
  let byDelta = offsets.get(rings)
  if (!byDelta) offsets.set(rings, (byDelta = new Map()))
  const hit = byDelta.get(delta)
  if (hit) return hit
  const out = offset(rings, delta)
  if (byDelta.size > 24) byDelta.clear()
  byDelta.set(delta, out)
  return out
}

export const difference = (a: Polygon[], b: Polygon[]) => fromPaths(differenceD(toPaths(a), toPaths(b), FillRule.NonZero, PRECISION))

// Outer outlines with their holes, from a set of rings.
export function groupRings(rings: Polygon[]): { outer: Polygon; holes: Polygon[] }[] {
  const tree = new PolyTreeD()
  booleanOpDWithPolyTree(ClipType.Union, toPaths(rings), null, tree, FillRule.NonZero, PRECISION)
  const out: { outer: Polygon; holes: Polygon[] }[] = []
  // Children of an outline are its holes; children of a hole are islands, which are outlines again.
  const visitOuter = (node: PolyPathD) => {
    const outer = node.poly ? fromPaths([node.poly])[0] : undefined
    const holes: Polygon[] = []
    for (let j = 0; j < node.count; j++) {
      const hole = node.child(j)
      if (hole.poly) holes.push(...fromPaths([hole.poly]))
      for (let k = 0; k < hole.count; k++) visitOuter(hole.child(k))
    }
    if (outer) out.push({ outer, holes })
  }
  for (let i = 0; i < tree.count; i++) visitOuter(tree.child(i))
  return out
}

export const ringsArea = (rings: Polygon[]) => rings.reduce((a, r) => a + signedArea(r), 0)
export const holeCount = (shape: CustomShape) => shape.rings.filter(flat => {
  let a = 0
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) a += flat[j] * flat[i + 1] - flat[i] * flat[j + 1]
  return a < 0
}).length
export const ringsPerimeter = (rings: Polygon[]) => rings.reduce((a, r) => a + perimeter(r), 0)

// ---------- the edge grid ----------

export class ShapeIndex {
  readonly rings: Polygon[]
  readonly box: Box
  private readonly ex0: Float64Array; private readonly ey0: Float64Array
  private readonly ex1: Float64Array; private readonly ey1: Float64Array
  private readonly cols: number; private readonly rows: number
  private readonly cw: number; private readonly ch: number
  private readonly buckets: Int32Array[]
  private readonly stamp: Int32Array
  private tick = 0
  private readonly ringBoxes: Box[]
  private paths: PathsD | null = null

  constructor(rings: Polygon[]) {
    this.rings = rings
    this.box = boxOf(rings)
    this.ringBoxes = rings.map(r => boxOf([r]))
    const n = pointCount(rings)
    this.ex0 = new Float64Array(n); this.ey0 = new Float64Array(n); this.ex1 = new Float64Array(n); this.ey1 = new Float64Array(n)
    let k = 0
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length]
        this.ex0[k] = a[0]; this.ey0[k] = a[1]; this.ex1[k] = b[0]; this.ey1[k] = b[1]; k++
      }
    }
    const [x0, y0, x1, y1] = this.box
    const w = Math.max(1e-9, x1 - x0), h = Math.max(1e-9, y1 - y0)
    const side = Math.max(4, Math.min(256, Math.round(Math.sqrt(n))))
    this.cols = Math.max(1, Math.round(side * Math.sqrt(w / h))); this.rows = Math.max(1, Math.round(side * Math.sqrt(h / w)))
    this.cw = w / this.cols; this.ch = h / this.rows
    const lists: number[][] = Array.from({ length: this.cols * this.rows }, () => [])
    for (let e = 0; e < n; e++) {
      const [c0, r0] = this.cell(Math.min(this.ex0[e], this.ex1[e]), Math.min(this.ey0[e], this.ey1[e]))
      const [c1, r1] = this.cell(Math.max(this.ex0[e], this.ex1[e]), Math.max(this.ey0[e], this.ey1[e]))
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lists[r * this.cols + c].push(e)
    }
    this.buckets = lists.map(l => Int32Array.from(l))
    this.stamp = new Int32Array(n)
  }

  private cell(x: number, y: number): [number, number] {
    return [
      Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.box[0]) / this.cw))),
      Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.box[1]) / this.ch))),
    ]
  }

  // Even-odd ray cast to the right, through only the grid row the point is in.
  contains(x: number, y: number): boolean {
    const [x0, y0, x1, y1] = this.box
    if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1)) return false
    const [col, row] = this.cell(x, y)
    const tick = ++this.tick
    let inside = false
    for (let c = col; c < this.cols; c++) {
      for (const e of this.buckets[row * this.cols + c]) {
        if (this.stamp[e] === tick) continue
        this.stamp[e] = tick
        const ay = this.ey0[e], by = this.ey1[e]
        if ((ay > y) === (by > y)) continue
        const xi = this.ex0[e] + ((y - ay) * (this.ex1[e] - this.ex0[e])) / (by - ay)
        if (xi > x) inside = !inside
      }
    }
    return inside
  }

  // Visit each edge that might touch the box, once.
  private near(box: Box, visit: (e: number) => boolean | void): void {
    if (!overlaps(box, this.box)) return
    const [c0, r0] = this.cell(box[0], box[1]), [c1, r1] = this.cell(box[2], box[3])
    const tick = ++this.tick
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const e of this.buckets[r * this.cols + c]) {
          if (this.stamp[e] === tick) continue
          this.stamp[e] = tick
          if (visit(e) === true) return
        }
      }
    }
  }

  // Whether any outline edge enters the box.
  crosses(box: Box): boolean {
    let hit = false
    this.near(box, e => {
      if (segmentHitsBox(this.ex0[e], this.ey0[e], this.ex1[e], this.ey1[e], box)) { hit = true; return true }
    })
    return hit
  }

  // A convex cell clipped to the shape: the cell itself when it is wholly inside, null when wholly outside,
  // and otherwise the pieces Clipper finds (holes included).
  clipCell(poly: Polygon): Polygon[] | null {
    if (poly.length < 3) return null
    const box = boxOf([poly])
    if (!this.crosses(box)) {
      let sx = 0, sy = 0
      for (const [x, y] of poly) { sx += x; sy += y }
      return this.contains(sx / poly.length, sy / poly.length) ? [poly] : null
    }
    // Only outlines near the cell matter; long ones are first cut down to the cell's box.
    const pad = 1e-3 * Math.max(box[2] - box[0], box[3] - box[1], 1e-6)
    const rect = { left: box[0] - pad, top: box[1] - pad, right: box[2] + pad, bottom: box[3] + pad }
    const paths = this.paths ?? (this.paths = toPaths(this.rings))
    const local: PathsD = []
    this.rings.forEach((ring, i) => {
      if (!overlaps(this.ringBoxes[i], box)) return
      if (ring.length <= 48) local.push(paths[i])
      else local.push(...rectClip(rect, paths[i], PRECISION))
    })
    if (!local.length) return null
    const pieces = fromPaths(intersectD([toPath(poly)], local, FillRule.EvenOdd, PRECISION))
    return pieces.length ? pieces : null
  }

  // The parts of a segment inside the shape.
  clipSegment(s: Segment): Segment[] {
    const [ax, ay, bx, by] = s
    const box: Box = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
    const ts: number[] = [0, 1]
    const dx = bx - ax, dy = by - ay
    this.near(box, e => {
      const ex = this.ex1[e] - this.ex0[e], ey = this.ey1[e] - this.ey0[e]
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-18) return
      const qx = this.ex0[e] - ax, qy = this.ey0[e] - ay
      const t = (qx * ey - qy * ex) / den, u = (qx * dy - qy * dx) / den
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t)
    })
    if (ts.length === 2) return this.contains(ax + dx / 2, ay + dy / 2) ? [s] : []
    ts.sort((p, q) => p - q)
    const out: Segment[] = []
    for (let i = 0; i + 1 < ts.length; i++) {
      const t0 = ts[i], t1 = ts[i + 1]
      if (t1 - t0 < 1e-9) continue
      const m = (t0 + t1) / 2
      if (!this.contains(ax + dx * m, ay + dy * m)) continue
      const last = out[out.length - 1]
      const sx = ax + dx * t0, sy = ay + dy * t0
      if (last && Math.abs(last[2] - sx) < 1e-12 && Math.abs(last[3] - sy) < 1e-12) { last[2] = ax + dx * t1; last[3] = ay + dy * t1 }
      else out.push([sx, sy, ax + dx * t1, ay + dy * t1])
    }
    return out
  }

  // The nearest point inside the shape, nudged just past the outline.
  nearestInside(x: number, y: number): Vec {
    if (this.contains(x, y)) return [x, y]
    let best = Infinity, px = x, py = y, nx = 0, ny = 0
    for (let e = 0; e < this.ex0.length; e++) {
      const ax = this.ex0[e], ay = this.ey0[e], ex = this.ex1[e] - ax, ey = this.ey1[e] - ay
      const len2 = ex * ex + ey * ey
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / len2)) : 0
      const qx = ax + ex * t, qy = ay + ey * t
      const d = (qx - x) ** 2 + (qy - y) ** 2
      if (d < best) { best = d; px = qx; py = qy; const l = Math.sqrt(len2) || 1; nx = -ey / l; ny = ex / l }
    }
    const step = 1e-6 * Math.max(1, this.box[2] - this.box[0], this.box[3] - this.box[1])
    for (const k of [1, -1, 10, -10, 100, -100]) {
      const qx = px + nx * step * k, qy = py + ny * step * k
      if (this.contains(qx, qy)) return [qx, qy]
    }
    return [px, py]
  }
}

// Liang–Barsky: does the segment touch the box?
function segmentHitsBox(x0: number, y0: number, x1: number, y1: number, [bx0, by0, bx1, by1]: Box): boolean {
  let t0 = 0, t1 = 1
  const dx = x1 - x0, dy = y1 - y0
  const edges: [number, number][] = [[-dx, x0 - bx0], [dx, bx1 - x0], [-dy, y0 - by0], [dy, by1 - y0]]
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-18) { if (q < 0) return false; continue }
    const r = q / p
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r }
    else { if (r < t0) return false; if (r < t1) t1 = r }
  }
  return true
}

const indexes = new WeakMap<Polygon[], ShapeIndex>()
export function shapeIndex(rings: Polygon[]): ShapeIndex {
  let index = indexes.get(rings)
  if (!index) indexes.set(rings, (index = new ShapeIndex(rings)))
  return index
}
