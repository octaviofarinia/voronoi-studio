import { memo } from 'react'
import { cutContents, cutLayers, listWords } from '../lib/cutPaths'
import { pngProblem } from '../lib/render'
import type { Settings } from '../lib/settings'
import { pixelSize, UNIT_NAME } from '../lib/units'
import { holeCount } from '../voronoi/shape'
import { Button, Section, SwitchField } from './Controls'
import type { Change } from './PatternPanel'

export type ExportKind = 'png' | 'svg' | 'laser' | 'dxf'

// Memoised: the panel only re-renders when its own props change, not on every relax step.
export const FilePanel = memo(function FilePanel({ s, change, unsaved, busy, onNew, onOpen, onSave, onExport, openError }: {
  s: Settings; change: Change; unsaved: boolean; busy: boolean
  onNew: () => void; onOpen: () => void; onSave: () => void; onExport: (kind: ExportKind) => void; openError: string
}) {
  const [pw, ph] = pixelSize(s.width, s.height, s.dpi)
  const pngBlocked = pngProblem(pw, ph)
  const fileUnits = s.units === 'in' ? 'pulgadas' : 'milímetros'
  const working = busy && 'Espera a que termine de actualizarse el patrón.'
  const contents = cutContents(s)
  const nothing = !contents.length && `No hay nada que cortar. Activa Puntos, ${s.cellStyle === 'holes' ? 'Huecos' : 'Aristas'} o Delaunay en la barra superior, o incluye el contorno de la lámina.`
  const layers = cutLayers(s, s.shape === 'custom' && !!s.customShape && holeCount(s.customShape) > 0)
  return <>
    <Section title="Proyecto">
      <p className="hint save-state">{unsaved ? <><span className="dot" aria-hidden="true" />Hay cambios sin guardar.</> : 'Todos los cambios guardados.'}</p>
      <div className="button-row three">
        <Button tip="Crea un diseño con los ajustes predeterminados." onClick={onNew}>Nuevo</Button>
        <Button tip="Abre un archivo de proyecto de Voronoi Studio (.voronoi.json)." shortcut="⌘O" onClick={onOpen}>Abrir…</Button>
        <Button className="primary" tip="Guarda los ajustes y todos los puntos, incluidas las ediciones manuales, en un proyecto que puedes volver a abrir." shortcut="⌘S" unavailable={working} onClick={onSave}>Guardar</Button>
      </div>
      {openError && <p className="hint error" role="alert">{openError}</p>}
    </Section>

    <Section title="Para corte">
      <div className="button-row">
        <Button tip={`Trazos ultrafinos en ${fileUnits} a tamaño real para LightBurn, Glowforge y otros programas de láser: cortes en rojo, primero los huecos, con los puntos y las líneas de Delaunay en sus propios colores si están visibles.`} unavailable={working || nothing} onClick={() => onExport('laser')}>SVG láser</Button>
        <Button tip={`DXF AutoCAD R12 en ${fileUnits}, con esquinas redondeadas como arcos reales y los puntos y las líneas de Delaunay en capas propias si están visibles, para Fusion, Illustrator, VCarve y CAM.`} unavailable={working || nothing} onClick={() => onExport('dxf')}>DXF</Button>
      </div>
      <SwitchField label="Incluir el contorno de la lámina" checked={s.sheetOutline}
        tip="Agrega el contorno de la lámina como corte exterior, en su propia capa después de los cortes interiores." onChange={sheetOutline => change({ sheetOutline }, 'sheetOutline')} />
      <p className="hint">{nothing || <>Los archivos de corte incluyen lo que ves: {listWords(contents)}, sin repetir líneas. Capas: {listWords(layers)}.</>}</p>
    </Section>

    <Section title="Para diseño gráfico">
      <div className="button-row">
        <Button tip={`El diseño tal como lo ves, con colores, puntos y líneas de Delaunay si están visibles, en ${s.units === 'px' ? 'píxeles' : UNIT_NAME[s.units === 'in' ? 'in' : 'mm']}.`}
          unavailable={working} onClick={() => onExport('svg')}>SVG</Button>
        <Button tip={`Una imagen de ${pw.toLocaleString()} × ${ph.toLocaleString()} px a ${s.dpi} píxeles por pulgada.`} unavailable={working || (pngBlocked ?? false)} onClick={() => onExport('png')}>PNG</Button>
      </div>
      <SwitchField label="Fondo PNG transparente" checked={s.transparentPng}
        tip="Exporta el PNG sin el fondo de la lámina." onChange={transparentPng => change({ transparentPng }, 'transparentPng')} />
      <p className="hint">{pngBlocked ?? `PNG: ${pw.toLocaleString()} × ${ph.toLocaleString()} px. Las exportaciones siempre muestran la lámina completa, sin importar el zoom.`}</p>
    </Section>
  </>
})
