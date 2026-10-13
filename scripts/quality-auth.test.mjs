import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePhone, phoneAuthConfig } from '../server/lib/phone-auth.ts';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AppErrorComponent } from '../src/lib/error-component.tsx';

test('phone normalization rejects malformed payloads before auth lookup', () => {
  for (const value of [undefined, null, 9550986390, {}, '', 'abc', '123', '+910000', '0'.repeat(12), '+91<script>', '+9195509863909999', '9550986390']) {
    assert.equal(normalizePhone(value), null, String(value));
  }
  assert.equal(normalizePhone('+91 95509 86390'), '+919550986390');
  assert.equal(normalizePhone('+1 (415) 555-1234'), '+14155551234');
});

test('production never enables a shared code by label; only the explicit server mode does', () => {
  const prod = { NODE_ENV: 'production', VITE_KATALIST_FIXED_OTP: '111111' };
  assert.equal(phoneAuthConfig(prod).mode, 'off');
  assert.equal(phoneAuthConfig({ ...prod, KATALIST_ENV: 'production' }).mode, 'off');
  assert.equal(phoneAuthConfig({ ...prod, KATALIST_ENV: 'uat' }).mode, 'off', 'relabelling production as UAT does not open sign-in');
  assert.deepEqual(phoneAuthConfig({ ...prod, KATALIST_PHONE_AUTH_MODE: 'static', KATALIST_STATIC_LOGIN_CODE: '482913' }), { mode: 'static', staticCode: '482913' });
  assert.equal(phoneAuthConfig({ ...prod, KATALIST_PHONE_AUTH_MODE: 'static', KATALIST_STATIC_LOGIN_CODE: 'not-an-otp' }).mode, 'off');
});

test('fallback error view renders null and non-Error throws without another crash', () => {
  for (const error of [null, undefined, 'failed', {}, new Error('')]) {
    const html = renderToStaticMarkup(createElement(AppErrorComponent, { error, reset() {} }));
    assert.match(html, /An unexpected error occurred/);
  }
  assert.match(renderToStaticMarkup(createElement(AppErrorComponent, { error: new Error('Connection lost'), reset() {} })), /Connection lost/);
});
