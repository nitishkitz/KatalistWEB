import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultCalendar, safeTimezone, type HolderCalendar } from "../../../../src/domain/coey/calendar";
import type { ThingSchedule } from "../../../../src/domain/coey/model";
import { computeHolderLane, computeSenderConcern } from "../../../../src/domain/coey/placement";

/**
 * Everything the Ask agent may read for one viewer, loaded once per turn with
 * the viewer's own Supabase session, so RLS decides what is visible. Tools
 * only filter and shape this; they never widen it (spec §13.2).
 */
export type WsThing = {
  id: string;
  title: string;
  notes: string | null;
  mode: "work" | "home";
  list_id: string | null;
  list: string | null;
  status: string;
  acknowledgement: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  sorted_at: string | null;
  caught_at: string | null;
  owner_actor_id: string;
  owner: string;
  holder_actor_id: string;
  holder: string;
  /** I sent it to someone else. */
  sent_by_me: boolean;
  /** It is in my court. */
  in_my_court: boolean;
  open: boolean;
  /** My lane for Things in my court. */
  lane: "now" | "next" | "later" | "none" | "hidden" | null;
  /** Sender-side concern for Things I sent (§8.2). */
  concern: string | null;
  promise_at: string | null;
  snoozed_until: string | null;
  bucket_ids: string[];
  /** The server would accept a nudge right now (list_nudgeable_things: timing, cooldown, rights). */
  can_nudge_now: boolean;
  /** Files on the Thing (stored attachments, plus older inline files kept in notes). */
  files: Array<{ name: string; kind: FileKind }>;
  /** When the viewer last nudged this Thing (their own nudges only). */
  my_last_nudge_at: string | null;
};

export type FileKind = "image" | "pdf" | "document" | "spreadsheet" | "video" | "other";
export function fileKind(name: string, mime?: string | null, type?: string | null): FileKind {
  const m = `${mime ?? ""} ${type ?? ""} ${name}`.toLowerCase();
  if (/image|\b(png|jpe?g|gif|webp|heic|svg)\b|\.(png|jpe?g|gif|webp|heic|svg)$/.test(m)) return "image";
  if (/pdf/.test(m)) return "pdf";
  if (/video|\.(mp4|mov|webm)$/.test(m)) return "video";
  if (/sheet|excel|csv|\.(xlsx?|csv)$/.test(m)) return "spreadsheet";
  if (/word|docx?|text|\.(docx?|txt|pptx?)$/.test(m)) return "document";
  return "other";
}

export type WsPerson = { actor_id: string; profile_id: string; name: string; connected: boolean; me: boolean };

const CLOSED = new Set(["sorted", "completed", "cancelled"]);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export class Workspace {
  readonly now: number;
  timezone = "Asia/Kolkata";
  viewerName = "";
  myActorId = "";
  things: WsThing[] = [];
  people: WsPerson[] = [];
  lists: Array<{ id: string; name: string; mode: string }> = [];
  buckets: Array<{ id: string; name: string; mode: string }> = [];
  private loaded: Promise<void> | null = null;

  readonly client: SupabaseClient;
  readonly userId: string;
  constructor(client: SupabaseClient, userId: string, now = Date.now()) {
    this.client = client;
    this.userId = userId;
    this.now = now;
  }

  load(): Promise<void> {
    this.loaded ??= this.read();
    return this.loaded;
  }

  private async read() {
    const c = this.client;
    const [profile, actor, ids, things, lists, buckets, snoozes, nudgeable] = await Promise.all([
      c.from("profiles").select("display_name,timezone").eq("id", this.userId).maybeSingle(),
      c.from("actors").select("id").eq("profile_id", this.userId).maybeSingle(),
      c.rpc("list_visible_identities"),
      c.from("things")
        .select("id,title,notes,context,list_id,work_status,acknowledgement,due_at,created_at,updated_at,sorted_at,caught_at,owner_actor_id,current_assignee_actor_id,owner_importance,assignee_personal_pace,cancelled_at")
        .is("cancelled_at", null)
        .order("updated_at", { ascending: false })
        .limit(600),
      // Direct messages and group chats are conversations, not Lists.
      c.from("lists").select("id,name,context").is("archived_at", null).not("kind", "in", "(dm,group)").limit(200),
      c.from("buckets").select("id,name,context").is("archived_at", null).limit(200),
      c.from("thing_snooze").select("thing_id,snoozed_until").gt("snoozed_until", new Date(this.now).toISOString()).limit(500),
      c.rpc("list_nudgeable_things", {}),
    ]);
    const canNudge = new Set(((nudgeable.data ?? []) as Array<{ thing_id?: string }>).map((r) => r.thing_id).filter(Boolean));
    if (things.error) throw things.error;
    const p = profile.data as { display_name?: string; timezone?: string } | null;
    this.timezone = safeTimezone(p?.timezone);
    this.viewerName = p?.display_name ?? "";
    this.myActorId = (actor.data as { id?: string } | null)?.id ?? "";
    type Ident = { profile_id: string; actor_id: string | null; display_name: string; connected: boolean };
    this.people = ((ids.data ?? []) as Ident[])
      .filter((r) => r.actor_id)
      .map((r) => ({ actor_id: r.actor_id!, profile_id: r.profile_id, name: r.display_name, connected: r.connected, me: r.profile_id === this.userId }));
    const nameOf = new Map(this.people.map((x) => [x.actor_id, x.me ? "You" : x.name]));
    this.lists = ((lists.data ?? []) as Array<{ id: string; name: string; context: string }>).map((l) => ({ id: l.id, name: l.name, mode: l.context }));
    this.buckets = ((buckets.data ?? []) as Array<{ id: string; name: string; context: string }>).map((b) => ({ id: b.id, name: b.name, mode: b.context }));
    const listName = new Map(this.lists.map((l) => [l.id, l.name]));
    const snoozed = new Map(((snoozes.data ?? []) as Array<{ thing_id: string; snoozed_until: string }>).map((s) => [s.thing_id, s.snoozed_until]));

    type Row = {
      id: string; title: string; notes: string | null; context: "work" | "home"; list_id: string | null; work_status: string; acknowledgement: string;
      due_at: string | null; created_at: string; updated_at: string; sorted_at: string | null; caught_at: string | null; owner_actor_id: string;
      current_assignee_actor_id: string; owner_importance: string | null; assignee_personal_pace: string | null;
    };
    const rows = (things.data ?? []) as Row[];
    const thingIds = rows.map((r) => r.id);
    const [schedules, bucketItems, attachments, myNudges] = await Promise.all([this.schedules(thingIds), this.bucketItems(thingIds), this.attachments(thingIds), this.myNudges(thingIds)]);
    const me = this.myActorId;
    this.things = rows.map((r) => {
      const s = schedules.get(r.id);
      const open = !CLOSED.has(r.work_status);
      const inMyCourt = r.current_assignee_actor_id === me && open;
      const sentByMe = r.owner_actor_id === me && r.current_assignee_actor_id !== me;
      let lane: WsThing["lane"] = null;
      if (inMyCourt) {
        const decided = s ? computeHolderLane({ ...s.schedule, snoozeUntil: null }, s.cal, this.now).lane : null;
        lane = decided ?? ((r.assignee_personal_pace ?? r.owner_importance ?? "next") as WsThing["lane"]);
        if (snoozed.has(r.id)) lane = "hidden";
      }
      // Older Things keep inline files in notes as JSON; that is not note text.
      let notes: string | null = r.notes;
      const inline: Array<{ name: string; kind: FileKind }> = [];
      if (r.notes?.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(r.notes) as { files?: Array<{ name?: string; type?: string; mimeType?: string }>; text?: string };
          notes = typeof parsed.text === "string" ? parsed.text : null;
          for (const f of parsed.files ?? []) if (f.name) inline.push({ name: f.name, kind: fileKind(f.name, f.mimeType, f.type) });
        } catch { /* plain text */ }
      }
      const stored = attachments.get(r.id) ?? [];
      return {
        id: r.id, title: r.title, notes: notes ? notes.slice(0, 500) : null, mode: r.context, list_id: r.list_id,
        list: r.list_id ? listName.get(r.list_id) ?? null : null, status: r.work_status, acknowledgement: r.acknowledgement,
        due_at: r.due_at, created_at: r.created_at, updated_at: r.updated_at, sorted_at: r.sorted_at, caught_at: r.caught_at,
        owner_actor_id: r.owner_actor_id, owner: nameOf.get(r.owner_actor_id) ?? "Katalist member",
        holder_actor_id: r.current_assignee_actor_id, holder: nameOf.get(r.current_assignee_actor_id) ?? "Katalist member",
        sent_by_me: sentByMe, in_my_court: inMyCourt, open, lane,
        concern: sentByMe && open && s ? computeSenderConcern(s.schedule, s.cal, this.now) : null,
        promise_at: s ? iso(s.schedule.promiseAt) : null,
        snoozed_until: snoozed.get(r.id) ?? null,
        bucket_ids: bucketItems.get(r.id) ?? [],
        can_nudge_now: canNudge.has(r.id),
        files: stored.length ? stored : inline,
        my_last_nudge_at: myNudges.get(r.id) ?? null,
      };
    });
  }

  private async schedules(ids: string[]) {
    const out = new Map<string, { schedule: ThingSchedule; cal: HolderCalendar }>();
    if (!ids.length) return out;
    try {
      const { scheduleFromRow } = await import("../../../../src/features/court/coey/schedules");
      const { calendarFromRow } = await import("../../../../src/features/court/coey/use-coey-context");
      const rows: ThingSchedule[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await this.client.from("thing_schedules").select("*").in("thing_id", ids.slice(i, i + 200));
        rows.push(...((data ?? []) as Parameters<typeof scheduleFromRow>[0][]).map(scheduleFromRow));
      }
      const holders = [...new Set(rows.map((r) => r.holderProfileId).filter((x): x is string => Boolean(x)))];
      const cals = new Map<string, HolderCalendar>();
      if (holders.length) {
        const { data } = await this.client.rpc("get_calendars", { p_profile_ids: holders });
        for (const row of (data ?? []) as Parameters<typeof calendarFromRow>[0][]) cals.set(row.profile_id, calendarFromRow(row));
      }
      const fallback = defaultCalendar(this.timezone);
      for (const s of rows) out.set(s.thingId, { schedule: s, cal: (s.holderProfileId && cals.get(s.holderProfileId)) || fallback });
    } catch {
      // Without schedules, lanes fall back to the stored pace and concerns are unknown.
    }
    return out;
  }

  private async myNudges(ids: string[]) {
    const out = new Map<string, string>();
    if (!ids.length || !this.myActorId) return out;
    const { data } = await this.client.from("nudges").select("thing_id,created_at").eq("from_actor_id", this.myActorId).in("thing_id", ids.slice(0, 300)).order("created_at", { ascending: false }).limit(500);
    for (const row of (data ?? []) as Array<{ thing_id: string; created_at: string }>) if (!out.has(row.thing_id)) out.set(row.thing_id, row.created_at);
    return out;
  }

  private async attachments(ids: string[]) {
    const out = new Map<string, Array<{ name: string; kind: FileKind }>>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await this.client.from("thing_attachments").select("thing_id,file_name,mime_type").in("thing_id", ids.slice(i, i + 200)).eq("status", "ready").limit(2000);
      for (const row of (data ?? []) as Array<{ thing_id: string; file_name: string; mime_type: string }>) {
        out.set(row.thing_id, [...(out.get(row.thing_id) ?? []), { name: row.file_name, kind: fileKind(row.file_name, row.mime_type) }]);
      }
    }
    return out;
  }

  private async bucketItems(ids: string[]) {
    const out = new Map<string, string[]>();
    if (!ids.length || !this.buckets.length) return out;
    const { data } = await this.client.from("bucket_items").select("bucket_id,thing_id").in("bucket_id", this.buckets.map((b) => b.id)).not("thing_id", "is", null).limit(2000);
    for (const row of (data ?? []) as Array<{ bucket_id: string; thing_id: string }>) out.set(row.thing_id, [...(out.get(row.thing_id) ?? []), row.bucket_id]);
    return out;
  }

  thing(id: string) {
    return this.things.find((t) => t.id === id) ?? null;
  }
}
