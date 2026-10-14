# Conversations and meetings: audit against competitors

The module is benchmarked against what studios and their clients already use:
Slack and Microsoft Teams (chat), Zoom, Google Meet and Teams (calls), and the
client portals of Houzz Pro, Basecamp, HoneyBook and Dubsado (client comms).
Each round fixes the biggest gaps, ships to main, and this list is updated.

Legend: ✓ done · ✱ in this round · ○ open

## Chat (Slack, Teams)

| Gap | Why it matters | State |
| --- | --- | --- |
| Emoji reactions on posts | The quickest "seen / agreed" in every chat app; clients use it to approve | ✓ R1 |
| Formatting (bold, italic, code, lists, quotes) | Specs and snag lists are unreadable as one paragraph | ✓ R1 |
| Paste or drop images and files into the box | Screenshots and site photos are most of what gets sent | ✓ R1 |
| Drafts kept per channel and thread | Switching channel lost half-written messages | ✓ R1 |
| Clients can send photos and files | Clients send site photos, inspiration and signed documents | ✓ R3 |
| Search messages | Finding "what did we decide about the tiles" | ✓ R3 |
| Pinned posts per channel | Decisions and key links stay on top | ✓ R3 |
| Direct messages between two people | Teams and Slack both have them | ✓ R9 |
| Typing indicator and "seen by" | Clients want to know the studio saw it | ✓ R4 |
| Mute a channel, notification levels | Busy studios need less noise | ✓ R4 |
| Link a project document, approval or task into a post | Keeps the conversation tied to the work | ✓ R8 |
| Email notifications and reply by email | Clients live in email (blocked: no email provider yet) | ○ |
| Jump to first unread, "new messages" line | Catching up after a site visit | ✓ R6 |

## Calls (Zoom, Meet, Teams)

| Gap | Why it matters | State |
| --- | --- | --- |
| Copy invite link and add to calendar (.ics) | Clients need a link and a calendar entry | ✓ R2 |
| Pick microphone, camera and speaker | Headsets and external cameras | ✓ R2 |
| Active speaker highlight and speaker view | Knowing who is talking; big tile for the speaker | ✓ R2 |
| Pin a person or a shared screen | Following a screen share on a small screen | ✓ R2 |
| Emoji reactions in the call | Quick feedback without unmuting | ✓ R2 |
| Waiting room: studio admits clients | Studios control who joins | ✓ R5 |
| Host controls: mute everyone, remove someone | Running a client meeting | ✓ R5 |
| Background blur | Working from home or site | ✓ R10 (where the browser blurs itself; a blur model of our own is still open) |
| Recurring meetings | Weekly site or design meetings | ✓ R6 |
| Connection quality, reconnect notice | Load-shedding and mobile data | ✓ R10 |
| Recording playback synced to the transcript | Jumping to "the part about the kitchen" | ✓ R7 |

## Client comms (Houzz Pro, Basecamp, HoneyBook, Dubsado)

| Gap | Why it matters | State |
| --- | --- | --- |
| Client sees unread counts and a clear "new" state | Client portals lead with "you have 2 new messages" | ✓ R4 |
| Client uploads (photos of the space, documents) | See chat above | ✓ R3 |
| Ask the client to approve or choose in a message | HoneyBook and Houzz Pro do approvals in the thread | ✓ R11 |
| Meeting notes shared with the client (team chooses) | Clients expect a recap after a meeting | ✓ R4 |

## Second audit (after round 11)

Every gap above is closed except email, which waits on an email provider. Looking again at Teams, Slack, WhatsApp (which most South African clients use) and Zoom:

| Gap | Why it matters | State |
| --- | --- | --- |
| Voice notes in a message | Designers on site talk rather than type; WhatsApp habit | ✓ R12 |
| A channel's files in one place | "Where was that tile spec?" without scrolling | ✓ R12 |
| "Catch me up": the assistant sums up what was missed | Teams Copilot and Slack AI recaps | ✓ R13 |
| Call someone straight from a direct message | Teams and WhatsApp call buttons | ✓ R13 |
| Save a message for later, remind me | Slack "Save" and "Remind me" | ✓ R14 (reminders arrive as notifications) |
| Send a message later | Slack and Teams scheduled send, for clients' hours | ✓ R14 (studio only; Send now or Cancel while it waits) |
| Forward a post to another channel | Sharing a client's message with the team | ✓ R15 (as a quote with its files and a note; warns before a client channel) |
| Link previews for web addresses | Product pages from suppliers read at a glance | ✓ R15 (pictures added in R18, served by us) |

## Third audit (after round 15)

Everything in the second list is closed. Looking again at Teams with Copilot, Slack, WhatsApp Business and Zoom:

| Gap | Why it matters | State |
| --- | --- | --- |
| "Starts in 10 minutes" meeting reminder with a way to join | Teams, Zoom and calendars all nudge before a call | ✓ R16 |
| Mark a post unread | Slack and Teams: come back to it later | ✓ R16 |
| Draft a reply with the assistant | Copilot and Gmail suggest replies; clients wait less | ✓ R17 (in the thread's box, in the client's language; facts to fill in are left in [brackets]) |
| Translate a post | Teams translates inline; South African clients write in Afrikaans, isiZulu and more | ✓ R17 (English, Afrikaans, isiZulu, isiXhosa, Sesotho, Setswana, Portuguese, French) |
| Follow or leave a thread | Slack and Teams: hear about the threads you care about only | ✓ R18 |
| Pictures in link previews, served by us | Product pictures without telling suppliers who looks | ✓ R18 (no SVG, 2 MB at most, public addresses only) |

## Fourth audit (after round 18)

| Gap | Why it matters | State |
| --- | --- | --- |
| Make a task from a post | Teams "create task from message"; client asks become work in one tap | ✓ R19 (clients see "noted as a task", not the studio's list) |
| A "Threads" view of every thread you're in, newest replies first | Slack Threads: catch up on replies without opening each channel | ✓ R20 |
| Search filters: from someone, in a channel, with files | Slack and Teams search filters | ✓ R20 |
| The assistant prepares a meeting's agenda from open tasks and unanswered questions | Teams Copilot meeting prep | ✓ R21 (kept only when the studio says so; client meetings leave internal matters out) |

## Fifth audit (after round 21)

| Gap | Why it matters | State |
| --- | --- | --- |
| The assistant can do what a person can here: send later, forward, set reminders, write agendas | "The AI must be able to do everything for me" | ✓ R22 |
| Pause notifications, and quiet hours outside working hours | Slack "Pause notifications"; studios work set hours | ✓ R23 (device alerts, paused or kept to working hours; everything still lands in Notifications) |
| Status: available, in a meeting, away | Teams presence; clients see if the studio is around | ✓ R24 (set busy or away with a note and an end time; clients see who is around, not notes) |
| Notifications on the phone (web push) | WhatsApp and Teams reach people on their phones | ✓ R25: pushes reach phones and computers even when Fundur is closed, as each person's alert settings allow; Fundur installs to the Home Screen |

## Sixth audit (after round 25), the last round of this loop

| Gap | Why it matters | State |
| --- | --- | --- |
| Meet now in any channel | Teams "Meet now" and Slack huddles; today only direct messages had a call button | ✓ R26 (in a client channel the client can join) |
| Quick replies | WhatsApp Business quick replies, HoneyBook snippets: the same answers to clients every day | ✓ R26 (per person, kept with their settings) |
| Away reply to clients outside studio hours | WhatsApp Business away message | ○ for a later loop |

## Where we are already ahead

- The assistant reads every channel, meeting and transcript and can carry the work on (@Assistant in any thread).
- Meeting notes with decisions and action items that become project tasks in one tap.
- Recording consent per person (POPIA), with people who decline left out of the audio and transcript.
- Imports of Teams, Zoom and Meet transcripts.
