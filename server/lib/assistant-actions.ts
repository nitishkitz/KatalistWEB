import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Structured action engine. Coey (or the model) may only PROPOSE actions.
 * A mutation runs only through confirmAssistantAction, which verifies a signed
 * preview token and then re-reads every target through the caller's own
 * authenticated client before each write.
 */
export type AssistantActionType =
  | "open_thing"
  | "open_list"
  | "open_bucket"
  | "prepare_nudge"
  | "set_status"
  | "set_due"
  | "assign_person"
  | "add_to_bucket"
  | "catch_thing"
  | "sort_thing"
  | "snooze_thing"
  | "promise_date"
  | "set_pace"
  | "set_court_lane"
  | "add_comment";

export type AssistantAction = {
  id: string;
  type: AssistantActionType;
  targetIds: string[];
  label: string;
  reason: string;
  requiresConfirmation: boolean;
  expiresAt: string;
};

export type ActionParams = {
  actorId?: string;
  status?: "not_started" | "under_progress";
  dueAt?: string;
  dueHasTime?: boolean;
  assigneeActorId?: string;
  bucketId?: string;
  message?: string;
  /** snooze_thing: when the snooze ends. promise_date: the promised time. */
  until?: string;
  pace?: "urgent" | "normal" | "chill";
  lane?: "now" | "next" | "later";
  comment?: string;
};

export type ActionTargetResult = {
  id: string;
  title: string;
  state: "ready" | "applied" | "already_applied" | "rejected" | "failed";
  message?: string;
};

export class ActionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: AssistantActionType[] = [
  "open_thing",
  "open_list",
  "open_bucket",
  "prepare_nudge",
  "set_status",
  "set_due",
  "assign_person",
  "add_to_bucket",
  "catch_thing",
  "sort_thing",
  "snooze_thing",
  "promise_date",
  "set_pace",
  "set_court_lane",
  "add_comment",
];
const MAX_TARGETS = 20;
const TTL_MS = 5 * 60 * 1000;
const CLOSED = new Set(["sorted", "cancelled", "completed"]);
const READ_ONLY = new Set<AssistantActionType>(["open_thing", "open_list", "open_bucket"]);

type ThingRow = {
  id: string;
  title: string;
  context: string;
  work_status: string;
  acknowledgement: string | null;
  due_at: string | null;
  current_assignee_actor_id: string | null;
};
type Snapshot = Record<string, { s: string; a: string | null; d: string | null; k: string | null }>;
type TokenPayload = {
  v: 1;
  uid: string;
  action: AssistantAction;
  params: ActionParams;
  snapshot: Snapshot;
  nonce: string;
};

let devSecret: string | undefined;
function secret(): string {
  const configured = process.env.ASSISTANT_ACTION_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production")
    throw new ActionError("Assistant actions are not configured.", 503);
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

function sign(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token: unknown): TokenPayload {
  if (typeof token !== "string" || token.length > 20_000) throw new ActionError("Invalid action.", 400);
  const [body, mac] = token.split(".");
  if (!body || !mac) throw new ActionError("Invalid action.", 400);
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new ActionError("Invalid action.", 400);
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    throw new ActionError("Invalid action.", 400);
  }
}

export function parseActionRequest(body: unknown): {
  type: AssistantActionType;
  targetIds: string[];
  params: ActionParams;
} {
  const input = (body ?? {}) as Record<string, unknown>;
  const type = input.type as AssistantActionType;
  if (!TYPES.includes(type)) throw new ActionError("Unsupported action.", 400);
  const targetIds = Array.isArray(input.targetIds)
    ? input.targetIds.filter((id): id is string => typeof id === "string")
    : [];
  if (
    !targetIds.length ||
    targetIds.length > MAX_TARGETS ||
    new Set(targetIds).size !== targetIds.length ||
    targetIds.some((id) => !UUID.test(id))
  )
    throw new ActionError("Between 1 and 20 valid targets are required.", 400);
  const raw = (input.params ?? {}) as Record<string, unknown>;
  const params: ActionParams = {};
  for (const key of ["actorId", "assigneeActorId", "bucketId"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !UUID.test(value)) throw new ActionError(`Invalid ${key}.`, 400);
    params[key] = value;
  }
  if (raw.status !== undefined) {
    if (raw.status !== "not_started" && raw.status !== "under_progress")
      throw new ActionError("Unsupported status.", 400);
    params.status = raw.status;
  }
  if (raw.dueAt !== undefined) {
    if (typeof raw.dueAt !== "string" || Number.isNaN(new Date(raw.dueAt).getTime()))
      throw new ActionError("Invalid due date.", 400);
    params.dueAt = new Date(raw.dueAt).toISOString();
    params.dueHasTime = raw.dueHasTime === true;
  }
  if (typeof raw.message === "string") params.message = raw.message.trim().slice(0, 500);
  if (raw.until !== undefined) {
    if (typeof raw.until !== "string" || Number.isNaN(new Date(raw.until).getTime())) throw new ActionError("Invalid time.", 400);
    if (new Date(raw.until).getTime() < Date.now() - 60_000) throw new ActionError("That time has already passed.", 400);
    params.until = new Date(raw.until).toISOString();
  }
  if (raw.lane !== undefined) {
    if (!["now", "next", "later"].includes(String(raw.lane))) throw new ActionError("Unsupported Court lane.", 400);
    params.lane = raw.lane as ActionParams["lane"];
  }
  if (raw.pace !== undefined) {
    if (raw.pace !== "urgent" && raw.pace !== "normal" && raw.pace !== "chill") throw new ActionError("Unsupported pace.", 400);
    params.pace = raw.pace;
  }
  if (typeof raw.comment === "string" && raw.comment.trim()) params.comment = raw.comment.trim().slice(0, 1000);
  return { type, targetIds, params };
}

function requireParams(type: AssistantActionType, params: ActionParams) {
  const ok =
    (type === "prepare_nudge" && params.actorId) ||
    (type === "set_status" && params.status) ||
    (type === "set_due" && params.dueAt) ||
    (type === "assign_person" && params.assigneeActorId) ||
    (type === "add_to_bucket" && params.bucketId) ||
    ((type === "snooze_thing" || type === "promise_date") && params.until) ||
    (type === "set_pace" && params.pace) ||
    (type === "set_court_lane" && params.lane) ||
    (type === "add_comment" && params.comment) ||
    type === "catch_thing" ||
    type === "sort_thing" ||
    READ_ONLY.has(type);
  if (!ok) throw new ActionError("This action is missing required details.", 400);
}

async function readThings(client: SupabaseClient, ids: string[]): Promise<Map<string, ThingRow>> {
  const { data, error } = await client
    .from("things")
    .select("id,title,context,work_status,acknowledgement,due_at,current_assignee_actor_id")
    .in("id", ids)
    .limit(MAX_TARGETS);
  if (error) throw new ActionError("The targets could not be rechecked.", 502);
  return new Map(((data ?? []) as ThingRow[]).map((row) => [row.id, row]));
}

function snapshotOf(row: ThingRow) {
  return {
    s: row.work_status,
    a: row.current_assignee_actor_id,
    d: row.due_at ? new Date(row.due_at).toISOString() : null,
    k: row.acknowledgement,
  };
}

type Evaluation = { results: ActionTargetResult[]; label: string; reason: string; myActorId?: string | null; acks?: Map<string, string | null> };

/** Shared by preview and confirm so both apply the same rules to fresh data. */
async function evaluate(
  client: SupabaseClient,
  type: AssistantActionType,
  targetIds: string[],
  params: ActionParams,
  viewerId: string,
  snapshot?: Snapshot,
): Promise<Evaluation> {
  const results = (rows: Array<[string, string, ActionTargetResult["state"], string?]>) =>
    rows.map(([id, title, state, message]) => ({ id, title, state, ...(message ? { message } : {}) }));

  if (type === "open_list" || type === "open_bucket") {
    const { data, error } = await client
      .from(type === "open_list" ? "lists" : "buckets")
      .select("id,name")
      .in("id", targetIds)
      .is("archived_at", null)
      .limit(MAX_TARGETS);
    if (error) throw new ActionError("The target could not be rechecked.", 502);
    const found = new Map((data ?? []).map((row) => [row.id as string, row.name as string]));
    return {
      label: `Open ${found.values().next().value ?? "this place"}`,
      reason: "Opens the page; nothing is changed.",
      results: targetIds.map((id) => ({
        id,
        title: found.get(id) ?? "Unavailable",
        state: found.has(id) ? ("ready" as const) : ("rejected" as const),
        ...(found.has(id) ? {} : { message: "No longer available." }),
      })),
    };
  }

  const things = await readThings(client, targetIds);
  const nudgeable = new Map<string, Set<string>>();
  let people = new Set<string>();
  let bucketOk: { context: string; members: Set<string>; name: string } | null = null;

  if (type === "prepare_nudge") {
    const { data, error } = await client.rpc("list_nudgeable_things", {});
    if (error) throw new ActionError("Nudge eligibility could not be checked.", 502);
    for (const row of (data ?? []) as Array<{ thing_id?: string; to_actor_id?: string }>)
      if (row.thing_id && row.to_actor_id)
        nudgeable.set(row.to_actor_id, (nudgeable.get(row.to_actor_id) ?? new Set()).add(row.thing_id));
  }
  let myActorId: string | null = null;
  if (type === "set_status" || type === "catch_thing" || type === "sort_thing" || type === "snooze_thing" || type === "promise_date" || type === "set_court_lane" || type === "add_comment") {
    // set_work_status is limited to the current assignee, so resolve the viewer's actor.
    const { data } = await client.from("actors").select("id").eq("profile_id", viewerId).maybeSingle();
    myActorId = (data?.id as string | undefined) ?? null;
  }
  if (type === "assign_person" || type === "prepare_nudge") {
    const { data, error } = await client.rpc("list_assignable_people", {});
    if (error) throw new ActionError("People could not be checked.", 502);
    people = new Set(((data ?? []) as Array<{ actor_id: string }>).map((p) => p.actor_id));
  }
  if (type === "add_to_bucket") {
    const [bucket, items] = await Promise.all([
      client.from("buckets").select("id,name,context").eq("id", params.bucketId!).is("archived_at", null).maybeSingle(),
      client.from("bucket_items").select("thing_id").eq("bucket_id", params.bucketId!).in("thing_id", targetIds),
    ]);
    if (bucket.error || !bucket.data) throw new ActionError("That Bucket is no longer available.", 409);
    bucketOk = {
      context: bucket.data.context as string,
      name: bucket.data.name as string,
      members: new Set((items.data ?? []).map((row) => row.thing_id as string)),
    };
  }

  const rows: Array<[string, string, ActionTargetResult["state"], string?]> = targetIds.map((id) => {
    const row = things.get(id);
    if (!row) return [id, "Unavailable", "rejected", "No longer visible to you."];
    const title = row.title.slice(0, 160);
    const closed = CLOSED.has(row.work_status);
    switch (type) {
      case "open_thing":
        return [id, title, "ready"];
      case "prepare_nudge":
        if (closed) return [id, title, "rejected", "Already closed."];
        if (row.current_assignee_actor_id !== params.actorId)
          return [id, title, "rejected", "The assignee changed."];
        if (!nudgeable.get(params.actorId!)?.has(id))
          return [id, title, "rejected", "Not nudgeable now (cooldown or permission)."];
        break;
      case "set_status":
        if (row.work_status === params.status) return [id, title, "already_applied"];
        if (closed) return [id, title, "rejected", "Already closed."];
        if (!myActorId || row.current_assignee_actor_id !== myActorId)
          return [id, title, "rejected", "Only the current assignee can change status."];
        if (row.acknowledgement !== "caught") return [id, title, "rejected", "Catch this Thing first."];
        break;
      case "set_due":
        if (closed) return [id, title, "rejected", "Already closed."];
        if (row.due_at && new Date(row.due_at).getTime() === new Date(params.dueAt!).getTime())
          return [id, title, "already_applied"];
        break;
      case "assign_person":
        if (row.current_assignee_actor_id === params.assigneeActorId) return [id, title, "already_applied"];
        if (closed) return [id, title, "rejected", "Already closed."];
        if (!people.has(params.assigneeActorId!)) return [id, title, "rejected", "That person is not assignable."];
        break;
      case "catch_thing":
        if (row.acknowledgement === "caught") return [id, title, "already_applied"];
        if (closed) return [id, title, "rejected", "Already closed."];
        if (!myActorId || row.current_assignee_actor_id !== myActorId) return [id, title, "rejected", "Only the person holding it can catch it."];
        break;
      case "sort_thing":
        if (row.work_status === "sorted") return [id, title, "already_applied"];
        if (closed) return [id, title, "rejected", "Already closed."];
        if (!myActorId || row.current_assignee_actor_id !== myActorId) return [id, title, "rejected", "Only the person holding it can mark it sorted."];
        break;
      case "snooze_thing":
      case "set_court_lane":
      case "promise_date":
        if (closed) return [id, title, "rejected", "Already closed."];
        if (!myActorId || row.current_assignee_actor_id !== myActorId) return [id, title, "rejected", "Only Things in your court."];
        break;
      case "set_pace":
        if (closed) return [id, title, "rejected", "Already closed."];
        break;
      case "add_comment":
        break;
      case "add_to_bucket":
        if (bucketOk!.members.has(id)) return [id, title, "already_applied"];
        if (row.context !== bucketOk!.context) return [id, title, "rejected", "Different context from the Bucket."];
        break;
    }
    const before = snapshot?.[id];
    const now = snapshotOf(row);
    if (before && (before.s !== now.s || before.a !== now.a || before.d !== now.d || before.k !== now.k))
      return [id, title, "rejected", "Changed since the preview. Review again."];
    return [id, title, "ready"];
  });

  const count = targetIds.length;
  const things_ = `${count} Thing${count === 1 ? "" : "s"}`;
  const label = {
    open_thing: "Open this Thing",
    prepare_nudge: `Nudge ${things_}`,
    set_status: `Mark ${things_} as ${params.status?.replace("_", " ")}`,
    set_due: `Set the due date on ${things_}`,
    assign_person: `Reassign ${things_}`,
    add_to_bucket: `Add ${things_} to ${bucketOk?.name ?? "the Bucket"}`,
    catch_thing: `Catch ${things_}`,
    sort_thing: `Mark ${things_} sorted`,
    snooze_thing: `Snooze ${things_}`,
    promise_date: `Promise a date on ${things_}`,
    set_court_lane: `Move ${things_} to ${params.lane} in your Court; sender’s pace and due date stay unchanged`,
    set_pace: `Set the pace on ${things_} to ${params.pace === "chill" ? "no rush" : params.pace}`,
    add_comment: `Comment on ${things_}`,
  }[type as "open_thing"];
  return {
    results: results(rows), label, reason: "Prepared from your request; nothing changes until you confirm.",
    myActorId, acks: new Map([...things].map(([id, row]) => [id, row.acknowledgement])),
  };
}

export async function previewAssistantAction(
  client: SupabaseClient,
  userId: string,
  request: ReturnType<typeof parseActionRequest>,
) {
  requireParams(request.type, request.params);
  const evaluation = await evaluate(client, request.type, request.targetIds, request.params, userId);
  const readOnly = READ_ONLY.has(request.type);
  const ready = evaluation.results.filter((r) => r.state === "ready").map((r) => r.id);
  const action: AssistantAction = {
    id: randomUUID(),
    type: request.type,
    targetIds: readOnly ? request.targetIds : ready,
    label: evaluation.label,
    reason: evaluation.reason,
    requiresConfirmation: !readOnly,
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
  };
  if (readOnly) return { action, targets: evaluation.results, token: null };
  if (!ready.length) return { action: { ...action, targetIds: [] }, targets: evaluation.results, token: null };
  const things = await readThings(client, ready);
  const snapshot: Snapshot = {};
  for (const [id, row] of things) snapshot[id] = snapshotOf(row);
  const token = sign({ v: 1, uid: userId, action, params: request.params, snapshot, nonce: randomBytes(8).toString("hex") });
  return { action, targets: evaluation.results, token };
}

const finished = new Map<string, { at: number; promise: Promise<ConfirmResult> }>();
export type ConfirmResult = { ok: boolean; results: ActionTargetResult[] };

export async function confirmAssistantAction(
  client: SupabaseClient,
  userId: string,
  input: { token?: unknown; idempotencyKey?: unknown },
): Promise<ConfirmResult> {
  const key = typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
  if (key.length < 8 || key.length > 100) throw new ActionError("An idempotency key is required.", 400);
  const payload = verify(input.token);
  if (payload.uid !== userId) throw new ActionError("Invalid action.", 403);
  if (Date.now() > new Date(payload.action.expiresAt).getTime())
    throw new ActionError("This action expired. Prepare it again.", 410);
  const cacheKey = `${userId}:${payload.action.id}:${key}`;
  const existing = finished.get(cacheKey);
  if (existing) return existing.promise;
  const promise = run(client, payload);
  finished.set(cacheKey, { at: Date.now(), promise });
  for (const [k, v] of finished)
    if (Date.now() - v.at > 10 * 60 * 1000 || finished.size > 500) finished.delete(k);
  promise.catch(() => finished.delete(cacheKey));
  return promise;
}

async function run(client: SupabaseClient, payload: TokenPayload): Promise<ConfirmResult> {
  const { action, params, snapshot } = payload;
  if (!action.requiresConfirmation || READ_ONLY.has(action.type)) throw new ActionError("Invalid action.", 400);
  const evaluation = await evaluate(client, action.type, action.targetIds, params, payload.uid, snapshot);
  const out: ActionTargetResult[] = [];
  for (const target of evaluation.results) {
    if (target.state !== "ready") {
      out.push(target);
      continue;
    }
    const call = (() => {
      switch (action.type) {
        case "prepare_nudge":
          return client.rpc("nudge_thing", { p_thing_id: target.id, p_reason: "quiet", p_message: params.message || null });
        case "set_status":
          return client.rpc("set_work_status", { p_thing_id: target.id, p_work_status: params.status });
        case "set_due":
          return client.rpc("set_due", { p_thing_id: target.id, p_due_at: params.dueAt, p_due_has_time: params.dueHasTime ?? false });
        case "assign_person":
          return client.rpc("reassign_thing", { p_thing_id: target.id, p_new_assignee_actor_id: params.assigneeActorId });
        case "catch_thing":
          return (async () => {
            const caught = await client.rpc("catch_thing", { p_thing_id: target.id, p_personal_pace: "next" });
            if (caught.error) return caught;
            return client.rpc("set_work_status", { p_thing_id: target.id, p_work_status: "under_progress" });
          })();
        case "sort_thing":
          return client.rpc("sort_thing", { p_thing_id: target.id });
        case "snooze_thing":
          return client.rpc("snooze_thing", { p_thing_id: target.id, p_snoozed_until: params.until });
        case "promise_date":
          return (async () => {
            if (evaluation.acks?.get(target.id) !== "caught") {
              const caught = await client.rpc("catch_thing", { p_thing_id: target.id, p_personal_pace: "next" });
              if (caught.error) return caught;
            }
            return client.rpc("coey_promise" as never, { p_thing_id: target.id, p_promise_at: params.until } as never);
          })();
        case "set_court_lane":
          return client.rpc("set_my_court_lane" as never, { p_thing_id: target.id, p_lane: params.lane } as never);
        case "set_pace":
          return client.rpc("coey_set_pace" as never, { p_thing_id: target.id, p_pace: params.pace } as never);
        case "add_comment":
          return client.from("thing_comments").insert({ thing_id: target.id, body: params.comment!, author_actor_id: evaluation.myActorId! });
        default:
          return client.rpc("add_to_bucket", { p_bucket_id: params.bucketId, p_thing_id: target.id });
      }
    })();
    try {
      const { error } = await call;
      out.push(error ? { ...target, state: "failed", message: error.message } : { ...target, state: "applied" });
    } catch {
      out.push({ ...target, state: "failed", message: "The change could not be saved." });
    }
  }
  return { ok: out.some((r) => r.state === "applied" || r.state === "already_applied"), results: out };
}
