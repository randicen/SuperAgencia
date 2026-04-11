# Tandeba / Codex Memory File

Read this file first in every new session.

## Project Identity

- Product name: Tandeba
- Root workspace: `C:\Users\acer\Desktop\proyectos antigravity\Agena`
- Production domain: `tandeba.com`
- Main goal: AI-first planning assistant with chat, voice, calendar organization, autonomous replanning, and email notifications

## Core Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Database: Supabase Postgres
- Auth: Clerk
- Deployment: Railway
- DNS / SSL / proxy: Cloudflare
- Email sending: Resend
- File storage: Cloudflare R2

## Infra and Domain Map

- `tandeba.com`: main product domain
- `accounts.tandeba.com`: Clerk account portal
- `clerk.tandeba.com`: Clerk frontend API domain
- Railway service: `web`
- Healthcheck endpoint: `/api/health`
- Railway is configured with rolling deploy support and 2 replicas

## Top-Level Folder Structure

- `src/`: React app, UI state, planner rendering, chat UI, calendar UI
- `server/`: backend domain logic, AI orchestration, auth bridge, replanning, email, governance
- `supabase/`: schema, migrations, database seed/source of truth
- `scripts/`: local helper scripts and operational tooling
- `dist/`: frontend build output
- `server.ts`: main backend entrypoint
- `README.md`, `ARQUITECTURA_Y_NOTAS.md`, `NOTES.md`, `lessons.md`: project documentation and learned constraints

## What The Key Files Do

### Frontend

- `src/App.tsx`
  - Main application shell
  - Orchestrates top-level state, chat interaction, planner/calendar rendering, settings panel, stream handling
- `src/components/Chat.tsx`
  - Chat UI and request lifecycle rendering
  - Sensitive area for pending states and UX copy during AI requests
- `src/lib/plannerState.ts`
  - Frontend planner state management and hydration helpers
- `src/lib/solver.ts`
  - Deterministic scheduling/solver logic used by the planner experience

### Backend

- `server.ts`
  - Main Express server
  - Defines `/api/chat`, `/api/health`, auth-aware API flows, stream responses, persistence flow
- `server/ai.ts`
  - Main AI orchestration layer
  - Contains system prompts, route prompts, model calling logic, tool/function handling, external lookup summarization
- `server/intentRouter.ts`
  - Intent classification for chat routes
  - Critical for deciding `conversation`, `planner_read`, `planner_mutation`, etc.
- `server/governance.ts`
  - Access control, entitlement checks, model-route resolution, plan/channel governance
- `server/state.ts`
  - Planner state loading, persistence, revision handling, recovery from good revisions
- `server/auth.ts`
  - Clerk identity bridge to historical Supabase user/profile state
- `server/live.ts`
  - Voice assistant pipeline and voice prompts
- `server/webSearchService.ts`
  - External search / factual retrieval support
- `server/notifications/email.ts`
  - Resend-based transactional email sending

### Replanning

- `server/replanning/changeDetection.ts`
  - Detects replanning triggers and state changes
- `server/replanning/policyEngine.ts`
  - Applies replanning policy decisions
- `server/replanning/guardrails.ts`
  - Prevents unsafe or invalid autonomous changes
- `server/replanning/replanningOrchestrator.ts`
  - Main replanning coordination flow
- `server/replanning/calendarConnectors.ts`
  - External calendar integration hooks

### Database

- `supabase/schema.sql`
  - Current database source of truth
  - Includes `model_routes`, `intent_model_routes`, planner schema, auth bridge fields, replay tables, revisions
- `supabase/migrations/`
  - Ordered history of schema changes
  - Must stay aligned with production DB before evaluating behavior changes

## Active Design / UX Choices

- Tandeba is not a toy demo. Product UX should feel intentional, minimal, and production-grade.
- Primary layout:
  - left panel = AI assistant chat / voice
  - right panel = agenda / calendar / planner output
- Top controls focus on:
  - workday start
  - workday end
  - work days
  - planning behavior
- Settings should avoid internal-engine jargon and admin/debug clutter.
- Recent UX cleanup removed:
  - `Actividad de replanificación`
  - `Correo de prueba`
  - `Detección interna de riesgo`
  - `Notificaciones por correo`
- Outlook integration should appear as `Pronto` rather than a broken or inactive control.
- Planning behavior should be grouped under a clearer mental model such as:
  - `Cómo organiza Tandeba`
  - `Estilo de planificación`
  - `Nivel de autonomía`

## Pages / Sections That Exist

- Main Tandeba app shell
- Chat assistant
- Voice / call interaction
- Agenda / calendar view
- Settings / planning preferences
- Calendar integrations
- Documents / library area
- Premium/account controls in top bar
- Clerk account flows on Tandeba domain

## User Preferences and Hard Constraints

- No toy demos
- No betas
- No patches
- Only engineering-grade solutions
- Do not change models/providers without explicit user approval
- Do not hide architectural changes behind silent fallbacks or “quick fixes”
- Fix root causes, not symptoms
- Touch the minimum necessary code
- Preserve unrelated behavior
- Explain tradeoffs concretely and briefly
- Prefer robust architecture over cosmetic hacks
- UX must stay clean, modern, and understandable

## AI / Chat System Notes

- The main active AI prompts live in `server/ai.ts`
- Voice prompts live in `server/live.ts`
- Chat pipeline is a sensitive area and has had repeated regressions in:
  - latency
  - route selection
  - incorrect planner mutation behavior
  - misleading UI progress states
- Before changing `/api/chat`, inspect:
  - `server.ts`
  - `server/ai.ts`
  - `server/intentRouter.ts`
  - `server/governance.ts`
  - `src/App.tsx`
  - `src/components/Chat.tsx`

## Current Model Routing Baseline

This is the known baseline that was restored after reverting unapproved changes.

- `model_routes` for `free/text` and `premium/text`
  - primary: `openrouter / google/gemma-3-12b-it:free`
  - fallback: `google / gemini-3.1-flash-lite-preview`
- `intent_model_routes`
  - `conversation` and `planner_read`
    - primary: `openrouter / google/gemma-3-12b-it:free`
    - fallback: `google / gemini-3.1-flash-lite-preview`
    - tier: `fast`
  - `planner_mutation`, `external_lookup`, `hybrid`
    - primary: `google / gemini-3.1-flash-lite-preview`
    - fallback: `openrouter / google/gemma-3-12b-it:free`
    - tier: `heavy`

Do not change this without explicit approval from the user.

## Auth / Identity Notes

- Auth migrated from Supabase Auth to Clerk
- Data continuity depends on the Clerk-to-historical-user bridge
- If agenda/chat appears “lost”, inspect user/profile linkage before assuming data deletion
- Relevant file: `server/auth.ts`

## Email Notes

- Resend is verified for `tandeba.com`
- Sender baseline:
  - `Tandeba <noreply@tandeba.com>`
- Email templates and signature are code-driven, not purely provider-driven

## Operational Cautions

- Git exists and should be treated seriously; keep commits clean and intentional
- Before any deploy-sensitive change, validate:
  - `npm run lint`
  - `npm run test`
  - `npm run build`
- Production behavior must be demonstrated, not assumed
- Before changing services, models, providers, DNS, or auth flows, verify exact current configuration first

## Session Startup Checklist

On every new session:

1. Read this file first
2. Read `lessons.md`
3. Check git status and current branch
4. Inspect recent architecture-sensitive files before touching them
5. Confirm whether the task requires backend, frontend, infra, or DB changes

## Non-Negotiable Standard

Build real software, not toy demos.
