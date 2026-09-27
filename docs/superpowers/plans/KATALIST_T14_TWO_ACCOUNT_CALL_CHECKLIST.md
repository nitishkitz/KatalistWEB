# Two-account live call checklist (H-07)

This is a prepared manual script for the one thing this session cannot execute locally: real
multi-party WebRTC behavior across two genuinely separate browsers/devices/network paths. It is
documentation only — no step below has been run as part of this pass. Everything reproducible
without live infrastructure (join/leave generation guards, lifecycle UI, audio-only fallback,
reaction/draw ownership, ringtone/timer cleanup) already has local test coverage — see
`scripts/use-list-call-lifecycle.test.mjs`, `scripts/use-list-call-ownership.test.mjs`,
`scripts/call-room-leave-race.test.mjs`, `scripts/ringtone-vibration.test.mjs`, and
`scripts/list-call-panel-recovery-states.test.mjs`. This checklist is for what those cannot prove:
real network conditions, real OS permission dialogs, and two independent peers.

## Fixtures

Use two disposable, isolated test accounts created for this purpose — **never real contacts or
production user data**. Two different physical devices (or at minimum two different browsers on
one machine, e.g. Chrome + Firefox, so OS-level media permission state is independent) on the same
List/conversation.

## Scenarios

1. **Baseline join.** Account A starts a call in a List. Account B joins from the invite/ring.
   Both see each other's video/audio within a few seconds. Leaving either side ends the call
   cleanly for the other (no frozen tile, no stuck "reconnecting").

2. **Permission denial.** Account B denies the camera/microphone permission prompt on join.
   Expected: the new H-06 error panel appears (not a vanished call window), offering Retry and
   "Join with audio only." Confirm "Join with audio only" actually connects with audio and no
   video tile for B.

3. **Device already in use.** On Account B's device, open another app/tab already holding the
   camera (e.g. a video call in another tool), then try to join. Expected: the "device unavailable"
   classification and message, not the generic or permission-denied message.

4. **Disconnect/reconnect.** Mid-call, disable Account B's network (airplane mode or disconnect
   Wi-Fi) for 10–15 seconds, then restore it. Expected: Account A sees B transition to
   "reconnecting" and back to a live tile without B having to manually rejoin; no duplicate B tile
   appears.

5. **Screen-share end.** Account A starts screen share, then stops it via the browser's own native
   "Stop sharing" control (not the in-app button). Expected: the in-app UI reflects sharing has
   stopped (no stale "sharing" state), and the shared screen's tracks are actually released (check
   the browser's own media-in-use indicator).

6. **Leave during permission prompt.** Account B triggers join, then immediately closes the tab
   or clicks Leave before responding to the OS permission dialog, then (if the dialog is still
   showing) grants permission anyway after leaving. Expected: no stray media stream, no
   late-arriving "connected" state for a call B already left.

7. **Device switch mid-call.** If the test device has multiple cameras/microphones, switch the
   active input mid-call (via OS settings or an in-app device picker, if one exists). Expected: no
   crash, no dropped connection to the peer, audio/video continues on the new device.

8. **Final leave.** Both accounts leave. Confirm on each device (via the browser's own
   camera/microphone-in-use indicator, not just the app UI) that no track is still active, and
   that the ringtone (if a ring was in progress) is stopped.

9. **Meeting reminder → join.** Schedule a meeting for ~1 minute out via `ScheduleMeetingDialog`.
   Confirm `MeetingReminderCard` surfaces within the 5-minute urgent window with an accurate
   countdown, and that clicking Join lands in the call already started/joined, not a second,
   duplicate ring.

## Recording results

For each scenario: device/browser/OS versions, pass/fail, and (for any failure) console errors
and a screen recording if possible. File results as a dated addendum to this document or in the
audit progress ledger's T14 section — do not silently mark H-07 fully closed without this
external run recorded somewhere.
