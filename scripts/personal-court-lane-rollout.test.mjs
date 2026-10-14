import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
let response;
mock.module('@/integrations/supabase/client', { namedExports: { supabase: {
  from: () => ({ select: () => ({ in: async () => response }) }),
} } });
const { fetchPersonalCourtLanes } = await import('../src/features/things/personal-court-lane.ts');
test('pre-migration database retains shared Court lanes', async () => {
  response = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.thing_court_placement' in the schema cache" } };
  assert.equal((await fetchPersonalCourtLanes(['thing-1'])).size, 0);
});
test('existing saved placement is preserved', async () => {
  response = { data: [{ thing_id: 'thing-1', lane: 'later', assignee_actor_id: 'actor-1' }], error: null };
  assert.deepEqual((await fetchPersonalCourtLanes(['thing-1'])).get('thing-1'), {lane:'later',assigneeActorId:'actor-1'});
});
test('permission, network and unrelated missing-table errors are not hidden', async () => {
  for (const error of [{code:'42501',message:'permission denied'}, {code:'',message:'Failed to fetch'}, {code:'PGRST205',message:'public.other_table missing'}]) {
    response = {data:null,error};
    await assert.rejects(fetchPersonalCourtLanes(['thing-1']), e => e === error);
  }
});
