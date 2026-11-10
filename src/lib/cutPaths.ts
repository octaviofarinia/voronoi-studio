// What a cutter should follow, shared by the laser SVG and the DXF. Like the other exports, cut files hold
// what the view shows: cell cuts while Edges or Holes is on, and sites and Delaunay lines while those are on.
// Each line appears once. Marks come first, then holes, then the outer outline, so parts don't drop out of
// the sheet before their holes are cut. A custom sheet's own holes count as inner cuts; they follow
// "Include the sheet outline", like the outside edge.
import type { Segment } from '../voronoi/geometry'
import type { Outline } from '../voronoi/holes'
import type { Geometry } from '../voronoi/pattern'
import { splitHoles, type Region } from '../voronoi/region'
import type { Settings } from './settings'
import { siteRadius } from './style'

export type CutSettings = Pick<Settings, 'cellStyle' | 'border' | 'sheetOutline' | 'showEdges' | 'showSites' | 'showDelaunay'>
export type CutPaths = {
  lines: Segment[]; outlines: Outline[]; inner: Region[]; outer: Region[]
  // Marks, each on its own layer and colour, so laser software can score, engrave or skip them.
  delaunay: Segment[]
  sites: { points: Float64Array; r: number } | null
}

export function cutPaths(g: Geometry, points: Float64Array, s: CutSettings): CutPaths {
  const sheet = splitHoles(g.sheet)
  const outer = s.sheetOutline ? [sheet.outer] : []
  const sheetHoles = s.sheetOutline && sheet.holes ? [sheet.holes] : []
  const delaunay = s.showDelaunay ? g.delaunay : []
  const sites = s.showSites && points.length ? { points, r: siteRadius(g.region, points.length / 2) } : null
  const marks = { delaunay, sites }
  if (!s.showEdges) return { lines: [], outlines: [], inner: sheetHoles, outer, ...marks }
  if (s.cellStyle === 'holes') return { lines: [], outlines: g.holes.map(h => h.outline), inner: sheetHoles, outer, ...marks }
  // The pattern's outline is its own cut when a border separates it from the sheet edge.
  const inner = s.border > 1e-9 || !s.sheetOutline ? [g.region] : []
  return { lines: g.edges.internal, outlines: [], inner: [...inner, ...sheetHoles], outer, ...marks }
}

// The parts a cut file will hold, in plain words, for the File tab. Empty when there's nothing to cut.
export function cutContents(s: CutSettings): string[] {
  const parts: string[] = []
  if (s.showEdges) parts.push(s.cellStyle === 'holes' ? 'huecos' : 'aristas de las celdas')
  if (s.showSites) parts.push('puntos')
  if (s.showDelaunay) parts.push('líneas de Delaunay')
  if (s.sheetOutline) parts.push('el contorno de la lámina')
  return parts
}

// Which layer holds what, for the File tab. `sheetHoles`: the sheet is an imported shape with holes.
export function cutLayers(s: CutSettings, sheetHoles: boolean): string[] {
  const inner = s.showEdges ? (s.cellStyle === 'holes' ? 'huecos' : 'aristas de las celdas') : s.sheetOutline && sheetHoles ? "huecos de la forma" : ''
  return [
    inner && `CUT_INNER para ${inner}`,
    s.sheetOutline && 'CUT_OUTER para el contorno',
    s.showSites && 'SITES (verde) para los puntos',
    s.showDelaunay && 'DELAUNAY (magenta) para las líneas de Delaunay',
  ].filter((part): part is string => Boolean(part))
}

// "a", "a and b", "a, b and c".
export function listWords(words: string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} y ${words[words.length - 1]}`
}

// Numbers for files: millimetres to a thousandth, without trailing zeros.
export function num(value: number, digits = 3): string {
  const text = value.toFixed(digits)
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text
  return trimmed === '-0' ? '0' : trimmed
}
