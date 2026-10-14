import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateMagicBox as calc } from '../src/features/court/magic-box-calculations.ts';

test('arithmetic precedence, percentages and safe failures', () => {
  assert.equal(calc('1250 × 4 + 500').value, 5500);
  assert.equal(calc('-(2 + 3)^2').value, -25);
  assert.equal(calc('18% of 4500').value, 810);
  assert.equal(calc('8500 minus 15%').value, 7225);
  assert.equal(calc('10 / 0').error, true);
  assert.equal(calc('2 + (3').error, true);
  assert.equal(calc('2 ^ 10000').error, true);
  assert.equal(calc('add 10%', 500).value, 550);
});

test('task text, references and bare dates are never calculations', () => {
  for (const text of ['Remind me to pay ₹500 tomorrow', 'Call Ravi at 10', '2026-10-14', '14-10-2026', '+919876543210', '500', 'Review 2 + 3 with @Ravi', 'https://example.com/2/3', 'interest on the overdue invoice']) assert.equal(calc(text), null, text);
});

test('splits, supplied tax rates and billing', () => {
  assert.equal(calc('Split ₹4,800 among 6 people').value, 800);
  assert.equal(calc('split 400 by 0').error, true);
  assert.ok(Math.abs(calc('Remove 18% GST from ₹1180').value - 1000) < 1e-9);
  assert.equal(calc('3h 45m at ₹800 per hour').value, 3000);
});

test('interest and EMI use explicit periods and stable zero-rate math', () => {
  assert.ok(Math.abs(calc('Interest on ₹50,000 at 12% annually for 6 months').value - 3000) < 1e-8);
  assert.ok(Math.abs(calc('compound interest on 10000 at 12% annually for 1 year compounded monthly').value - 1268.2503013197) < 1e-7);
  assert.ok(Math.abs(calc('simple interest on 10000 at 1% monthly for 6 months').value - 600) < 1e-8);
  assert.equal(calc('EMI for ₹5 lakh at 0% over 10 months').value, 50000);
  assert.ok(Math.abs(calc('EMI for ₹5 lakh at 10% over 3 years').value - 16133.5935969188) < 1e-7);
  assert.equal(calc('interest on 50000').error, true);
});

test('calendar math validates dates and handles year boundaries', () => {
  const now = new Date(2026, 9, 14, 12);
  assert.match(calc('45 days after 14 October', undefined, now).result, /28 November 2026/);
  assert.match(calc('1 day after 2026-12-31').result, /1 January 2027/);
  assert.equal(calc('1 day after 2026-02-30').error, true);
  assert.equal(calc('days between 2026-10-14 and 2026-11-01').value, 18);
});
