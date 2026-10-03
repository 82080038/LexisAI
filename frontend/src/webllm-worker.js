// Dedicated worker untuk WebLLM — menjaga UI tetap responsif saat generate.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()
self.onmessage = (msg) => {
  handler.onmessage(msg)
}
