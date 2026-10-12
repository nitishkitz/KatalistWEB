import { defineEventHandler, readBody, createError, setHeader } from "h3";
import { requireUser } from "../../lib/require-user";
import { answerAssistantQuestion, buildAssistantFacts } from "../../lib/assistant";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  const { userId, client } = await requireUser(event);
  const body = await readBody(event) as { question?: unknown; listId?: unknown; bucketId?: unknown; context?: unknown; personChoice?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 800) throw createError({ statusCode: 400, message: "A question between 1 and 800 characters is required." });
  const listId = typeof body?.listId === "string" ? body.listId : undefined;
  const bucketId = typeof body?.bucketId === "string" ? body.bucketId : undefined;
  const context = body?.context === "home" ? "home" : "work";
  try {
    const facts = await buildAssistantFacts(client, userId, { listId, bucketId, context });
    const answer = await answerAssistantQuestion(facts, question, [], undefined,
      typeof body?.personChoice === "string" ? body.personChoice : undefined);
    return { ok: true, answer, facts: { scope: facts.scope, summary: facts.summary, things: facts.things, nudge_recommendations: facts.nudge_recommendations } };
  } catch (error) {
    if (error instanceof Error && error.message === "scope_not_found") throw createError({ statusCode: 404, message: "That List or Bucket is no longer available." });
    throw createError({ statusCode: 502, message: "Katalist could not prepare an answer right now." });
  }
});
