import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { createServer as createViteServer } from 'vite';

import { runAgent } from './server/ai.js';
import { requireAuth, type AuthenticatedRequest } from './server/auth.js';
import { solveSchedule, DEFAULT_INTELLIGENT_CONFIG } from './src/lib/solver.js';
import { 
  loadPlannerState, 
  savePlannerState, 
  appendChatMessage,
  redoPlannerState,
  undoPlannerState,
} from './server/state.js';
import type { PlannerState } from './src/lib/plannerState.js';
import { DEFAULT_PLANNER_STATE } from './src/lib/plannerState.js';
import type { ReplanningSettings } from './src/lib/plannerState.js';
import {
  createDocumentDownloadUrl,
  deleteDocumentForUser,
  listDocumentsForUser,
  queueDocumentsForUser,
} from './server/documents.js';
import { HttpError, isHttpError } from './server/httpErrors.js';
import { registerLiveVoiceProxy } from './server/live.js';
import {
  buildCalendarConnectUrl,
  finalizeCalendarOAuth,
  verifyOAuthState,
} from './server/replanning/calendarConnectors.js';
import { processCalendarSyncForProvider } from './server/replanning/replanningOrchestrator.js';
import {
  disconnectCalendarConnectionForUser,
  updateReplanningSettingsForUser,
} from './server/replanning/store.js';
import type { CalendarProvider } from './server/replanning/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distIndexPath = path.join(__dirname, 'dist', 'index.html');
const deploymentBuildId =
  process.env.RAILWAY_DEPLOYMENT_ID ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.SOURCE_VERSION ||
  `local-${Date.now()}`;
const deploymentStartedAt = new Date().toISOString();

const shouldUseViteDevServer = () => {
  const explicitDev =
    process.env.USE_VITE_DEV_SERVER === 'true' ||
    process.env.NODE_ENV === 'development';

  if (explicitDev) {
    return true;
  }

  return !existsSync(distIndexPath);
};

const publicAppUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, '') || '';

const isCalendarProvider = (value: string): value is CalendarProvider =>
  value === 'google' || value === 'outlook';

const buildErrorPayload = (error: unknown) => {
  if (isHttpError(error)) {
    return {
      status: error.status,
      payload: {
        error: error.message,
        code: error.code,
      },
    };
  }

  return {
    status: 500,
    payload: {
      error: error instanceof Error ? error.message : 'Unexpected server error.',
      code: 'internal_error',
    },
  };
};

const sendJsonError = (res: express.Response, error: unknown) => {
  const { status, payload } = buildErrorPayload(error);
  if (!res.headersSent) {
    res.status(status).json(payload);
  }
};

const startServer = async () => {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const server = createServer(app);
  const upload = multer({ storage: multer.memoryStorage() });

  app.use(express.json({ limit: '2mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Tandeba-Build-Id', deploymentBuildId);
    next();
  });

  // Healthcheck
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'Tandeba 2.0' }));
  app.get('/api/version', (_req, res) =>
    res.json({
      buildId: deploymentBuildId,
      deployedAt: deploymentStartedAt,
    }),
  );

  // Load State
  app.get('/api/state', requireAuth, async (req, res, next) => {
    try {
      const state = await loadPlannerState((req as AuthenticatedRequest).authUser);
      res.json({ state });
    } catch (error) { next(error); }
  });
  app.post('/api/state', requireAuth, async (req, res) => {
    try {
      const state = await savePlannerState(
        (req as AuthenticatedRequest).authUser,
        req.body as PlannerState,
      );
      res.json({ state });
    } catch (error) {
      sendJsonError(res, error);
    }
  });

  app.get('/api/documents', requireAuth, async (req, res) => {
    try {
      const state = await loadPlannerState((req as AuthenticatedRequest).authUser);
      const query = typeof req.query.q === 'string' ? req.query.q : undefined;
      const documents = await listDocumentsForUser(state.profileId ?? state.id, query);
      res.json(documents);
    } catch (error) {
      sendJsonError(res, error);
    }
  });

  app.post('/api/documents/upload', requireAuth, upload.array('documents'), async (req, res) => {
    try {
      const authUser = (req as AuthenticatedRequest).authUser;
      const state = await loadPlannerState(authUser);
      const created = await queueDocumentsForUser(
        state.profileId ?? state.id,
        state.viewer?.tier ?? 'free',
        (req.files as Express.Multer.File[] | undefined) ?? [],
      );
      res.status(201).json({ documents: created });
    } catch (error) {
      sendJsonError(res, error);
    }
  });

  app.post('/api/documents/:id/download-url', requireAuth, async (req, res) => {
    try {
      const authUser = (req as AuthenticatedRequest).authUser;
      const url = await createDocumentDownloadUrl(authUser.id, req.params.id);
      res.json({ url });
    } catch (error) {
      sendJsonError(res, error);
    }
  });

  app.delete('/api/documents/:id', requireAuth, async (req, res) => {
    try {
      const authUser = (req as AuthenticatedRequest).authUser;
      await deleteDocumentForUser(authUser.id, req.params.id);
      res.status(204).send();
    } catch (error) {
      sendJsonError(res, error);
    }
  });

  app.put('/api/settings/replanning', requireAuth, async (req, res) => {
    try {
      const authUser = (req as AuthenticatedRequest).authUser;
      const settings = await updateReplanningSettingsForUser(
        authUser.id,
        req.body as Partial<ReplanningSettings>,
      );
      res.json({ settings });
    } catch (error) {
      sendJsonError(res, error);
    }
  });

  app.get('/api/calendar/:provider/connect', requireAuth, async (req, res) => {
    try {
      const authUser = (req as AuthenticatedRequest).authUser;
      if (!isCalendarProvider(req.params.provider)) {
        throw new HttpError(404, 'calendar_provider_not_found', 'Proveedor de calendario no soportado.');
      }

      const url = buildCalendarConnectUrl(authUser.id, req.params.provider);
      res.json({ url });
    } catch (error) {
      sendJsonError(res, error);
    }
  });

  app.get('/api/calendar/:provider/callback', async (req, res) => {
    try {
      if (!isCalendarProvider(req.params.provider)) {
        throw new HttpError(404, 'calendar_provider_not_found', 'Proveedor de calendario no soportado.');
      }

      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!state || !code) {
        throw new HttpError(400, 'calendar_oauth_invalid_callback', 'La respuesta OAuth está incompleta.');
      }

      const verified = verifyOAuthState(state);
      if (verified.provider !== req.params.provider) {
        throw new HttpError(400, 'calendar_oauth_provider_mismatch', 'El callback no coincide con el proveedor.');
      }

      await finalizeCalendarOAuth(verified.userId, verified.provider, code);
      const redirectTarget = publicAppUrl || '/';
      res.redirect(`${redirectTarget}?calendar=${verified.provider}&status=connected`);
    } catch (error) {
      const { status, payload } = buildErrorPayload(error);
      res
        .status(status)
        .send(`<html><body><h1>${payload.code}</h1><p>${payload.error}</p></body></html>`);
    }
  });

  app.post('/api/calendar/:provider/disconnect', requireAuth, async (req, res) => {
    try {
      const authUser = (req as AuthenticatedRequest).authUser;
      if (!isCalendarProvider(req.params.provider)) {
        throw new HttpError(404, 'calendar_provider_not_found', 'Proveedor de calendario no soportado.');
      }

      await disconnectCalendarConnectionForUser(authUser.id, req.params.provider);
      const settings = await updateReplanningSettingsForUser(authUser.id, {});
      res.json({ settings });
    } catch (error) {
      sendJsonError(res, error);
    }
  });

  app.post('/api/calendar/:provider/sync', requireAuth, async (req, res) => {
    try {
      const authUser = (req as AuthenticatedRequest).authUser;
      if (!isCalendarProvider(req.params.provider)) {
        throw new HttpError(404, 'calendar_provider_not_found', 'Proveedor de calendario no soportado.');
      }

      const user = {
        id: authUser.id,
        email: authUser.email ?? `${authUser.id}@local.invalid`,
        fullName: authUser.user_metadata.full_name ?? authUser.user_metadata.name,
        avatarUrl: authUser.user_metadata.avatar_url ?? null,
      };
      const result = await processCalendarSyncForProvider(user, req.params.provider);
      const state = result?.state ?? (await loadPlannerState(authUser));
      res.json({ state });
    } catch (error) {
      sendJsonError(res, error);
    }
  });

  app.post('/api/history/:direction', requireAuth, async (req, res) => {
    try {
      const authUser = (req as AuthenticatedRequest).authUser;
      const direction = req.params.direction;
      if (direction !== 'undo' && direction !== 'redo') {
        throw new HttpError(404, 'history_direction_not_found', 'Acción de historial no soportada.');
      }

      const state =
        direction === 'undo'
          ? await undoPlannerState(authUser)
          : await redoPlannerState(authUser);
      res.json({ state });
    } catch (error) {
      sendJsonError(res, error);
    }
  });

  // Chat / Action Endpoint (Streaming NDJSON)
  app.post('/api/chat', requireAuth, upload.any(), async (req, res, next) => {
    const authedReq = req as AuthenticatedRequest;
    const { message } = req.body ?? {};

    // Enable streaming headers
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (event: { type: string; [key: string]: any }) => {
      res.write(JSON.stringify(event) + '\n');
    };

    try {
      // 1. Load current state
      sendEvent({ type: 'status', phase: 'routing', message: 'Cargando estado actual...' });
      const currentState = await loadPlannerState(authedReq.authUser);

      // 2. Prepare history for AI
      const history = (currentState.messages || []).slice(-6).map(m => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.text
      }));

      // 3. Run AI Agent with streaming callbacks
      const agentResponse = await runAgent({
        userMessage: message,
        history,
        tasks: currentState.tasks,
        calendarEvents: currentState.calendarEvents,
        dependencies: currentState.dependencies,
        schedule: currentState.schedule,
        workWindow: currentState.workWindow,
        strategy: currentState.strategy
      }, (streamEvent) => {
        // Forward status events to client in real-time
        if (streamEvent.type === 'status') {
          sendEvent(streamEvent);
        }
      });

      // 4. Detect if changes occurred
      const hasChanges = JSON.stringify(currentState.tasks) !== JSON.stringify(agentResponse.tasks) ||
                         JSON.stringify(currentState.calendarEvents) !== JSON.stringify(agentResponse.calendarEvents);

      let savedState;

      if (hasChanges) {
        sendEvent({ type: 'status', phase: 'planning', message: 'Validando y optimizando agenda...' });
        
        // 4a. If changes: Run Solver
        const now = new Date();
        const result = solveSchedule(
          agentResponse.tasks,
          agentResponse.dependencies,
          agentResponse.calendarEvents,
          currentState.workWindow,
          currentState.strategy,
          now.getHours() * 60 + now.getMinutes(),
          7, 15,
          currentState.schedule || undefined,
          DEFAULT_INTELLIGENT_CONFIG,
          now.getDay()
        );

        sendEvent({ type: 'status', phase: 'saving', message: 'Guardando cambios...' });

        savedState = await savePlannerState(authedReq.authUser, {
          ...currentState,
          tasks: agentResponse.tasks,
          calendarEvents: agentResponse.calendarEvents,
          dependencies: agentResponse.dependencies,
          schedule: result.schedule,
          messages: [...currentState.messages, { role: 'user', text: message }, { role: 'model', text: agentResponse.text }]
        });
      } else {
        // 4b. If no changes: Just save chat
        savedState = await appendChatMessage(authedReq.authUser, message, agentResponse.text);
      }

      // Send final result
      sendEvent({ type: 'result', state: savedState });
      res.end();
    } catch (error) {
      console.error('Chat error:', error);
      sendEvent({ type: 'error', error: error instanceof Error ? error.message : String(error) });
      res.end();
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    sendJsonError(res, error);
  });

  // Vite / Static Assets
  if (shouldUseViteDevServer()) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => res.sendFile(distIndexPath));
  }

  registerLiveVoiceProxy(server);
  server.listen(port, '0.0.0.0', () => console.log(`Tandeba 2.0 running on port ${port}`));
};

startServer();
