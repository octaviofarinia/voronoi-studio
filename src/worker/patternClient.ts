// Sends jobs to the pattern worker and resolves them in order. If workers are unavailable, jobs run here.
import { runJob, type Job, type JobResult } from './jobs'

type Pending = { job: Job; resolve: (result: JobResult) => void; reject: (error: Error) => void }

export class PatternClient {
  private worker: Worker | null = null
  private next = 1
  private pending = new Map<number, Pending>()

  constructor() {
    try {
      this.worker = new Worker(new URL('./pattern.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<{ id: number; result?: JobResult; error?: string }>) => {
        const { id, result, error } = event.data
        const waiting = this.pending.get(id)
        this.pending.delete(id)
        if (!waiting) return
        if (result) waiting.resolve(result)
        else waiting.reject(new Error(error ?? 'No se pudo crear el patrón.'))
      }
      this.worker.onerror = () => this.fallBack()
    } catch {
      this.worker = null
    }
  }

  run(job: Job): Promise<JobResult> {
    if (!this.worker) return runHere(job)
    const id = this.next++
    // Copy the points so the caller's array stays usable after the transfer.
    const message = job.kind === 'relax' ? { ...job, points: job.points.slice() } : job
    return new Promise((resolve, reject) => {
      this.pending.set(id, { job, resolve, reject })
      this.worker!.postMessage({ id, job: message })
    })
  }

  // If the worker fails to start (for example, opened from a file), finish waiting jobs here instead.
  private fallBack() {
    this.worker?.terminate()
    this.worker = null
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const p of waiting) runHere(p.job).then(p.resolve, p.reject)
  }

  dispose() { this.worker?.terminate(); this.pending.clear() }
}

function runHere(job: Job): Promise<JobResult> {
  return new Promise((resolve, reject) => setTimeout(() => {
    try { resolve(runJob(job)) } catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
  }, 0))
}
