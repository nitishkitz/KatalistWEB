import { randomUUID } from "node:crypto";
import { sanitizeCoeyCopy, type CoeyEvent } from "@/features/court/magic-box/coey-copy";

const SARVAM_CHAT_URL = "https://api.sarvam.ai/v1/chat/completions";
const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text";
const DEFAULT_CHAT_MODEL = "sarvam-105b";
const DEFAULT_STT_MODEL = "saaras:v3";

export type SarvamEnv = {
  SARVAM_API_KEY?: string;
  SARVAM_CHAT_MODEL?: string;
  SARVAM_STT_MODEL?: string;
};

export function readSarvamApiKey(env: SarvamEnv = process.env): string | null {
  const key = env.SARVAM_API_KEY?.trim() ?? "";
  return key ? key : null;
}

const CORRECTION_PROMPT = `You are a text-cleanup helper inside Katalist Magic Box.
Return JSON only.
Fix spelling, grammar, punctuation and obvious shorthand.
Preserve the user's work meaning.
Preserve @mentions exactly.
Preserve names, numbers, URLs, file names and quoted text.
Do not choose an assignee.
Do not invent a date or time.
You may echo an existing date phrase as a non-authoritative hint.
You may return NOW/NEXT/LATER only as a non-authoritative hint when explicit.
Never add work the user did not say.`;

const COEY_PROMPT = `You write one Katalist Coey micro-message.
Coey is a fast, precise Ninja Butler Cat and neutral umpire.
Warm, brief, non-judgmental.
Never shame, scold, compare people, fabricate urgency, or mention system internals.
Maximum 18 words.
Return JSON only: {"text":"..."}`;

type ChatResult = { text: string } | { error: string };

async function sarvamChat(input: {
  key: string;
  model: string;
  system: string;
  user: string;
  fetchImpl?: typeof fetch;
}): Promise<ChatResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(SARVAM_CHAT_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      temperature: 0.2,
    }),
  });
  if (!response.ok) return { error: `sarvam_${response.status}` };
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) return { error: "empty" };
  return { text };
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function correctMagicBoxText(input: {
  text: string;
  locale?: string;
  env?: SarvamEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ requestId: string; correctedText: string | null; hints: { datePhrase: string | null; importance: "now" | "next" | "later" | null }; degraded?: boolean }> {
  const requestId = randomUUID();
  const key = readSarvamApiKey(input.env);
  if (!key) {
    return {
      requestId,
      correctedText: null,
      hints: { datePhrase: null, importance: null },
      degraded: true,
    };
  }
  const result = await sarvamChat({
    key,
    model: input.env?.SARVAM_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL,
    system: CORRECTION_PROMPT,
    user: JSON.stringify({ text: input.text, locale: input.locale ?? "en-IN" }),
    fetchImpl: input.fetchImpl,
  });
  if ("error" in result) {
    return { requestId, correctedText: null, hints: { datePhrase: null, importance: null }, degraded: true };
  }
  const parsed = extractJson(result.text) as {
    correctedText?: unknown;
    hints?: { datePhrase?: unknown; importance?: unknown };
  } | null;
  const corrected = typeof parsed?.correctedText === "string" ? parsed.correctedText.trim() : "";
  const importanceRaw = parsed?.hints?.importance;
  const importance =
    importanceRaw === "now" || importanceRaw === "next" || importanceRaw === "later" ? importanceRaw : null;
  return {
    requestId,
    correctedText: corrected && corrected !== input.text ? corrected : corrected || null,
    hints: {
      datePhrase: typeof parsed?.hints?.datePhrase === "string" ? parsed.hints.datePhrase : null,
      importance,
    },
  };
}

export async function generateCoeyCopy(input: {
  event: CoeyEvent;
  personName?: string;
  env?: SarvamEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ text: string; degraded?: boolean }> {
  const key = readSarvamApiKey(input.env);
  const fallback = { text: sanitizeCoeyCopy(null, input.event, input.personName), degraded: true as const };
  if (!key) return fallback;
  const result = await sarvamChat({
    key,
    model: input.env?.SARVAM_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL,
    system: COEY_PROMPT,
    user: JSON.stringify({ event: input.event, personName: input.personName ?? null }),
    fetchImpl: input.fetchImpl,
  });
  if ("error" in result) return fallback;
  const parsed = extractJson(result.text) as { text?: unknown } | null;
  return { text: sanitizeCoeyCopy(parsed?.text, input.event, input.personName) };
}

export async function transcribeMagicBoxAudio(input: {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  env?: SarvamEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ text: string | null; degraded?: boolean }> {
  const key = readSarvamApiKey(input.env);
  if (!key) return { text: null, degraded: true };
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  form.set("model", input.env?.SARVAM_STT_MODEL?.trim() || DEFAULT_STT_MODEL);
  form.set("mode", "transcribe");
  const audio = new ArrayBuffer(input.bytes.byteLength);
  new Uint8Array(audio).set(input.bytes);
  form.set(
    "file",
    new Blob([audio], { type: input.mimeType || "application/octet-stream" }),
    input.filename || "audio.webm",
  );
  const response = await fetchImpl(SARVAM_STT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) return { text: null, degraded: true };
  const json = (await response.json()) as { transcript?: string; text?: string };
  const text = (json.transcript ?? json.text ?? "").trim();
  return { text: text || null, degraded: !text };
}
