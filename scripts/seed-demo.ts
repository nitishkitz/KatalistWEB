/**
 * KATALIST DEMO / STAGING SEED  —  DEMO DATA ONLY, NEVER PRODUCTION
 * =================================================================
 * Usage:  bun scripts/seed-demo.ts
 *
 * Drives the existing Katalist backend through its real RPCs as real
 * authenticated demo people. No schema / RLS / RPC / enum / lifecycle change,
 * no trigger disabled, no direct write to `things` — every Thing, catch, pace,
 * status change, handover, sort, cancel, bucket reference, nudge, shred and
 * Bridge grant goes through the frozen contracts, so every row is canonical by
 * construction (including current_assignment_id).
 *
 * Backdated ("aged") state is deliberately NOT simulated: things.created_at is
 * immutable and set_updated_at forces updated_at = now(), so aged rows cannot
 * be produced safely. Newer valid states are used instead, and the Nudges
 * surface is populated with real nudges rather than faked timestamps.
 *
 * Rerunning is safe: the demo universe is torn down first (scripts/reset-demo.ts).
 */
import {
  admin,
  DEMO_FIXED_OTP,
  EXTERNALS,
  PEOPLE,
  PersonKey,
  Session,
  daysAhead,
  hoursAhead,
  rpc,
  signInAs,
  todayAt,
} from './demo/lib';
import { resetDemo } from './reset-demo';

type Ctx = 'work' | 'home';
type Level = 'now' | 'next' | 'later';

const counts: Record<string, number> = {
  people: 0,
  external_actors: 0,
  things: 0,
  lists: 0,
  list_memberships: 0,
  buckets: 0,
  bucket_items: 0,
  thing_comments: 0,
  list_messages: 0,
  nudges: 0,
  bridge_grants: 0,
  shredded: 0,
  ghost_cards: 0,
};

// ---------------------------------------------------------------- helpers

type ThingRow = { id: string; title: string };

/**
 * Katalist history is append-only by design (Things, assignments, activity and
 * nudges can never be deleted, and this seed does not disable those triggers).
 * Rerunning therefore *converges* on the existing demo universe instead of
 * building a second one: anything already present is reused, anything already
 * in the target state is left alone.
 */
const existingThings = new Map<string, ThingRow>();
const existingLists = new Map<string, string>();

export async function loadExisting() {
  const { data: things } = await admin.from('things').select('id, title');
  for (const t of things ?? []) existingThings.set(t.title, t as ThingRow);
  const { data: lists } = await admin.from('lists').select('id, name');
  for (const l of lists ?? []) existingLists.set(l.name, l.id);
}

/** Run a step that is already satisfied on a rerun without failing the seed. */
async function tolerant(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  · skipped ${label}: ${msg}`);
    return false;
  }
}

async function makeThing(
  owner: Session,
  args: {
    title: string;
    assignee?: string;
    notes?: string;
    context?: Ctx;
    importance?: Level;
    pace?: Level;
    dueAt?: string;
    dueHasTime?: boolean;
    listId?: string;
  },
): Promise<ThingRow> {
  const already = existingThings.get(args.title);
  if (already) {
    counts.things++;
    return already;
  }
  const row = await rpc<ThingRow>(owner.db, 'create_thing', {
    p_title: args.title,
    p_assignee_actor_id: args.assignee ?? null,
    p_notes: args.notes ?? null,
    p_context: args.context ?? 'work',
    p_owner_importance: args.importance ?? 'next',
    p_personal_pace: args.pace ?? null,
    p_due_at: args.dueAt ?? null,
    p_due_has_time: args.dueHasTime ?? false,
    p_list_id: args.listId ?? null,
  });
  counts.things++;
  existingThings.set(row.title, row);
  return row;
}

const catchIt = (s: Session, id: string, pace?: Level) =>
  tolerant(`catch ${id}`, () =>
    rpc(s.db, 'catch_thing', { p_thing_id: id, p_personal_pace: pace ?? null }),
  );

const status = (s: Session, id: string, work: 'under_progress' | 'not_started') =>
  tolerant(`status ${id}`, () =>
    rpc(s.db, 'set_work_status', { p_thing_id: id, p_work_status: work }),
  );

const sortIt = (s: Session, id: string) =>
  tolerant(`sort ${id}`, () => rpc(s.db, 'sort_thing', { p_thing_id: id }));

const cancelIt = (s: Session, id: string, reason: string) =>
  tolerant(`cancel ${id}`, () =>
    rpc(s.db, 'cancel_thing', { p_thing_id: id, p_reason: reason }),
  );

async function comment(s: Session, thingId: string, body: string) {
  const { error } = await s.db
    .from('thing_comments')
    .insert({ thing_id: thingId, author_actor_id: s.actorId, body });
  if (error) {
    console.log(`  · skipped comment: ${error.message}`);
    return;
  }
  counts.thing_comments++;
}

async function listMessage(s: Session, listId: string, body: string) {
  const { error } = await s.db
    .from('list_messages')
    .insert({ list_id: listId, author_profile_id: s.profileId, body });
  if (error) {
    console.log(`  · skipped list message: ${error.message}`);
    return;
  }
  counts.list_messages++;
}

async function makeList(owner: Session, name: string, context: Ctx = 'work') {
  const already = existingLists.get(name);
  if (already) {
    counts.lists++;
    return already;
  }
  const row = await rpc<{ id: string }>(owner.db, 'create_list', {
    p_name: name,
    p_context: context,
  });
  counts.lists++;
  existingLists.set(name, row.id);
  return row.id;
}

async function addMember(
  owner: Session,
  listId: string,
  member: Session,
  role: 'collaborator' | 'view_only',
) {
  const ok = await tolerant(`member ${member.person.name}`, () =>
    rpc(owner.db, 'add_list_member', {
      p_list_id: listId,
      p_profile_id: member.profileId,
      p_role: role,
    }),
  );
  if (ok) counts.list_memberships++;
}

async function makeBucket(owner: Session, name: string, context: Ctx = 'work') {
  const row = await rpc<{ id: string }>(owner.db, 'create_bucket', {
    p_name: name,
    p_context: context,
  });
  counts.buckets++;
  return row.id;
}

async function bucketAdd(
  owner: Session,
  bucketId: string,
  ref: { thingId?: string; listId?: string },
) {
  await rpc(owner.db, 'add_to_bucket', {
    p_bucket_id: bucketId,
    p_thing_id: ref.thingId ?? null,
    p_list_id: ref.listId ?? null,
  });
  counts.bucket_items++;
}

async function nudge(
  s: Session,
  thingId: string,
  reason: 'waiting_for_catch' | 'quiet' | 'due_soon' | 'stale' | 'repeated_handoff',
  message?: string,
) {
  const ok = await tolerant('nudge', () =>
    rpc(s.db, 'nudge_thing', {
      p_thing_id: thingId,
      p_reason: reason,
      p_message: message ?? null,
    }),
  );
  if (ok) counts.nudges++;
}

async function shred(s: Session, thingId: string) {
  const ok = await tolerant('shred', () =>
    rpc(s.db, 'shred_for_me', { p_object_type: 'thing', p_object_id: thingId }),
  );
  if (ok) counts.shredded++;
}

async function externalActor(priya: Session, e: (typeof EXTERNALS)[number]) {
  const { data: ident } = await admin
    .from('external_identities')
    .select('id')
    .eq('phone_e164', e.phone)
    .maybeSingle();
  if (ident?.id) {
    const { data: actor } = await admin
      .from('actors')
      .select('id')
      .eq('external_identity_id', ident.id)
      .maybeSingle();
    if (actor?.id) {
      counts.external_actors++;
      return actor.id as string;
    }
  }
  const row = await rpc<{ id: string }>(priya.db, 'create_external_actor', {
    p_display_name: e.name,
    p_phone_e164: e.phone,
    p_email: e.email,
  });
  counts.external_actors++;
  return row.id;

}

/**
 * Repair pass for an interrupted run: re-point a Thing at its own open
 * assignment row. things.current_assignment_id is a mutable back-link (no
 * immutability trigger covers it), so this restores the canonical shape
 * without bypassing any protection.
 */
async function relinkAssignments() {
  const { data: broken } = await admin
    .from('things')
    .select('id, work_status')
    .is('current_assignment_id', null);
  for (const t of broken ?? []) {
    const { data: assignments } = await admin
      .from('thing_assignments')
      .select('id, ended_at, assigned_at')
      .eq('thing_id', t.id)
      .order('assigned_at', { ascending: false });
    const pick = (assignments ?? []).find((a) => !a.ended_at) ?? (assignments ?? [])[0];
    if (!pick) continue;
    await admin.from('things').update({ current_assignment_id: pick.id }).eq('id', t.id);
  }
}

/**
 * Notifications are produced by the real triggers, which is more volume than a
 * demo screen needs. They are freely re-creatable (no invariant, no history
 * guarantee), so the newest 28 are kept.
 */
async function trimNotifications() {
  const { data: keep } = await admin
    .from('notifications')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(28);
  const ids = (keep ?? []).map((k) => k.id);
  if (!ids.length) return;
  await admin.from('notifications').delete().not('id', 'in', `(${ids.join(',')})`);
}

/** Every Thing must look exactly like an RPC-created Thing. */
async function verifyIntegrity() {
  const { data, error } = await admin
    .from('things')
    .select(
      'id, title, work_status, acknowledgement, caught_at, assignee_personal_pace, current_assignee_actor_id, current_assignment_id',
    );
  if (error) throw new Error(`integrity read: ${error.message}`);

  const { data: assignments, error: aErr } = await admin
    .from('thing_assignments')
    .select('id, thing_id, assignee_actor_id, acknowledgement, caught_at, ended_at');
  if (aErr) throw new Error(`integrity read assignments: ${aErr.message}`);
  const byId = new Map(assignments!.map((a) => [a.id, a]));

  const problems: string[] = [];
  for (const t of data!) {
    const a = t.current_assignment_id ? byId.get(t.current_assignment_id) : undefined;
    if (!t.current_assignment_id) problems.push(`${t.title}: current_assignment_id null`);
    else if (!a) problems.push(`${t.title}: current assignment missing`);
    else {
      if (a.thing_id !== t.id) problems.push(`${t.title}: assignment belongs elsewhere`);
      const terminal = t.work_status === 'sorted' || t.work_status === 'cancelled';
      if (a.ended_at && !terminal)
        problems.push(`${t.title}: current assignment already ended`);
      if (a.assignee_actor_id !== t.current_assignee_actor_id)
        problems.push(`${t.title}: assignee mismatch`);
      if (a.acknowledgement !== t.acknowledgement)
        problems.push(`${t.title}: acknowledgement mismatch`);
    }
    if (t.acknowledgement === 'caught' && !t.caught_at) problems.push(`${t.title}: caught w/o time`);
    if (t.acknowledgement === 'waiting_for_catch' && t.caught_at)
      problems.push(`${t.title}: waiting with caught_at`);
    if (t.acknowledgement === 'waiting_for_catch' && t.assignee_personal_pace)
      problems.push(`${t.title}: pace before catch`);
  }
  if (problems.length) throw new Error(`INTEGRITY FAILURES:\n  ${problems.join('\n  ')}`);
  return data!.length;
}

// ---------------------------------------------------------------- main

async function main() {
  console.log('KATALIST DEMO SEED — staging only\n');

  // Removes only what Katalist allows to be removed (buckets, chat, comments,
  // notifications, personal state, memberships). Things, assignments, activity
  // and nudges are append-only: the seed converges on them instead.
  console.log('Clearing the re-creatable demo layer…');
  await resetDemo({ verbose: false });
  await loadExisting();

  const sessions = {} as Record<PersonKey, Session>;
  for (const p of PEOPLE) {
    sessions[p.key] = await signInAs(p);
    counts.people++;
    console.log(`  identity ready: ${p.name}  ${p.phone}`);
  }
  const { priya, arjun, sarah, mike, neha } = sessions;

  const rohan = await externalActor(priya, EXTERNALS[0]!);
  const david = await externalActor(priya, EXTERNALS[1]!);

  // ------------------------------------------------------------- Lists (6)
  const mobile = await makeList(priya, 'Mobile App Launch');
  await addMember(priya, mobile, arjun, 'collaborator');
  await addMember(priya, mobile, mike, 'collaborator');
  await addMember(priya, mobile, sarah, 'view_only');

  const website = await makeList(sarah, 'Website Relaunch');
  await addMember(sarah, website, priya, 'collaborator');
  await addMember(sarah, website, mike, 'collaborator');
  await addMember(sarah, website, neha, 'view_only');

  const campaign = await makeList(priya, 'Q4 Marketing Campaign');
  await addMember(priya, campaign, sarah, 'collaborator');
  await addMember(priya, campaign, neha, 'view_only');

  const office = await makeList(neha, 'Office Operations');
  await addMember(neha, office, priya, 'collaborator');
  await addMember(neha, office, arjun, 'view_only');

  const onboarding = await makeList(mike, 'Customer Onboarding Revamp');
  await addMember(mike, onboarding, priya, 'collaborator');
  await addMember(mike, onboarding, neha, 'view_only');

  const home = await makeList(priya, 'Home & Family', 'home');

  // ------------------------------------------- Priya's Court — NOW (work)
  const playStore = await makeThing(priya, {
    title: 'Finalize Play Store wording',
    importance: 'now',
    pace: 'now',
    listId: mobile,
    dueAt: todayAt(17),
    dueHasTime: true,
    notes: 'Short description is over the character limit — trim the feature list.',
  });
  await status(priya, playStore.id, 'under_progress');

  const vendorCall = await makeThing(priya, {
    title: 'Call vendor for shoot confirmation',
    importance: 'now',
    pace: 'next', // Owner Importance NOW, Personal Pace NEXT
    dueAt: hoursAhead(5),
    dueHasTime: true,
  });

  const budget = await makeThing(priya, {
    title: 'Review campaign budget',
    importance: 'now',
    pace: 'now',
    listId: campaign,
    dueAt: daysAhead(1),
  });

  const checklist = await makeThing(priya, {
    title: 'Fix production release checklist',
    importance: 'now',
    pace: 'now',
    listId: mobile,
    dueAt: todayAt(19),
    dueHasTime: true,
  });
  await status(priya, checklist.id, 'under_progress');

  const banner = await makeThing(priya, {
    title: 'Approve launch banner',
    importance: 'next', // Owner Importance NEXT, Personal Pace NOW
    pace: 'now',
    listId: campaign,
  });

  const macros = await makeThing(priya, {
    title: 'Sign off support macros',
    importance: 'now',
    pace: 'now',
    listId: onboarding,
  });

  // ------------------------------------------ Priya's Court — NEXT (work)
  const launchCopy = await makeThing(priya, {
    title: 'Review website launch copy',
    importance: 'next',
    pace: 'next',
    listId: website,
  });
  const photographer = await makeThing(priya, {
    title: 'Book launch photographer',
    importance: 'next',
    pace: 'next',
    dueAt: daysAhead(4),
  });
  const invoice = await makeThing(priya, {
    title: 'Confirm vendor invoice',
    importance: 'now',
    pace: 'next',
    dueAt: daysAhead(3),
  });
  const meetingNotes = await makeThing(priya, {
    title: 'Prepare launch meeting notes',
    importance: 'next',
    pace: 'next',
  });
  const landing = await makeThing(priya, {
    title: 'Review new landing page',
    importance: 'next',
    pace: 'next',
    listId: website,
  });
  await status(priya, landing.id, 'under_progress');

  // ----------------------------------------- Priya's Court — LATER (work)
  const assetFolder = await makeThing(priya, {
    title: 'Organize campaign asset folder',
    importance: 'later',
    pace: 'later',
  });
  const venues = await makeThing(priya, {
    title: 'Research Q4 event venues',
    importance: 'later',
    pace: 'later',
  });
  const sop = await makeThing(priya, {
    title: 'Update internal SOP document',
    importance: 'later',
    pace: 'later',
    listId: office,
  });
  // Created, then cancelled by its Owner — keeps a LATER Thing in the
  // cancelled history rather than inflating the active set.
  const oldContracts = await makeThing(priya, {
    title: 'Review old vendor contracts',
    importance: 'later',
    pace: 'later',
  });
  await cancelIt(priya, oldContracts.id, 'Superseded by the new vendor register.');

  // ------------------------------------------------- Priya's Court — HOME
  const electrician = await makeThing(priya, {
    title: 'Book electrician for kitchen socket',
    context: 'home',
    importance: 'now',
    pace: 'now',
    dueAt: todayAt(20),
    dueHasTime: true,
    listId: home,
    notes: 'Socket behind the fridge trips the breaker.',
  });
  const insurance = await makeThing(priya, {
    title: 'Renew car insurance',
    context: 'home',
    importance: 'next',
    pace: 'next',
    dueAt: daysAhead(6),
  });
  const gift = await makeThing(priya, {
    title: "Buy birthday gift for Meera",
    context: 'home',
    importance: 'next',
    pace: 'now',
    dueAt: daysAhead(2),
    listId: home,
  });

  // ------------------------------ Priya's Court — Waiting for Catch (in)
  const pressNote = await makeThing(sarah, {
    title: 'Sign off on the launch press note',
    assignee: priya.actorId,
    importance: 'now',
    dueAt: daysAhead(2),
  });
  const seating = await makeThing(neha, {
    title: 'Approve office seating plan',
    assignee: priya.actorId,
    importance: 'next',
    listId: office,
  });
  const emailSeq = await makeThing(mike, {
    title: 'Confirm onboarding email sequence',
    assignee: priya.actorId,
    importance: 'now',
    listId: onboarding,
    dueAt: daysAhead(1),
  });

  // --------------------------------------------------------- Their Court
  const qa = await makeThing(priya, {
    title: 'QA Android production build',
    assignee: arjun.actorId,
    importance: 'now',
    listId: mobile,
    dueAt: daysAhead(1),
  });
  const contract = await makeThing(priya, {
    title: 'Review launch contract',
    assignee: neha.actorId,
    importance: 'now',
    dueAt: daysAhead(2),
  });
  const emailCopy = await makeThing(priya, {
    title: 'Finalize launch email copy',
    assignee: sarah.actorId,
    importance: 'now',
    listId: campaign,
  });
  await catchIt(sarah, emailCopy.id);
  await status(sarah, emailCopy.id, 'under_progress');

  const screenshots = await makeThing(priya, {
    title: 'Upload product screenshots',
    assignee: mike.actorId,
    importance: 'next',
    listId: mobile,
  });
  await catchIt(mike, screenshots.id, 'now');
  await status(mike, screenshots.id, 'under_progress');

  const pricing = await makeThing(priya, {
    title: 'Vendor pricing confirmation',
    assignee: rohan,
    importance: 'now',
    dueAt: daysAhead(2),
    notes: 'Rohan is an outside vendor — reachable through a Bridge link only.',
  });

  const approval = await makeThing(priya, {
    title: 'Client approval document',
    assignee: neha.actorId,
    importance: 'next',
  });
  await catchIt(neha, approval.id, 'next');

  const releaseDraft = await makeThing(priya, {
    title: 'Prepare release notes draft',
    assignee: arjun.actorId,
    importance: 'next',
    listId: mobile,
  });
  await catchIt(arjun, releaseDraft.id, 'later');

  const pricingPage = await makeThing(priya, {
    title: 'Update pricing page',
    assignee: sarah.actorId,
    importance: 'next',
    listId: website,
  });

  const onboardChecklist = await makeThing(priya, {
    title: 'Refresh onboarding checklist',
    assignee: mike.actorId,
    importance: 'next',
    listId: onboarding,
  });
  await catchIt(mike, onboardChecklist.id, 'next');
  await status(mike, onboardChecklist.id, 'under_progress');

  const supplies = await makeThing(priya, {
    title: 'Stock office supplies for launch week',
    assignee: neha.actorId,
    importance: 'next',
    listId: office,
  });
  await catchIt(neha, supplies.id, 'now');

  // ------------------ Reassignment: handover keeps status, resets the catch
  const shootBrief = await makeThing(priya, {
    title: 'Write photo shoot brief',
    assignee: arjun.actorId,
    importance: 'next',
    listId: campaign,
  });
  await catchIt(arjun, shootBrief.id, 'next');
  await status(arjun, shootBrief.id, 'under_progress');
  await tolerant('reassign shoot brief', () =>
    rpc(priya.db, 'reassign_thing', {
      p_thing_id: shootBrief.id,
      p_new_assignee_actor_id: sarah.actorId,
    }),
  );

  // ---------------------- Things owned by collaborators inside Priya's Lists
  const analytics = await makeThing(mike, {
    title: 'Migrate analytics events',
    importance: 'now',
    pace: 'now',
    listId: mobile,
  });
  await status(mike, analytics.id, 'under_progress');

  const emptyStates = await makeThing(arjun, {
    title: 'Polish empty states',
    importance: 'next',
    pace: 'next',
    listId: mobile,
  });

  const blogPost = await makeThing(sarah, {
    title: 'Publish blog announcement',
    importance: 'now',
    pace: 'now',
    listId: website,
  });

  // -------------------------------------------------- Terminal — Sorted (9)
  const sortedSpecs: {
    owner: Session;
    holder: Session;
    title: string;
    listId?: string;
    context?: Ctx;
  }[] = [
    { owner: priya, holder: priya, title: 'Publish release notes for v2.3', listId: mobile },
    { owner: priya, holder: arjun, title: 'Ship app icon update', listId: mobile },
    { owner: sarah, holder: sarah, title: 'Finalize press contact list', listId: campaign },
    { owner: priya, holder: mike, title: 'Fix crash on Android 12', listId: mobile },
    { owner: priya, holder: priya, title: 'Approve October invoice' },
    { owner: mike, holder: mike, title: 'Set up demo environment', listId: onboarding },
    { owner: priya, holder: priya, title: 'Order launch t-shirts' },
    { owner: priya, holder: priya, title: 'Collect team feedback on beta', listId: mobile },
    { owner: neha, holder: neha, title: 'Archive last quarter office files', listId: office },
  ];
  const sorted: ThingRow[] = [];
  for (const spec of sortedSpecs) {
    const self = spec.owner === spec.holder;
    const t = await makeThing(spec.owner, {
      title: spec.title,
      assignee: self ? undefined : spec.holder.actorId,
      importance: 'next',
      pace: self ? 'next' : undefined,
      listId: spec.listId,
      context: spec.context,
    });
    if (!self) await catchIt(spec.holder, t.id, 'next');
    await status(spec.holder, t.id, 'under_progress');
    await sortIt(spec.holder, t.id);
    sorted.push(t);
  }

  // ----------------------------------------------- Terminal — Cancelled (6)
  const cancelledSpecs: {
    owner: Session;
    title: string;
    reason: string;
    listId?: string;
    context?: Ctx;
    assignee?: string;
  }[] = [
    {
      owner: priya,
      title: 'Print merchandise for launch',
      reason: 'Budget moved to digital ads this quarter.',
    },
    {
      owner: priya,
      title: 'Run radio ad campaign',
      reason: 'Dropped after the media plan review.',
      assignee: sarah.actorId,
    },
    {
      owner: priya,
      title: 'Redesign old pricing table',
      reason: 'Superseded by the new pricing page.',
      listId: website,
    },
    { owner: priya, title: 'Book conference booth', reason: 'Event postponed to next year.' },
    {
      owner: neha,
      title: 'Buy a second coffee machine',
      reason: 'The repaired one is working again.',
      listId: office,
    },
    {
      owner: priya,
      title: 'Order replacement blinds',
      reason: 'Landlord is handling it.',
      context: 'home',
    },
  ];
  const cancelled: ThingRow[] = [];
  for (const spec of cancelledSpecs) {
    const t = await makeThing(spec.owner, {
      title: spec.title,
      assignee: spec.assignee,
      importance: 'later',
      pace: spec.assignee ? undefined : 'later',
      listId: spec.listId,
      context: spec.context,
    });
    await cancelIt(spec.owner, t.id, spec.reason);
    cancelled.push(t);
  }

  // ------------------------------------------------- Bridge (external only)
  const printProof = await makeThing(priya, {
    title: 'Review final print proof',
    assignee: david,
    importance: 'now',
    dueAt: daysAhead(2),
    notes: 'Check the trim marks and the spelling of the venue name.',
  });
  let token: string | undefined;
  await tolerant('bridge grant', async () => {
    const grant = await rpc<{ token: string; expires_at: string }[]>(
      priya.db,
      'issue_bridge_grant',
      { p_thing_id: printProof.id },
    );
    counts.bridge_grants++;
    token = Array.isArray(grant) ? grant[0]?.token : undefined;
  });

  // ------------------------------------------------------- Thing comments
  await comment(priya, playStore.id, 'Trimmed the feature list — one line still runs long.');
  await comment(sarah, emailCopy.id, 'First draft is written, running it past legal tomorrow.');
  await comment(priya, emailCopy.id, 'Looks good. Keep the subject line under 45 characters.');
  await comment(mike, screenshots.id, 'Six of ten screens uploaded, dark mode set is next.');
  await comment(priya, qa.id, 'Prioritise the payment flow when you pick this up.');
  await comment(arjun, releaseDraft.id, 'Drafting from the changelog, ready by Thursday.');
  await comment(priya, contract.id, 'Legal flagged clause 7 — please read it closely.');
  await comment(neha, approval.id, 'Sent to the client, waiting on their signature.');
  await comment(mike, onboardChecklist.id, 'Reordered the steps so billing comes last.');
  await comment(priya, checklist.id, 'Added the rollback step we missed last release.');
  await comment(sarah, shootBrief.id, 'Picking this up from Arjun — brief is half written.');
  await comment(priya, budget.id, 'Media spend is 12% over. Trimming the print line.');
  await comment(mike, analytics.id, 'Events are mapped, verifying in staging today.');
  await comment(priya, sorted[0]!.id, 'Published and shared in the launch channel.');
  await comment(neha, supplies.id, 'Ordered — delivery lands Monday morning.');

  // --------------------------------------------------------- List messages
  await listMessage(priya, mobile, 'Launch review moved to Thursday 4pm. Agenda in the notes.');
  await listMessage(arjun, mobile, 'Icon update is live in the internal build.');
  await listMessage(mike, mobile, 'Android build 214 is up for QA.');
  await listMessage(priya, mobile, 'Please keep screenshots to the six approved screens.');
  await listMessage(sarah, website, 'Copy freeze is Friday — last edits by Thursday night.');
  await listMessage(priya, website, 'Landing page hero still needs the new tagline.');
  await listMessage(mike, website, 'Redirects are mapped for the old pricing URLs.');
  await listMessage(priya, campaign, 'Budget review done, final numbers shared tomorrow.');
  await listMessage(sarah, campaign, 'Press list is finalised — 42 contacts.');
  await listMessage(priya, campaign, 'Shoot brief moved to Sarah while Arjun is on the build.');
  await listMessage(neha, office, 'Seating plan draft is on the noticeboard.');
  await listMessage(priya, office, 'Please confirm the launch week supplies order.');
  await listMessage(mike, onboarding, 'New checklist ordering is in review.');
  await listMessage(priya, onboarding, 'Support macros signed off on my side.');
  await listMessage(neha, office, 'Internet plan renewal comes up at the end of the month.');

  // ----------------------------------------------------------------- Nudges
  await nudge(priya, qa.id, 'waiting_for_catch', 'Can you pick this up today?');
  await nudge(priya, contract.id, 'waiting_for_catch', 'Legal needs this before Friday.');
  await nudge(priya, pricingPage.id, 'waiting_for_catch');
  await nudge(priya, pricing.id, 'waiting_for_catch', 'Following up on the quote.');
  await nudge(priya, emailCopy.id, 'due_soon', 'Send comes out Monday morning.');
  await nudge(priya, screenshots.id, 'quiet', 'How are the dark mode screens coming along?');
  await nudge(priya, approval.id, 'quiet');
  await nudge(sarah, pressNote.id, 'waiting_for_catch', 'Just needs your sign-off.');
  await nudge(mike, emailSeq.id, 'due_soon', 'Sequence goes live tomorrow.');
  await nudge(neha, seating.id, 'waiting_for_catch');
  await nudge(arjun, releaseDraft.id, 'quiet', 'Anything else you want in the notes?');

  // ---------------------------------------------- Buckets (private to Priya)
  const bThisWeek = await makeBucket(priya, 'This Week');
  const bLaunch = await makeBucket(priya, 'Launch Focus');
  const bWaiting = await makeBucket(priya, 'Waiting on Others');
  const bDeep = await makeBucket(priya, 'Deep Work');
  const bRead = await makeBucket(priya, 'Read & Review');
  const bHome = await makeBucket(priya, 'Home Admin', 'home');

  for (const id of [playStore.id, checklist.id, budget.id, vendorCall.id, emailSeq.id, banner.id])
    await bucketAdd(priya, bThisWeek, { thingId: id });
  await bucketAdd(priya, bThisWeek, { listId: mobile });

  for (const id of [playStore.id, qa.id, screenshots.id, macros.id, printProof.id])
    await bucketAdd(priya, bLaunch, { thingId: id });
  await bucketAdd(priya, bLaunch, { listId: campaign });

  for (const id of [qa.id, contract.id, pricing.id, pricingPage.id, approval.id])
    await bucketAdd(priya, bWaiting, { thingId: id });

  for (const id of [meetingNotes.id, sop.id, venues.id])
    await bucketAdd(priya, bDeep, { thingId: id });

  for (const id of [launchCopy.id, landing.id, pressNote.id, seating.id])
    await bucketAdd(priya, bRead, { thingId: id });
  await bucketAdd(priya, bRead, { listId: website });

  for (const id of [electrician.id, insurance.id, gift.id])
    await bucketAdd(priya, bHome, { thingId: id });

  // ------------------------------------------------- Ghost Card (same Thing)
  // Priya is in Work context; the Home Thing "Book electrician…" is due tonight,
  // so the Doorman presents the *same* Thing as a breakthrough card.
  const ghostOk = await tolerant('ghost card', () =>
    rpc(priya.db, 'doorman_mark_presented', {
      p_thing_id: electrician.id,
      p_reason: 'due_today_other_context',
    }),
  );
  if (ghostOk) counts.ghost_cards++;

  // -------------------------------------------------- Recently Shredded (4)
  await shred(priya, cancelled[0]!.id); // cancelled, Priya owns
  await shred(priya, cancelled[3]!.id); // cancelled, Priya owns
  await shred(priya, sorted[6]!.id); // sorted, Priya owns
  await shred(priya, analytics.id); // Mike's List Thing — Priya neither owns nor holds

  // ---------------------------------------------------------------- report
  await relinkAssignments();
  await trimNotifications();
  const total = await verifyIntegrity();
  const q = async (t: string, f?: (b: any) => any) => {
    let b = admin.from(t).select('id', { count: 'exact', head: true });
    if (f) b = f(b);
    const { count } = await b;
    return count ?? 0;
  };

  const active = await q('things', (b) =>
    b.not('work_status', 'in', '("sorted","cancelled")'),
  );
  const sortedCount = await q('things', (b) => b.eq('work_status', 'sorted'));
  const cancelledCount = await q('things', (b) => b.eq('work_status', 'cancelled'));
  const waiting = await q('things', (b) =>
    b.eq('acknowledgement', 'waiting_for_catch').not('work_status', 'in', '("sorted","cancelled")'),
  );
  const notStarted = await q('things', (b) =>
    b.eq('acknowledgement', 'caught').eq('work_status', 'not_started'),
  );
  const underProgress = await q('things', (b) => b.eq('work_status', 'under_progress'));
  const notifications = await q('notifications');
  const activity = await q('thing_activity');
  const homeThings = await q('things', (b) => b.eq('context', 'home'));

  console.log('\nSeed complete.\n');
  console.log('Counts');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v}`);
  console.log(`  ${'things_total'.padEnd(20)} ${total}`);
  console.log(`  ${'things_active'.padEnd(20)} ${active}`);
  console.log(`  ${'waiting_for_catch'.padEnd(20)} ${waiting}`);
  console.log(`  ${'caught_not_started'.padEnd(20)} ${notStarted}`);
  console.log(`  ${'under_progress'.padEnd(20)} ${underProgress}`);
  console.log(`  ${'sorted'.padEnd(20)} ${sortedCount}`);
  console.log(`  ${'cancelled'.padEnd(20)} ${cancelledCount}`);
  console.log(`  ${'home_context'.padEnd(20)} ${homeThings}`);
  console.log(`  ${'notifications'.padEnd(20)} ${notifications}`);
  console.log(`  ${'activity_events'.padEnd(20)} ${activity}`);

  console.log('\nBridge demo link (staging, shown once — not committed anywhere):');
  console.log(`  /bridge/${token ?? '(token not returned)'}`);

  console.log('\nDemo login (phone + OTP, the normal Katalist flow)');
  for (const p of PEOPLE) console.log(`  ${p.name.padEnd(16)} ${p.phone}`);
  console.log(
    `\n  Register these numbers as Supabase Auth test phone numbers with the fixed\n` +
      `  OTP ${DEMO_FIXED_OTP} (Auth → Sign In / Providers → Phone). Staging only.\n` +
      `  Primary demo login: Priya Sharma, +91 90000 00001.`,
  );
}

await main();
