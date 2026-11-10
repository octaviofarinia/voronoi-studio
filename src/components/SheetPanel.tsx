import { memo } from 'react'
import { matchPreset, presetSize, SHEET_PRESETS } from '../lib/presets'
import { RANGES, type Settings } from '../lib/settings'
import { formatLength, pixelSize, type Units } from '../lib/units'
import type { Shape } from '../voronoi/region'
import { holeCount } from '../voronoi/shape'
import { Button, LengthField, NumberField, Section, Segmented, SwitchField, type Option } from './Controls'
import { Icon } from './Icon'
import type { Change } from './PatternPanel'

const UNITS: Option<Units>[] = [
  { value: 'mm', label: 'mm', tip: 'Muestra las longitudes en milímetros.' },
  { value: 'in', label: 'in', tip: 'Muestra las longitudes en pulgadas. Los archivos SVG y DXF también usan pulgadas.' },
  { value: 'px', label: 'px', tip: 'Muestra las longitudes en píxeles con la resolución indicada abajo, para diseños de pantalla.' },
  { value: 'pc', label: 'pica', tip: 'Muestra las longitudes en picas (6 por pulgada), para impresión.' },
]
const shapes = (imported: boolean): Option<Shape>[] => [
  { value: 'rect', label: 'Rectángulo', tip: 'Una lámina rectangular.' },
  { value: 'ellipse', label: 'Elipse', tip: 'Una lámina redonda u ovalada que se ajusta al ancho y alto, como un posavasos o un panel redondo.' },
  { value: 'custom', label: 'Importada', tip: 'El contorno importado desde un SVG, con sus huecos.', unavailable: !imported && 'Primero importa una forma SVG con el botón de abajo.' },
]
const ASSUMED = {
  css: 'El archivo no indica su tamaño; se interpretó con 96 unidades por pulgada, el estándar web. Revisa el ancho y el alto.',
  illustrator: 'El archivo no indica su tamaño. Parece creado en Illustrator, por lo que se interpretó con 72 unidades por pulgada. Revisa el ancho y el alto.',
}

// Memoised: the panel only re-renders when its own props change, not on every relax step.
export const SheetPanel = memo(function SheetPanel({ s, change, onImportShape }: { s: Settings; change: Change; onImportShape: () => void }) {
  const preset = matchPreset(s.width, s.height, s.shape, s.units, s.dpi)
  const [pw, ph] = pixelSize(s.width, s.height, s.dpi)
  const maxBorder = Math.min(s.width, s.height) / 3
  const custom = s.shape === 'custom' ? s.customShape : null
  // An imported shape keeps its proportions, so width and height move together.
  const aspect = custom ? custom.width / custom.height : null
  const holes = s.customShape ? holeCount(s.customShape) : 0
  return <>
    <Section title="Tamaño">
      <label className="field" data-tip="Tamaños habituales de lámina. Al elegir uno se ajustan el tamaño, la forma y las unidades.">
        <span className="field-label"><span>Formato</span></span>
        <select value={preset} onChange={event => {
          const p = SHEET_PRESETS.find(item => item.id === event.currentTarget.value)
          if (!p) return
          const [width, height] = presetSize(p, s.dpi)
          change({ width, height, units: p.units, shape: p.shape }, 'preset')
        }}>
          <option value="custom">Personalizado…</option>
          {SHEET_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <Segmented label="Unidades" options={UNITS} value={s.units} onChange={units => change({ units }, 'units')} />
      <div className="pair">
        <LengthField label="Ancho" mm={s.width} min={RANGES.width[0]} max={RANGES.width[1]} units={s.units} dpi={s.dpi} compact
          tip={aspect ? 'Ancho de la lámina. El alto se ajusta para conservar las proporciones de la forma importada.' : 'Ancho de la lámina. Cambiar las unidades convierte este valor sin modificar el tamaño.'}
          onChange={width => change(aspect ? { width, height: width / aspect } : { width }, 'width')} />
        <Button className="icon-button swap" label="Intercambiar ancho y alto" tip="Intercambia el ancho y el alto para cambiar la orientación de la lámina."
          unavailable={Boolean(aspect) && 'Intercambiar las dimensiones deformaría la forma importada. Gírala en tu aplicación de dibujo.'}
          onClick={() => change({ width: s.height, height: s.width }, 'swap')}><Icon name="swap" /></Button>
        <LengthField label="Alto" mm={s.height} min={RANGES.height[0]} max={RANGES.height[1]} units={s.units} dpi={s.dpi} compact
          tip={aspect ? 'Alto de la lámina. El ancho se ajusta para conservar las proporciones de la forma importada.' : 'Alto de la lámina.'}
          onChange={height => change(aspect ? { height, width: height * aspect } : { height }, 'height')} />
      </div>
      <p className="hint">{pw.toLocaleString()} × {ph.toLocaleString()} px a {s.dpi} píxeles por pulgada.</p>
      <Segmented label="Forma" options={shapes(Boolean(s.customShape))} value={s.shape} onChange={shape => {
        // Back to the imported shape at the current width, with the height that keeps it from stretching.
        if (shape === 'custom' && s.customShape) change({ shape, height: s.width * (s.customShape.height / s.customShape.width) }, 'shape')
        else change({ shape }, 'shape')
      }} />
      <Button className="wide" tip="Usa como lámina un contorno cerrado de un SVG de Illustrator, Inkscape, Figma o un archivo de corte. Las formas interiores se convierten en huecos. También puedes arrastrar un SVG a la ventana."
        onClick={onImportShape}><Icon name="import" />Importar forma SVG…</Button>
      {s.customShape && <p className="hint">
        <b>{s.customShape.name}</b>: {formatLength(s.customShape.width, s.units, s.dpi)} × {formatLength(s.customShape.height, s.units, s.dpi)} al importar
        {holes ? `, ${holes} ${holes === 1 ? 'hueco' : 'huecos'}` : ''}.{custom ? '' : ' Elige Importada para usarla.'}
      </p>}
      {custom && custom.sized !== 'file' && <div className="notice" role="status"><p>{ASSUMED[custom.sized]}</p></div>}
    </Section>

    <Section title="Composición">
      <LengthField label="Borde" mm={Math.min(s.border, maxBorder)} min={0} max={maxBorder} units={s.units} dpi={s.dpi} small
        tip={s.cellStyle === 'holes' ? 'Ancho del marco sólido entre el borde de la lámina y los huecos.' : 'Distancia entre el borde de la lámina y el patrón.'}
        onChange={border => change({ border }, 'border')} />
      <NumberField label="Píxeles por pulgada" value={s.dpi} min={RANGES.dpi[0]} max={RANGES.dpi[1]} suffix="ppp"
        tip="Resolución para las medidas en píxeles y la exportación PNG. Usa 300 para impresión y 72–144 para pantallas." onChange={dpi => change({ dpi: Math.round(dpi) }, 'dpi')} />
      <SwitchField label="Conservar puntos al cambiar la lámina" checked={s.keepPoints}
        tip="Activado: los puntos se adaptan al nuevo tamaño o forma. Desactivado: se crea un patrón nuevo, salvo que hayas editado puntos a mano."
        onChange={keepPoints => change({ keepPoints }, 'keepPoints')} />
    </Section>
  </>
})
