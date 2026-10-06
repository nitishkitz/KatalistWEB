import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrivateAddress, parseLinkPreview, parsePreviewTarget, sanitizeText } from "../server/lib/link-preview.ts";

test("private, loopback, link-local and metadata addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("only plain http(s) URLs on standard ports are accepted", () => {
  assert.ok(parsePreviewTarget("https://framer.com/"));
  assert.ok(parsePreviewTarget("http://example.com/a?b=1"));
  for (const bad of ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest", "https://example.com:8443/", "https://user:pw@example.com/", "http://intranet.local/", "", "not a url"]) {
    assert.equal(parsePreviewTarget(bad), null, bad);
  }
});

test("metadata is extracted, sanitized and bounded", () => {
  const html = `<html><head><title>Fallback</title>
    <meta property="og:title" content="Framer &amp; Co &lt;script&gt;alert(1)&lt;/script&gt;">
    <meta property="og:description" content="Build   sites fast">
    <meta property="og:image" content="/img/cover.png">
    <meta property="og:site_name" content="Framer"></head></html>`;
  const preview = parseLinkPreview(html, new URL("https://www.framer.com/"));
  assert.equal(preview.host, "framer.com");
  assert.equal(preview.title?.includes("<"), false);
  assert.equal(preview.description, "Build sites fast");
  assert.equal(preview.image, "https://www.framer.com/img/cover.png");
  assert.equal(preview.siteName, "Framer");
});

test("dangerous image schemes are dropped and long text is truncated", () => {
  const preview = parseLinkPreview(`<meta property="og:image" content="javascript:alert(1)"><title>x</title>`, new URL("https://a.com/"));
  assert.equal(preview.image, null);
  assert.equal(sanitizeText("a".repeat(500), 50)?.length, 50);
});
