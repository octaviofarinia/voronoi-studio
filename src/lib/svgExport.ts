// SVG files at real size. "Artwork" looks like the preview; "laser" has hairlines with no fill, which laser
// software such as LightBurn and Glowforge reads by colour: cuts in red, and sites and Delaunay lines, when
// shown, in their own colours so they can be scored, engraved or skipped.
import type { Polygon, Segment } from '../voronoi/geometry'
import type { Outline } from '../voronoi/holes'
import type { Geometry } from '../voronoi/pattern'
import { regionCenter, regionHeight, regionWidth, type Region } from '../voronoi/region'
import { cutPaths, num } from './cutPaths'
import { DELAUNAY_COLOR, SITE_COLOR, siteRadius } from './style'
import type { Settings } from './settings'

export const LASER_RED = '#ff0000'
export const LASER_SITES = '#00ff00'
export const LASER_DELAUNAY = '#ff00ff'
const HAIRLINE_MM = 0.025

// Physical size attributes. Inches stay inches; everything else is written in millimetres, except
// artwork in pixels, which keeps its pixel size for screen use.
function sizeAttributes(s: Settings, artwork: boolean): string {
  if (s.units === 'in') return `width="${num(s.width / 25.4, 4)}in" height="${num(s.height / 25.4, 4)}in"`
  if (s.units === 'px' && artwork) return `width="${Math.round((s.width / 25.4) * s.dpi)}" height="${Math.round((s.height / 25.4) * s.dpi)}"`
  return `width="${num(s.width)}mm" height="${num(s.height)}mm"`
}

function header(s: Settings, artwork: boolean, title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" ${sizeAttributes(s, artwork)} viewBox="0 0 ${num(s.width)} ${num(s.height)}">\n`
    + `<title>${title}</title>\n`
}

// Straight-sided outlines (a custom shape's rings) as one path, filled even-odd so holes stay open.
export function ringsPath(rings: Polygon[]): string {
  return rings.map(ring => `M${ring.map(([x, y]) => `${num(x)} ${num(y)}`).join('L')}Z`).join('')
}

export function regionElement(r: Region, attributes: string): string {
  if (r.shape === 'custom') return `<path fill-rule="evenodd" d="${ringsPath(r.rings ?? [])}" ${attributes}/>`
  if (r.shape === 'rect') return `<rect x="${num(r.x0)}" y="${num(r.y0)}" width="${num(regionWidth(r))}" height="${num(regionHeight(r))}" ${attributes}/>`
  const [cx, cy] = regionCenter(r)
  return `<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(regionWidth(r) / 2)}" ry="${num(regionHeight(r) / 2)}" ${attributes}/>`
}

export function segmentsPath(segments: Segment[]): string {
  return segments.map(([x0, y0, x1, y1]) => `M${num(x0)} ${num(y0)}L${num(x1)} ${num(y1)}`).join('')
}

// A closed outline with true arcs. Positive bulges turn the way angles grow, which is SVG's sweep flag 1.
export function outlinePath({ points, bulges }: Outline): string {
  let d = `M${num(points[0][0])} ${num(points[0][1])}`
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], bulge = bulges[i]
    if (Math.abs(bulge) < 1e-9) { if (i < points.length - 1) d += `L${num(b[0])} ${num(b[1])}`; continue }
    const theta = 4 * Math.atan(Math.abs(bulge))
    const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 * Math.sin(theta / 2))
    d += `A${num(r)} ${num(r)} 0 ${theta > Math.PI ? 1 : 0} ${bulge > 0 ? 1 : 0} ${num(b[0])} ${num(b[1])}`
  }
  return `${d}Z`
}

export function artworkSvg(g: Geometry, points: Float64Array, s: Settings): string {
  const width = num(s.lineWidth, 4)
  const stroke = `stroke="${s.lineColor}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`
  const fill = s.fill ? s.fillColor : 'none'
  let svg = header(s, true, 'Diseño de Voronoi Studio')
  svg += `<g id="sheet">${regionElement(g.sheet, `fill="${s.background}"`)}</g>\n`
  if (s.showEdges) {
    svg += `<g id="cells" fill="${fill}" ${stroke}>\n`
    if (s.cellStyle === 'holes') for (const hole of g.holes) svg += `<path d="${outlinePath(hole.outline)}"/>\n`
    else {
      svg += `${regionElement(g.region, '')}\n`
      if (g.edges.internal.length) svg += `<path fill="none" d="${segmentsPath(g.edges.internal)}"/>\n`
    }
    svg += `</g>\n`
  }
  if (s.showDelaunay && g.delaunay.length) {
    svg += `<g id="delaunay" fill="none" stroke="${DELAUNAY_COLOR}" stroke-opacity="0.6" stroke-width="${width}" stroke-linecap="round">`
      + `<path d="${segmentsPath(g.delaunay)}"/></g>\n`
  }
  if (s.showSites && points.length) {
    const r = num(siteRadius(g.region, points.length / 2))
    svg += `<g id="sites" fill="${SITE_COLOR}">\n`
    for (let i = 0; i < points.length; i += 2) svg += `<circle cx="${num(points[i])}" cy="${num(points[i + 1])}" r="${r}"/>\n`
    svg += `</g>\n`
  }
  return `${svg}</svg>\n`
}

export function laserSvg(g: Geometry, points: Float64Array, s: Settings): string {
  const cut = cutPaths(g, points, s)
  const hairline = (colour: string) => `fill="none" stroke="${colour}" stroke-width="${HAIRLINE_MM}"`
  const style = hairline(LASER_RED)
  let svg = header(s, false, 'Líneas de corte de Voronoi Studio')
  if (cut.delaunay.length) svg += `<g id="delaunay" ${hairline(LASER_DELAUNAY)}><path d="${segmentsPath(cut.delaunay)}"/></g>\n`
  if (cut.sites) {
    const { points: p, r } = cut.sites
    svg += `<g id="sites" ${hairline(LASER_SITES)}>\n`
    for (let i = 0; i < p.length; i += 2) svg += `<circle cx="${num(p[i])}" cy="${num(p[i + 1])}" r="${num(r)}"/>\n`
    svg += `</g>\n`
  }
  if (cut.outlines.length || cut.lines.length || cut.inner.length) {
    svg += `<g id="cut-inner" ${style}>\n`
    for (const outline of cut.outlines) svg += `<path d="${outlinePath(outline)}"/>\n`
    if (cut.lines.length) svg += `<path d="${segmentsPath(cut.lines)}"/>\n`
    for (const r of cut.inner) svg += `${regionElement(r, '')}\n`
    svg += `</g>\n`
  }
  if (cut.outer.length) svg += `<g id="cut-outer" ${style}>${cut.outer.map(r => regionElement(r, '')).join('')}</g>\n`
  return `${svg}</svg>\n`
}
