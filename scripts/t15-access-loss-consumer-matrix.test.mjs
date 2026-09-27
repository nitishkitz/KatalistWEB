import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * T15/B-03/B-04/C-04/C-06: T01's own "Remaining item 1" named Court, List
 * detail, Bucket detail, Hub conversations/messages/files, and meetings as
 * still using bespoke loading/error/empty logic without the confirmed-
 * access-loss distinction AsyncState's three already-wired surfaces have.
 * Direct re-verification during T15 found the chat/message layer
 * (use-list-messages.ts's `accessLost`, already wired into ListChatPanel)
 * and the unread-count sentinel (use-conversations.ts's `"unknown"` type,
 * already wired into HubSidebar/ChatHeadsDock) were ALREADY correctly
 * closed by a later pass that never updated T01's own note -- not
 * re-touched here. The genuinely-open remainder closed by this pass: List/
 * Bucket detail and Court didn't distinguish a confirmed access-loss kind
 * from a transient failure in their copy/retry-offering; the Hub
 * conversation-metadata header exposed no error at all; List meetings
 * exposed no error at all.
 */
const listDetail = readFileSync(new URL("../src/routes/lists.$listId.tsx", import.meta.url), "utf8");
const bucketDetail = readFileSync(new URL("../src/routes/buckets.$bucketId.tsx", import.meta.url), "utf8");
const courtDesktop = readFileSync(new URL("../src/features/court/CourtDesktop.tsx", import.meta.url), "utf8");
const conversationWorkspace = readFileSync(new URL("../src/features/hub/components/ConversationWorkspace.tsx", import.meta.url), "utf8");
const useConversations = readFileSync(new URL("../src/features/hub/use-conversations.ts", import.meta.url), "utf8");
const useListMeetings = readFileSync(new URL("../src/features/lists/use-list-meetings.ts", import.meta.url), "utf8");

test("List detail distinguishes a confirmed access-loss error from a transient one, and never offers Retry for the former", () => {
  assert.match(listDetail, /import \{ classifyAsyncError \} from "@\/lib\/query-policy"/);
  assert.match(listDetail, /const accessLost = kind === "forbidden" \|\| kind === "unauthenticated" \|\| kind === "not-found"/);
  assert.match(listDetail, /You no longer have access to this List/);
  assert.match(listDetail, /\{!accessLost && \(/);
});

test("Bucket detail distinguishes a confirmed access-loss error from a transient one, and never offers Retry for the former", () => {
  assert.match(bucketDetail, /import \{ classifyAsyncError \} from "@\/lib\/query-policy"/);
  assert.match(bucketDetail, /You no longer have access to this Bucket/);
  assert.match(bucketDetail, /accessLost \? \(/);
});

test("Court distinguishes a confirmed unauthenticated session (retry cannot help) from a transient load failure, offering sign-in instead of Retry", () => {
  assert.match(courtDesktop, /const unauthenticated = classifyAsyncError\(error\) === "unauthenticated"/);
  assert.match(courtDesktop, /Your session has ended\./);
  assert.match(courtDesktop, /href="\/auth"/);
});

test("the Hub conversation-metadata header now exposes error/refetch and shows a real unavailable/retry state instead of a silently generic header", () => {
  assert.match(useConversations, /error: query\.error,\s*\n\s*refetch: query\.refetch,/);
  assert.match(conversationWorkspace, /conversationGone \|\| conversationLoadFailed/);
  assert.match(conversationWorkspace, /This conversation is no longer available\./);
  assert.match(conversationWorkspace, /refetchConversation/);
});

test("List meetings now exposes a real error/refetch, distinguishing a failed fetch from a confirmed empty schedule", () => {
  assert.match(useListMeetings, /error: hidden \? null : query\.error/);
  assert.match(useListMeetings, /refetch: query\.refetch/);
  assert.match(listDetail, /meetingsHook\.error && meetingsHook\.meetings\.length === 0/);
  assert.match(listDetail, /Couldn't load meetings\./);
});
