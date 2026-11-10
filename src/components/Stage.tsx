import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { drawDesign, type Hover } from '../lib/render'
import type { Settings } from '../lib/settings'
import { nearestPoint } from '../voronoi/diagram'
import type { Geometry } from '../voronoi/pattern'
import { clampToRegion, contains } from '../voronoi/region'

export type Tool = 'move' | 'add' | 'erase' | 'pan'
export type StageControls = { fit: () => void; zoomBy: (factor: number) => void }
export type EditKind = 'move' | 'add' | 'erase'

type View = { zoom: number; panX: number; panY: number }
type Drag =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'point'; index: number; dx: number; dy: number }
  | { kind: 'erase'; last: number }
  | { kind: 'pinch'; distance: number; midX: number; midY: number; view: View; worldX: number; worldY: number }

const ZOOM_MIN = 0.25, ZOOM_MAX = 40
const FIT_PADDING = 20

// The sheet preview. It fills the window behind the panels and fits the sheet into the free area between
// them (the frame). Pointer input edits points: drag to move, Alt-click to add, Shift-click to erase,
// Space or the Pan tool to pan, wheel or pinch to zoom.
export function Stage({ geometry, points, settings, tool, frameRef, controlRef, onBeginEdit, onPoints, onZoom, onNotice }: {
  geometry: Geometry
  points: Float64Array
  settings: Settings
  tool: Tool
  frameRef: RefObject<HTMLDivElement | null>
  controlRef: RefObject<StageControls | null>
  onBeginEdit: (kind: EditKind) => void
  onPoints: (points: Float64Array) => void
  onZoom: (zoom: number) => void
  onNotice: (text: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0, frame: { x: 0, y: 0, width: 0, height: 0 } })
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 })
  const [hover, setHover] = useState<Hover>(null)
  const [cursor, setCursor] = useState('default')
  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const space = useRef(false)
  // Latest points for handlers that run between renders.
  const live = useRef(points)
  useEffect(() => { live.current = points }, [points])

  // Track the window and the free frame between panels.
  useLayoutEffect(() => {
    const measure = () => {
      const outer = box.current?.getBoundingClientRect()
      const inner = frameRef.current?.getBoundingClientRect()
      if (!outer) return
      const frame = inner && inner.width > 40 && inner.height > 40
        ? { x: inner.left - outer.left, y: inner.top - outer.top, width: inner.width, height: inner.height }
        : { x: 0, y: 0, width: outer.width, height: outer.height }
      setSize({ width: outer.width, height: outer.height, frame })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (box.current) observer.observe(box.current)
    if (frameRef.current) observer.observe(frameRef.current)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [frameRef])

  const fitScale = Math.max(1e-6, Math.min((size.frame.width - FIT_PADDING * 2) / settings.width, (size.frame.height - FIT_PADDING * 2) / settings.height))
  const centerX = size.frame.x + size.frame.width / 2, centerY = size.frame.y + size.frame.height / 2
  // Where the sheet's top-left corner lands for a scale and pan.
  const originX = useCallback((s: number, pan: number) => centerX - (settings.width / 2) * s + pan, [centerX, settings.width])
  const originY = useCallback((s: number, pan: number) => centerY - (settings.height / 2) * s + pan, [centerY, settings.height])
  const scale = fitScale * view.zoom
  const ox = originX(scale, view.panX), oy = originY(scale, view.panY)

  useEffect(() => onZoom(view.zoom), [view.zoom, onZoom])

  // Draw whenever anything visible changes.
  useLayoutEffect(() => {
    const el = canvas.current
    if (!el || !size.width) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(size.width * dpr), h = Math.round(size.height * dpr)
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    drawDesign(ctx, geometry, points, settings, { scale, ox, oy, dpr, preview: true, hover })
    // Read-only view state for QA scripts in development builds.
    if (import.meta.env.DEV) (window as unknown as { __stage: unknown }).__stage = { scale, ox, oy, points, rect: box.current?.getBoundingClientRect() }
  }, [geometry, points, settings, scale, ox, oy, size, hover])

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect()
    return [(clientX - r.left - ox) / scale, (clientY - r.top - oy) / scale] as const
  }, [ox, oy, scale])

  // Zoom by a factor, keeping the world point under the cursor (or the frame centre) in place.
  const zoomAround = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const cx = clientX === undefined ? centerX : clientX - r.left
    const cy = clientY === undefined ? centerY : clientY - r.top
    setView(v => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor))
      const s0 = fitScale * v.zoom, s1 = fitScale * zoom
      const wx = (cx - originX(s0, v.panX)) / s0, wy = (cy - originY(s0, v.panY)) / s0
      return { zoom, panX: cx - wx * s1 - originX(s1, 0), panY: cy - wy * s1 - originY(s1, 0) }
    })
  }, [fitScale, centerX, centerY, originX, originY])

  useEffect(() => {
    controlRef.current = { fit: () => setView({ zoom: 1, panX: 0, panY: 0 }), zoomBy: factor => zoomAround(factor) }
  }, [controlRef, zoomAround])

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      zoomAround(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)), event.clientX, event.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAround])

  // Hold Space to pan, as in most design tools. Ignored while typing.
  useEffect(() => {
    const typing = (event: KeyboardEvent) => event.target instanceof Element && Boolean(event.target.closest('input, select, textarea, button'))
    const down = (event: KeyboardEvent) => { if (event.code === 'Space' && !typing(event)) { space.current = true; setCursor('grab'); event.preventDefault() } }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') { space.current = false; setCursor('default') } }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  const hitRadius = (event: React.PointerEvent) => (event.pointerType === 'touch' ? 24 : 12) / scale
  const inRegion = (x: number, y: number) => contains(geometry.region, x, y)

  const eraseAt = (x: number, y: number, last: number): number => {
    const current = live.current
    if (!inRegion(x, y) || current.length <= 2) return last
    const { index } = nearestPoint(current, x, y)
    if (index < 0 || index === last) return last
    const next = new Float64Array(current.length - 2)
    next.set(current.subarray(0, index * 2)); next.set(current.subarray(index * 2 + 2), index * 2)
    live.current = next
    onPoints(next)
    return -1
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* the pointer already ended */ }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    setHover(null)
    if (pointers.current.size === 2) {
      // Two fingers: pinch to zoom and drag to pan. Whatever one finger started is dropped.
      const [a, b] = [...pointers.current.values()]
      const [wx, wy] = toWorld((a.x + b.x) / 2, (a.y + b.y) / 2)
      drag.current = { kind: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2, view, worldX: wx, worldY: wy }
      return
    }
    if (pointers.current.size > 2) return
    const [x, y] = toWorld(event.clientX, event.clientY)
    const panning = tool === 'pan' || space.current || event.button === 1
    if (panning) { drag.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, panX: view.panX, panY: view.panY }; setCursor('grabbing'); return }
    if (event.button !== 0) return
    const adding = tool === 'add' || (tool === 'move' && event.altKey)
    const erasing = tool === 'erase' || (tool === 'move' && event.shiftKey)
    if (adding) {
      if (!inRegion(x, y)) { onNotice('Los puntos deben estar dentro del área del patrón, sin salir del borde.'); return }
      if (live.current.length / 2 >= 20_000) { onNotice('Este diseño alcanzó el límite de puntos de la aplicación (20 000).'); return }
      onBeginEdit('add')
      const [px, py] = clampToRegion(geometry.region, x, y)
      const next = new Float64Array(live.current.length + 2)
      next.set(live.current); next[next.length - 2] = px; next[next.length - 1] = py
      live.current = next
      onPoints(next)
      drag.current = { kind: 'point', index: next.length / 2 - 1, dx: 0, dy: 0 }
      setCursor('grabbing')
      return
    }
    if (erasing) {
      if (!inRegion(x, y)) return
      onBeginEdit('erase')
      drag.current = { kind: 'erase', last: eraseAt(x, y, -2) }
      return
    }
    const near = nearestPoint(live.current, x, y)
    if (near.index >= 0 && near.distance <= hitRadius(event)) {
      onBeginEdit('move')
      // Keep the grab offset so the point doesn't jump under the finger.
      drag.current = { kind: 'point', index: near.index, dx: live.current[near.index * 2] - x, dy: live.current[near.index * 2 + 1] - y }
      setCursor('grabbing')
      return
    }
    // Dragging empty space pans the view.
    drag.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, panX: view.panX, panY: view.panY }
    setCursor('grabbing')
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const d = drag.current
    if (d?.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (!a || !b) return
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, d.view.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, d.distance))))
      const r = box.current!.getBoundingClientRect()
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top
      const s1 = fitScale * zoom
      setView({ zoom, panX: mx - d.worldX * s1 - originX(s1, 0), panY: my - d.worldY * s1 - originY(s1, 0) })
      return
    }
    if (d?.kind === 'pan') { setView(v => ({ ...v, panX: d.panX + event.clientX - d.startX, panY: d.panY + event.clientY - d.startY })); return }
    const [x, y] = toWorld(event.clientX, event.clientY)
    if (d?.kind === 'point') {
      const [px, py] = clampToRegion(geometry.region, x + d.dx, y + d.dy)
      const next = live.current.slice()
      next[d.index * 2] = px; next[d.index * 2 + 1] = py
      live.current = next
      onPoints(next)
      return
    }
    if (d?.kind === 'erase') { d.last = eraseAt(x, y, d.last); return }
    if (event.pointerType === 'touch') return
    // Hover feedback: the point that would move, or the cell that would be erased.
    const erasing = tool === 'erase' || (tool === 'move' && event.shiftKey)
    if (tool === 'pan' || space.current) { setHover(null); setCursor('grab'); return }
    if (erasing) {
      const near = inRegion(x, y) ? nearestPoint(live.current, x, y) : null
      setHover(near && near.index >= 0 ? { kind: 'cell', index: near.index } : null)
      setCursor(near ? 'pointer' : 'default')
      return
    }
    if (tool === 'add' || event.altKey) { setHover(null); setCursor(inRegion(x, y) ? 'crosshair' : 'not-allowed'); return }
    const near = nearestPoint(live.current, x, y)
    const hit = near.index >= 0 && near.distance <= 12 / scale
    setHover(hit ? { kind: 'site', index: near.index } : null)
    setCursor(hit ? 'grab' : 'default')
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId)
    if (drag.current?.kind === 'pinch' && pointers.current.size === 1) {
      // Lifting one finger of a pinch carries on as a pan with the other.
      const [p] = [...pointers.current.values()]
      drag.current = { kind: 'pan', startX: p.x, startY: p.y, panX: view.panX, panY: view.panY }
      return
    }
    if (pointers.current.size === 0) { drag.current = null; setCursor(space.current || tool === 'pan' ? 'grab' : 'default') }
  }

  return <div ref={box} className="stage-canvas">
    <canvas ref={canvas} style={{ cursor }} aria-label="Vista previa de la lámina. Arrastra puntos para moverlos; Alt + clic para agregar; Mayús + clic para borrar."
      role="img" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onPointerLeave={() => { if (!drag.current) setHover(null) }} onContextMenu={event => event.preventDefault()} />
  </div>
}
