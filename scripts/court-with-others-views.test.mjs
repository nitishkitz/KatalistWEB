import './dom-test-setup.mjs';
import assert from 'node:assert/strict';
import { test, mock, afterEach } from 'node:test';
import { createElement as h, useState } from 'react';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

mock.module('@/features/things/InlineThingDetailWorkspace', { namedExports: { InlineThingDetailWorkspace: () => null } });
mock.module('@/features/people/directory', { namedExports: { matchProfile: () => null, matchAvatarByName: () => null, useAvatarUrl: () => null, useProfileDirectory: () => ({}) } });
mock.module('@/features/things/rpc', { namedExports: { rpcNudgeThing: async () => {} } });
const { CourtWithOthersSidebar } = await import('../src/features/court/CourtWithOthersSidebar.tsx');
afterEach(cleanup);
const person = { id: 'p', name: 'Alex', initials: 'A' };
const thing = (id, ownerImportance, extra = {}) => ({ id, title: id, ownerImportance, personalPace: 'later', personalCourtLane: 'later', assignee: person, owner: person, creator: person, workStatus: 'not_started', acknowledgement: 'waiting_for_catch', dueAt: null, updatedAt: '2026-01-01', ...extra });
function mount(items, extra = {}) {
  const props = { theirs: items, theirGroups: { waiting_for_catch: items.slice(0, 1), moving: items.slice(1), needs_attention: [] }, directory: {}, onOpenThing: () => {}, onViewAllTheirs: () => {}, ...extra };
  function Harness() {
    const [theirFocus, setTheirFocus] = useState(null);
    return h(CourtWithOthersSidebar, { ...props, theirFocus, setTheirFocus });
  }
  return render(h(QueryClientProvider, { client: new QueryClient() }, h(Harness)));
}
test('status remains default and switching to pace filters by shared priority, ignoring private placement', () => {
  mount([thing('Shared now', 'now'), thing('Shared next', 'next'), thing('Shared later', 'later')]);
  assert.equal(screen.getByRole('button', { name: 'Status', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.ok(screen.getByText('Shared now'));
  assert.equal(screen.queryByText('Shared next'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Pace', exact: true }));
  assert.ok(screen.getByRole('button', { name: 'Now: 1' }));
  assert.ok(screen.getByText('Shared now'));
  fireEvent.click(screen.getByRole('button', { name: 'Next: 1' }));
  assert.ok(screen.getByText('Shared next'));
  assert.equal(screen.queryByText('Shared now'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Status', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Moving: 2' }));
  assert.ok(screen.getByText('Shared next'));
  assert.ok(screen.getByText('Shared later'));
});
test('view all remains available in the header and pace empty selection is clear', () => {
  let views = 0;
  mount([thing('Only next', 'next')], { onViewAllTheirs: () => views++ });
  const viewAll = screen.getByRole('button', { name: 'View all 1' });
  assert.ok(viewAll.closest('header'));
  fireEvent.click(viewAll);
  assert.equal(views, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Pace', exact: true }));
  assert.ok(screen.getByText('No Things in Now.'));
});
test('pace counts only the supplied filtered Things and uses owner priority for Coey schedules', () => {
  mount([
    thing('Coey shared next', 'next', { coey: { schedule: { state: 'caught', privateWait: false, promiseAt: null, lastActivityAt: Date.now() }, holderCal: {}, viewerProfileId: 'viewer' } }),
    thing('Visible later', 'later'),
  ], { theirGroups: { waiting_for_catch: [], moving: [], needs_attention: [] } });
  fireEvent.click(screen.getByRole('button', { name: 'Pace', exact: true }));
  assert.ok(screen.getByRole('button', { name: 'Now: 0' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next: 1' }));
  assert.ok(screen.getByText('Coey shared next'));
  assert.equal(screen.queryByText('Visible later'), null);
  assert.ok(screen.getByRole('button', { name: 'View all 2' }));
});
test('pace cards preserve keyboard opening and view selection survives switching back to Status', () => {
  const opened = [];
  mount([thing('Next card', 'next')], { onOpenThing: (item) => opened.push(item.id) });
  fireEvent.click(screen.getByRole('button', { name: 'Pace', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Next: 1' }));
  const card = screen.getByText('Next card').closest('[data-thing-id]');
  fireEvent.keyDown(card, { key: 'Enter' });
  fireEvent.keyDown(card, { key: ' ' });
  assert.deepEqual(opened, ['Next card', 'Next card']);
  fireEvent.click(screen.getByRole('button', { name: 'Status', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Pace', exact: true }));
  assert.equal(screen.getByRole('button', { name: 'Next: 1' }).getAttribute('aria-pressed'), 'true');
});

test('approved header keeps mode and count controls grouped; View all shares the title row', () => {
  mount([thing('One task', 'now')]);
  const header = screen.getByRole('heading', { name: 'With others' }).closest('header');
  const viewAll = screen.getByRole('button', { name: 'View all 1' });
  assert.equal(viewAll.parentElement, screen.getByRole('heading', { name: 'With others' }).parentElement);
  assert.equal(screen.getByRole('group', { name: 'With Others view' }).querySelectorAll('button').length, 2);
  assert.equal(screen.getByRole('group', { name: 'Filter by status' }).querySelectorAll('button').length, 3);
  assert.equal(header.querySelector('select'), null);
  assert.equal(screen.getByRole('button', { name: 'Waiting for Catch: 1' }).getAttribute('aria-pressed'), 'true');
});
test('keyboard events on the Nudge action do not open the parent task', () => {
  const opened = [];
  mount([thing('Nudge this', 'now')], { onOpenThing: (item) => opened.push(item.id) });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Nudge', exact: true }), { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Nudge', exact: true }), { key: ' ' });
  assert.deepEqual(opened, []);
});
