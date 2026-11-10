import { Modal } from './Modal'

// The quick start card and the ? dialog with every shortcut.

export function QuickStart({ onClose }: { onClose: () => void }) {
  return <section className="quick-start glass" aria-labelledby="quick-start-title">
    <h2 id="quick-start-title">Guía de inicio</h2>
    <ol>
      <li><b>Lámina:</b> elige un tamaño y una forma, como una baldosa de 200 mm o un posavasos, o importa un contorno SVG.</li>
      <li><b>Patrón:</b> elige la cantidad y distribución de celdas; luego muévelas, agrégalas o bórralas en la lámina.</li>
      <li><b>Estilo</b> y <b>Archivo:</b> elige Líneas o Huecos y exporta un SVG para láser o DXF a tamaño real.</li>
    </ol>
    <p>Pasa el cursor por un control para ver qué hace.</p>
    <button type="button" className="primary" data-tip="Oculta esta guía. Puedes volver a abrirla con el botón ?." onClick={onClose}>Entendido</button>
  </section>
}

const SHORTCUTS: [string, string][] = [
  ['G', 'Generar un nuevo patrón'],
  ['R', 'Relajar'],
  ['P', 'Activar o detener Autorrelajar'],
  ['V  A  E  H', 'Herramientas Mover, Agregar, Borrar y Desplazar'],
  ['Espacio', 'Arrastrar para desplazar con cualquier herramienta'],
  ['Alt + clic', 'Agregar una celda'],
  ['Mayús + clic', 'Borrar una celda'],
  ['Rueda, pellizco', 'Zoom'],
  ['+  −  F', 'Acercar, alejar, ajustar'],
  ['1  2  3', 'Puntos, aristas, Delaunay'],
  ['⌘Z  ⇧⌘Z', 'Deshacer, rehacer'],
  ['⌘S  ⌘O', 'Guardar, abrir proyecto'],
  ['Esc', 'Cerrar o volver a Mover'],
  ['?', 'Esta lista'],
]

export function HelpDialog({ onClose, onQuickStart }: { onClose: () => void; onQuickStart: () => void }) {
  return <Modal labelledBy="help-title" onClose={onClose}>
    <h2 id="help-title">Atajos de teclado</h2>
    <dl>{SHORTCUTS.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>)}</dl>
    <p className="hint">En pantallas táctiles, un dedo edita con la herramienta actual y dos dedos desplazan la vista y cambian el zoom. En Windows, usa Ctrl en lugar de ⌘.</p>
    <div className="confirm-actions">
      <button type="button" data-tip="Vuelve a mostrar la guía de tres pasos." onClick={onQuickStart}>Mostrar guía de inicio</button>
      <button type="button" className="primary" data-autofocus onClick={onClose}>Cerrar</button>
    </div>
  </Modal>
}

export type Pending = { title: string; body: string; confirm: string; run: () => void }

export function ConfirmDialog({ pending, onCancel }: { pending: Pending; onCancel: () => void }) {
  return <Modal role="alertdialog" labelledBy="confirm-title" describedBy="confirm-body" onClose={onCancel}>
    <h2 id="confirm-title">{pending.title}</h2>
    <p id="confirm-body" className="hint">{pending.body}</p>
    <div className="confirm-actions">
      <button type="button" data-autofocus data-tip="Conserva el diseño actual." onClick={onCancel}>Cancelar</button>
      <button type="button" className="primary" data-tip="Continúa. Puedes recuperar los puntos actuales con Deshacer." onClick={() => { onCancel(); pending.run() }}>{pending.confirm}</button>
    </div>
  </Modal>
}
