# Tandeba Progress

Use this file to record concise session progress for future restarts.

## Current Focus

- Product: Tandeba
- Workspace: `C:\Users\acer\Desktop\proyectos antigravity\Agena`
- Goal: AI-first planning assistant with chat, voice, calendar, replanning, and email

## Progress Log

- 2026-04-11: Read `codex.md` and `lessons.md` to re-establish Tandeba context.
- 2026-04-11: Confirmed core stack and sensitive files for future work.
- 2026-04-11: Confirmed Railway production auto-deploys from `randicen/SuperAgencia` branch `dev`.
- 2026-04-11: Added deploy version detection in backend and stale-session refresh handling in frontend to improve UX after new releases without manual page reload in idle state.
- 2026-04-11: Added second-layer recovery for active sessions: chat checks deploy version after interrupted streams and live voice now attempts bounded WebSocket reconnection before asking for refresh.
- 2026-04-11: Added `railway.json` to pin Railway deploy config in repo and reduce production scaling from 2 replicas to 1 replica.
- 2026-04-11: Audited current app for real integration failures beyond `tsc`/tests/build. Confirmed that frontend features for documents, replanning settings, calendar integration, voice websocket, undo/redo, and partial autosave call endpoints that are not currently registered in `server.ts`.
- 2026-04-11: Confirmed first-login bootstrap risk: auth creates `profiles`, but `loadPlannerState()` expects an existing `planner_states` row and can fail for new users before the app becomes usable.
- 2026-04-11: Confirmed chat attachment/document gap: frontend sends `attachments` and `selectedDocumentIds`, but `/api/chat` currently reads only `message`, so those UX paths are exposed but non-functional.
- 2026-04-11: Confirmed planner persistence bug: `/api/chat` only detects changes in `tasks` and `calendarEvents`; dependency-only mutations can be dropped silently instead of being saved.

## Confirmed Issues Backlog

1. Missing backend routes for already-exposed frontend capabilities:
   - `/api/documents`
   - `/api/documents/upload`
   - `/api/documents/:id/download-url`
   - `/api/documents/:id`
   - `/api/settings/replanning`
   - `/api/calendar/:provider/connect`
   - `/api/calendar/:provider/disconnect`
   - `/api/calendar/:provider/sync`
   - `POST /api/state`
   - `POST /api/history/:direction`
   - `/ws/live`
2. New-user bootstrap failure risk because planner state is assumed to exist before first successful app load.
3. Chat attachments and selected library documents are ignored by backend even though the UI sends them.
4. Dependency-only planner mutations can be lost because chat persistence only checks task/event diffs.

## Update Format

- Date
- What changed
- What remains
- Any risk or blocker
