import { answer } from "./fixtures";
/** MOCKED: replaces the signed-in fetch. Every /api/code-activity read is answered from fixtures.ts. */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const result = answer(new URL(url, "http://harness.invalid"), init);
  await new Promise((r) => setTimeout(r, 30));
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json" } });
}
