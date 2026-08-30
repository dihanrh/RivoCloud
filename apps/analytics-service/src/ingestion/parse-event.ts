import { edgeRequestEventSchema, type EdgeRequestEvent } from './edge-request-event.js';

export function parseEdgeRequestEvent(data: Uint8Array): EdgeRequestEvent | null {
  try {
    return edgeRequestEventSchema.parse(JSON.parse(new TextDecoder().decode(data)));
  } catch {
    return null;
  }
}
