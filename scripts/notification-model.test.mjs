import test from 'node:test';
import assert from 'node:assert/strict';
import { groupNotifications, notificationActions } from '../src/features/notifications/notification-model.ts';
const item = (id, changes = {}) => ({ id, title: 'New message in Team', body: 'Latest message', read: true, createdAt: '2026-09-28T10:00:00Z', kind: 'list_message', thingId: null, listId: 'chat-a', actorId: null, ...changes });
const thing = (changes = {}) => ({ id: 'thing-a', title: 'Review', owner_actor_id: 'owner', current_assignee_actor_id: 'assignee', acknowledgement: 'waiting_for_catch', work_status: 'not_started', cancelled_at: null, ...changes });
test('grouping preserves latest preview, unread status, and every notification ID', () => {
  const result = groupNotifications([item('new'), item('old', { read: false, body: 'Old message' })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].body, 'Latest message');
  assert.equal(result[0].read, false);
  assert.deepEqual(result[0].ids, ['new', 'old']);
  assert.equal(result[0].count, 2);
});
test('chat groups never merge different conversations or dates', () => {
  assert.equal(groupNotifications([item('a'), item('b', { listId: 'chat-b' }), item('c', { createdAt: '2026-09-27T10:00:00Z' })]).length, 3);
});
test('duplicate briefings collapse only within their date and Thing events remain separate', () => {
  const rows = groupNotifications([item('a', { kind: 'morning_brief' }), item('b', { kind: 'morning_brief' }), item('c', { kind: 'thing_sorted' }), item('d', { kind: 'thing_sorted' })]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].count, 2);
});
test('old assignment notifications cannot offer actions for completed, cancelled, or unavailable Things', () => {
  const notification = item('a', { kind: 'thing_assigned', thingId: 'thing-a' });
  for (const current of [undefined, thing({ work_status: 'sorted' }), thing({ cancelled_at: '2026-09-28' }), thing({ work_status: 'cancelled' })]) {
    assert.deepEqual(notificationActions(notification, current, 'assignee'), { needsAttention: false, canCatch: false, canReassign: false });
  }
});
test('catch and handoff depend on the current actor and current acknowledgement', () => {
  const notification = item('a', { kind: 'thing_assigned' });
  assert.equal(notificationActions(notification, thing(), 'assignee').canCatch, true);
  assert.equal(notificationActions(notification, thing(), 'assignee').canReassign, false);
  assert.equal(notificationActions(notification, thing({ acknowledgement: 'caught' }), 'assignee').canReassign, true);
  assert.equal(notificationActions(notification, thing(), 'owner').canReassign, true);
  assert.deepEqual(notificationActions(notification, thing(), 'unrelated'), { needsAttention: false, canCatch: false, canReassign: false });
  assert.deepEqual(notificationActions(notification, thing(), null), { needsAttention: false, canCatch: false, canReassign: false });
});
