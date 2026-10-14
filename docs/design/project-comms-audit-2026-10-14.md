# Project communication audit — 14 October 2026

## Scope and stopping point

Audit the existing project conversations, meeting/calendar interface, access boundaries, and call actions; fix demonstrated defects and verify locally. The user explicitly waived login-dependent browser checks. New competitor features are outside this audit.

## Fixes

- Calendar meeting dialog: portal to the document body so the animated header cannot clip or reposition it. Added Escape dismissal, keyboard focus cycling, scroll locking, and focus restoration.
- Polling: ignore responses from previous sources and superseded requests, and clear obsolete errors when switching source.
- Project navigation: reset conversation and meeting component state when the project or meeting changes.
- Scheduling: display 90 minutes as “1 h 30 min”. Update the meeting-list clock every 30 seconds so groups do not remain frozen at page-load time.
- Notes privacy: automatic notes now post only a readiness notice to chat. Summaries, decisions and action items stay on the meeting detail. This also protects team channels subsequently shared with clients.
- Call integrity: verify meeting scope before signaling, leaving or ending; reject a leave request naming another participant's session before deleting signals.
- Private meetings: apply channel membership to project meeting lists, workspace calendars, direct meeting reads and dependent actions.

## Evidence

The focused communication/calendar suite passes 17 tests. Added coverage verifies cross-project reads and mutations are refused; private meetings are excluded from lists/calendar and cannot be opened, joined or cancelled by nonmembers; client-visible note notices contain no private note content; and participants cannot leave another person's session. Existing coverage exercises mentions, reactions, threads, notifications, consent, captions, transcripts, notes, action tasks, calendar export and backup/restore.

Final verification: 26 tests passed across `comms.test.ts`, `calendar.test.ts`, `team.test.ts`, and `permissions.test.ts`, run with test concurrency limited to one. Type checking (`npx tsc --noEmit`), targeted ESLint on all changed source/test files, and `git diff --check` passed. The unrestricted full-suite attempt was stopped when it made the workspace sluggish; it is not reported as passing.

## Limits

- Changes are local and have not been deployed.
- Browser preview could not reach the local server. The supplied production URL requires login, and the user asked to skip that check. Visual behavior and real two-participant audio/video are not verified.
- Previously posted note content is not removed from existing chat history. The fix prevents new automatic copies; historical cleanup requires a separate review.
- Automated coverage is evidence for the tested paths, not a guarantee of every browser, network, device or deployment configuration.
