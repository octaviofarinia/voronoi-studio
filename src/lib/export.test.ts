import { describe, expect, it } from 'vitest'
import { arcFromBulge, type Outline } from '../voronoi/holes'
import { buildGeometry, patternRegion } from '../voronoi/pattern'
import { seedPoints } from '../voronoi/seeding'
import { cutContents, cutLayers } from './cutPaths'
import { cutDxf, LAYER_DELAUNAY, LAYER_INNER, LAYER_OUTER, LAYER_SITES } from './dxfExport'
import { DEFAULTS, seedSettings, type Settings } from './settings'
import { artworkSvg, LASER_DELAUNAY, LASER_SITES, laserSvg, outlinePath } from './svgExport'

const design = (over: Partial<Settings> = {}) => {
  const s = { ...DEFAULTS, ...over }
  const points = seedPoints(seedSettings(s), patternRegion(s)).points
  return { s, points, g: buildGeometry(points, s) }
}

// Pairs of DXF group codes and values, as a reader sees them.
const dxfPairs = (text: string) => {
  const lines = text.trimEnd().split('\n')
  const pairs: [number, string][] = []
  for (let i = 0; i < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]])
  return pairs
}

describe('SVG export', () => {
  it('writes the artwork at real size, with each edge once', () => {
    const { s, points, g } = design()
    const svg = artworkSvg(g, points, s)
    expect(svg).toContain('width="200mm" height="200mm" viewBox="0 0 200 200"')
    const edges = svg.match(/M[\d.]+ [\d.]+L/g) ?? []
    expect(edges.length).toBe(g.edges.internal.length)
    expect(svg.match(/<circle /g)).toHaveLength(300)
  })

  it('keeps pixel sizes for pixel artwork and inches for inch sheets', () => {
    expect(artworkSvg(design({ units: 'px' }).g, new Float64Array(), { ...DEFAULTS, units: 'px' })).toContain('width="2362" height="2362"')
    expect(laserSvg(design().g, new Float64Array(), { ...DEFAULTS, units: 'in', width: 254, height: 127 })).toContain('width="10in" height="5in" viewBox="0 0 254 127"')
  })

  it('writes laser cuts as red hairlines, holes before the outer cut', () => {
    const { s, points, g } = design({ cellStyle: 'holes', showSites: false })
    const svg = laserSvg(g, points, s)
    expect(svg).toContain('stroke="#ff0000" stroke-width="0.025"')
    expect(svg).not.toContain('<circle')
    expect(svg.match(/<path d=/g)).toHaveLength(g.holes.length)
    expect(svg.indexOf('cut-inner')).toBeLessThan(svg.indexOf('cut-outer'))
    expect(laserSvg(g, points, { ...s, sheetOutline: false })).not.toContain('cut-outer')
  })

  it('adds the sites and Delaunay lines the view shows, in their own colours, before the cuts', () => {
    const { s, points, g } = design({ cellStyle: 'holes', showSites: true, showDelaunay: true })
    const svg = laserSvg(g, points, s)
    const sites = /<g id="sites" ([^>]*)>(.*?)<\/g>/s.exec(svg)!
    expect(sites[1]).toBe(`fill="none" stroke="${LASER_SITES}" stroke-width="0.025"`)
    expect(sites[2].match(/<circle /g)).toHaveLength(points.length / 2)
    const delaunay = /<g id="delaunay" ([^>]*)><path d="([^"]*)"/.exec(svg)!
    expect(delaunay[1]).toContain(`stroke="${LASER_DELAUNAY}"`)
    expect(delaunay[2].match(/M/g)).toHaveLength(g.delaunay.length)
    expect(svg.indexOf('id="sites"')).toBeLessThan(svg.indexOf('cut-inner'))
    expect(svg.indexOf('id="delaunay"')).toBeLessThan(svg.indexOf('cut-inner'))
    // Hidden in the view, left out of the file.
    const hidden = laserSvg(g, points, { ...s, showSites: false, showDelaunay: false })
    expect(hidden).not.toContain('id="sites"')
    expect(hidden).not.toContain('id="delaunay"')
  })

  it('leaves out the cells when Holes or Edges is hidden', () => {
    const { s, points, g } = design({ cellStyle: 'holes', showEdges: false, showSites: true })
    const svg = laserSvg(g, points, s)
    expect(svg).not.toContain('cut-inner')
    expect(svg).toContain('cut-outer')
    expect(svg.match(/<circle /g)).toHaveLength(points.length / 2)
    expect(cutContents(s)).toEqual(['puntos', 'el contorno de la lámina'])
    expect(cutContents({ ...s, showSites: false, sheetOutline: false })).toEqual([])
    expect(cutLayers(s, false)).toEqual(['CUT_OUTER para el contorno', 'SITES (verde) para los puntos'])
    expect(cutLayers(s, true)[0]).toBe("CUT_INNER para huecos de la forma")
    expect(cutLayers({ ...s, showEdges: true, showDelaunay: true }, true)).toEqual(['CUT_INNER para huecos', 'CUT_OUTER para el contorno', 'SITES (verde) para los puntos', 'DELAUNAY (magenta) para las líneas de Delaunay'])
    const lines = design({ cellStyle: 'lines', border: 5, showEdges: false })
    expect(laserSvg(lines.g, lines.points, lines.s)).not.toContain('cut-inner')
  })

  it('draws rounded corners as SVG arcs', () => {
    const { g } = design({ cellStyle: 'holes', cornerRadius: 1 })
    const d = outlinePath(g.holes[0].outline)
    expect(d.match(/A/g)?.length).toBe(g.holes[0].outline.points.length / 2)
    expect(d.endsWith('Z')).toBe(true)
  })
})

describe('DXF export', () => {
  it('writes a well-formed R12 file with layers and units', () => {
    const { s, points, g } = design({ cellStyle: 'holes' })
    const pairs = dxfPairs(cutDxf(g, points, s))
    expect(pairs[0]).toEqual([0, 'SECTION'])
    expect(pairs[pairs.length - 1]).toEqual([0, 'EOF'])
    expect(pairs.every(([code]) => Number.isInteger(code))).toBe(true)
    expect(pairs.filter(p => p[0] === 0 && p[1] === 'POLYLINE')).toHaveLength(g.holes.length + 1)
    const header = pairs.findIndex(p => p[1] === '$INSUNITS')
    expect(pairs[header + 1]).toEqual([70, '4'])
    expect(pairs.some(p => p[0] === 8 && p[1] === LAYER_OUTER)).toBe(true)
  })

  it('writes inches, lines and a true circle for round sheets', () => {
    const { s, points, g } = design({ units: 'in', width: 254, height: 254, shape: 'ellipse', showSites: false })
    const pairs = dxfPairs(cutDxf(g, points, s))
    expect(pairs[pairs.findIndex(p => p[1] === '$INSUNITS') + 1]).toEqual([70, '1'])
    expect(pairs.filter(p => p[0] === 0 && p[1] === 'LINE')).toHaveLength(g.edges.internal.length)
    expect(pairs.filter(p => p[0] === 0 && p[1] === 'CIRCLE')).toHaveLength(2)
    const radius = pairs.find(p => p[0] === 40)
    expect(Number(radius?.[1])).toBeCloseTo(5 - 5 / 25.4, 4)
  })

  it('puts shown sites and Delaunay lines on their own layers', () => {
    const { s, points, g } = design({ cellStyle: 'holes', showSites: true, showDelaunay: true })
    const pairs = dxfPairs(cutDxf(g, points, s))
    const layerTable = pairs.findIndex(p => p[1] === 'LAYER')
    expect(pairs[layerTable + 1]).toEqual([70, '4'])
    const on = (kind: string, layer: string) => pairs.filter((p, i) => p[0] === 0 && p[1] === kind && pairs[i + 1][1] === layer).length
    expect(on('CIRCLE', LAYER_SITES)).toBe(points.length / 2)
    expect(on('LINE', LAYER_DELAUNAY)).toBe(g.delaunay.length)
    const hidden = dxfPairs(cutDxf(g, points, { ...s, showSites: false, showDelaunay: false }))
    expect(hidden.some(p => p[1] === LAYER_SITES || p[1] === LAYER_DELAUNAY)).toBe(false)
    expect(hidden[hidden.findIndex(p => p[1] === 'LAYER') + 1]).toEqual([70, '2'])
  })

  it('flips y and keeps each arc centred on its corner', () => {
    const { s, points, g } = design({ cellStyle: 'holes', cornerRadius: 1.5 })
    const hole = g.holes[0]
    const pairs = dxfPairs(cutDxf(g, points, s))
    // Read the first hole's vertices and bulges back.
    const start = pairs.findIndex(p => p[1] === 'POLYLINE')
    const vertices: [number, number][] = [], bulges: number[] = []
    for (let i = start + 1; pairs[i][1] !== 'SEQEND'; i++) {
      if (pairs[i][1] !== 'VERTEX') continue
      const get = (code: number) => { for (let j = i + 1; j < pairs.length && pairs[j][0] !== 0; j++) if (pairs[j][0] === code) return Number(pairs[j][1]); return 0 }
      vertices.push([get(10), get(20)]); bulges.push(get(42))
    }
    const outline: Outline = { points: vertices, bulges }
    expect(outline.points).toHaveLength(hole.outline.points.length)
    const i = hole.outline.bulges.findIndex(b => b !== 0)
    const original = arcFromBulge(hole.outline.points[i], hole.outline.points[i + 1], hole.outline.bulges[i])
    const flipped = arcFromBulge(outline.points[i], outline.points[i + 1], outline.bulges[i])
    expect(flipped.cx).toBeCloseTo(original.cx, 3)
    expect(flipped.cy).toBeCloseTo(s.height - original.cy, 3)
    expect(flipped.r).toBeCloseTo(1.5, 3)
    expect(pairs.some(p => p[0] === 8 && p[1] === LAYER_INNER)).toBe(true)
  })
})
