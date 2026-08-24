import { z } from "zod";

export const magicBoxCorrectRequestSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  locale: z.string().trim().min(2).max(16).optional(),
});

export const magicBoxCorrectResponseSchema = z.object({
  requestId: z.string(),
  correctedText: z.string().nullable(),
  hints: z
    .object({
      datePhrase: z.string().nullable().optional(),
      importance: z.enum(["now", "next", "later"]).nullable().optional(),
    })
    .optional(),
  degraded: z.boolean().optional(),
});

export const magicBoxCoeyRequestSchema = z.object({
  event: z.enum([
    "THING_TOSSED_SELF",
    "THING_TOSSED_OTHER",
    "PERSON_AMBIGUOUS",
    "DATE_AMBIGUOUS",
    "VOICE_CAPTURED",
    "VOICE_FAILED",
    "ATTACHMENT_FAILED",
    "TOSS_FAILED",
  ]),
  personName: z.string().trim().max(80).optional(),
});

export const magicBoxCoeyResponseSchema = z.object({
  text: z.string(),
  degraded: z.boolean().optional(),
});

export type MagicBoxCorrectRequest = z.infer<typeof magicBoxCorrectRequestSchema>;
export type MagicBoxCorrectResponse = z.infer<typeof magicBoxCorrectResponseSchema>;
export type MagicBoxCoeyRequest = z.infer<typeof magicBoxCoeyRequestSchema>;
export type MagicBoxCoeyResponse = z.infer<typeof magicBoxCoeyResponseSchema>;
