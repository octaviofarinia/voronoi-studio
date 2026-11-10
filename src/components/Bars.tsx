import type { ReactNode } from 'react'
import type { Settings } from '../lib/settings'
import { formatLength, formatLong, formatSmall } from '../lib/units'
import type { Metrics } from '../voronoi/pattern'
import { Button } from './Controls'
import { Icon, type IconName } from './Icon'
import type { Tool } from './Stage'

// The floating bars around the sheet: tools and visibility on top, the main actions and status below,
// and the measurements panel.

const TOOLS: { id: Tool; label: string; icon: IconName; key: string; tip: string }[] = [
  { id: 'move', label: 'Mover', icon: 'move', key: 'V', tip: 'Arrastra un punto para mover su celda. Alt + clic agrega, Mayús + clic borra y arrastrar el espacio vacío desplaza la vista.' },
  { id: 'add', label: 'Agregar', icon: 'add', key: 'A', tip: 'Haz clic para agregar una celda; mantén pulsado para ubicarla.' },
  { id: 'erase', label: 'Borrar', icon: 'erase', key: 'E', tip: 'Haz clic en una celda para borrarla o arrastra sobre varias para borrarlas.' },
  { id: 'pan', label: 'Desplazar', icon: 'pan', key: 'H', tip: 'Arrastra para desplazar la vista. Mantén pulsada la barra espaciadora para hacerlo con cualquier herramienta.' },
]

const TOOL_CAPTION: Record<Tool, string> = {
  move: 'Arrastra un punto para moverlo · Alt + clic agrega · Mayús + clic borra · Espacio + arrastrar desplaza · Rueda para zoom',
  add: 'Haz clic dentro del borde para agregar una celda · Esc para Mover',
  erase: 'Haz clic o arrastra sobre las celdas para borrarlas · Esc para Mover',
  pan: 'Arrastra para desplazar la vista · Rueda o pellizco para zoom · Esc para Mover',
}

export function ViewBar({ tool, setTool, s, toggle, zoom, onFit, onZoom }: {
  tool: Tool; setTool: (tool: Tool) => void; s: Settings
  toggle: (key: 'showSites' | 'showEdges' | 'showDelaunay') => void; zoom: number; onFit: () => void; onZoom: (factor: number) => void
}) {
  const edgeName = s.cellStyle === 'holes' ? 'Huecos' : 'Aristas'
  return <div className="viewport-bars">
    <div className="viewport-bar-row">
      <div className="floating-bar glass" role="toolbar" aria-label="Herramientas">
        {TOOLS.map(t => <Button key={t.id} pressed={tool === t.id} tip={t.tip} shortcut={t.key} label={t.label} onClick={() => setTool(t.id)}>
          <Icon name={t.icon} /><span className="compact-label">{t.label}</span></Button>)}
      </div>
      <div className="floating-bar glass" role="toolbar" aria-label="Mostrar">
        <Button pressed={s.showSites} shortcut="1" tip="Muestra u oculta los puntos que originan cada celda." onClick={() => toggle('showSites')}>Puntos</Button>
        <Button pressed={s.showEdges} shortcut="2" tip={`Muestra u oculta ${s.cellStyle === 'holes' ? 'los huecos' : 'las aristas'} de las celdas.`} onClick={() => toggle('showEdges')}>{edgeName}</Button>
        <Button pressed={s.showDelaunay} shortcut="3" tip="Muestra u oculta la triangulación de Delaunay: las líneas que unen puntos vecinos." onClick={() => toggle('showDelaunay')}>Delaunay</Button>
        <span className="bar-divider" aria-hidden="true" />
        <Button className="icon-button zoom-step" label="Alejar" shortcut="−" tip="Alejar." onClick={() => onZoom(1 / 1.25)}><Icon name="minus" /></Button>
        <Button className="zoom-readout" shortcut="F" tip="Ajusta la lámina completa a la ventana." label={`Zoom al ${Math.round(zoom * 100)} por ciento. Ajustar a la ventana`} onClick={onFit}>{Math.round(zoom * 100)}%</Button>
        <Button className="icon-button zoom-step" label="Acercar" shortcut="+" tip="Acercar." onClick={() => onZoom(1.25)}><Icon name="plus" /></Button>
      </div>
    </div>
    <p className="view-caption"><span>{TOOL_CAPTION[tool]}</span></p>
  </div>
}

export function Dock({ relaxSteps, auto, busy, canRelax, onGenerate, onRelax, onAuto, status, warning, canUndo, canRedo, onUndo, onRedo }: {
  relaxSteps: number; auto: boolean; busy: boolean; canRelax: string | false
  onGenerate: () => void; onRelax: () => void; onAuto: () => void
  status: ReactNode; warning: boolean; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void
}) {
  const steps = Math.max(1, relaxSteps)
  return <div className="dock">
    <div className="timeline glass">
      <div className="transport" role="group" aria-label="Acciones del patrón">
        <Button className="primary" shortcut="G" tip="Crea un patrón con una nueva semilla aleatoria y los ajustes actuales." onClick={onGenerate}>
          <Icon name="dice" />Generar</Button>
        <Button shortcut="R" unavailable={canRelax || (auto && 'La relajación automática ya está en marcha.') || (busy && 'Espera a que termine la actualización actual.')}
          tip={`Aplica ${steps} ${steps === 1 ? 'paso' : 'pasos'} de relajación de Lloyd: cada punto se mueve al centro de su celda para equilibrar los tamaños.`}
          onClick={onRelax}><Icon name="relax" /><span className="compact-label">Relajar ×{steps}</span></Button>
        <Button shortcut="P" pressed={auto} unavailable={canRelax || (!auto && busy && 'Espera a que termine la actualización actual.')} tip={auto ? 'Detén la relajación.' : 'Sigue relajando hasta que los puntos se estabilicen o lo detengas.'}
          onClick={onAuto}><Icon name={auto ? 'pause' : 'play'} /><span className="compact-label">Autorrelajar</span></Button>
      </div>
      <span className="timeline-status" role="status" data-warning={warning}>{status}</span>
      <div className="transport" role="group" aria-label="Historial">
        <Button className="icon-button" label="Deshacer" shortcut="⌘Z" unavailable={!canUndo && 'Todavía no hay cambios para deshacer.'} tip="Deshace el último cambio." onClick={onUndo}><Icon name="undo" /></Button>
        <Button className="icon-button" label="Rehacer" shortcut="⇧⌘Z" unavailable={!canRedo && 'No hay cambios para rehacer.'} tip="Rehace el cambio que deshiciste." onClick={onRedo}><Icon name="redo" /></Button>
      </div>
    </div>
  </div>
}

export function Inspector({ m, s, count }: { m: Metrics; s: Settings; count: number }) {
  const L = (mm: number) => formatSmall(mm, s.units, s.dpi)
  const holes = s.cellStyle === 'holes'
  const rows: [string, string, string][] = [
    ['Lámina', `${formatLength(s.width, s.units, s.dpi)} × ${formatLength(s.height, s.units, s.dpi)}`, s.shape === 'ellipse' ? 'Una elipse que se ajusta a este ancho y alto.'
      : s.shape === 'custom' ? `La forma importada${s.customShape ? `, ${s.customShape.name},` : ''} con este ancho y alto.` : 'Ancho × alto de la lámina.'],
    ['Celdas', count.toLocaleString(), 'Cantidad de puntos, uno por celda.'],
    ...(holes ? [['Huecos', `${m.holes.toLocaleString()}${m.dropped ? ` · ${m.dropped.toLocaleString()} sin perforar` : ''}`,
      'Huecos recortados. Las celdas menores que el hueco mínimo o cerradas por el material quedan sin perforar.'] as [string, string, string]] : []),
    ['Celda media', `Ø ${L(m.meanSize)}`, 'Diámetro de un círculo con el área media de las celdas.'],
    ['Variación', `${(m.evenness * 100).toFixed(1)} %`, 'Variación del área de las celdas (coeficiente de variación). 0 % indica tamaños iguales; los puntos aleatorios rondan el 50 %.'],
    holes
      ? ['Hueco más estrecho', m.holes ? L(m.narrowest) : '—', 'El menor ancho de todos los huecos. Compáralo con el ancho de corte del láser o el diámetro de la fresa.']
      : ['Arista más corta', L(m.shortestEdge), 'Las aristas muy cortas producen fragmentos y esquinas diminutos. La relajación las alarga.'],
    ['Longitud de corte', formatLong(m.cutLength, s.units), 'Longitud total de las líneas de corte, incluido el contorno de la lámina, para estimar el tiempo del láser o del plóter.'],
  ]
  return <section className="measurements" aria-labelledby="measure-title">
    <h2 id="measure-title">Medidas</h2>
    <dl>{rows.map(([term, value, tip]) => <div key={term}><dt data-tip={tip} tabIndex={0}>{term}</dt><dd>{value}</dd></div>)}</dl>
  </section>
}
