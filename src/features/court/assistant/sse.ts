import { decodeCoeyEvent, type CoeyEvent } from "../../../../server/lib/assistant-turn";

/**
 * Incremental Server-Sent Events parser. Feed decoded text chunks; it returns
 * the complete, well-formed Coey events found so far and keeps any partial
 * frame for the next chunk. Malformed frames are dropped, never thrown.
 */
export function createSseParser() {
  let buffer = "";
  return {
    push(chunk: string): CoeyEvent[] {
      buffer += chunk.replace(/\r\n/g, "\n");
      const out: CoeyEvent[] = [];
      let index: number;
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const event = decodeCoeyEvent(data);
        if (event) out.push(event);
      }
      return out;
    },
  };
}
