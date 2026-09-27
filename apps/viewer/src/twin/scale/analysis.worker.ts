/// <reference lib="webworker" />
import { parseMith } from '../mith/parse'
import { analyzeScale, type WorkerResult } from './model'

// Exposure analysis for the enterprise pack, off the UI thread. Display-only arithmetic.
self.onmessage = async (event: MessageEvent<{ indexUrl: string }>) => {
  const t0 = performance.now()
  try {
    const res = await fetch(event.data.indexUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = await res.json()
    const t1 = performance.now()
    const doc = parseMith(raw)
    const t2 = performance.now()
    const analysis = analyzeScale(doc, t2 - t1)
    const msg: WorkerResult = { ok: true, analysis, workerMs: performance.now() - t0, fetchMs: t1 - t0 }
    self.postMessage(msg)
  } catch (err) {
    const msg: WorkerResult = { ok: false, error: err instanceof Error ? err.message : 'unknown' }
    self.postMessage(msg)
  }
}
