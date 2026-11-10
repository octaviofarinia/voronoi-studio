import { memo } from 'react'
import { RANGES, type Settings } from '../lib/settings'
import type { CellStyle } from '../voronoi/pattern'
import { ColorField, LengthField, Section, Segmented, SwitchField, type Option } from './Controls'
import type { Change } from './PatternPanel'

const STYLES: Option<CellStyle>[] = [
  { value: 'lines', label: 'Líneas', tip: 'Aristas de las celdas como líneas simples para grabado, plóter, impresión o corte de celdas individuales.' },
  { value: 'holes', label: 'Huecos', tip: 'Cada celda se recorta como un hueco con esquinas redondeadas, dejando material entre ellas.' },
]

// Memoised: the panel only re-renders when its own props change, not on every relax step.
export const StylePanel = memo(function StylePanel({ s, change, holes, dropped }: { s: Settings; change: Change; holes: number; dropped: number }) {
  const len = { units: s.units, dpi: s.dpi, small: true }
  return <>
    <Section title="Celdas">
      <Segmented label="Estilo de celda" options={STYLES} value={s.cellStyle} onChange={cellStyle => change({ cellStyle }, 'cellStyle')} />
      <p className="hint">{s.cellStyle === 'holes'
        ? 'Huecos: recortes con material sólido entre ellos, como en un panel Voronoi de corte láser o impresión 3D.'
        : 'Líneas: cada arista se dibuja una sola vez para que la cortadora o el plóter no repase ninguna línea.'}</p>
      {s.cellStyle === 'holes' && <>
        <LengthField label="Ancho entre huecos" mm={s.web} min={RANGES.web[0]} max={RANGES.web[1]} {...len}
          tip="Ancho del material que queda entre huecos vecinos." onChange={web => change({ web }, 'web')} />
        <LengthField label="Radio de esquinas" mm={s.cornerRadius} min={RANGES.cornerRadius[0]} max={RANGES.cornerRadius[1]} {...len}
          tip="Redondea las esquinas de cada hueco. En los pequeños se usa el mayor radio que cabe. Para CNC, usa el radio de tu fresa." onChange={cornerRadius => change({ cornerRadius }, 'cornerRadius')} />
        <LengthField label="Hueco mínimo" mm={s.minHole} min={RANGES.minHole[0]} max={RANGES.minHole[1]} {...len}
          tip="Los huecos más estrechos quedan sin perforar para evitar que los fragmentos diminutos se quemen o se rompan." onChange={minHole => change({ minHole }, 'minHole')} />
        {holes === 0 && dropped > 0
          ? <div className="notice" role="status"><p>No caben huecos: el ancho del material o el hueco mínimo supera el tamaño de las celdas. Reduce uno de esos valores o la cantidad de celdas.</p></div>
          : dropped > 0 && <p className="hint">{dropped.toLocaleString()} {dropped === 1 ? 'celda queda' : 'celdas quedan'} sin perforar por {dropped === 1 ? 'ser más estrecha' : 'ser más estrechas'} que el hueco mínimo.</p>}
      </>}
    </Section>

    <Section title="Color y línea">
      <LengthField label="Grosor de línea" mm={s.lineWidth} min={RANGES.lineWidth[0]} max={RANGES.lineWidth[1]} {...len}
        tip="Grosor del trazo en la vista previa, PNG y SVG artístico. Los archivos para láser siempre usan líneas ultrafinas." onChange={lineWidth => change({ lineWidth }, 'lineWidth')} />
      <ColorField label="Color de línea" value={s.lineColor} tip="Color de las aristas de las celdas." onChange={lineColor => change({ lineColor }, 'lineColor')} />
      <SwitchField label={s.cellStyle === 'holes' ? 'Rellenar huecos' : 'Rellenar celdas'} checked={s.fill}
        tip={s.cellStyle === 'holes' ? 'Colorea el interior de cada hueco.' : 'Colorea el área interior del patrón.'} onChange={fill => change({ fill }, 'fill')} />
      {s.fill && <ColorField label="Color de relleno" value={s.fillColor} tip="Color del interior de las celdas." onChange={fillColor => change({ fillColor }, 'fillColor')} />}
      <ColorField label={s.cellStyle === 'holes' ? 'Color del material' : 'Fondo'} value={s.background}
        tip="Color de la lámina detrás del patrón." onChange={background => change({ background }, 'background')} />
      <p className="hint">Los puntos, las aristas y las líneas de Delaunay se activan y desactivan desde la barra superior, tanto para la vista como para las exportaciones.</p>
    </Section>
  </>
})
