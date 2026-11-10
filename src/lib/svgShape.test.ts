import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { signedArea } from '../voronoi/geometry'
import { shapeFromOutlines, ShapeError } from '../voronoi/shape'
import { contains, sheetRegion } from '../voronoi/region'
import { parsePathData, parseTransform, PICTURE_ONLY, readSvgOutlines, SvgShapeError } from './svgShape'

const PT = 25.4 / 72
const fixture = (name: string) => readFileSync(new URL(`../../test-fixtures/${name}`, import.meta.url), 'utf8')
const box = (points: [number, number][]) => {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

describe('SVG outlines', () => {
  it('reads an Illustrator file without a size at 72 units per inch', () => {
    const { rings, units } = readSvgOutlines(fixture('pill.svg'))
    expect(units).toBe('illustrator')
    expect(rings).toHaveLength(1)
    const [x0, y0, x1, y1] = box(rings[0])
    expect(x1 - x0).toBeCloseTo((400 * 25.4) / 72, 2)
    expect(y1 - y0).toBeCloseTo((200 * 25.4) / 72, 2)
    // A stadium: a circle plus a rectangle.
    const r = (100 * 25.4) / 72
    expect(Math.abs(signedArea(rings[0]))).toBeCloseTo(Math.PI * r * r + 2 * r * (2 * r), -1)
  })

  it('reads sizes in millimetres, nested outlines as holes, and skips open lines', () => {
    const { rings, units, open } = readSvgOutlines(fixture('pill-with-hole.svg'))
    expect(units).toBe('file')
    expect(open).toBe(1)
    const shape = shapeFromOutlines(rings, 'pill-with-hole.svg')
    expect(shape.width).toBeCloseTo(160, 3)
    expect(shape.height).toBeCloseTo(80, 3)
    expect(shape.rings).toHaveLength(2)
    const areas = shape.rings.map(flat => {
      const ring: [number, number][] = []
      for (let i = 0; i < flat.length; i += 2) ring.push([flat[i] * shape.width, flat[i + 1] * shape.height])
      return signedArea(ring)
    }).sort((a, b) => a - b)
    expect(areas[0]).toBeCloseTo(-Math.PI * 15 * 15, -1) // the hole
    expect(areas[1]).toBeCloseTo(Math.PI * 40 * 40 + 80 * 80, -1)
  })

  it('parses compact path numbers the way drawing apps write them', () => {
    const [sub] = parsePathData('M612.58.5H227.5C102.13.5.5,102.13.5,227.5Z', 0.1)
    expect(sub.points[0]).toEqual([612.58, 0.5])
    expect(sub.points[1]).toEqual([227.5, 0.5])
    expect(sub.points[sub.points.length - 1]).toEqual([0.5, 227.5])
    expect(sub.closed).toBe(true)
    // Relative moves, repeated pairs and arcs with packed flags.
    const [tri] = parsePathData('m10 10 10 0 0 10z', 0.1)
    expect(tri.points).toEqual([[10, 10], [20, 10], [20, 20]])
    const [circle] = parsePathData('M0 0a5 5 0 1010 0a5 5 0 10-10 0z', 0.01)
    const b = box(circle.points) // flattened within 0.01, so the extremes may fall short by that much
    expect(b[2] - b[0]).toBeCloseTo(10, 1)
    expect(b[3] - b[1]).toBeCloseTo(10, 1)
  })

  it('applies group and element transforms', () => {
    const m = parseTransform('translate(10 5) scale(2)')
    expect(m).toEqual([2, 0, 0, 2, 10, 5])
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
      <g transform="translate(10 5)"><polygon transform="scale(2)" points="0,0 10,0 10,10 0,10"/></g></svg>`
    const { rings } = readSvgOutlines(svg)
    expect(box(rings[0])).toEqual([10, 5, 30, 25])
  })

  it('leaves out hidden and non-drawing content', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <defs><rect width="50" height="50"/></defs>
      <rect width="10" height="10" style="display:none"/>
      <circle cx="48" cy="48" r="24"/></svg>`
    const { rings, units } = readSvgOutlines(svg)
    expect(units).toBe('css')
    expect(rings).toHaveLength(1)
    const [x0, , x1] = box(rings[0])
    expect(x1 - x0).toBeCloseTo(48 * (25.4 / 96), 2) // 96 user units per inch
  })

  it('reads a picture’s outline from the clipping mask that trims it, as Illustrator exports one', () => {
    // Gil’s JHU ICE asset: a picture of the page with a ticket-shaped window, clipped to that outline by a class.
    const ticket = 'M243,425.6c0,2.49-2.01,4.5-4.5,4.5-7.44,0-13.5,6.06-13.5,13.5,0,2.49-2.01,4.5-4.5,4.5H92c-2.49,0-4.5-2.01-4.5-4.5,'
      + '0-7.44-6.06-13.5-13.5-13.5-2.49,0-4.5-2.01-4.5-4.5v-152.04c0-2.49,2.01-4.5,4.5-4.5,7.44,0,13.5-6.06,13.5-13.5,0-2.49,2.01-4.5,'
      + '4.5-4.5h128.5c2.49,0,4.5,2.01,4.5,4.5,0,7.44,6.06,13.5,13.5,13.5,2.49,0,4.5,2.01,4.5,4.5v152.04Z'
    const asset = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="Layer_2" data-name="Layer 2" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 688 868">
  <defs><style>
      .cls-1 { fill: none; }

      .cls-2 { clip-path: url(#clippath); }
    </style>
    <clipPath id="clippath"><path class="cls-1" d="M2,2v864h684V2H2Z${ticket}"/></clipPath></defs>
  <g id="Layer_1-2" data-name="Layer 1"><g class="cls-2">
    <image width="688" height="868" xlink:href="data:image/png;base64,iVBORw0KGgo="/>
  </g></g>
</svg>`
    const outlines = readSvgOutlines(asset)
    expect(outlines.fromClip).toBe(true)
    expect(outlines.units).toBe('illustrator')
    expect(outlines.rings).toHaveLength(2)
    expect(box(outlines.rings[0]).map(v => v / PT)).toEqual([2, 2, 686, 866].map(v => expect.closeTo(v, 6)))
    // The sheet is the page with the ticket as a hole.
    const shape = shapeFromOutlines(outlines.rings, 'asset.svg', outlines.units)
    expect(shape.width).toBeCloseTo(684 * PT, 3)
    expect(shape.height).toBeCloseTo(864 * PT, 3)
    const sheet = sheetRegion(shape.width, shape.height, 'custom', shape)
    expect(contains(sheet, 400 * PT, 600 * PT)).toBe(true)
    expect(contains(sheet, (150 - 2) * PT, (350 - 2) * PT)).toBe(false) // inside the ticket window
  })

  it('places a clipping mask in the space of whatever uses it', () => {
    const read = (use: string) => readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
      <defs><clipPath id="c" transform="translate(5 0)"><path d="M0 0H10V10H0"/></clipPath></defs>
      <g transform="translate(20 30)"><image ${use} width="50" height="50" href="a.png"/></g></svg>`)
    const placed = [[[25, 30], [35, 30], [35, 40], [25, 40]]]
    expect(read('clip-path="url(#c)"').rings).toEqual(placed)
    expect(read('style="opacity:.5; clip-path: url(\'#c\')"').rings).toEqual(placed)
    expect(read('transform="scale(2)" clip-path="url(#c)"').rings).toEqual([[[30, 30], [50, 30], [50, 50], [30, 50]]])
    // Used twice in the same place, it's still one outline.
    expect(read('clip-path="url(#c)"/><image clip-path="url(#c)"').rings).toEqual(placed)
    // A class from a style sheet wrapped in CDATA.
    const cdata = readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style><![CDATA[ .a, .clip { clip-path: url(#c) } ]]></style>
      <clipPath id="c"><circle cx="50" cy="50" r="20"/></clipPath><image class="x clip" width="100" height="100" href="a.png"/></svg>`)
    expect(cdata.fromClip).toBe(true)
    const px = 25.4 / 96
    for (const [x, y] of cdata.rings[0]) expect(Math.hypot(x / px - 50, y / px - 50)).toBeCloseTo(20, 6)
  })

  it('prefers closed shapes to clipping masks, and says when a file is only a picture', () => {
    const both = readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><clipPath id="c"><rect width="10" height="10"/></clipPath></defs>
      <image clip-path="url(#c)" width="50" height="50" href="a.png"/><circle cx="50" cy="50" r="20"/></svg>`)
    expect(both.fromClip).toBe(false)
    expect(both.rings).toHaveLength(1)
    expect(() => readSvgOutlines('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image width="10" height="10" href="a.png"/></svg>')).toThrow(PICTURE_ONLY)
    // A clip sized to whatever uses it has no outline of its own.
    expect(() => readSvgOutlines(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="1" height="1"/></clipPath>
      <image clip-path="url(#c)" width="10" height="10" href="a.png"/></svg>`)).toThrow('solo contiene una imagen')
  })

  it('explains files it cannot use', () => {
    expect(() => readSvgOutlines('not an svg')).toThrow(SvgShapeError)
    expect(() => readSvgOutlines('<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>')).toThrow(/líneas abiertas/)
    expect(() => readSvgOutlines('<svg viewBox="0 0 10 10"><g/></svg>')).toThrow(/no tiene contornos cerrados/)
    expect(() => shapeFromOutlines([[[0, 0], [0.5, 0], [0.5, 0.5]]], 'tiny')).toThrow(ShapeError)
  })
})
