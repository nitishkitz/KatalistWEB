import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFigmaUrl } from "@/features/designs/figma-url";

const KEY = "AbCdEf1234567890xyZ123";
const OTHER = "ZyXwVu0987654321abC456";

function ok(input) {
  const result = parseFigmaUrl(input);
  assert.equal(result.ok, true, `expected ok for ${input}: ${JSON.stringify(result)}`);
  return result.value;
}

function fails(input, code) {
  const result = parseFigmaUrl(input);
  assert.equal(result.ok, false, `expected failure for ${input}`);
  assert.equal(result.error.code, code);
  assert.ok(result.error.message.length > 0);
}

test("design link converts to an embed with the host identifier", () => {
  const v = ok(`https://www.figma.com/design/${KEY}/Checkout-Flow`);
  assert.equal(v.kind, "design");
  assert.equal(v.fileKey, KEY);
  assert.equal(v.nodeId, null);
  assert.equal(v.embedUrl, `https://embed.figma.com/design/${KEY}?embed-host=katalist`);
  assert.equal(v.normalizedUrl, `https://www.figma.com/design/${KEY}`);
});

test("frame target survives and node-id syntax is normalized", () => {
  const dash = ok(`https://www.figma.com/design/${KEY}/Name?node-id=12-34&t=trackingjunk`);
  const colon = ok(`https://figma.com/design/${KEY}/Other-Name?node-id=12%3A34`);
  assert.equal(dash.nodeId, "12-34");
  assert.equal(dash.embedUrl, `https://embed.figma.com/design/${KEY}?node-id=12-34&embed-host=katalist`);
  assert.equal(dash.normalizedUrl, `https://www.figma.com/design/${KEY}?node-id=12-34`);
  assert.equal(dash.identityKey, colon.identityKey);
});

test("legacy /file/ links normalize to design", () => {
  const legacy = ok(`https://www.figma.com/file/${KEY}/Name?node-id=1-2`);
  const modern = ok(`https://www.figma.com/design/${KEY}/Name?node-id=1-2`);
  assert.equal(legacy.kind, "design");
  assert.equal(legacy.normalizedUrl, modern.normalizedUrl);
  assert.equal(legacy.identityKey, modern.identityKey);
});

test("branch links use the branch key", () => {
  const v = ok(`https://www.figma.com/design/${KEY}/branch/${OTHER}/Name`);
  assert.equal(v.fileKey, OTHER);
  assert.equal(v.embedUrl, `https://embed.figma.com/design/${OTHER}?embed-host=katalist`);
});

test("FigJam, Slides and deck routes map to their official embed paths", () => {
  assert.equal(ok(`https://www.figma.com/board/${KEY}/Retro`).embedUrl, `https://embed.figma.com/board/${KEY}?embed-host=katalist`);
  assert.equal(ok(`https://www.figma.com/board/${KEY}/Retro`).kind, "figjam");
  assert.equal(ok(`https://www.figma.com/slides/${KEY}/Pitch`).kind, "slides");
  assert.equal(ok(`https://www.figma.com/deck/${KEY}/Pitch`).embedUrl, `https://embed.figma.com/deck/${KEY}?embed-host=katalist`);
});

test("prototype flow, version and scaling parameters are preserved", () => {
  const v = ok(
    `https://www.figma.com/proto/${KEY}/App?node-id=5-6&starting-point-node-id=7%3A8&version-id=123456&scaling=fit-width&content-scaling=fixed&hide-ui=1`,
  );
  assert.equal(v.kind, "prototype");
  assert.equal(v.nodeId, "5-6");
  assert.equal(v.startingPointNodeId, "7-8");
  assert.equal(v.versionId, "123456");
  assert.equal(v.embedHonorsVersion, true);
  const embed = new URL(v.embedUrl);
  assert.equal(embed.origin + embed.pathname, `https://embed.figma.com/proto/${KEY}`);
  assert.equal(embed.searchParams.get("starting-point-node-id"), "7-8");
  assert.equal(embed.searchParams.get("version-id"), "123456");
  assert.equal(embed.searchParams.get("scaling"), "fit-width");
  assert.equal(embed.searchParams.get("embed-host"), "katalist");
  assert.equal(embed.searchParams.has("hide-ui"), false);
});

test("different frames and different prototype flows from one file have different identities", () => {
  const a = ok(`https://www.figma.com/design/${KEY}/N?node-id=1-2`);
  const b = ok(`https://www.figma.com/design/${KEY}/N?node-id=1-3`);
  const whole = ok(`https://www.figma.com/design/${KEY}/N`);
  assert.notEqual(a.identityKey, b.identityKey);
  assert.notEqual(a.identityKey, whole.identityKey);
  const flow1 = ok(`https://www.figma.com/proto/${KEY}/N?node-id=1-2&starting-point-node-id=1-2`);
  const flow2 = ok(`https://www.figma.com/proto/${KEY}/N?node-id=1-2&starting-point-node-id=9-9`);
  assert.notEqual(flow1.identityKey, flow2.identityKey);
  assert.notEqual(a.identityKey, ok(`https://www.figma.com/proto/${KEY}/N?node-id=1-2`).identityKey);
});

test("version differences are distinct; page-id counts only without a node", () => {
  const latest = ok(`https://www.figma.com/design/${KEY}/N?node-id=1-2`);
  const versioned = ok(`https://www.figma.com/design/${KEY}/N?node-id=1-2&version-id=99`);
  assert.notEqual(latest.identityKey, versioned.identityKey);
  assert.equal(versioned.embedHonorsVersion, false);
  assert.equal(new URL(versioned.embedUrl).searchParams.has("version-id"), false);
  const withPage = ok(`https://www.figma.com/design/${KEY}/N?node-id=1-2&page-id=0-1`);
  assert.equal(withPage.identityKey, latest.identityKey);
  const pageA = ok(`https://www.figma.com/design/${KEY}/N?page-id=0-1`);
  const pageB = ok(`https://www.figma.com/design/${KEY}/N?page-id=0-7`);
  assert.notEqual(pageA.identityKey, pageB.identityKey);
});

test("file name slug, tracking parameters and host variant do not change identity", () => {
  const a = ok(`https://www.figma.com/design/${KEY}/First-Name?node-id=1-2&t=abc`);
  const b = ok(`https://figma.com/design/${KEY}/Renamed?node-id=1-2&utm_source=x`);
  const c = ok(`https://embed.figma.com/design/${KEY}?node-id=1-2&embed-host=other`);
  assert.equal(a.identityKey, b.identityKey);
  assert.equal(a.identityKey, c.identityKey);
  assert.equal(a.embedUrl, c.embedUrl);
});

test("arbitrary query parameters never reach the embed", () => {
  const v = ok(`https://www.figma.com/design/${KEY}/N?node-id=1-2&foo=bar&embed-host=evil&callback=javascript:alert(1)`);
  const embed = new URL(v.embedUrl);
  assert.deepEqual([...embed.searchParams.keys()].sort(), ["embed-host", "node-id"]);
  assert.equal(embed.searchParams.get("embed-host"), "katalist");
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(ok(`  https://www.figma.com/design/${KEY}/N \n`).fileKey, KEY);
});

test("lookalike and unsupported hosts are rejected", () => {
  for (const host of [
    "figma.com.evil.com",
    "evil-figma.com",
    "notfigma.com",
    "www.figma.com.evil.io",
    "figma.com.",
    "api.figma.com",
    "staging.figma.com",
    "figmа.com",
  ]) {
    fails(`https://${host}/design/${KEY}/N`, "unsupported_host");
  }
});

test("credentials, ports and insecure or foreign schemes are rejected", () => {
  fails(`https://user:pass@www.figma.com/design/${KEY}/N`, "credentials_not_allowed");
  fails(`https://user@www.figma.com/design/${KEY}/N`, "credentials_not_allowed");
  fails(`https://www.figma.com:8443/design/${KEY}/N`, "port_not_allowed");
  fails(`http://www.figma.com/design/${KEY}/N`, "insecure_protocol");
  fails(`javascript:alert(1)`, "insecure_protocol");
  fails(`data:text/html,<iframe src="https://www.figma.com/design/${KEY}">`, "insecure_protocol");
  fails(`ftp://www.figma.com/design/${KEY}`, "insecure_protocol");
});

test("host-confusion tricks do not pass", () => {
  fails(`https://www.figma.com@evil.com/design/${KEY}/N`, "credentials_not_allowed");
  fails(`https://evil.com/?u=https://www.figma.com/design/${KEY}/N`, "unsupported_host");
  fails(`https://evil.com#www.figma.com/design/${KEY}`, "unsupported_host");
});

test("malformed, empty and oversized input fails clearly", () => {
  fails("", "empty");
  fails("   ", "empty");
  fails("not a url", "malformed");
  fails("www.figma.com/design/abc", "malformed");
  fails(`https://www.figma.com/design/${KEY}/${"a".repeat(3000)}`, "too_long");
});

test("unsupported routes are rejected", () => {
  for (const path of ["/community/file/123", "/files/recent", "/", "/@someone", "/make/" + KEY, "/dev/" + KEY, "/api/v1/files/" + KEY]) {
    fails(`https://www.figma.com${path}`, "unsupported_route");
  }
});

test("invalid file keys are rejected", () => {
  fails("https://www.figma.com/design/", "invalid_file_key");
  fails("https://www.figma.com/design/bad.key/N", "invalid_file_key");
  fails(`https://www.figma.com/design/${"a".repeat(129)}/N`, "invalid_file_key");
  fails(`https://www.figma.com/design/${KEY}%2F..%2Fx/N`, "invalid_file_key");
  fails(`https://www.figma.com/design/${KEY}!/N`, "invalid_file_key");
  fails(`https://www.figma.com/design/${KEY}/branch/bad!/N`, "invalid_file_key");
  fails(`https://www.figma.com/design/${KEY}/branch`, "invalid_file_key");
});

test("invalid node, version, page and scaling values are rejected", () => {
  fails(`https://www.figma.com/design/${KEY}/N?node-id=abc`, "invalid_node_id");
  fails(`https://www.figma.com/design/${KEY}/N?node-id="><script>`, "invalid_node_id");
  fails(`https://www.figma.com/design/${KEY}/N?node-id=`, "invalid_node_id");
  fails(`https://www.figma.com/proto/${KEY}/N?starting-point-node-id=x`, "invalid_node_id");
  fails(`https://www.figma.com/design/${KEY}/N?version-id=abc`, "invalid_version_id");
  fails(`https://www.figma.com/design/${KEY}/N?page-id=zzz`, "invalid_parameter");
  fails(`https://www.figma.com/proto/${KEY}/N?scaling=huge`, "invalid_parameter");
  fails(`https://www.figma.com/proto/${KEY}/N?content-scaling=huge`, "invalid_parameter");
});

test("starting-point-node-id is ignored for non-prototype kinds", () => {
  const v = ok(`https://www.figma.com/design/${KEY}/N?node-id=1-2&starting-point-node-id=9-9`);
  assert.equal(v.startingPointNodeId, null);
  assert.equal(new URL(v.embedUrl).searchParams.has("starting-point-node-id"), false);
});

test("file keys are validated by safe characters and bounded length, not a fixed length", () => {
  assert.equal(ok("https://www.figma.com/design/abc123/N").fileKey, "abc123");
  assert.equal(ok(`https://www.figma.com/design/${"a".repeat(128)}/N`).fileKey, "a".repeat(128));
  assert.equal(ok("https://www.figma.com/design/Ab_c-1/N").fileKey, "Ab_c-1");
});

test("page-only links target the page in non-prototype embeds", () => {
  const v = ok(`https://www.figma.com/design/${KEY}/N?page-id=0%3A1`);
  assert.equal(v.nodeId, null);
  assert.equal(v.pageId, "0-1");
  assert.equal(v.embedNodeId, "0-1");
  assert.equal(new URL(v.embedUrl).searchParams.get("node-id"), "0-1");
  assert.equal(new URL(ok(`https://www.figma.com/board/${KEY}/N?page-id=0-1`).embedUrl).searchParams.get("node-id"), "0-1");
});

test("explicit node-id wins over page-id; prototypes do not map page-id", () => {
  const both = ok(`https://www.figma.com/design/${KEY}/N?node-id=5-6&page-id=0-1`);
  assert.equal(both.embedNodeId, "5-6");
  const proto = ok(`https://www.figma.com/proto/${KEY}/N?page-id=0-1`);
  assert.equal(proto.embedNodeId, null);
  assert.equal(new URL(proto.embedUrl).searchParams.has("node-id"), false);
});

test("nested or instance node ids are rejected explicitly, not dropped", () => {
  const result = parseFigmaUrl(`https://www.figma.com/design/${KEY}/N?node-id=I1%3A2%3B3%3A4`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_node_id");
  assert.match(result.error.message, /nested|instance/i);
});

test("round trip: parsing normalizedUrl preserves identity, embed target and URLs", () => {
  const inputs = [
    `https://www.figma.com/design/${KEY}/Name`,
    `https://www.figma.com/file/${KEY}/Name?node-id=1%3A2&t=x`,
    `https://www.figma.com/design/${KEY}/branch/${OTHER}/Name?node-id=3-4`,
    `https://www.figma.com/design/${KEY}/N?page-id=0%3A1`,
    `https://www.figma.com/design/${KEY}/N?node-id=5-6&page-id=0-1&version-id=99`,
    `https://www.figma.com/board/${KEY}/N?node-id=2-3`,
    `https://www.figma.com/slides/${KEY}/N?node-id=2-3`,
    `https://www.figma.com/deck/${KEY}/N`,
    `https://www.figma.com/proto/${KEY}/N?node-id=1-2&starting-point-node-id=7%3A8&version-id=123&scaling=contain&content-scaling=responsive`,
    `https://www.figma.com/proto/${KEY}/N?page-id=0-1`,
  ];
  for (const input of inputs) {
    const first = ok(input);
    const second = ok(first.normalizedUrl);
    assert.equal(second.identityKey, first.identityKey, input);
    assert.equal(second.embedUrl, first.embedUrl, input);
    assert.equal(second.normalizedUrl, first.normalizedUrl, input);
    assert.equal(second.fileKey, first.fileKey, input);
    assert.equal(second.embedNodeId, first.embedNodeId, input);
  }
});
