// Draws a design on a 2D canvas, for the on-screen preview and for PNG export. World units are
// millimetres; the caller passes the scale (pixels per millimetre) and offset.
import type { Segment } from '../voronoi/geometry'
import { arcFromBulge, type Outline } from '../voronoi/holes'
import type { Geometry } from '../voronoi/pattern'
import { regionCenter, regionHeight, regionWidth, type Region } from '../voronoi/region'
import { DELAUNAY_COLOR, SITE_COLOR, siteRadius } from './style'
import type { Settings } from './settings'

export type Hover = { kind: 'site' | 'cell'; index: number } | null
export type DrawOptions = {
  scale: number; ox: number; oy: number; dpr: number
  preview: boolean // adds the paper shadow, minimum line widths and hover marks
  hover?: Hover
  transparent?: boolean
}

const PREVIEW_MIN_LINE = 0.75 // css px
const HOVER = '#0a84ff'
const ERASE = '#ff3b30'

// Adds the region's outline to the current path. Fill and clip it with 'evenodd', so a custom shape's holes stay open.
export function regionPath(ctx: CanvasRenderingContext2D, r: Region) {
  if (r.shape === 'rect') { ctx.rect(r.x0, r.y0, regionWidth(r), regionHeight(r)); return }
  if (r.shape === 'custom') {
    for (const ring of r.rings ?? []) {
      ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
    }
    return
  }
  const [cx, cy] = regionCenter(r)
  ctx.ellipse(cx, cy, regionWidth(r) / 2, regionHeight(r) / 2, 0, 0, Math.PI * 2)
}

function segmentsPath(ctx: CanvasRenderingContext2D, segments: Segment[]) {
  for (const [x0, y0, x1, y1] of segments) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1) }
}

export function outlinePath(ctx: CanvasRenderingContext2D, { points, bulges }: Outline) {
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    if (Math.abs(bulges[i]) < 1e-9) { ctx.lineTo(b[0], b[1]); continue }
    const arc = arcFromBulge(a, b, bulges[i])
    // Canvas angles grow clockwise on screen, the same way positive bulges turn.
    ctx.arc(arc.cx, arc.cy, arc.r, arc.start, arc.end, !arc.positive)
  }
  ctx.closePath()
}

export function drawDesign(ctx: CanvasRenderingContext2D, g: Geometry, points: Float64Array, s: Settings, o: DrawOptions) {
  const px = 1 / o.scale // one css pixel, in millimetres
  const minLine = o.preview ? PREVIEW_MIN_LINE * px : 0
  ctx.setTransform(o.dpr * o.scale, 0, 0, o.dpr * o.scale, o.dpr * o.ox, o.dpr * o.oy)

  if (!o.transparent) {
    ctx.save()
    if (o.preview) { ctx.shadowColor = 'rgba(15, 23, 42, .28)'; ctx.shadowBlur = 28 * o.dpr; ctx.shadowOffsetY = 8 * o.dpr }
    ctx.beginPath(); regionPath(ctx, g.sheet)
    ctx.fillStyle = s.background; ctx.fill('evenodd')
    ctx.restore()
  }

  ctx.save()
  ctx.beginPath(); regionPath(ctx, g.sheet); ctx.clip('evenodd')
  // Round caps cost about 40 % more to draw; on big previews they're invisible at screen size.
  const many = o.preview && g.edges.internal.length > 4000
  ctx.lineCap = many ? 'butt' : 'round'; ctx.lineJoin = 'round'
  const lineWidth = Math.max(s.lineWidth, minLine)

  if (s.showEdges) {
    ctx.strokeStyle = s.lineColor; ctx.lineWidth = lineWidth; ctx.fillStyle = s.fillColor
    if (s.cellStyle === 'holes') {
      // One path per hole: browsers slow down sharply on a single path with tens of thousands of arcs.
      for (const hole of g.holes) {
        ctx.beginPath(); outlinePath(ctx, hole.outline)
        if (s.fill) ctx.fill()
        ctx.stroke()
      }
    } else {
      ctx.beginPath(); regionPath(ctx, g.region)
      if (s.fill) ctx.fill('evenodd')
      segmentsPath(ctx, g.edges.internal)
      ctx.stroke()
    }
  }

  if (s.showDelaunay && g.delaunay.length) {
    ctx.beginPath(); segmentsPath(ctx, g.delaunay)
    ctx.globalAlpha = 0.6; ctx.strokeStyle = DELAUNAY_COLOR; ctx.lineWidth = lineWidth; ctx.stroke(); ctx.globalAlpha = 1
  }

  if (s.showSites && points.length) {
    const r = Math.max(siteRadius(g.region, points.length / 2), o.preview ? 1.3 * px : 0)
    ctx.fillStyle = SITE_COLOR
    if (o.preview && r < 2 * px) {
      // Dots under two pixels look the same as squares and draw many times faster.
      for (let i = 0; i < points.length; i += 2) ctx.fillRect(points[i] - r, points[i + 1] - r, r * 2, r * 2)
    } else {
      ctx.beginPath()
      for (let i = 0; i < points.length; i += 2) { ctx.moveTo(points[i] + r, points[i + 1]); ctx.arc(points[i], points[i + 1], r, 0, Math.PI * 2) }
      ctx.fill()
    }
  }
  ctx.restore()

  if (o.preview && o.hover) drawHover(ctx, g, points, o.hover, px)
}

function drawHover(ctx: CanvasRenderingContext2D, g: Geometry, points: Float64Array, hover: NonNullable<Hover>, px: number) {
  if (hover.kind === 'site') {
    const x = points[hover.index * 2], y = points[hover.index * 2 + 1]
    if (x === undefined) return
    ctx.beginPath(); ctx.arc(x, y, 7 * px, 0, Math.PI * 2)
    ctx.lineWidth = 2 * px; ctx.strokeStyle = HOVER; ctx.stroke()
    return
  }
  const cell = g.cells[hover.index]
  if (!cell) return
  ctx.beginPath()
  for (const ring of cell) {
    ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
  }
  ctx.fillStyle = 'rgba(255, 59, 48, .16)'; ctx.fill('evenodd')
  ctx.lineWidth = 2 * px; ctx.strokeStyle = ERASE; ctx.stroke()
}

// Largest PNG the app will try. Browsers fail above roughly 16k pixels a side or a few hundred megapixels.
export const PNG_MAX_SIDE = 16_384
export const PNG_MAX_PIXELS = 120_000_000

export function pngProblem(width: number, height: number): string | null {
  if (width > PNG_MAX_SIDE || height > PNG_MAX_SIDE) return `Ese PNG tendría ${width.toLocaleString()} × ${height.toLocaleString()} px y superaría el límite de ${PNG_MAX_SIDE.toLocaleString()} px por lado del navegador. Reduce los píxeles por pulgada en la pestaña Lámina o exporta un SVG.`
  if (width * height > PNG_MAX_PIXELS) return `Ese PNG tendría ${Math.round((width * height) / 1e6)} megapíxeles, más de lo que el navegador puede generar. Reduce los píxeles por pulgada en la pestaña Lámina o exporta un SVG.`
  return null
}

export function renderPng(g: Geometry, points: Float64Array, s: Settings, width: number, height: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  drawDesign(ctx, g, points, s, { scale: width / s.width, ox: 0, oy: 0, dpr: 1, preview: false, transparent: s.transparentPng })
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'))
}
