import { HttpError, defaultGetUser, jsonNoStore, requireSupabaseUser, type GetUserFn } from "@/lib/supabase-user.server";
import { magicBoxCoeyRequestSchema, magicBoxCorrectRequestSchema } from "@/features/ai/schemas";
import { correctMagicBoxText, generateCoeyCopy, transcribeMagicBoxAudio } from "@/features/ai/sarvam-client.server";
import { aiFlags, enforceAiBudget, type MagicBoxAiOperation } from "@/features/ai/ai-rate-limit.server";
import { coeyFallback } from "@/features/court/magic-box/coey-copy";

const MAX_JSON_BYTES = 8192;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ALLOWED_AUDIO = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp3",
]);

async function readJson(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.length > MAX_JSON_BYTES) throw new HttpError(400, "Check the information and try again.");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "Check the information and try again.");
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonNoStore(
      error.status === 401
        ? { error: "unauthorized", message: error.message }
        : { error: "invalid_request", message: error.message },
      error.status,
    );
  }
  return jsonNoStore({ error: "unavailable", message: "That assist is unavailable right now." }, 503);
}

export type MagicBoxApiOptions = {
  getUser?: GetUserFn;
  enforceBudget?: (input: { userId: string; operation: MagicBoxAiOperation }) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  flags?: ReturnType<typeof aiFlags>;
  fetchImpl?: typeof fetch;
};

async function consume(options: MagicBoxApiOptions | undefined, userId: string, operation: MagicBoxAiOperation) {
  const decision = await (options?.enforceBudget ?? enforceAiBudget)({ userId, operation });
  if (!decision.allowed) {
    const error = new HttpError(429, "Give that a moment, then try again.");
    (error as HttpError & { retryAfterSeconds?: number }).retryAfterSeconds = decision.retryAfterSeconds;
    throw error;
  }
}

export function createMagicBoxCorrectHandler(options?: MagicBoxApiOptions) {
  return async (request: Request) => {
    try {
      const user = await requireSupabaseUser(request, options?.getUser ?? defaultGetUser);
      const flags = options?.flags ?? aiFlags();
      if (!flags.correction) {
        return jsonNoStore({ requestId: "disabled", correctedText: null, hints: { datePhrase: null, importance: null }, degraded: true });
      }
      await consume(options, user.id, "correct");
      const parsed = magicBoxCorrectRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) throw new HttpError(400, "Check the information and try again.");
      const result = await correctMagicBoxText({ ...parsed.data, fetchImpl: options?.fetchImpl });
      return jsonNoStore(result);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        const retry = (error as HttpError & { retryAfterSeconds?: number }).retryAfterSeconds ?? 60;
        return new Response(JSON.stringify({ error: "rate_limited", message: error.message }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": String(retry), "cache-control": "no-store" },
        });
      }
      return errorResponse(error);
    }
  };
}

export function createMagicBoxCoeyHandler(options?: MagicBoxApiOptions) {
  return async (request: Request) => {
    try {
      const user = await requireSupabaseUser(request, options?.getUser ?? defaultGetUser);
      const parsed = magicBoxCoeyRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) throw new HttpError(400, "Check the information and try again.");
      const flags = options?.flags ?? aiFlags();
      if (!flags.coey) {
        return jsonNoStore({ text: coeyFallback(parsed.data.event, parsed.data.personName), degraded: true });
      }
      await consume(options, user.id, "coey");
      const result = await generateCoeyCopy({
        event: parsed.data.event,
        personName: parsed.data.personName,
        fetchImpl: options?.fetchImpl,
      });
      return jsonNoStore(result);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createMagicBoxTranscribeHandler(options?: MagicBoxApiOptions) {
  return async (request: Request) => {
    try {
      const user = await requireSupabaseUser(request, options?.getUser ?? defaultGetUser);
      const flags = options?.flags ?? aiFlags();
      if (!flags.stt) return jsonNoStore({ text: null, degraded: true });
      await consume(options, user.id, "transcribe");
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) throw new HttpError(400, "Check the information and try again.");
      if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) throw new HttpError(400, "Check the information and try again.");
      const mimeType = (file.type || "audio/webm").split(";")[0]!.trim();
      if (mimeType && !ALLOWED_AUDIO.has(mimeType) && !mimeType.startsWith("audio/")) {
        throw new HttpError(400, "Check the information and try again.");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const filename = file instanceof File ? file.name : "audio.webm";
      const result = await transcribeMagicBoxAudio({
        bytes,
        filename,
        mimeType: mimeType || "audio/webm",
        fetchImpl: options?.fetchImpl,
      });
      return jsonNoStore(result);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        const retry = (error as HttpError & { retryAfterSeconds?: number }).retryAfterSeconds ?? 60;
        return new Response(JSON.stringify({ error: "rate_limited", message: error.message }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": String(retry), "cache-control": "no-store" },
        });
      }
      return errorResponse(error);
    }
  };
}
