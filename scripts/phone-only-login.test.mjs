import './dom-test-setup.mjs';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { act, createElement } from 'react';
import { renderHook, cleanup } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let fixed = '111111';
// The hook reads its mode and the displayed code from the server.
globalThis.fetch = async (url) => {
  if (String(url).includes('/api/auth/login-config')) {
    return new Response(JSON.stringify(fixed ? { mode: 'static', staticCode: fixed } : { mode: 'off', staticCode: null }), { status: 200 });
  }
  throw new Error('unexpected fetch ' + url);
};
mock.module('@/integrations/supabase/client', { namedExports: { supabase: {} } });
mock.module('@tanstack/react-router', { namedExports: { useNavigate: () => () => {} } });
mock.module('@/hooks/useSession', { namedExports: {
  useSession: () => ({ session: null, loading: true }), signInAsDemo: () => {}, DEMO_PERSONAS: [],
} });
mock.module('@/lib/session-mode', { namedExports: { demoEnabled: () => false } });
mock.module('@/features/people/directory', { namedExports: { useAvatarUrl: () => null } });
const { useOtpSignIn } = await import('../src/features/auth/use-otp-sign-in.ts');
const { ContactStep, CodeStep } = await import('../src/features/auth/gate/GateSteps.tsx');

test('phone stays selected without SMS; it never falls back to email', async () => {
  fixed = null;
  const { result } = renderHook(() => useOtpSignIn('/'));
  assert.equal(result.current.channel, 'phone');
  const html = renderToStaticMarkup(createElement(ContactStep, { auth: result.current, sending: false, onSubmit() {} }));
  assert.match(html, /type="tel"/);
  assert.doesNotMatch(html, /type="email"|Use email instead/);
  await act(async () => assert.equal(await result.current.sendCode(), false));
  assert.match(result.current.note.text, /not configured/);
  assert.equal(result.current.testOtp, null);
  cleanup();
});

test('test OTP sits immediately after the code cells and is absent outside test mode', async () => {
  fixed = '111111';
  const { result } = renderHook(() => useOtpSignIn('/'));
  await act(async () => result.current.setPhone('98765 43210'));
  await act(async () => assert.equal(await result.current.sendCode(), true));
  const props = { auth: result.current, verifying: false, verificationPending: false, recovering: false, rejected: false,
    onCodeChange() {}, onSubmit() {}, onResend() {}, onChangeContact() {} };
  const html = renderToStaticMarkup(createElement(CodeStep, props));
  assert.match(html, /id="kg-test-otp"[^>]*>Temporary sign-in code: <strong>111111<\/strong>/);
  assert.ok(html.indexOf('id="kg-test-otp"') > html.indexOf('id="kg-otp"'));
  assert.ok(html.indexOf('id="kg-test-otp"') < html.indexOf('id="kg-code-note"'));
  assert.match(html, /No SMS sent/);
  const real = renderToStaticMarkup(createElement(CodeStep, { ...props, auth: { ...result.current, testOtp: null } }));
  assert.doesNotMatch(real, /111111|Temporary sign-in code|No SMS sent/);
  cleanup();
});
