import assert from 'node:assert/strict';
import test from 'node:test';
import { briefGreeting } from '@/features/catchup/brief-greeting';

test('greeting uses the profile timezone and first name without assuming morning on reopen', () => {
  assert.equal(briefGreeting(new Date('2026-10-07T05:00:00Z'), ' Nithesh Reddy ', 'Asia/Kolkata'), 'Good morning, Nithesh');
  assert.equal(briefGreeting(new Date('2026-10-07T07:00:00Z'), 'Nithesh Reddy', 'Asia/Kolkata'), 'Good afternoon, Nithesh');
  assert.equal(briefGreeting(new Date('2026-10-07T14:00:00Z'), null, 'Asia/Kolkata'), 'Good evening');
  assert.equal(briefGreeting(new Date('2026-10-07T07:00:00Z'), 'Ajjju', 'America/New_York'), 'Good morning, Ajjju');
});
