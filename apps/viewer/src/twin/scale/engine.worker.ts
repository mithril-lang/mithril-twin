/// <reference lib="webworker" />
import { handle, ScaleEngine, type EngineRequest } from './engine'

// Generates the synthetic enterprise pack and runs the exposure analysis off the UI thread.
const engine = new ScaleEngine()
self.onmessage = (event: MessageEvent<EngineRequest>) => handle(engine, event.data, (r) => self.postMessage(r))
