import { useCallback, useEffect, useRef, useState } from 'react'
import { emptyHistory, record, redo as redoStep, undo as undoStep, type History } from './lib/history'
import { planChange, type Doc } from './lib/changes'
import type { Settings } from './lib/settings'
import { patternRegion } from './voronoi/pattern'
import { typicalSpacing } from './voronoi/seeding'
import { runJob, type Job, type JobResult } from './worker/jobs'
import { PatternClient } from './worker/patternClient'

// The design being edited, with undo, unsaved-change tracking, and the background jobs that make and
// relax points. The rules for what a settings change does to the points are in lib/changes.ts.

export type { Doc }
export type Status = { text: string; warning?: boolean } | null

const AUTO_MAX_STEPS = 3000

export function freshDoc(settings: Settings): Doc {
  return { settings, points: runJob({ kind: 'generate', settings }).points, handEdited: false, stale: false }
}

// The spacing the last generated pattern used, so turning Auto spacing off can keep it.
export function spacingOf(settings: Settings): number {
  return runJob({ kind: 'generate', settings: { ...settings, relaxSteps: 0 } }).spacing
}

export function useDesign(initial: () => { doc: Doc; saved: boolean }, onStatus: (status: Status) => void) {
  const [start] = useState(initial)
  const [doc, setDocState] = useState(start.doc)
  // The design as last saved. Undoing back to it counts as saved again.
  const [saved, setSaved] = useState<Doc | null>(start.saved ? start.doc : null)
  const [history, setHistory] = useState<History<Doc>>(emptyHistory)
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(false)
  const [capped, setCapped] = useState(false)
  const [spacing, setSpacing] = useState(0)
  const docRef = useRef(doc)
  const client = useRef<PatternClient | null>(null)
  const token = useRef(0)
  const inFlight = useRef(false)
  const queued = useRef<Settings | null>(null)
  const autoOn = useRef(false)
  const status = useRef(onStatus)
  useEffect(() => { status.current = onStatus }, [onStatus])
  // Whether the "stopped at 20,000 points" warning is showing, so a later pattern clears only that message.
  const cappedShown = useRef(false)

  useEffect(() => {
    const c = new PatternClient()
    client.current = c
    return () => { c.dispose(); client.current = null }
  }, [])

  const run = useCallback((job: Job): Promise<JobResult> => client.current ? client.current.run(job) : Promise.resolve(runJob(job)), [])

  // Replace the design. key: undo-merge key, null for its own undo step, false to skip history.
  const apply = useCallback((next: Doc, key: string | null | false) => {
    if (key !== false) { const before = docRef.current; setHistory(h => record(h, before, key)) }
    docRef.current = next
    setDocState(next)
  }, [])

  const stopAuto = useCallback((message?: string) => {
    if (!autoOn.current) return
    autoOn.current = false
    setAuto(false)
    if (message) status.current({ text: message })
  }, [])

  // Remake points in the worker. While one job runs, only the newest request waits; older ones are dropped.
  const regenerate = useCallback((settings: Settings) => {
    stopAuto()
    const mine = ++token.current
    if (inFlight.current) { queued.current = settings; return }
    const start = (s: Settings, id: number) => {
      inFlight.current = true
      setBusy(true)
      run({ kind: 'generate', settings: s }).then(result => {
        if (id !== token.current) return
        apply({ ...docRef.current, points: result.points, handEdited: false, stale: false }, false)
        setCapped(result.capped)
        setSpacing(result.spacing)
        if (result.capped) { status.current({ text: 'Se alcanzó el límite de 20 000 puntos. Aumenta la separación.', warning: true }); cappedShown.current = true }
        else if (cappedShown.current) { status.current(null); cappedShown.current = false }
      }).catch((error: Error) => status.current({ text: `No se pudo crear el patrón: ${error.message}`, warning: true }))
        .finally(() => {
          inFlight.current = false
          setBusy(false)
          const next = queued.current
          queued.current = null
          if (next) start(next, token.current)
        })
    }
    start(settings, mine)
  }, [apply, run, stopAuto])

  const change = useCallback((patch: Partial<Settings>, key?: string) => {
    const { next, remake } = planChange(docRef.current, patch)
    apply(next, `settings:${key ?? Object.keys(patch).join(',')}`)
    if (remake) regenerate(next.settings)
  }, [apply, regenerate])

  // A new pattern from the current settings, optionally with a new seed. Callers confirm first if points were edited.
  const generate = useCallback((seed?: number) => {
    const prev = docRef.current
    const settings = seed === undefined ? prev.settings : { ...prev.settings, seed }
    apply({ ...prev, settings, handEdited: false, stale: false }, null)
    regenerate(settings)
  }, [apply, regenerate])

  const relaxOnce = useCallback(() => {
    if (inFlight.current || autoOn.current) return
    const before = docRef.current
    const mine = ++token.current
    inFlight.current = true
    setBusy(true)
    run({ kind: 'relax', settings: before.settings, points: before.points, steps: Math.max(1, before.settings.relaxSteps) }).then(result => {
      if (mine !== token.current) return
      setHistory(h => record(h, before, null))
      apply({ ...docRef.current, points: result.points }, false)
    }).catch((error: Error) => status.current({ text: `No se pudo relajar: ${error.message}`, warning: true }))
      .finally(() => { inFlight.current = false; setBusy(false) })
  }, [apply, run])

  const toggleAuto = useCallback(() => {
    if (autoOn.current) { stopAuto('Se detuvo la relajación automática.'); return }
    if (inFlight.current) return
    autoOn.current = true
    setAuto(true)
    const mine = ++token.current
    const start = docRef.current
    setHistory(h => record(h, start, null))
    // Settled once no point moves more than a 2,000th of the typical spacing in a step.
    const tolerance = typicalSpacing(patternRegion(start.settings), start.points.length / 2) / 2000
    let steps = 0
    const loop = () => {
      if (!autoOn.current || mine !== token.current) return
      const current = docRef.current
      run({ kind: 'relax', settings: current.settings, points: current.points, steps: 1 }).then(result => {
        if (!autoOn.current || mine !== token.current) return
        steps++
        apply({ ...docRef.current, points: result.points }, false)
        if (result.maxMove < tolerance) { stopAuto(`Se estabilizó tras ${steps.toLocaleString()} pasos de relajación.`); return }
        if (steps >= AUTO_MAX_STEPS) { stopAuto(`Se detuvo tras ${AUTO_MAX_STEPS.toLocaleString()} pasos.`); return }
        status.current({ text: `Relajando · paso ${steps.toLocaleString()}` })
        window.setTimeout(loop, 16)
      }).catch(() => stopAuto('Se detuvo la relajación automática.'))
    }
    status.current({ text: 'Relajando…' })
    loop()
  }, [apply, run, stopAuto])

  // Hand edits: one undo step per gesture, then live updates while the pointer moves.
  const beginEdit = useCallback(() => {
    stopAuto()
    token.current++
    const before = docRef.current
    setHistory(h => record(h, before, null))
  }, [stopAuto])
  const editPoints = useCallback((points: Float64Array) => apply({ ...docRef.current, points, handEdited: true }, false), [apply])

  // Replace the whole design, for New and Open. Undo can still return to the previous one.
  const replace = useCallback((next: Doc, isSaved: boolean) => {
    stopAuto()
    token.current++
    apply(next, null)
    setSaved(isSaved ? next : null)
    setCapped(false)
    setSpacing(0) // the panel estimates the spacing until the next pattern reports it
  }, [apply, stopAuto])

  const undo = useCallback(() => {
    const step = undoStep(history, docRef.current)
    if (!step) return
    stopAuto(); token.current++; setSpacing(0)
    setHistory(step.history); docRef.current = step.state; setDocState(step.state)
  }, [history, stopAuto])
  const redo = useCallback(() => {
    const step = redoStep(history, docRef.current)
    if (!step) return
    stopAuto(); token.current++; setSpacing(0)
    setHistory(step.history); docRef.current = step.state; setDocState(step.state)
  }, [history, stopAuto])

  return {
    doc, change, generate, relaxOnce, toggleAuto, beginEdit, editPoints, replace, undo, redo, stopAuto,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    unsaved: doc !== saved, markSaved: (what: Doc) => setSaved(what),
    busy, auto, capped, spacing,
  }
}
