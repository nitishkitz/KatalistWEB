import { HttpError, defaultGetUser, jsonNoStore, requireSupabaseUser, type GetUserFn } from "@/lib/supabase-user.server";
import {
  magicBoxCoeyRequestSchema,
  magicBoxCorrectRequestSchema,
} from "@/features/ai/schemas";
import { correctMagicBoxText, generateCoeyCopy, transcribeMagicBoxAudio } from "@/features/ai/sarvam-client.server";

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

export function createMagicBoxCorrectHandler(options?: { getUser?: GetUserFn }) {
  return async (request: Request) => {
    try {
      const user = await requireSupabaseUser(request, options?.getUser ?? defaultGetUser);
      void user;
      const parsed = magicBoxCorrectRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) throw new HttpError(400, "Check the information and try again.");
      const result = await correctMagicBoxText(parsed.data);
      return jsonNoStore(result);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createMagicBoxCoeyHandler(options?: { getUser?: GetUserFn }) {
  return async (request: Request) => {
    try {
      const user = await requireSupabaseUser(request, options?.getUser ?? defaultGetUser);
      void user;
      const parsed = magicBoxCoeyRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) throw new HttpError(400, "Check the information and try again.");
      const result = await generateCoeyCopy({
        event: parsed.data.event,
        personName: parsed.data.personName,
      });
      return jsonNoStore(result);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createMagicBoxTranscribeHandler(options?: { getUser?: GetUserFn }) {
  return async (request: Request) => {
    try {
      const user = await requireSupabaseUser(request, options?.getUser ?? defaultGetUser);
      void user;
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
      const result = await transcribeMagicBoxAudio({ bytes, filename, mimeType: mimeType || "audio/webm" });
      return jsonNoStore(result);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
