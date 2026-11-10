import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGeometry } from '../voronoi/pattern'
import { emptyHistory, record, redo, undo } from './history'
import { matchPreset, presetSize, SHEET_PRESETS } from './presets'
import { parseProject, ProjectError, serializeProject } from './project'
import { DEFAULTS, sanitizeSettings } from './settings'
import { formatLength, formatLong, formatSmall, fromUnits, pixelSize, toUnits } from './units'

describe('project files', () => {
  it('round-trips settings and hand-edited points', () => {
    const points = Float64Array.from([10.12345, 20, 150.5, 30.25, 90, 180])
    const settings = { ...DEFAULTS, count: 3, cellStyle: 'holes' as const, lineColor: '#123abc' }
    const back = parseProject(serializeProject({ settings, points, handEdited: true }))
    expect(back.settings).toEqual(settings)
    expect(back.handEdited).toBe(true)
    expect(Array.from(back.points)).toEqual([10.123, 20, 150.5, 30.25, 90, 180])
    // Reopening gives the same diagram as before saving, to a micrometre.
    const a = buildGeometry(points, settings).metrics, b = buildGeometry(back.points, settings).metrics
    expect(b.cutLength).toBeCloseTo(a.cutLength, 1)
  })

  it('opens the version 1 fixture, filling in missing settings', () => {
    const design = parseProject(readFileSync(new URL('../../test-fixtures/minimal-v1.voronoi.json', import.meta.url), 'utf8'))
    expect(design.points.length).toBe(8)
    expect(design.settings.width).toBe(120)
    expect(design.settings.cellStyle).toBe(DEFAULTS.cellStyle)
  })

  it('explains bad files instead of opening them', () => {
    expect(() => parseProject('not json')).toThrow(ProjectError)
    expect(() => parseProject('{"schema":"other"}')).toThrow(/esquema/)
    expect(() => parseProject('{"schema":"voronoi-studio/project","version":99}')).toThrow(/más reciente/)
    expect(() => parseProject('{"schema":"voronoi-studio/project","version":1,"points":[1,2,3]}')).toThrow(/dañados/)
  })

  it('clamps out-of-range and wrongly typed settings', () => {
    const s = sanitizeSettings({ width: 1e9, count: -4, units: 'furlongs', lineColor: 'red', showSites: 'yes', cellStyle: 'holes' })
    expect(s.width).toBe(5000)
    expect(s.count).toBe(2)
    expect(s.units).toBe('mm')
    expect(s.lineColor).toBe(DEFAULTS.lineColor)
    expect(s.showSites).toBe(true)
    expect(s.cellStyle).toBe('holes')
  })
})

describe('units and presets', () => {
  it('converts between units', () => {
    expect(toUnits(25.4, 'in', 300)).toBeCloseTo(1)
    expect(toUnits(25.4, 'px', 300)).toBeCloseTo(300)
    expect(toUnits(25.4, 'pc', 300)).toBeCloseTo(6)
    expect(fromUnits(1080, 'px', 300)).toBeCloseTo(91.44)
    expect(formatLength(12.5, 'mm', 300)).toBe('12.5 mm')
    expect(formatLength(25.4, 'in', 300)).toBe('1 in')
    expect(formatLong(4820, 'mm')).toBe('4.82 m')
    expect(formatSmall(0.001, 'mm', 300)).toBe('menos de 0.01 mm')
    expect(formatSmall(0, 'mm', 300)).toBe('0 mm')
    expect(pixelSize(200, 200, 300)).toEqual([2362, 2362])
  })

  it('matches presets, with pixel presets following pixels per inch', () => {
    const square = SHEET_PRESETS.find(p => p.id === 'square-1080')!
    const [w, h] = presetSize(square, 300)
    expect(pixelSize(w, h, 300)).toEqual([1080, 1080])
    expect(matchPreset(w, h, 'rect', 'px', 300)).toBe('square-1080')
    expect(matchPreset(210, 297, 'rect', 'mm', 300)).toBe('a4')
    expect(matchPreset(211, 297, 'rect', 'mm', 300)).toBe('custom')
  })
})

describe('history', () => {
  it('undoes and redoes, merging quick repeats of the same change', () => {
    let h = emptyHistory<number>()
    h = record(h, 1, 'count', 0)
    h = record(h, 2, 'count', 100) // merged with the first: undo goes straight back to 1
    h = record(h, 3, 'seed', 200)
    const u1 = undo(h, 4)!
    expect(u1.state).toBe(3)
    const u2 = undo(u1.history, u1.state)!
    expect(u2.state).toBe(1)
    expect(undo(u2.history, u2.state)).toBeNull()
    const r = redo(u2.history, u2.state)!
    expect(r.state).toBe(3)
  })
})
