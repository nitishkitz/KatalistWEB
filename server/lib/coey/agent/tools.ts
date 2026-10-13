import { addDays, localParts, zonedInstant } from "../../../../src/domain/coey/calendar";
import { summarizeEvent } from "../../assistant-activity";
import type { ActionParams, AssistantActionType } from "../../assistant-actions";
import { FESTIVAL_DATES } from "../../../../src/domain/coey/time";
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
import type { Workspace, WsThing } from "./workspace";

/**
 * The Ask agent's tools. Read tools filter the viewer's Workspace (already
 * RLS-scoped) or read per-Thing detail with the viewer's own session. Nothing
 * here writes: actions are only proposed, and the person confirms them in the UI.
 */
type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]s\b/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const nullable = (schema: Json) => ({ anyOf: [schema, { type: "null" }] });
const STATES = ["any", "open", "waiting_for_catch", "in_progress", "sorted", "overdue", "past_follow_up", "promised", "snoozed"] as const;

export const ACTION_TYPES = ["catch", "sort", "snooze", "nudge", "promise", "set_pace", "comment", "reassign", "open"] as const;
/** The same shape the answer's action cards use; confirmed through /api/assistant/action. */
export type ProposedAction = { id: string; type: AssistantActionType; label: string; requires_confirmation: boolean; target_ids: string[]; params: ActionParams };

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "find_things",
      description:
        "Find, count or group the user's Things (tasks). Use for any question about what is pending, due, overdue, waiting, sorted, sent, received, by person, List, Bucket, lane or date. Returns a total, optional group counts, and up to `limit` Things.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: nullable({ type: "string", enum: ["work", "home", "both"], description: "Default: the mode the user is in." }),
          person: nullable({ type: "string", description: "A person's name as the user typed it. Matches Things they sent you or that are with them." }),
          relation: nullable({ type: "string", enum: ["any", "in_my_court", "i_sent", "they_sent_me", "with_them"], description: "in_my_court = the user holds it; i_sent = the user sent it to someone; they_sent_me / with_them need `person`." }),
          state: nullable({ type: "string", enum: [...STATES], description: "open = not sorted. past_follow_up = Things the user sent that are past their usual follow-up time or missed a promised date." }),
          lane: nullable({ type: "string", enum: ["now", "next", "later"] }),
          list: nullable({ type: "string", description: "List name" }),
          bucket: nullable({ type: "string", description: "Bucket name" }),
          text: nullable({ type: "string", description: "Words in the Thing title or notes" }),
          has_files: nullable({ type: "string", enum: ["any", "image", "pdf", "document", "spreadsheet", "video"], description: "Only Things with attached files of this kind (\"any\" = any file)" }),
          date_field: nullable({ type: "string", enum: ["due", "created", "sorted", "updated"] }),
          from: nullable({ type: "string", description: "First local date, YYYY-MM-DD, inclusive" }),
          to: nullable({ type: "string", description: "Last local date, YYYY-MM-DD, inclusive" }),
          sort: nullable({ type: "string", enum: ["due_soonest", "oldest", "newest", "recently_updated"] }),
          group_by: nullable({ type: "string", enum: ["none", "person", "list", "lane", "state", "mode"] }),
          limit: nullable({ type: "integer", minimum: 1, maximum: 50 }),
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "date_info",
      description: "Exact calendar facts: today's date, the weekday of a date, days from today, and known dates of festivals and of the user's own holidays.",
      parameters: { type: "object", additionalProperties: false, properties: { date: nullable({ type: "string", description: "YYYY-MM-DD" }), occasion: nullable({ type: "string", description: "A festival or occasion name" }) } },
    },
  },
  {
    type: "function",
    function: {
      name: "show_answer",
      description:
        "Finish: show the answer. The heading is the outcome in a few words (\"5 Things in your court\", \"No follow-up needed yet\"). The description is one or two short sentences of context, without listing Thing titles (the rows show them). results = the refs to show: find_things (r1…) as rows, get_thing (d1…) as one Thing in full, activity (a1…) as a timeline, search_comments (c1…) as comment excerpts. Empty if nothing should be shown. group_by: lane (Now/Next/Later/With others/Snoozed), person, state, or none.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string", maxLength: 90 },
          description: nullable({ type: "string", maxLength: 320 }),
          results: { type: "array", items: { type: "string" }, maxItems: 4 },
          group_by: { type: "string", enum: ["lane", "person", "state", "none"] },
        },
        required: ["heading", "results", "group_by"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_thing",
      description: "Full detail of one Thing: notes, who sent it and who holds it, dates, lane, promise, files, latest comments, its activity history and nudge times. Pass the id from find_things, or a title.",
      parameters: { type: "object", additionalProperties: false, properties: { id: nullable({ type: "string" }), title: nullable({ type: "string" }) } },
    },
  },
  {
    type: "function",
    function: {
      name: "search_comments",
      description: "Search comments on the user's Things, by words, by who wrote them and by date.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { text: nullable({ type: "string" }), person: nullable({ type: "string" }), from: nullable({ type: "string" }), to: nullable({ type: "string" }), limit: nullable({ type: "integer", minimum: 1, maximum: 30 }) },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "activity",
      description: "What happened on the user's Things between two local dates: created, caught, sorted, reassigned, due date changes, comments, nudges.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" }, person: nullable({ type: "string" }), limit: nullable({ type: "integer", minimum: 1, maximum: 60 }) },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "people_lists_buckets",
      description: "The people the user is connected with, and the user's Lists and Buckets with how many open Things each has.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_action",
      description:
        "Offer the user an action on one Thing. It is NOT performed: the user sees a button and confirms. Types: catch; sort (mark sorted); snooze (args.option 1h|6h|next_day); nudge (only Things the user sent to someone); promise (args.at local YYYY-MM-DDTHH:MM; for Things someone else sent the user — this is how the user moves such a Thing between lanes: within a working day = Now, 2-5 working days = Next, more = Later); set_pace (args.pace urgent|normal|chill; only Things the user sent, including their own: urgent = Now, normal = Next, chill = Later); comment (args.body); reassign (args.person); open.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: [...ACTION_TYPES] },
          thing_id: nullable({ type: "string", description: "One Thing" }),
          thing_ids: nullable({ type: "array", items: { type: "string" }, maxItems: 20, description: "Several Things for the same action" }),
          args: nullable({ type: "object", additionalProperties: true }),
        },
        required: ["type"],
      },
    },
  },
] as const;

/** Sender-side follow-up, in words (§8.2). */
const FOLLOW_UP: Record<string, string> = {
  promise_missed: "missed its promised date",
  stale: "past its usual follow-up time",
  not_caught: "not caught yet",
  caught_no_date: "caught, no date promised",
  on_track: "on track (promised date ahead)",
  blocked: "waiting on someone else",
};

/** One line of history or a comment, with its Thing. Times are ISO; text from people is plain text. */
export type Entry = { at: string; by: string; text: string; thing_id: string; thing_title: string };
const commentText = (body: unknown) => String(body ?? "").replace(/<!--[\s\S]*?-->/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);

export type ToolOutcome = { result: Json; thingIds: string[]; action?: ProposedAction; status: string };

export class AgentTools {
  readonly actions: ProposedAction[] = [];
  readonly seen = new Set<string>();
  /** Every find_things result, by ref, with ALL matching ids (not only the rows sent to the model). */
  readonly results = new Map<string, { ids: string[]; filters: string[] }>();
  /** get_thing (d…), activity (a…) and search_comments (c…) results the answer can show. */
  readonly details = new Map<string, { thingId: string; comments: Entry[]; history: Entry[]; nudgedAt: string[] }>();
  readonly timelines = new Map<string, Entry[]>();
  /** Whether the answer used the person's Katalist data (decides which checks apply). */
  usedKatalist = false;
  readonly commentSets = new Map<string, Entry[]>();
  hasRef(ref: string) { return this.results.has(ref) || this.details.has(ref) || this.timelines.has(ref) || this.commentSets.has(ref); }
  /** Set when the model calls show_answer. */
  final: { heading: string; description: string | null; results: string[]; groupBy: "lane" | "person" | "state" | "none" } | null = null;
  private readonly ws: Workspace;
  private readonly mode: "work" | "home";
  constructor(ws: Workspace, mode: "work" | "home") {
    this.ws = ws;
    this.mode = mode;
  }

  async run(name: string, raw: unknown): Promise<ToolOutcome> {
    await this.ws.load();
    const args = (raw && typeof raw === "object" ? raw : {}) as Json;
    if (["find_things", "get_thing", "search_comments", "activity", "people_lists_buckets", "propose_action"].includes(name)) this.usedKatalist = true;
    switch (name) {
      case "date_info": return this.dateInfo(args);
      case "find_things": return this.findThings(args);
      case "get_thing": return this.getThing(args);
      case "search_comments": return this.searchComments(args);
      case "activity": return this.activity(args);
      case "people_lists_buckets": return this.peopleListsBuckets();
      case "propose_action": return this.proposeMany(args);
      case "show_answer": {
        const g = String(args.group_by);
        this.final = {
          heading: (str(args.heading) ?? "").slice(0, 90),
          description: str(args.description)?.slice(0, 320) ?? null,
          results: Array.isArray(args.results) ? (args.results as unknown[]).filter((x): x is string => typeof x === "string" && this.hasRef(x)) : [],
          groupBy: g === "lane" || g === "person" || g === "state" ? g : "none",
        };
        return { result: { shown: true }, thingIds: [], status: "Writing the answer" };
      }
      default: return { result: { error: `unknown tool ${name}` }, thingIds: [], status: "Thinking" };
    }
  }

  private day(date: string | null, end = false): number | null {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return zonedInstant(end ? addDays(date, 1) : date, 0, this.ws.timezone);
  }

  /** Exact name (full or first) among people the viewer can see; never guesses. */
  resolvePerson(name: string): { ids: string[]; names: string[]; me: boolean } {
    const wanted = fold(name);
    if (["me", "my", "myself", "i"].includes(wanted)) return { ids: [this.ws.myActorId], names: ["You"], me: true };
    const known = new Map<string, string>();
    for (const p of this.ws.people) known.set(p.actor_id, p.me ? this.ws.viewerName : p.name);
    for (const t of this.ws.things) {
      known.set(t.owner_actor_id, known.get(t.owner_actor_id) ?? t.owner);
      known.set(t.holder_actor_id, known.get(t.holder_actor_id) ?? t.holder);
    }
    const hits = [...known].filter(([, n]) => n && (fold(n) === wanted || fold(n).split(" ")[0] === wanted));
    const loose = hits.length ? hits : [...known].filter(([, n]) => n && wanted.length >= 3 && fold(n).includes(wanted));
    return { ids: loose.map(([id]) => id), names: loose.map(([id, n]) => (id === this.ws.myActorId ? `${n} (you)` : n)), me: loose.length === 1 && loose[0]![0] === this.ws.myActorId };
  }

  /** Local "YYYY-MM-DD HH:MM" in the viewer's timezone. */
  local(isoAt: string | null): string | null {
    if (!isoAt) return null;
    const at = Date.parse(isoAt);
    if (!Number.isFinite(at)) return null;
    const p = localParts(at, this.ws.timezone);
    return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday]} ${p.date} ${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`;
  }

  private compact(t: WsThing) {
    this.seen.add(t.id);
    return {
      id: t.id, title: t.title, from: t.owner, with: t.holder, mode: t.mode, list: t.list,
      state: t.status === "sorted" ? "sorted" : t.acknowledgement === "waiting_for_catch" ? "waiting_for_catch" : t.status === "under_progress" ? "in_progress" : t.status,
      lane: t.lane, due: this.local(t.due_at), promised_for: this.local(t.promise_at), follow_up: t.concern ? FOLLOW_UP[t.concern] ?? t.concern : null,
      snoozed_until: this.local(t.snoozed_until),
      ...(t.sent_by_me && t.open ? { can_nudge_now: t.can_nudge_now } : {}),
      ...(t.files.length ? { files: t.files.slice(0, 5).map((f) => `${f.name} (${f.kind})`), file_count: t.files.length } : {}),
      created: this.local(t.created_at)?.slice(4, 14) ?? null, sorted_on: this.local(t.sorted_at)?.slice(4, 14) ?? null,
    };
  }

  private findThings(a: Json): ToolOutcome {
    const ws = this.ws, me = ws.myActorId, now = ws.now;
    const mode = str(a.mode) ?? this.mode;
    let things = ws.things.filter((t) => mode === "both" || t.mode === mode);
    let personNote: Json | null = null;
    const person = str(a.person);
    let personIds: string[] = [];
    if (person) {
      const r = this.resolvePerson(person);
      if (r.ids.length === 0) return { result: { total: 0, person_not_found: person, note: "No one by that name is visible to this user." }, thingIds: [], status: "Looking for people" };
      if (r.ids.length > 1 && !r.me) return { result: { total: 0, ambiguous_person: person, candidates: r.names, note: "Ask the user which one they mean." }, thingIds: [], status: "Looking for people" };
      personIds = r.ids;
      personNote = { person: r.names[0] };
    }
    const relation = str(a.relation) ?? "any";
    let breakdown: Json | null = null;
    if (personIds.length && personIds[0] !== me) {
      const pid = personIds[0]!;
      const open = things.filter((t) => t.open);
      breakdown = {
        open_with_them_sent_by_you: open.filter((t) => t.holder_actor_id === pid && t.owner_actor_id === me).length,
        open_with_them_from_others: open.filter((t) => t.holder_actor_id === pid && t.owner_actor_id !== me).length,
        open_in_your_court_sent_by_them: open.filter((t) => t.owner_actor_id === pid && t.holder_actor_id === me).length,
      };
    }
    if (personIds.length) {
      const pid = personIds[0]!;
      things = things.filter((t) =>
        pid === me ? t.holder_actor_id === me
          : relation === "they_sent_me" ? t.owner_actor_id === pid && t.holder_actor_id === me
            : relation === "with_them" ? t.holder_actor_id === pid
              : t.holder_actor_id === pid || t.owner_actor_id === pid);
    }
    if (relation === "in_my_court") things = things.filter((t) => t.holder_actor_id === me);
    if (relation === "i_sent") things = things.filter((t) => t.sent_by_me);
    const state = str(a.state) ?? "open";
    const due = (t: WsThing) => (t.due_at ? Date.parse(t.due_at) : null);
    things = things.filter((t) => {
      switch (state) {
        case "any": return true;
        case "open": return t.open;
        case "waiting_for_catch": return t.open && t.acknowledgement === "waiting_for_catch";
        case "in_progress": return t.open && t.acknowledgement !== "waiting_for_catch";
        case "sorted": return t.status === "sorted";
        case "overdue": return t.open && due(t) !== null && due(t)! < now;
        case "past_follow_up": return t.sent_by_me && (t.concern === "stale" || t.concern === "promise_missed");
        case "promised": return t.open && t.promise_at !== null;
        case "snoozed": return t.lane === "hidden";
        default: return t.open;
      }
    });
    const lane = str(a.lane);
    if (lane) things = things.filter((t) => t.lane === lane);
    const list = str(a.list);
    if (list) {
      const ids = ws.lists.filter((l) => fold(l.name).includes(fold(list))).map((l) => l.id);
      things = things.filter((t) => t.list_id && ids.includes(t.list_id));
    }
    const bucket = str(a.bucket);
    if (bucket) {
      const ids = ws.buckets.filter((b) => fold(b.name).includes(fold(bucket))).map((b) => b.id);
      things = things.filter((t) => t.bucket_ids.some((b) => ids.includes(b)));
    }
    const text = str(a.text);
    if (text) {
      const words = fold(text).split(" ").filter((w) => w.length > 2);
      things = things.filter((t) => { const hay = fold(`${t.title} ${t.notes ?? ""}`); return words.every((w) => hay.includes(w)); });
    }
    const hasFiles = str(a.has_files);
    if (hasFiles) things = things.filter((t) => t.files.some((f) => hasFiles === "any" || f.kind === hasFiles));
    const field = str(a.date_field);
    const from = this.day(str(a.from)), to = this.day(str(a.to), true);
    if (from !== null || to !== null) {
      const pick = (t: WsThing) => {
        const v = field === "created" ? t.created_at : field === "sorted" ? t.sorted_at : field === "updated" ? t.updated_at : t.due_at;
        return v ? Date.parse(v) : null;
      };
      things = things.filter((t) => { const v = pick(t); return v !== null && (from === null || v >= from) && (to === null || v < to); });
    }
    const sort = str(a.sort) ?? "due_soonest";
    const order: Record<string, (x: WsThing, y: WsThing) => number> = {
      due_soonest: (x, y) => (due(x) ?? Infinity) - (due(y) ?? Infinity),
      oldest: (x, y) => Date.parse(x.created_at) - Date.parse(y.created_at),
      newest: (x, y) => Date.parse(y.created_at) - Date.parse(x.created_at),
      recently_updated: (x, y) => Date.parse(y.updated_at) - Date.parse(x.updated_at),
    };
    things = [...things].sort(order[sort] ?? order.due_soonest);
    const groupBy = str(a.group_by);
    let groups: Array<{ group: string; count: number }> | undefined;
    if (groupBy && groupBy !== "none") {
      const key = (t: WsThing) =>
        groupBy === "person" ? (t.holder_actor_id === me ? `From ${t.owner}` : `With ${t.holder}`)
          : groupBy === "list" ? t.list ?? "No List"
            : groupBy === "lane" ? t.lane ?? "not in your court"
              : groupBy === "mode" ? t.mode
                : this.compact(t).state;
      const counts = new Map<string, number>();
      for (const t of things) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
      groups = [...counts].map(([group, count]) => ({ group, count })).sort((x, y) => y.count - x.count);
    }
    const limit = Math.min(50, Math.max(1, Number(a.limit) || 15));
    const shown = things.slice(0, limit).map((t) => this.compact(t));
    const ref = `r${this.results.size + 1}`;
    this.results.set(ref, { ids: things.map((t) => t.id), filters: filterLabels(a, personNote?.person as string | undefined, this.mode) });
    return {
      result: { ref, total: things.length, ...(personNote ?? {}), ...(breakdown ? { person_breakdown: breakdown } : {}), ...(groups ? { groups } : {}), things: shown, ...(things.length > shown.length ? { more: things.length - shown.length } : {}) },
      thingIds: shown.map((t) => t.id),
      status: "Looking through your Things",
    };
  }

  private findOne(a: Json): WsThing | null {
    const id = str(a.id);
    if (id) return this.ws.thing(id);
    const title = str(a.title ?? a.thing_title);
    if (!title) return null;
    const want = fold(title);
    const exact = this.ws.things.filter((t) => fold(t.title) === want);
    if (exact.length === 1) return exact[0]!;
    const words = want.split(" ").filter((w) => w.length > 2);
    const near = this.ws.things.filter((t) => words.length && words.every((w) => fold(t.title).includes(w)));
    return near.length === 1 ? near[0]! : null;
  }

  private async getThing(a: Json): Promise<ToolOutcome> {
    const t = this.findOne(a);
    if (!t) return { result: { error: "No single Thing matches. Use find_things with text to see candidates." }, thingIds: [], status: "Looking for that Thing" };
    const c = this.ws.client;
    const [comments, events, nudges] = await Promise.all([
      c.from("thing_comments").select("author_actor_id,body,created_at").eq("thing_id", t.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(10),
      c.from("thing_activity").select("actor_id,event,detail,created_at").eq("thing_id", t.id).order("created_at", { ascending: false }).limit(15),
      c.from("nudges").select("created_at").eq("thing_id", t.id).order("created_at", { ascending: false }).limit(10),
    ]);
    const name = (id: unknown) => this.nameOf(id);
    const ref = `d${this.details.size + 1}`;
    const entry = (at: string, by: string, text: string): Entry => ({ at, by, text, thing_id: t.id, thing_title: t.title });
    this.details.set(ref, {
      thingId: t.id,
      comments: ((comments.data ?? []) as Array<{ author_actor_id: string; body: string; created_at: string }>).map((r) => entry(r.created_at, name(r.author_actor_id), commentText(r.body))).filter((e) => e.text),
      history: ((events.data ?? []) as Array<{ actor_id: string; event: string; detail: Record<string, unknown> | null; created_at: string }>).map((e) => entry(e.created_at, name(e.actor_id), summarizeEvent(e.event, e.detail, name))),
      nudgedAt: ((nudges.data ?? []) as Array<{ created_at: string }>).map((n) => n.created_at),
    });
    return {
      result: {
        ref,
        thing: { ...this.compact(t), notes: t.notes, caught_on: this.local(t.caught_at), updated: this.local(t.updated_at), sent_by_user: t.sent_by_me, in_users_court: t.in_my_court },
        files: t.files.map((f) => `${f.name} (${f.kind})`),
        comments: ((comments.data ?? []) as Array<{ author_actor_id: string; body: string; created_at: string }>).map((r) => ({ by: name(r.author_actor_id), at: this.local(r.created_at), untrusted_text: commentText(r.body) })),
        history: ((events.data ?? []) as Array<{ actor_id: string; event: string; detail: Record<string, unknown> | null; created_at: string }>).map((e) => ({ at: this.local(e.created_at), by: name(e.actor_id), what: summarizeEvent(e.event, e.detail, name) })),
        // §13.2: nudge history shows times only, never who asked.
        nudged_at: ((nudges.data ?? []) as Array<{ created_at: string }>).map((n) => this.local(n.created_at)),
      },
      thingIds: [t.id],
      status: `Reading “${t.title.slice(0, 40)}”`,
    };
  }

  private nameOf(actorId: unknown): string {
    if (actorId === this.ws.myActorId) return "You";
    const p = this.ws.people.find((x) => x.actor_id === actorId);
    if (p) return p.name;
    const t = this.ws.things.find((x) => x.owner_actor_id === actorId || x.holder_actor_id === actorId);
    return t ? (t.owner_actor_id === actorId ? t.owner : t.holder) : "Katalist member";
  }

  private async searchComments(a: Json): Promise<ToolOutcome> {
    const ids = this.ws.things.map((t) => t.id);
    if (!ids.length) return { result: { comments: [] }, thingIds: [], status: "Reading comments" };
    let q = this.ws.client.from("thing_comments").select("thing_id,author_actor_id,body,created_at").in("thing_id", ids.slice(0, 300)).is("deleted_at", null);
    const from = this.day(str(a.from)), to = this.day(str(a.to), true);
    if (from !== null) q = q.gte("created_at", new Date(from).toISOString());
    if (to !== null) q = q.lt("created_at", new Date(to).toISOString());
    const text = str(a.text);
    if (text) q = q.ilike("body", `%${text.replace(/[%_]/g, "").slice(0, 60)}%`);
    const person = str(a.person);
    if (person) {
      const r = this.resolvePerson(person);
      if (r.ids.length !== 1) return { result: r.ids.length ? { ambiguous_person: person, candidates: r.names } : { person_not_found: person }, thingIds: [], status: "Reading comments" };
      q = q.eq("author_actor_id", r.ids[0]!);
    }
    const { data } = await q.order("created_at", { ascending: false }).limit(Math.min(30, Math.max(1, Number(a.limit) || 15)));
    const rows = (data ?? []) as Array<{ thing_id: string; author_actor_id: string; body: string; created_at: string }>;
    const cref = `c${this.commentSets.size + 1}`;
    this.commentSets.set(cref, rows.map((r) => ({ at: r.created_at, by: this.nameOf(r.author_actor_id), text: commentText(r.body), thing_id: r.thing_id, thing_title: this.ws.thing(r.thing_id)?.title ?? "a Thing" })).filter((e) => e.text));
    return {
      result: { ref: cref, comments: rows.map((r) => ({ thing_id: r.thing_id, thing: this.ws.thing(r.thing_id)?.title ?? "a Thing", by: this.nameOf(r.author_actor_id), at: this.local(r.created_at), untrusted_text: commentText(r.body) })) },
      thingIds: [...new Set(rows.map((r) => r.thing_id))],
      status: "Reading comments",
    };
  }

  private async activity(a: Json): Promise<ToolOutcome> {
    const from = this.day(str(a.from)), to = this.day(str(a.to), true);
    if (from === null || to === null) return { result: { error: "from and to must be YYYY-MM-DD" }, thingIds: [], status: "Checking activity" };
    const ids = this.ws.things.map((t) => t.id);
    if (!ids.length) return { result: { events: [] }, thingIds: [], status: "Checking activity" };
    let q = this.ws.client.from("thing_activity").select("thing_id,actor_id,event,detail,created_at").in("thing_id", ids.slice(0, 300))
      .gte("created_at", new Date(from).toISOString()).lt("created_at", new Date(to).toISOString());
    const person = str(a.person);
    if (person) {
      const r = this.resolvePerson(person);
      if (r.ids.length !== 1) return { result: r.ids.length ? { ambiguous_person: person, candidates: r.names } : { person_not_found: person }, thingIds: [], status: "Checking activity" };
      q = q.eq("actor_id", r.ids[0]!);
    }
    const { data } = await q.order("created_at", { ascending: false }).limit(Math.min(60, Math.max(1, Number(a.limit) || 40)));
    const rows = (data ?? []) as Array<{ thing_id: string; actor_id: string; event: string; detail: Record<string, unknown> | null; created_at: string }>;
    const name = (id: unknown) => this.nameOf(id);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.event] = (counts[r.event] ?? 0) + 1;
    const aref = `a${this.timelines.size + 1}`;
    this.timelines.set(aref, rows.map((r) => ({ at: r.created_at, by: name(r.actor_id), text: summarizeEvent(r.event, r.detail, name), thing_id: r.thing_id, thing_title: this.ws.thing(r.thing_id)?.title ?? "a Thing" })));
    return {
      result: { ref: aref, counts_by_event: counts, events: rows.map((r) => ({ thing_id: r.thing_id, thing: this.ws.thing(r.thing_id)?.title ?? "a Thing", by: name(r.actor_id), at: this.local(r.created_at), what: summarizeEvent(r.event, r.detail, name) })) },
      thingIds: [...new Set(rows.map((r) => r.thing_id))].slice(0, 20),
      status: "Checking what changed",
    };
  }

  private dateInfo(a: Json): ToolOutcome {
    const tz = this.ws.timezone;
    const today = todayIn(this.ws.now, tz);
    const days = (d: string) => Math.round((zonedInstant(d, 0, tz) - zonedInstant(today, 0, tz)) / 86_400_000);
    const out: Json = { today, today_weekday: WEEKDAY_NAMES[localParts(this.ws.now, tz).weekday] };
    const date = str(a.date);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = { date, weekday: WEEKDAY_NAMES[localParts(zonedInstant(date, 12 * 60, tz), tz).weekday], days_from_today: days(date) };
    const occasion = str(a.occasion);
    if (occasion) {
      const key = occasion.toLowerCase().replace(/[^a-z]/g, "");
      const known = Object.entries(FESTIVAL_DATES).find(([k]) => key.includes(k) || k.includes(key));
      const upcoming = known?.[1].filter((d) => d >= today) ?? [];
      out.occasion = upcoming.length
        ? { name: occasion, next_date: upcoming[0], weekday: WEEKDAY_NAMES[localParts(zonedInstant(upcoming[0]!, 12 * 60, tz), tz).weekday], days_from_today: days(upcoming[0]!), source: "Katalist festival calendar" }
        : { name: occasion, known: false, note: "Not in Katalist's festival calendar. Give your best knowledge and tell the user to confirm the exact date, since many festival dates change each year." };
    }
    return { result: out, thingIds: [], status: "Checking the calendar" };
  }

  private peopleListsBuckets(): ToolOutcome {
    const ws = this.ws;
    const openIn = (pred: (t: WsThing) => boolean) => ws.things.filter((t) => t.open && pred(t)).length;
    return {
      result: {
        // §13.2 / Q4: names only — never another person's workload.
        connected_people: ws.people.filter((p) => p.connected && !p.me).map((p) => p.name),
        lists: ws.lists.map((l) => ({ name: l.name, mode: l.mode, open_things: openIn((t) => t.list_id === l.id) })),
        buckets: ws.buckets.map((b) => ({ name: b.name, mode: b.mode, open_things: openIn((t) => t.bucket_ids.includes(b.id)) })),
      },
      thingIds: [],
      status: "Checking your people and Lists",
    };
  }

  /** One proposal per action and holder; several Things share one confirm card. */
  private proposeMany(a: Json): ToolOutcome {
    const ids = Array.isArray(a.thing_ids) ? (a.thing_ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20) : [];
    if (ids.length <= 1) return this.propose({ ...a, thing_id: ids[0] ?? a.thing_id });
    const outcomes = ids.map((id) => this.propose({ ...a, thing_id: id }, false));
    const ok = outcomes.filter((o) => o.action);
    const merged = new Map<string, ProposedAction>();
    for (const o of ok) {
      const x = o.action!;
      const key = `${x.type}:${JSON.stringify(x.params)}`;
      const prev = merged.get(key);
      merged.set(key, prev ? { ...prev, target_ids: [...prev.target_ids, ...x.target_ids] } : { ...x });
    }
    for (const x of merged.values()) {
      const full = x.target_ids.length > 1 ? { ...x, id: `agent-${x.type}-${x.target_ids.length}-${x.target_ids[0]}`, label: batchLabel(x) } : x;
      if (!this.actions.some((y) => y.id === full.id)) this.actions.push(full);
    }
    return {
      result: { proposed: ok.length, buttons: [...merged.values()].map((x) => (x.target_ids.length > 1 ? batchLabel(x) : x.label)), skipped: outcomes.filter((o) => !o.action).map((o) => o.result.reason), note: "Not done yet; the user must confirm." },
      thingIds: ok.flatMap((o) => o.thingIds),
      status: "Preparing an action",
    };
  }

  private propose(a: Json, record = true): ToolOutcome {
    const type = str(a.type);
    const t = this.findOne({ id: a.thing_id, title: a.thing_id });
    const args = (a.args && typeof a.args === "object" ? a.args : {}) as Json;
    const refuse = (why: string): ToolOutcome => ({ result: { proposed: false, reason: why }, thingIds: [], status: "Preparing an action" });
    if (!type || !(ACTION_TYPES as readonly string[]).includes(type)) return refuse("unknown action type");
    if (!t) return refuse("that Thing is not visible to this user; find it first");
    const me = this.ws.myActorId;
    const mine = t.holder_actor_id === me && t.open;
    const sent = t.owner_actor_id === me && t.open;
    const tz = this.ws.timezone;
    let action: Omit<ProposedAction, "id" | "requires_confirmation" | "target_ids"> | null = null;
    switch (type) {
      case "catch":
        if (!mine || t.acknowledgement !== "waiting_for_catch") return refuse("only an uncaught Thing in the user's court can be caught");
        action = { type: "catch_thing", label: `Catch “${t.title}”`, params: {} };
        break;
      case "sort":
        if (!mine) return refuse("only Things in the user's court can be marked sorted");
        action = { type: "sort_thing", label: `Mark “${t.title}” sorted`, params: {} };
        break;
      case "snooze": {
        if (!mine) return refuse("only Things in the user's court can be snoozed");
        const option = ["1h", "6h", "next_day"].includes(String(args.option)) ? String(args.option) : "next_day";
        const until = option === "1h" ? this.ws.now + 3_600_000 : option === "6h" ? this.ws.now + 6 * 3_600_000 : zonedInstant(addDays(todayIn(this.ws.now, tz), 1), 9 * 60, tz);
        action = { type: "snooze_thing", label: `Snooze “${t.title}” ${option === "next_day" ? "until tomorrow 9 am" : `for ${option.replace("h", " hours").replace("1 hours", "1 hour")}`}`, params: { until: new Date(until).toISOString() } };
        break;
      }
      case "nudge":
        if (!t.sent_by_me || !t.open) return refuse("the user can nudge only Things they sent to someone else");
        if (!t.can_nudge_now) return refuse("too soon to nudge this one: a Thing can be nudged a few hours after it was sent or last changed, and not again within 2 hours of a nudge");
        action = { type: "prepare_nudge", label: `Nudge ${t.holder} about “${t.title}”`, params: { actorId: t.holder_actor_id } };
        break;
      case "promise": {
        if (!mine || t.owner_actor_id === me) return refuse("a promise is for Things someone else sent the user; for the user's own Things use set_pace");
        const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(args.at ?? ""));
        if (!m) return refuse("args.at must be local YYYY-MM-DDTHH:MM");
        const at = zonedInstant(m[1]!, Number(m[2]) * 60 + Number(m[3]), tz);
        if (at < this.ws.now) return refuse("that time has passed");
        const p = localParts(at, tz);
        action = { type: "promise_date", label: `Promise “${t.title}” by ${p.date} ${m[2]}:${m[3]}`, params: { until: new Date(at).toISOString() } };
        break;
      }
      case "set_pace": {
        if (!sent) return refuse("only the sender sets the pace; for a Thing someone else sent, propose a promise date");
        const pace = String(args.pace);
        if (pace !== "urgent" && pace !== "normal" && pace !== "chill") return refuse("pace must be urgent, normal or chill");
        action = { type: "set_pace", label: `Set “${t.title}” to ${pace === "chill" ? "no rush" : pace}`, params: { pace } };
        break;
      }
      case "comment": {
        const body = str(args.body);
        if (!body) return refuse("args.body is required");
        action = { type: "add_comment", label: `Comment on “${t.title}”: “${body.slice(0, 80)}”`, params: { comment: body.slice(0, 1000) } };
        break;
      }
      case "reassign": {
        if (!t.open || (t.owner_actor_id !== me && t.holder_actor_id !== me)) return refuse("only the sender or holder can reassign");
        const r = this.resolvePerson(String(args.person ?? ""));
        const connected = r.ids.filter((id) => this.ws.people.some((p) => p.actor_id === id && (p.connected || p.me)));
        if (connected.length !== 1) return refuse(connected.length ? "more than one person matches; ask which" : "the user is not connected with that person");
        action = { type: "assign_person", label: `Send “${t.title}” to ${r.names[r.ids.indexOf(connected[0]!)]}`, params: { assigneeActorId: connected[0] } };
        break;
      }
      case "open":
        action = { type: "open_thing", label: `Open “${t.title}”`, params: {} };
        break;
    }
    if (!action) return refuse("unknown action type");
    const full: ProposedAction = { ...action, id: `agent-${action.type}-${t.id}`, requires_confirmation: action.type !== "open_thing", target_ids: [t.id] };
    if (record && !this.actions.some((x) => x.id === full.id)) this.actions.push(full);
    this.seen.add(t.id);
    return { result: { proposed: true, shown_to_user_as_button: full.label, note: "Not done yet; the user must confirm." }, thingIds: [t.id], action: full, status: "Preparing an action" };
  }
}

const STATE_LABEL: Record<string, string> = {
  waiting_for_catch: "Waiting for Catch", in_progress: "In progress", sorted: "Sorted", overdue: "Overdue",
  past_follow_up: "Past follow-up", promised: "Promised", snoozed: "Snoozed", any: "Any state",
};
/** Plain labels for what a search covered, shown as chips above the rows. */
export function filterLabels(a: Json, person: string | undefined, mode: "work" | "home"): string[] {
  const out: string[] = [];
  const m = str(a.mode);
  if (m === "both") out.push("Work and Home");
  else if (m && m !== mode) out.push(m === "work" ? "Work" : "Home");
  const rel = str(a.relation);
  if (rel === "in_my_court") out.push("In your court");
  if (rel === "i_sent") out.push("Sent by you");
  if (person) out.push(rel === "they_sent_me" ? `From ${person}` : rel === "with_them" ? `With ${person}` : person);
  const st = str(a.state);
  if (st && st !== "open" && STATE_LABEL[st]) out.push(STATE_LABEL[st]);
  const lane = str(a.lane);
  if (lane) out.push(lane[0]!.toUpperCase() + lane.slice(1));
  for (const k of ["list", "bucket"] as const) { const v = str(a[k]); if (v) out.push(`${k === "list" ? "List" : "Bucket"}: ${v}`); }
  const text = str(a.text);
  if (text) out.push(`“${text}”`);
  const files = str(a.has_files);
  if (files) out.push(files === "any" ? "Has files" : `Has ${files === "image" ? "images" : `${files} files`}`);
  const field = str(a.date_field), from = str(a.from), to = str(a.to);
  if (from || to) out.push(`${field === "created" ? "Created" : field === "sorted" ? "Sorted" : field === "updated" ? "Changed" : "Due"} ${from && to ? (from === to ? from : `${from} – ${to}`) : from ? `from ${from}` : `until ${to}`}`);
  return out;
}

function batchLabel(x: ProposedAction) {
  const n = x.target_ids.length;
  const verb: Record<string, string> = {
    catch_thing: "Catch", sort_thing: "Mark sorted:", snooze_thing: "Snooze", prepare_nudge: "Nudge about", promise_date: "Promise", set_pace: "Set pace on",
    add_comment: "Comment on", assign_person: "Reassign", open_thing: "Open",
  };
  return `${verb[x.type] ?? "Apply to"} ${n} Things`;
}

export const todayIn = (now: number, timezone: string) => localParts(now, timezone).date;
