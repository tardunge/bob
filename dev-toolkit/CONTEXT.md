# Bob

Bob is a local, self-hosted voice assistant that runs agent work against the user's selected workspace and retains conversations on the user's machine.

## Language

**Conversation**:
A durable local sequence of user and assistant messages sharing one profile and canonical agent continuation.
_Avoid_: Thread, chat, session in user-facing language

**Turn**:
One accepted user input and its response lifecycle within a Conversation.
_Avoid_: Request, prompt, message when referring to the whole lifecycle

**Agent Work**:
A durable Bob execution record representing the agent activity initiated by one Turn.
_Avoid_: Job, background task, worker when referring to the durable record

**Promotion**:
The persisted transition that changes non-terminal Agent Work from foreground to background ownership and releases its Conversation's foreground slot.
_Avoid_: Backgrounding, detachment, timeout

**Background Callback**:
The durable terminal outcome from promoted Agent Work addressed to its originating Conversation.
_Avoid_: Notification, completion message, subagent result

**Attention State**:
The browser-derived classification of whether Bob is attended in the originating Conversation, attended elsewhere in Bob, or away.
_Avoid_: Focus, active tab, visibility when used alone

**Bob Chime**:
Bob's original short notification sound scheduled once by the elected browser audio owner for an eligible live terminal result that is not spoken in full.
_Avoid_: Beep, ping, Discord sound, Slack sound, Meet sound

## Relationships

- A **Conversation** contains zero or more **Turns**.
- A **Turn** creates exactly one **Agent Work** record.
- **Agent Work** starts in foreground ownership and may undergo **Promotion** at most once.
- Promoted **Agent Work** produces exactly one terminal **Background Callback**.
- **Attention State** selects full response speech or Bob Chime eligibility; the elected browser audio owner deduplicates and schedules eligible live chimes.

## Example dialogue

> **Dev:** "The Turn has been running for two minutes. Should I time it out?"
> **Domain expert:** "No. Apply Promotion to its Agent Work, release the Conversation, and keep the work running. When it finishes, persist one Background Callback. Use the Attention State to choose full speech or the Bob Chime."

## Flagged ambiguities

- "Thread," "chat," and "session" were used for the user-visible message container; resolved: use **Conversation** in product language, while `Session` may remain an implementation type.
- "Background worker" was used for both a process and its durable lifecycle record; resolved: the record is **Agent Work**, while worker and process remain implementation terms.
- "Callback" and "notification" were conflated; resolved: a **Background Callback** is durable Conversation content, while the **Bob Chime** is transient presentation.
- "Focus" was treated as sufficient attention evidence; resolved: **Attention State** combines document visibility, window focus, and selected Conversation.
- "Callback inbox" and "write lease" are implementation mechanisms, not Bob domain vocabulary; they remain lower-case implementation language in the PRD and are not glossary entries.
