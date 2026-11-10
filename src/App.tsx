import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dock, Inspector, ViewBar } from './components/Bars'
import { FilePanel, type ExportKind } from './components/FilePanel'
import { ConfirmDialog, HelpDialog, QuickStart, type Pending } from './components/Help'
import { PatternPanel } from './components/PatternPanel'
import { SheetPanel } from './components/SheetPanel'
import { Stage, type StageControls, type Tool } from './components/Stage'
import { StylePanel } from './components/StylePanel'
import { TabPanel, Tabs } from './components/Tabs'
import { TooltipLayer } from './components/Tooltip'
import { cutDxf } from './lib/dxfExport'
import { EXTENSION, parseProject, ProjectError, serializeProject } from './lib/project'
import { pngProblem, renderPng } from './lib/render'
import { saveFile } from './lib/saveFile'
import { DEFAULTS, seedSettings, type Settings } from './lib/settings'
import { artworkSvg, laserSvg } from './lib/svgExport'
import { readSvgOutlines, SvgShapeError } from './lib/svgShape'
import { pixelSize, trimZeros, toUnits, UNIT_LABEL } from './lib/units'
import { freshDoc, spacingOf, useDesign, type Doc, type Status } from './useDesign'
import { integrateDensity, densityField } from './voronoi/density'
import { buildGeometry, patternRegion } from './voronoi/pattern'
import { randomSeed } from './voronoi/random'
import { contains, regionArea } from './voronoi/region'
import { shapeFromOutlines, ShapeError } from './voronoi/shape'

type TabId = 'pattern' | 'sheet' | 'style' | 'file'
const SESSION_KEY = 'voronoi-studio:session'
const SESSION_UNSAVED_KEY = 'voronoi-studio:session-unsaved'
const QUICK_START_KEY = 'voronoi-studio:quick-start-dismissed'

const storage = {
  get: (key: string) => { try { return localStorage.getItem(key) } catch { return null } },
  set: (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* private mode or full: skip */ } },
}

// The last session comes back after a reload or a closed tab, so work is never lost to an accident.
function initialDesign(): { doc: Doc; saved: boolean; restored: boolean } {
  const text = storage.get(SESSION_KEY)
  if (text) {
    try {
      const design = parseProject(text)
      return { doc: { ...design, stale: false }, saved: storage.get(SESSION_UNSAVED_KEY) !== '1', restored: true }
    } catch { /* an unreadable session starts fresh */ }
  }
  return { doc: freshDoc(DEFAULTS), saved: true, restored: false }
}

// The spacing Auto spacing would use, shown in the Spacing field while it is on.
function autoSpacingFor(s: Settings): number {
  const region = patternRegion(s)
  const count = Math.max(2, s.count)
  if (s.placement === 'hex') return Math.sqrt((2 * regionArea(region)) / (Math.sqrt(3) * count))
  if (s.placement === 'square') return Math.sqrt(regionArea(region) / count)
  const mass = integrateDensity(densityField(seedSettings(s).density, region), region, (x, y) => contains(region, x, y), 32)
  return Math.sqrt((0.62 * 2 / Math.sqrt(3)) * mass / count)
}

const baseName = (s: Settings) => {
  const unit = s.units === 'px' ? 'px' : s.units === 'in' ? 'in' : 'mm'
  const v = (mm: number) => trimZeros(toUnits(mm, unit, s.dpi).toFixed(unit === 'in' ? 2 : unit === 'px' ? 0 : 1))
  return `voronoi-${v(s.width)}x${v(s.height)}${UNIT_LABEL[unit]}`
}

export function App() {
  const [first] = useState(initialDesign)
  const [status, setStatus] = useState<Status>(() => (first.restored ? { text: 'Se restauró tu última sesión.' } : null))
  const design = useDesign(() => first, setStatus)
  const { doc } = design
  const s = doc.settings
  const [tab, setTab] = useState<TabId>('pattern')
  const [tool, setTool] = useState<Tool>('move')
  const [zoom, setZoom] = useState(1)
  const [showHelp, setShowHelp] = useState(false)
  const [showQuickStart, setShowQuickStart] = useState(() => storage.get(QUICK_START_KEY) !== '1')
  const [pending, setPending] = useState<Pending | null>(null)
  const [openError, setOpenError] = useState('')
  const frameRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<StageControls | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const shapeInput = useRef<HTMLInputElement>(null)

  // Routine messages fade back to the cell count; warnings stay until something else happens.
  useEffect(() => {
    if (!status || status.warning) return
    const timer = window.setTimeout(() => setStatus(null), 5000)
    return () => window.clearTimeout(timer)
  }, [status])

  // Geometry depends on a few settings only, so colour and visibility changes don't rebuild it.
  const { width, height, shape, customShape, border, cellStyle, web, cornerRadius, minHole, showDelaunay } = s
  const patternSettings = useMemo(() => ({ width, height, shape, customShape, border, cellStyle, web, cornerRadius, minHole, showDelaunay }),
    [width, height, shape, customShape, border, cellStyle, web, cornerRadius, minHole, showDelaunay])
  const geometry = useMemo(() => buildGeometry(doc.points, patternSettings), [doc.points, patternSettings])
  const exactSpacing = useCallback(() => spacingOf(s), [s])
  const count = doc.points.length / 2

  // Keep a copy of the session, a moment after the last change.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      storage.set(SESSION_KEY, serializeProject(doc))
      storage.set(SESSION_UNSAVED_KEY, design.unsaved ? '1' : '0')
    }, 600)
    return () => window.clearTimeout(timer)
  }, [doc, design.unsaved])

  // Asks before discarding unsaved work, in an in-app dialog (embedded browsers can block confirm()).
  const guard = useCallback((when: boolean, p: Pending) => { if (when) setPending(p); else p.run() }, [])

  const generateNew = useCallback(() => guard(doc.handEdited, {
    title: '¿Reemplazar los puntos editados?', confirm: 'Generar nuevo',
    body: 'El nuevo patrón reemplaza los puntos que moviste, agregaste o borraste. Puedes recuperarlos con Deshacer.',
    run: () => design.generate(randomSeed()),
  }), [guard, doc.handEdited, design])

  const applySettings = () => guard(true, {
    title: '¿Aplicar los nuevos ajustes?', confirm: 'Aplicar ajustes',
    body: 'Los puntos editados a mano se reemplazarán por un patrón con los ajustes actuales. Puedes recuperarlos con Deshacer.',
    run: () => design.generate(),
  })

  const newDesign = () => guard(design.unsaved, {
    title: '¿Crear un nuevo diseño?', confirm: 'Descartar y crear nuevo',
    body: 'Se perderán los cambios sin guardar del diseño actual. Puedes recuperarlo con Deshacer durante esta sesión.',
    run: () => { design.replace(freshDoc({ ...DEFAULTS, seed: randomSeed() }), true); setStatus({ text: 'Nuevo diseño.' }) },
  })

  const openProject = () => guard(design.unsaved, {
    title: '¿Abrir otro proyecto?', confirm: 'Descartar y abrir',
    body: 'Se perderán los cambios sin guardar del diseño actual. Puedes recuperarlo con Deshacer durante esta sesión.',
    run: () => fileInput.current?.click(),
  })

  const readProject = async (file: File) => {
    try {
      const opened = parseProject(await file.text())
      design.replace({ ...opened, stale: false }, true)
      setOpenError('')
      setStatus({ text: `Se abrió ${file.name}.` })
    } catch (error) {
      // The current design stays as it was.
      setOpenError(error instanceof ProjectError ? error.message : `No se pudo leer ${file.name}.`)
      setTab('file')
    }
  }

  // An SVG outline becomes the sheet. A new shape means a new pattern, so hand edits are confirmed first.
  const replaceEdits = (run: () => void) => guard(doc.handEdited, {
    title: '¿Reemplazar los puntos editados?', confirm: 'Usar la nueva forma',
    body: 'Al cambiar la forma de la lámina se genera un patrón que reemplaza los puntos que moviste, agregaste o borraste. Puedes recuperarlos con Deshacer.',
    run,
  })
  const importShape = () => replaceEdits(() => shapeInput.current?.click())

  const readShape = async (file: File) => {
    try {
      const outlines = readSvgOutlines(await file.text())
      const shape = shapeFromOutlines(outlines.rings, file.name, outlines.units)
      const edited = design.doc.handEdited
      design.change({ shape: 'custom', customShape: shape, width: shape.width, height: shape.height }, 'customShape')
      if (edited) design.generate() // already confirmed: start fresh in the new shape
      setTab('sheet')
      const skipped = outlines.open ? ` Se ${outlines.open === 1 ? 'omitió' : 'omitieron'} ${outlines.open} ${outlines.open === 1 ? 'línea abierta' : 'líneas abiertas'}.` : ''
      const using = outlines.fromClip ? `${file.name} es una imagen; se usa el contorno de su máscara de recorte como lámina.` : `Se usa ${file.name} como lámina.`
      setStatus({ text: `${using}${skipped}`, warning: Boolean(outlines.open) || outlines.fromClip })
    } catch (error) {
      const known = error instanceof SvgShapeError || error instanceof ShapeError
      setStatus({ text: known ? error.message : `No se pudo leer ${file.name} como una forma.`, warning: true })
    }
  }

  // Files dropped on the window: SVGs become the sheet shape, project files open.
  useEffect(() => {
    const over = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault() }
    const drop = (event: DragEvent) => {
      const file = event.dataTransfer?.files[0]
      if (!file) return
      event.preventDefault()
      if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') replaceEdits(() => void readShape(file))
      else if (/\.json$/i.test(file.name)) guard(design.unsaved, {
        title: '¿Abrir otro proyecto?', confirm: 'Descartar y abrir',
        body: 'Se perderán los cambios sin guardar del diseño actual. Puedes recuperarlo con Deshacer durante esta sesión.',
        run: () => void readProject(file),
      })
      else setStatus({ text: `${file.name} no es una forma SVG ni un proyecto de Voronoi Studio.`, warning: true })
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  })

  const report = (name: string, result: Awaited<ReturnType<typeof saveFile>>) => {
    if (result === 'saved' || result === 'downloaded') setStatus({ text: `${result === 'saved' ? 'Guardado:' : 'Descargado:'} ${name}.` })
    else if (result === 'failed') setStatus({ text: `No se pudo guardar ${name}.`, warning: true })
    return result === 'saved' || result === 'downloaded'
  }

  const saveProject = async () => {
    const snapshot = doc
    const name = `${baseName(s)}${EXTENSION}`
    if (report(name, await saveFile(name, serializeProject(snapshot), 'application/json', 'Proyecto de Voronoi Studio'))) design.markSaved(snapshot)
  }

  const exportFile = async (kind: ExportKind) => {
    const base = baseName(s)
    if (kind === 'svg') report(`${base}.svg`, await saveFile(`${base}.svg`, artworkSvg(geometry, doc.points, s), 'image/svg+xml', 'Imagen SVG'))
    if (kind === 'laser') report(`${base}-cut.svg`, await saveFile(`${base}-cut.svg`, laserSvg(geometry, doc.points, s), 'image/svg+xml', 'Archivo SVG para corte'))
    if (kind === 'dxf') report(`${base}.dxf`, await saveFile(`${base}.dxf`, cutDxf(geometry, doc.points, s), 'application/dxf', 'Dibujo DXF'))
    if (kind === 'png') {
      const [w, h] = pixelSize(s.width, s.height, s.dpi)
      const problem = pngProblem(w, h)
      if (problem) { setStatus({ text: problem, warning: true }); return }
      setStatus({ text: `Generando un PNG de ${w.toLocaleString()} × ${h.toLocaleString()} px…` })
      const blob = await renderPng(geometry, doc.points, s, w, h)
      if (!blob) { setStatus({ text: 'El navegador no pudo generar un PNG tan grande. Reduce los píxeles por pulgada.', warning: true }); return }
      report(`${base}.png`, await saveFile(`${base}.png`, blob, 'image/png', 'Imagen PNG'))
    }
  }

  const relaxBlocked = count < 3 && 'Se necesitan al menos 3 puntos para relajar.'
  const toggle = (key: 'showSites' | 'showEdges' | 'showDelaunay') => design.change({ [key]: !s[key] }, key)
  const closeQuickStart = () => { setShowQuickStart(false); storage.set(QUICK_START_KEY, '1') }

  // Keyboard shortcuts, ignored while typing. Re-registered each render so handlers see current state.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const typing = Boolean(target?.closest('input, select, textarea'))
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (event.key === 'Escape') { setShowHelp(false); setPending(null); if (!typing) setTool('move'); return }
      if (pending || showHelp) return
      if (mod && key === 's') { event.preventDefault(); void saveProject(); return }
      if (mod && key === 'o') { event.preventDefault(); openProject(); return }
      if (typing) return
      if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) design.redo(); else design.undo(); return }
      if (mod && key === 'y') { event.preventDefault(); design.redo(); return }
      if (mod || event.altKey) return
      if (key === 'g') generateNew()
      else if (key === 'r') { if (!relaxBlocked) design.relaxOnce() }
      else if (key === 'p') { if (!relaxBlocked) design.toggleAuto() }
      else if (key === 'v') setTool('move')
      else if (key === 'a') setTool('add')
      else if (key === 'e') setTool('erase')
      else if (key === 'h') setTool('pan')
      else if (key === '1') toggle('showSites')
      else if (key === '2') toggle('showEdges')
      else if (key === '3') toggle('showDelaunay')
      else if (key === 'f' || key === '0') stageRef.current?.fit()
      else if (key === '+' || key === '=') stageRef.current?.zoomBy(1.25)
      else if (key === '-' || key === '_') stageRef.current?.zoomBy(1 / 1.25)
      else if (event.key === '?') setShowHelp(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const statusText = status?.text ?? (design.busy ? 'Actualizando el patrón…'
    : `${count.toLocaleString()} celdas · semilla ${s.seed}${doc.handEdited ? ' · editado a mano' : ''}`)

  return <main className="studio">
    <TooltipLayer />
    <div className="stage">
      <Stage geometry={geometry} points={doc.points} settings={s} tool={tool} frameRef={frameRef} controlRef={stageRef}
        onBeginEdit={() => { design.beginEdit(); setStatus(null) }} onPoints={design.editPoints} onZoom={setZoom}
        onNotice={text => setStatus({ text })} />
    </div>

    <header className="brand glass">
      <div><p className="app-kicker">Patrones Voronoi para crear</p><h1>Voronoi Studio</h1></div>
      <button type="button" className="icon-button" aria-label="Atajos de teclado y ayuda" data-tip="Atajos de teclado y guía de inicio." data-key="?" onClick={() => setShowHelp(true)}>?</button>
    </header>

    <aside className="sidebar side-panel glass" aria-label="Controles del diseño">
      <Tabs label="Controles del diseño" idBase="design" value={tab} onChange={setTab} tabs={[
        { id: 'pattern', label: 'Patrón', title: 'Cantidad y distribución de celdas, gradientes y relajación.', badge: doc.stale ? 'ajustes sin aplicar' : undefined },
        { id: 'sheet', label: 'Lámina', title: 'Tamaño, forma, unidades y borde de la lámina.' },
        { id: 'style', label: 'Estilo', title: 'Líneas o huecos, ancho del material, radio de las esquinas y colores.' },
        { id: 'file', label: 'Archivo', title: 'Guarda o abre un proyecto y exporta SVG para láser, DXF, SVG o PNG.', badge: design.unsaved ? 'cambios sin guardar' : undefined },
      ]} />
      <TabPanel idBase="design" id="pattern" value={tab}>
        <PatternPanel s={s} change={design.change} stale={doc.stale} onApply={applySettings} actualCount={count}
          autoSpacingValue={design.spacing || autoSpacingFor(s)} exactSpacing={exactSpacing} capped={design.capped} onShuffle={generateNew} />
      </TabPanel>
      <TabPanel idBase="design" id="sheet" value={tab}><SheetPanel s={s} change={design.change} onImportShape={importShape} /></TabPanel>
      <TabPanel idBase="design" id="style" value={tab}><StylePanel s={s} change={design.change} holes={geometry.metrics.holes} dropped={geometry.metrics.dropped} /></TabPanel>
      <TabPanel idBase="design" id="file" value={tab}>
        <FilePanel s={s} change={design.change} unsaved={design.unsaved} busy={design.busy} openError={openError}
          onNew={newDesign} onOpen={openProject} onSave={() => void saveProject()} onExport={kind => void exportFile(kind)} />
      </TabPanel>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Elige un archivo de proyecto" onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void readProject(file)
      }} />
      <input ref={shapeInput} type="file" accept=".svg,image/svg+xml" hidden aria-label="Elige una forma SVG" onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void readShape(file)
      }} />
    </aside>

    <div className="center">
      <ViewBar tool={tool} setTool={setTool} s={s} toggle={toggle} zoom={zoom} onFit={() => stageRef.current?.fit()} onZoom={f => stageRef.current?.zoomBy(f)} />
      <div className="sheet-frame" ref={frameRef}>
        {showQuickStart && <QuickStart onClose={closeQuickStart} />}
      </div>
      <Dock relaxSteps={s.relaxSteps} auto={design.auto} busy={design.busy} canRelax={relaxBlocked}
        onGenerate={generateNew} onRelax={design.relaxOnce} onAuto={design.toggleAuto}
        status={statusText} warning={Boolean(status?.warning)}
        canUndo={design.canUndo} canRedo={design.canRedo} onUndo={design.undo} onRedo={design.redo} />
    </div>

    <aside className="inspector side-panel glass" aria-label="Medidas">
      <Inspector m={geometry.metrics} s={s} count={count} />
    </aside>

    {pending && <ConfirmDialog pending={pending} onCancel={() => setPending(null)} />}
    {showHelp && <HelpDialog onClose={() => setShowHelp(false)} onQuickStart={() => { setShowHelp(false); setShowQuickStart(true) }} />}
  </main>
}
