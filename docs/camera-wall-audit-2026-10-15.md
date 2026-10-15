# Camera-wall and compact-bar audit — 15 October 2026

Audited current main, including ea81157, without reverting the later place
briefing or source-health releases. No Worker was deleted and no BMA letter
was sent. Existing wall, camera catalogue, map and compact bars preserved.

## Confirmed defects and fixes

- Native HLS errors and rejected play promises reserved a playback slot
  indefinitely. Errors now detach the failed camera and admit a visible waiter.
- Detached videos retained playing listeners. Cleanup removes listeners,
  pauses the element, destroys HLS and clears the source. Late play rejection
  is guarded by the current media session so it cannot poison a later one.
- Hidden browser pages retained playback. Visibility change releases players
  without refilling while hidden and resumes visible tiles on return.
- Open A → close → open B → resolve B → resolve A created two observers and
  orphaned one. A request-generation guard rejects stale catalogue responses.
- aria-modal alone did not prevent keyboard focus escaping into the map.
  Background page is inert during the wall; Tab wraps within the dialog,
  Escape closes it and original focus is restored.
- “Stills are taken when the wall opens” was false: stable proxy URLs may
  serve cached images, and lazy images load later. Labels now disclose
  unverified capture time and no automatic still refresh. Operator/community
  provenance is retained on wall tiles, and viewer links are HTTP(S)-filtered.
- Clamped warning reasons lacked a visual expansion path. Added a native
  Read full warning / Collapse warning button with aria-expanded and controls.
- Desktop exposed the phone-only close button as a blank light bar after its
  conversion to a native button. It is now explicitly hidden above 720px;
  the real keyboard-operable button remains available on phones.

## Evidence

The first three lifecycle tests failed against the original code and passed
after the fixes. `npm run test:wall` now contains six tests, including native
failure/refill, event cleanup, hidden-page allocation, rejected playback,
late rejection isolation, and the close/reopen race.

Independent read-only reviewer reproduced the race against the original
and reran its harness on the patch: observer states changed from
`[false,true]` (leak) to `[true]` (all disconnected). No confirmed serious
regression found in the bounded patched-code review.

## Limits

Twelve is a maximum concurrent video allocation, not a promise that twelve
working live feeds exist. An image loading is not evidence that its capture
time is current. Counts are dynamic catalogue counts, not availability or
uptime counts. Compact-bar pixel dimensions vary by viewport/content; do not
reuse the original report's measurements as universal specifications.
