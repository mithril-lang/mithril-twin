import type { EngineReply, EngineRequest, PackLoad, PathRequest, PathResult } from './engine'
import type { ScaleAnalysis } from './model'
import type { PackChunk } from './pack'

export type EngineClient = {
  via: 'worker' | 'inline'
  /** Resolves with the generated manifest + parsed index (the pack), then analysis follows. */
  pack: Promise<{ load: PackLoad; ms: number }>
  analysis: Promise<{ analysis: ScaleAnalysis; ms: number }>
  chunk: (company: string) => Promise<{ chunk: PackChunk; ms: number }>
  path: (req: PathRequest) => Promise<{ result: PathResult; ms: number }>
  dispose: () => void
}

/** Start the engine in a Web Worker when available, else inline (async, same protocol). */
export function startEngine(seed: number): EngineClient {
  const useWorker = typeof Worker !== 'undefined'
  let send: (m: EngineRequest) => void
  let dispose: () => void
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>()
  let resolvePack!: (v: { load: PackLoad; ms: number }) => void
  let rejectPack!: (e: Error) => void
  let resolveAnalysis!: (v: { analysis: ScaleAnalysis; ms: number }) => void
  let rejectAnalysis!: (e: Error) => void
  const pack = new Promise<{ load: PackLoad; ms: number }>((res, rej) => { resolvePack = res; rejectPack = rej })
  const analysis = new Promise<{ analysis: ScaleAnalysis; ms: number }>((res, rej) => { resolveAnalysis = res; rejectAnalysis = rej })
  const onReply = (r: EngineReply) => {
    if (r.type === 'pack') resolvePack({ load: r.load, ms: r.ms })
    else if (r.type === 'analysis') resolveAnalysis({ analysis: r.analysis, ms: r.ms })
    else if (r.type === 'error') {
      if (r.id != null) { pending.get(r.id)?.reject(new Error(r.error)); pending.delete(r.id) }
      else { rejectPack(new Error(r.error)); rejectAnalysis(new Error(r.error)) }
    } else {
      const p = pending.get(r.id)
      pending.delete(r.id)
      p?.resolve((r.type === 'chunk' ? { chunk: r.chunk, ms: r.ms } : { result: r.result, ms: r.ms }) as never)
    }
  }
  if (useWorker) {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<EngineReply>) => onReply(e.data)
    worker.onerror = (e) => onReply({ type: 'error', error: e.message || 'worker failed' })
    send = (m) => worker.postMessage(m)
    dispose = () => worker.terminate()
  } else {
    // Inline fallback (no Worker, e.g. tests): load the engine lazily so the generator stays
    // out of the main bundle.
    const mod = import('./engine')
    const engine = mod.then((m) => new m.ScaleEngine())
    let disposed = false
    // Yield between steps so the UI can paint the pack before the analysis runs.
    send = (m) => {
      void Promise.all([mod, engine]).then(([{ handle }, eng]) => {
        if (disposed) return
        if (m.type === 'load') {
          const replies: EngineReply[] = []
          handle(eng, m, (r) => replies.push(r))
          onReply(replies[0]!)
          setTimeout(() => { if (!disposed) for (const r of replies.slice(1)) onReply(r) }, 0)
        } else handle(eng, m, onReply)
      })
    }
    dispose = () => { disposed = true }
  }
  let nextId = 1
  const call = <T,>(build: (id: number) => EngineRequest) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolve as (v: never) => void, reject })
      send(build(id))
    })
  send({ type: 'load', seed })
  return {
    via: useWorker ? 'worker' : 'inline',
    pack,
    analysis,
    chunk: (company) => call((id) => ({ type: 'chunk', id, company })),
    path: (req) => call((id) => ({ type: 'path', id, req })),
    dispose,
  }
}

let shared: { seed: number; client: EngineClient } | null = null

/**
 * One engine per seed for the page (survives React StrictMode double effects and remounts).
 * A different seed disposes the previous engine.
 */
export function sharedEngine(seed: number): EngineClient {
  if (shared?.seed === seed) return shared.client
  shared?.client.dispose()
  shared = { seed, client: startEngine(seed) }
  return shared.client
}

/** Drop the shared engine (tests). */
export function resetSharedEngine() {
  shared?.client.dispose()
  shared = null
}
