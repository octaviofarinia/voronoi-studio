// Sheet sizes people often need. The first six come from the old Voronoi Lab; the rest suit
// laser cutting and print. Sizes are millimetres; pixel sizes convert at the sheet's pixels-per-inch.
import type { Shape } from '../voronoi/region'
import type { Units } from './units'

export type SheetPreset = { id: string; label: string; width: number; height: number; units: Units; shape: Shape; pixels?: [number, number] }

const mm = (inches: number) => inches * 25.4

export const SHEET_PRESETS: SheetPreset[] = [
  { id: 'square-1080', label: 'Cuadrado 1080 × 1080 px', width: 0, height: 0, units: 'px', shape: 'rect', pixels: [1080, 1080] },
  { id: 'portrait-1080', label: 'Publicación vertical 1080 × 1350 px', width: 0, height: 0, units: 'px', shape: 'rect', pixels: [1080, 1350] },
  { id: 'hd', label: 'HD 1920 × 1080 px', width: 0, height: 0, units: 'px', shape: 'rect', pixels: [1920, 1080] },
  { id: 'letter', label: 'Carta 8,5 × 11 in', width: mm(8.5), height: mm(11), units: 'in', shape: 'rect' },
  { id: 'a4', label: 'A4 210 × 297 mm', width: 210, height: 297, units: 'mm', shape: 'rect' },
  { id: 'a3', label: 'A3 297 × 420 mm', width: 297, height: 420, units: 'mm', shape: 'rect' },
  { id: 'tile-200', label: 'Baldosa 200 × 200 mm', width: 200, height: 200, units: 'mm', shape: 'rect' },
  { id: 'sheet-12', label: 'Lámina para láser 12 × 12 in', width: mm(12), height: mm(12), units: 'in', shape: 'rect' },
  { id: 'panel-600', label: 'Panel 600 × 400 mm', width: 600, height: 400, units: 'mm', shape: 'rect' },
  { id: 'coaster', label: 'Posavasos Ø 100 mm', width: 100, height: 100, units: 'mm', shape: 'ellipse' },
  { id: 'disc-300', label: 'Disco Ø 300 mm', width: 300, height: 300, units: 'mm', shape: 'ellipse' },
]

// The sheet size in millimetres for a preset; pixel presets depend on pixels-per-inch.
export function presetSize(preset: SheetPreset, dpi: number): [number, number] {
  if (preset.pixels) return [(preset.pixels[0] / dpi) * 25.4, (preset.pixels[1] / dpi) * 25.4]
  return [preset.width, preset.height]
}

// Which preset the current sheet matches, if any, so the menu shows it.
export function matchPreset(width: number, height: number, shape: Shape, units: Units, dpi: number): string {
  const hit = SHEET_PRESETS.find(p => {
    const [w, h] = presetSize(p, dpi)
    return p.shape === shape && p.units === units && Math.abs(w - width) < 0.01 && Math.abs(h - height) < 0.01
  })
  return hit?.id ?? 'custom'
}
