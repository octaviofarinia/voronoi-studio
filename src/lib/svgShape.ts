// Reads the closed outlines in an SVG file, so a drawing can become the sheet's shape. Plain TypeScript with
// no DOM, so it runs in tests too. Curves and arcs are flattened into short straight segments, transforms are
// applied, and everything is converted to millimetres using the file's own size. A file that is only a picture
// trimmed by a clipping mask, as Illustrator saves a shape it can't write as SVG, gives the mask's outline.
import type { Polygon, Vec } from '../voronoi/geometry'

export type SvgUnits = 'file' | 'css' | 'illustrator'
export type SvgOutlines = {
  rings: Polygon[] // closed outlines in millimetres, in file order
  units: SvgUnits // 'file': the file gives its size; 'css': assumed 96 per inch; 'illustrator': assumed 72 per inch
  open: number // open paths that were left out because they don't enclose anything
  // True when the file draws no closed shapes, only pictures, and the rings are the outlines of the clipping
  // masks that trim them. Illustrator saves a shape it can't write as SVG this way: a picture of it, clipped to its outline.
  fromClip: boolean
}
export class SvgShapeError extends Error {}

// Illustrator saves a shape as a picture when SVG can't describe its look: a freeform gradient, a mesh or an effect.
export const PICTURE_ONLY = 'Este SVG solo contiene una imagen, sin líneas. En Illustrator, selecciona la forma, haz clic en Borrar apariencia '
  + 'en el panel Apariencia, agrega un trazo y vuelve a exportar.'

const MM: Record<string, number> = { mm: 1, cm: 10, q: 0.25, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 }
// Elements whose contents are never drawn directly, or aren't outlines.
const SKIP = new Set(['defs', 'symbol', 'clippath', 'mask', 'pattern', 'marker', 'style', 'script', 'title', 'desc', 'metadata',
  'text', 'foreignobject', 'lineargradient', 'radialgradient', 'filter', 'image', 'switch'])
// Of those, the ones that are only ever drawn where something else refers to them.
const UNDRAWN = new Set(['defs', 'symbol', 'clippath', 'mask', 'pattern', 'marker', 'style', 'script', 'title', 'desc', 'metadata',
  'lineargradient', 'radialgradient', 'filter'])
const MAX_POINTS = 200_000
const TOO_DETAILED = 'Este SVG tiene demasiados detalles para usarlo como forma. Simplifícalo y vuelve a intentarlo.'

type Matrix = [number, number, number, number, number, number] // x' = a x + c y + e, y' = b x + d y + f
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
]
const apply = (m: Matrix, [x, y]: Vec): Vec => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
const matrixScale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
const STICKY_NUMBER = new RegExp(NUMBER.source, 'y')
const numbers = (text: string) => (text.match(NUMBER) ?? []).map(Number)

export function parseTransform(text: string | undefined): Matrix {
  let m = IDENTITY
  if (!text) return m
  for (const [, name, args] of text.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const v = numbers(args)
    let t: Matrix = IDENTITY
    if (name === 'matrix' && v.length >= 6) t = [v[0], v[1], v[2], v[3], v[4], v[5]]
    else if (name === 'translate') t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]
    else if (name === 'scale') t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]
    else if (name === 'rotate') {
      const a = ((v[0] ?? 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a)
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0]
      t = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy])
    } else if (name === 'skewX') t = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0]
    else if (name === 'skewY') t = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]
    m = multiply(m, t)
  }
  return m
}

// ---------- path data ----------

type Subpath = { points: Vec[]; closed: boolean }

function cubic(out: Vec[], p0: Vec, p1: Vec, p2: Vec, p3: Vec, tol: number, depth = 0) {
  // Flat enough when both control points are within tol of the chord.
  const dx = p3[0] - p0[0], dy = p3[1] - p0[1], len = Math.hypot(dx, dy)
  const d1 = len > 1e-12 ? Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) / len : Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
  const d2 = len > 1e-12 ? Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx) / len : Math.hypot(p2[0] - p0[0], p2[1] - p0[1])
  if (depth >= 16 || Math.max(d1, d2) <= tol) { out.push(p3); return }
  const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const a = mid(p0, p1), b = mid(p1, p2), c = mid(p2, p3), ab = mid(a, b), bc = mid(b, c), m = mid(ab, bc)
  cubic(out, p0, a, ab, m, tol, depth + 1)
  cubic(out, m, bc, c, p3, tol, depth + 1)
}

// SVG's endpoint arc, turned into points (SVG spec, appendix F.6).
function arc(out: Vec[], p0: Vec, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, p1: Vec, tol: number) {
  rx = Math.abs(rx); ry = Math.abs(ry)
  if (rx < 1e-12 || ry < 1e-12 || (p0[0] === p1[0] && p0[1] === p1[1])) { out.push(p1); return }
  const phi = (rotation * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi)
  const hx = (p0[0] - p1[0]) / 2, hy = (p0[1] - p1[1]) / 2
  const x1 = cos * hx + sin * hy, y1 = -sin * hx + cos * hy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda) }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cxp = (k * rx * y1) / ry, cyp = (-k * ry * x1) / rx
  const cx = cos * cxp - sin * cyp + (p0[0] + p1[0]) / 2, cy = sin * cxp + cos * cyp + (p0[1] + p1[1]) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t0 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
  let dt = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
  if (!sweep && dt > 0) dt -= Math.PI * 2
  if (sweep && dt < 0) dt += Math.PI * 2
  const r = Math.max(rx, ry)
  const step = tol < r ? 2 * Math.acos(1 - tol / r) : Math.PI / 2
  const n = Math.min(1000, Math.max(1, Math.ceil(Math.abs(dt) / step)))
  for (let i = 1; i <= n; i++) {
    const t = t0 + (dt * i) / n
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t)
    out.push(i === n ? p1 : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy])
  }
}

export function parsePathData(d: string, tol: number): Subpath[] {
  const subpaths: Subpath[] = []
  let i = 0
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++ }
  const peekNumber = () => { skip(); return i < d.length && /[+\-.\d]/.test(d[i]) }
  const readNumber = () => {
    skip()
    STICKY_NUMBER.lastIndex = i
    const m = STICKY_NUMBER.exec(d)
    if (!m) throw new SvgShapeError('Un trazado de este SVG contiene datos dañados.')
    i += m[0].length
    return Number(m[0])
  }
  const readFlag = () => { skip(); const c = d[i++]; if (c !== '0' && c !== '1') throw new SvgShapeError('Un trazado de este SVG contiene un arco dañado.'); return c === '1' }

  // Asserted, not annotated: the helpers below reassign it, which narrowing can't see.
  let current = null as Subpath | null
  let x = 0, y = 0, startX = 0, startY = 0
  let lastCtrl: Vec | null = null, lastQuad: Vec | null = null
  let command = ''
  const begin = (px: number, py: number) => {
    if (current && current.points.length) subpaths.push(current)
    current = { points: [[px, py]], closed: false }
    startX = px; startY = py
  }
  const lineTo = (px: number, py: number) => { if (!current) begin(x, y); current!.points.push([px, py]) }

  while (i < d.length) {
    skip()
    if (i >= d.length) break
    if (/[A-Za-z]/.test(d[i])) command = d[i++]
    else if (!command) throw new SvgShapeError('Un trazado de este SVG contiene datos dañados.')
    const rel = command === command.toLowerCase()
    const C = command.toUpperCase()
    const ox = rel ? x : 0, oy = rel ? y : 0
    switch (C) {
      case 'M': {
        const px = readNumber() + ox, py = readNumber() + oy
        begin(px, py); x = px; y = py
        command = rel ? 'l' : 'L' // later pairs are line-tos
        lastCtrl = lastQuad = null
        break
      }
      case 'L': { const px = readNumber() + ox, py = readNumber() + oy; lineTo(px, py); x = px; y = py; lastCtrl = lastQuad = null; break }
      case 'H': { const px = readNumber() + ox; lineTo(px, y); x = px; lastCtrl = lastQuad = null; break }
      case 'V': { const py = readNumber() + oy; lineTo(x, py); y = py; lastCtrl = lastQuad = null; break }
      case 'C': case 'S': {
        let c1: Vec
        if (C === 'C') c1 = [readNumber() + ox, readNumber() + oy]
        else c1 = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y]
        const c2: Vec = [readNumber() + ox, readNumber() + oy], p: Vec = [readNumber() + ox, readNumber() + oy]
        if (!current) begin(x, y)
        cubic(current!.points, [x, y], c1, c2, p, tol)
        lastCtrl = c2; lastQuad = null; x = p[0]; y = p[1]
        break
      }
      case 'Q': case 'T': {
        let q: Vec
        if (C === 'Q') q = [readNumber() + ox, readNumber() + oy]
        else q = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y]
        const p: Vec = [readNumber() + ox, readNumber() + oy]
        if (!current) begin(x, y)
        cubic(current!.points, [x, y], [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)], [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p, tol)
        lastQuad = q; lastCtrl = null; x = p[0]; y = p[1]
        break
      }
      case 'A': {
        const rx = readNumber(), ry = readNumber(), rotation = readNumber(), large = readFlag(), sweep = readFlag()
        const p: Vec = [readNumber() + ox, readNumber() + oy]
        if (!current) begin(x, y)
        arc(current!.points, [x, y], rx, ry, rotation, large, sweep, p, tol)
        x = p[0]; y = p[1]; lastCtrl = lastQuad = null
        break
      }
      case 'Z': {
        if (current) { current.closed = true; subpaths.push(current); current = null }
        x = startX; y = startY; lastCtrl = lastQuad = null
        command = '' // a number right after Z is an error, but a new command letter is fine
        continue
      }
      default: throw new SvgShapeError(`Este SVG usa un comando de trazado (${command}) que no pertenece al formato SVG.`)
    }
    // More numbers without a letter repeat the same command; otherwise the next letter is read.
    if (!peekNumber() && i < d.length && !/[A-Za-z]/.test(d[i])) throw new SvgShapeError('Un trazado de este SVG contiene datos dañados.')
  }
  if (current && current.points.length) subpaths.push(current)
  return subpaths
}

// ---------- elements ----------

type Attributes = Record<string, string>
const ATTRIBUTE = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
function attributesOf(text: string): Attributes {
  const out: Attributes = {}
  for (const m of text.matchAll(ATTRIBUTE)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
  return out
}
const hidden = (a: Attributes) => /(^|;)\s*display\s*:\s*none/i.test(a.style ?? '') || a.display === 'none'

// ---------- clipping paths ----------

const urlId = (text: string) => /url\(\s*['"]?#([^'")\s]+)/.exec(text)?.[1] ?? null
const clipInCss = (text: string) => { const m = /clip-path\s*:\s*([^;]*)/i.exec(text); return m ? urlId(m[1]) : null }

// Classes that set a clipping path in the file's style sheets. Illustrator writes them this way:
// .cls-2 { clip-path: url(#clippath); }
function clipClasses(text: string): Map<string, string> {
  const out = new Map<string, string>()
  const css = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  for (const [, sheet] of css.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const [, selectors, rules] of sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const id = clipInCss(rules)
      if (id) for (const selector of selectors.split(',')) { const c = /^\s*\.([\w-]+)\s*$/.exec(selector); if (c) out.set(c[1], id) }
    }
  }
  return out
}

// The clipping path an element uses, by its style, its class or its clip-path attribute.
function clipOf(a: Attributes, byClass: Map<string, string>): string | null {
  const inStyle = a.style ? clipInCss(a.style) : null
  if (inStyle) return inStyle
  for (const c of (a.class ?? '').split(/\s+/).reverse()) { const id = byClass.get(c); if (id) return id }
  return a['clip-path'] ? urlId(a['clip-path']) : null
}

// A length in millimetres, or null when it's missing or a percentage.
function lengthMm(text: string | undefined): number | null {
  if (!text) return null
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(text)
  if (!m) return null
  const unit = m[2].toLowerCase()
  if (!(unit in MM)) return null
  return Number(m[1]) * MM[unit]
}
const unitOf = (text: string | undefined) => /([a-zA-Z%]*)\s*$/.exec(text ?? '')?.[1].toLowerCase() ?? ''

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, tol: number): Vec[] {
  const r = Math.max(rx, ry)
  const step = tol < r ? 2 * Math.acos(1 - tol / r) : Math.PI / 2
  const n = Math.min(2000, Math.max(8, Math.ceil((Math.PI * 2) / step)))
  return Array.from({ length: n }, (_, i): Vec => [cx + rx * Math.cos((i / n) * Math.PI * 2), cy + ry * Math.sin((i / n) * Math.PI * 2)])
}

function rectPoints(a: Attributes, tol: number): Vec[] | null {
  const x = Number(a.x ?? 0) || 0, y = Number(a.y ?? 0) || 0, w = Number(a.width), h = Number(a.height)
  if (!(w > 0 && h > 0)) return null
  let rx = a.rx !== undefined ? Number(a.rx) : NaN, ry = a.ry !== undefined ? Number(a.ry) : NaN
  if (!Number.isFinite(rx)) rx = Number.isFinite(ry) ? ry : 0
  if (!Number.isFinite(ry)) ry = rx
  rx = Math.min(Math.max(0, rx), w / 2); ry = Math.min(Math.max(0, ry), h / 2)
  if (rx < 1e-12 || ry < 1e-12) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
  const d = `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}`
    + `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
  return parsePathData(d, tol)[0]?.points ?? null
}

// Closed outlines from one element, in its own coordinates. Open paths count as closed when their ends meet.
// In a clipping path, a filled area, every part counts as closed.
function outlinesOf(name: string, a: Attributes, tol: number, filled = false): { rings: Vec[][]; open: number } {
  const rings: Vec[][] = []
  let open = 0
  const add = (points: Vec[], closed: boolean) => {
    if (points.length < 2) return
    const first = points[0], last = points[points.length - 1]
    const meets = Math.hypot(first[0] - last[0], first[1] - last[1]) <= tol * 4
    if (!closed && !meets && !filled) { open++; return }
    const ring = meets ? points.slice(0, -1) : points
    if (ring.length >= 3) rings.push(ring)
  }
  if (name === 'path' && a.d) for (const sub of parsePathData(a.d, tol)) add(sub.points, sub.closed)
  else if (name === 'rect') { const p = rectPoints(a, tol); if (p) add(p, true) }
  else if (name === 'circle') { const r = Number(a.r); if (r > 0) add(ellipsePoints(Number(a.cx ?? 0) || 0, Number(a.cy ?? 0) || 0, r, r, tol), true) }
  else if (name === 'ellipse') {
    const rx = Number(a.rx), ry = Number(a.ry ?? a.rx)
    if (rx > 0 && ry > 0) add(ellipsePoints(Number(a.cx ?? 0) || 0, Number(a.cy ?? 0) || 0, rx, ry, tol), true)
  } else if (name === 'polygon' || name === 'polyline') {
    const v = numbers(a.points ?? '')
    const points: Vec[] = []
    for (let k = 0; k + 1 < v.length; k += 2) points.push([v[k], v[k + 1]])
    add(points, name === 'polygon')
  } else if (name === 'line' && !filled) open++
  return { rings, open }
}

// All closed outlines in a file, in millimetres. tolerance: how far flattened curves may stray, in mm.
export function readSvgOutlines(text: string, tolerance = 0.02): SvgOutlines {
  if (!/<svg[\s>]/i.test(text)) throw new SvgShapeError('Este archivo no es un dibujo SVG.')
  const illustrator = /Adobe Illustrator/i.test(text) || /data-name\s*=/.test(text)
  const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '')

  const rings: Polygon[] = []
  let open = 0, total = 0, units: SvgUnits = 'css'
  let rootScale = 0 // millimetres per user unit
  let rootM = IDENTITY
  // Clipping paths, in their own coordinates, and where each is used. They're placed in the user space of the
  // element that uses them, so they only become rings at the end, if the file has no closed shapes of its own.
  const clipClass = clipClasses(text)
  const clips = new Map<string, Vec[][]>()
  const clipUses: { id: string; m: Matrix }[] = []
  let clipTotal = 0, pictures = 0
  // clip: the clipping path whose outline this element is part of
  type Frame = { name: string; m: Matrix; skip: boolean; clip: string | null }
  const stack: Frame[] = []
  for (const tag of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, rawName, rest, selfClosing] = tag
    const name = rawName.toLowerCase().replace(/^svg:/, '')
    if (closing) {
      // Pop back to the matching element; stray closing tags are ignored.
      const at = stack.map(f => f.name).lastIndexOf(name)
      if (at >= 0) stack.length = at
      continue
    }
    const a = attributesOf(rest)
    const parent = stack[stack.length - 1]
    let m = parent ? parent.m : IDENTITY
    const skip = Boolean(parent?.skip) || SKIP.has(name) || hidden(a)
    let clip: string | null = null
    if (name === 'clippath') {
      // objectBoundingBox clips are sized to whatever uses them, so they give no outline of their own.
      clip = a.clippathunits?.toLowerCase() === 'objectboundingbox' || hidden(a) ? null : a.id ?? null
      m = IDENTITY
    } else if (parent?.clip && !SKIP.has(name) && !hidden(a)) clip = parent.clip
    if (name === 'image' && !parent?.skip && !hidden(a)) pictures++
    if (name === 'svg' && !parent) {
      const vb = numbers(a.viewbox ?? '')
      const w = lengthMm(a.width), h = lengthMm(a.height)
      const px = (u: string) => u === '' || u === 'px'
      const perPx = illustrator ? 25.4 / 72 : 25.4 / 96
      units = illustrator && (px(unitOf(a.width)) || a.width === undefined) ? 'illustrator' : 'css'
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        const sx = w !== null ? (px(unitOf(a.width)) ? (Number(numbers(a.width!)[0]) * perPx) : w) / vb[2] : null
        const sy = h !== null ? (px(unitOf(a.height)) ? (Number(numbers(a.height!)[0]) * perPx) : h) / vb[3] : null
        rootScale = sx !== null && sy !== null ? Math.min(sx, sy) : sx ?? sy ?? perPx
        if ((w !== null && !px(unitOf(a.width))) || (h !== null && !px(unitOf(a.height)))) units = 'file'
        m = multiply([rootScale, 0, 0, rootScale, 0, 0], [1, 0, 0, 1, -vb[0], -vb[1]])
      } else {
        rootScale = perPx // without a viewBox, user units are pixels whatever the size says
        if (w !== null && !px(unitOf(a.width))) units = 'file'
        m = [rootScale, 0, 0, rootScale, 0, 0]
      }
    } else if (name === 'svg') {
      m = multiply(m, [1, 0, 0, 1, Number(a.x ?? 0) || 0, Number(a.y ?? 0) || 0])
    }
    if (a.transform) m = multiply(m, parseTransform(a.transform))
    if (name === 'svg' && !parent) rootM = m
    const shape = ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line'].includes(name)
    if (!skip && shape) {
      const tol = tolerance / Math.max(1e-12, matrixScale(m))
      const found = outlinesOf(name, a, tol)
      open += found.open
      for (const ring of found.rings) {
        total += ring.length
        if (total > MAX_POINTS) throw new SvgShapeError(TOO_DETAILED)
        rings.push(ring.map(p => apply(m, p)))
      }
    } else if (clip && shape) {
      // A clipping path's scale on the page is known only where it's used, so curves are flattened as if it
      // were used at the file's own scale.
      const tol = tolerance / Math.max(1e-12, rootScale * matrixScale(m))
      const entry = clips.get(clip) ?? []
      clips.set(clip, entry)
      for (const ring of outlinesOf(name, a, tol, true).rings) {
        clipTotal += ring.length
        if (clipTotal > MAX_POINTS) throw new SvgShapeError(TOO_DETAILED)
        entry.push(ring.map(p => apply(m, p)))
      }
    }
    // Pictures and text are drawn too, though they aren't outlines, so a clip they use counts.
    if (!parent?.skip && !hidden(a) && !UNDRAWN.has(name)) { const id = clipOf(a, clipClass); if (id) clipUses.push({ id, m }) }
    if (!selfClosing) stack.push({ name, m, skip, clip })
  }
  if (!rootScale) throw new SvgShapeError('Este archivo no es un dibujo SVG.')
  // A file of pictures alone has no closed outlines, but the clipping paths that trim the pictures are their outlines.
  let fromClip = false
  if (!rings.length && clips.size) {
    const used = clipUses.filter(u => clips.get(u.id)?.length)
    // A clip used in a way this reader doesn't follow is placed on the page as it is.
    const placed = used.length ? used : [...clips.keys()].map(id => ({ id, m: rootM }))
    const seen = new Set<string>()
    for (const { id, m } of placed) {
      const key = `${id} ${m.join(' ')}`
      if (seen.has(key)) continue
      seen.add(key)
      for (const ring of clips.get(id)!) {
        total += ring.length
        if (total > MAX_POINTS) throw new SvgShapeError(TOO_DETAILED)
        rings.push(ring.map(p => apply(m, p)))
      }
    }
    fromClip = rings.length > 0
  }
  if (!rings.length) {
    throw new SvgShapeError(open ? 'Este SVG solo contiene líneas abiertas. Cierra el contorno uniendo sus extremos para que delimite un área y vuelve a intentarlo.'
      : pictures ? PICTURE_ONLY : 'Este SVG no tiene contornos cerrados que puedan usarse como forma.')
  }
  return { rings, units, open, fromClip }
}
