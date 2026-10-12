import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeTestPhone } from '../server/lib/test-phone.ts';
import { serverFixedOtp } from '../server/lib/fixed-otp.ts';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AppErrorComponent } from '../src/lib/error-component.tsx';

test('test phone normalization rejects malformed payloads before auth lookup', () => {
  for (const value of [undefined, null, 9550986390, {}, '', 'abc', '123', '+910000', '0'.repeat(12), '+91<script>', '+9195509863909999']) {
    assert.equal(normalizeTestPhone(value), null, String(value));
  }
  assert.equal(normalizeTestPhone('+91 95509 86390'), '+919550986390');
  assert.equal(normalizeTestPhone('+1 (415) 555-1234'), '+14155551234');
});

test('production rejects a configured shared OTP unless explicitly marked UAT', (t) => {
  const keys = ['NODE_ENV', 'KATALIST_ENV', 'VITE_KATALIST_ENV', 'VITE_KATALIST_FIXED_OTP'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  t.after(() => keys.forEach(k => saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]));
  process.env.NODE_ENV = 'production';
  process.env.VITE_KATALIST_FIXED_OTP = '111111';
  delete process.env.KATALIST_ENV;
  delete process.env.VITE_KATALIST_ENV;
  assert.equal(serverFixedOtp(), null);
  process.env.KATALIST_ENV = 'production';
  assert.equal(serverFixedOtp(), null);
  process.env.KATALIST_ENV = 'uat';
  assert.equal(serverFixedOtp(), '111111');
  process.env.VITE_KATALIST_FIXED_OTP = 'not-an-otp';
  assert.equal(serverFixedOtp(), null);
});

test('fallback error view renders null and non-Error throws without another crash', () => {
  for (const error of [null, undefined, 'failed', {}, new Error('')]) {
    const html = renderToStaticMarkup(createElement(AppErrorComponent, { error, reset() {} }));
    assert.match(html, /An unexpected error occurred/);
  }
  assert.match(renderToStaticMarkup(createElement(AppErrorComponent, { error: new Error('Connection lost'), reset() {} })), /Connection lost/);
});
