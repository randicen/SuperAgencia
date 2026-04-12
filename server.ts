import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { createServer } from 'http';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { chatWithSolverBackend } from './server/ai.js';
import { requireAuth, type AuthenticatedRequest } from './server/auth.js';
import { parseChatAttachments } from './server/chatAttachments.js';
import {
  assertReplayRequestId,
  completeChatReplay,
  findCompletedReplay,
  releasePendingChatReplay,
  reserveChatReplay,
} from './server/chatReplay.js';
import {
  buildDocumentRetrievalContext,
  createDocumentDownloadUrl,
  deleteDocumentForUser,
  getDocumentForUser,
  listDocumentsForUser,
  queueDocumentsForUser,
  shouldRetrieveDocumentsForMessage,
} from './server/documents.js';
import { assertChannelAccess, recordUsageEvent } from './server/governance.js';
import { HttpError, isHttpError } from './server/httpErrors.js';
import { registerLiveVoiceProxy } from './server/live.js';
import { sendTestEmail } from './server/notifications/email.js';
import { buildCalendarConnectUrl, finalizeCalendarOAuth, verifyOAuthState } from './server/replanning/calendarConnectors.js';
import {
  acceptReplanningSuggestion,
  processAutonomousReplanningForUser,
  processCalendarSyncForProvider,
  rejectReplanningSuggestion,
} from './server/replanning/replanningOrchestrator.js';
import {
  disconnectCalendarConnectionForUser,
  listUsersForAutonomousReplanning,
  loadReplanningBundleForUser,
  updateReplanningSettingsForUser,
} from './server/replanning/store.js';
import { MAX_DOCUMENT_FILE_SIZE_BYTES, type DocumentStatus } from './src/lib/documents.js';
import { DEFAULT_PLANNER_STATE, type ChatIntentRoute, type PlannerStateSyncPayload } from './src/lib/plannerState.js';
import { DEFAULT_INTELLIGENT_CONFIG, solveSchedule } from './src/lib/solver.js';
import {
  appendChatMessages,
  loadPlannerState,
  recordScheduleRun,
  redoPlannerState,
  savePlannerState,
  undoPlannerState,
} from './server/state.js';
import type { PlannerState } from './src/lib/plannerState.js';

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

const parseErrorCode = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { status?: string; code?: number | string; error?: { status?: string; code?: number | string } };

  if (typeof candidate.status === 'string') return candidate.status;
  if (typeof candidate.code === 'string') return candidate.code;
  if (typeof candidate.code === 'number') return String(candidate.code);
  if (candidate.error && typeof candidate.error.status === 'string') return candidate.error.status;
  if (candidate.error && typeof candidate.error.code === 'string') return candidate.error.code;
  if (candidate.error && typeof candidate.error.code === 'number') return String(candidate.error.code);
  return null;
};

const findReplayResultInState = (
  state: PlannerState,
  requestId: string,
): { state: PlannerState; reply: string } | null => {
  const matchedUserMessage = state.messages.some(
    (message) => message.role === 'user' && message.metadata?.requestId === requestId,
  );
  if (!matchedUserMessage) {
    return null;
  }

  const matchedReply = [...state.messages]
    .reverse()
    .find((message) => message.role === 'model' && message.metadata?.requestId === requestId);

  if (!matchedReply) {
    return null;
  }

  return {
    state,
    reply: matchedReply.text,
  };
};

const startServer = async () => {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const server = createServer(app);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 4,
    },
  });
  const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_DOCUMENT_FILE_SIZE_BYTES,
      files: 8,
    },
  });

  app.use(express.json({ limit: '2mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Tandeba-Build-Id', deploymentBuildId);
    next();
  });

  const maybeHandleMultipart = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (req.is('multipart/form-data')) {
      upload.array('attachments', 4)(req, res, next);
      return;
    }
    next();
  };

  const parseJsonField = <T,>(value: unknown, fallback: T): T => {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  };

  const toOrchestratorUser = (req: AuthenticatedRequest) => ({
    id: req.authUser.id,
    email: req.authUser.email ?? '',
    fullName:
      (typeof req.authUser.user_metadata?.full_name === 'string' && req.authUser.user_metadata.full_name) ||
      (typeof req.authUser.user_metadata?.name === 'string' && req.authUser.user_metadata.name) ||
      undefined,
    avatarUrl:
      (typeof req.authUser.user_metadata?.avatar_url === 'string' && req.authUser.user_metadata.avatar_url) ||
      null,
  });

  const isStreamRequested = (req: express.Request) => req.header('x-tandeba-stream') === '1';

  const ensureStreamHeaders = (res: express.Response) => {
    if (res.headersSent) return;
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
  };

  const writeStreamEvent = (res: express.Response, event: Record<string, unknown>) => {
    ensureStreamHeaders(res);
    res.write(`${JSON.stringify(event)}\n`);
  };

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'Tandeba API' });
  });

  app.get('/api/version', (_req, res) =>
    res.json({
      buildId: deploymentBuildId,
      deployedAt: deploymentStartedAt,
    }),
  );

  app.get('/api/documents', requireAuth, async (req, res, next) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : undefined;
      const status = typeof req.query.status === 'string' ? (req.query.status as DocumentStatus) : undefined;
      const payload = await listDocumentsForUser((req as AuthenticatedRequest).authUser.id, query, status);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/documents/:id', requireAuth, async (req, res, next) => {
    try {
      const document = await getDocumentForUser((req as AuthenticatedRequest).authUser.id, req.params.id);
      res.json({ document });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/documents/:id/download-url', requireAuth, async (req, res, next) => {
    try {
      const url = await createDocumentDownloadUrl((req as AuthenticatedRequest).authUser.id, req.params.id);
      res.json({ url });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/documents/:id', requireAuth, async (req, res, next) => {
    try {
      await deleteDocumentForUser((req as AuthenticatedRequest).authUser.id, req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/documents/upload', requireAuth, (req, res, next) => {
    documentUpload.array('documents', 8)(req, res, next);
  }, async (req, res, next) => {
    try {
      const governance = await assertChannelAccess((req as AuthenticatedRequest).authUser, 'text');
      const files = ((req.files as Express.Multer.File[] | undefined) ?? []).filter(Boolean);
      const documents = await queueDocumentsForUser(
        (req as AuthenticatedRequest).authUser.id,
        governance.access.planCode,
        files,
      );
      res.status(201).json({ documents });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/state', requireAuth, async (req, res, next) => {
    try {
      const state = await loadPlannerState((req as AuthenticatedRequest).authUser);
      res.json({ state });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/state', requireAuth, async (req, res, next) => {
    try {
      const payload = req.body as PlannerStateSyncPayload;
      const currentState = await loadPlannerState((req as AuthenticatedRequest).authUser);
      const serverNow = new Date();
      const nowMinutes = Number.isFinite(payload.clientNowMinutes)
        ? payload.clientNowMinutes
        : serverNow.getHours() * 60 + serverNow.getMinutes();
      const currentWeekday = Number.isFinite(payload.clientWeekday)
        ? payload.clientWeekday
        : serverNow.getDay();
      const scheduleBaseDate =
        payload.clientDayStartIso || payload.scheduleBaseDate || serverNow.toISOString();

      const result =
        currentState.tasks.length > 0
          ? solveSchedule(
              currentState.tasks,
              currentState.dependencies,
              currentState.calendarEvents,
              payload.workWindow ?? currentState.workWindow,
              payload.strategy ?? currentState.strategy,
              nowMinutes,
              7,
              15,
              currentState.schedule ?? undefined,
              DEFAULT_INTELLIGENT_CONFIG,
              currentWeekday,
            )
          : { schedule: [], diagnostics: null };

      const state = await savePlannerState((req as AuthenticatedRequest).authUser, {
        ...currentState,
        schedule: result.schedule,
        diagnostics: result.diagnostics ?? null,
        workWindow: payload.workWindow ?? currentState.workWindow,
        strategy: payload.strategy ?? currentState.strategy,
        scheduleBaseDate,
      });
      res.json({ state });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/settings/replanning', requireAuth, async (req, res, next) => {
    try {
      const settings = await updateReplanningSettingsForUser((req as AuthenticatedRequest).authUser.id, {
        mode: req.body?.mode,
        googleCalendarEnabled: req.body?.googleCalendarEnabled,
        outlookCalendarEnabled: req.body?.outlookCalendarEnabled,
        internalRiskDetectionEnabled: req.body?.internalRiskDetectionEnabled,
        emailNotificationsEnabled: req.body?.emailNotificationsEnabled,
      });
      res.json({ settings });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/replanning/feed', requireAuth, async (req, res, next) => {
    try {
      const bundle = await loadReplanningBundleForUser((req as AuthenticatedRequest).authUser.id);
      res.json(bundle);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/replanning/events/:id/accept', requireAuth, async (req, res, next) => {
    try {
      const authedReq = req as AuthenticatedRequest;
      const state = await acceptReplanningSuggestion(toOrchestratorUser(authedReq), req.params.id);
      res.json({ state });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/replanning/events/:id/reject', requireAuth, async (req, res, next) => {
    try {
      const authedReq = req as AuthenticatedRequest;
      await rejectReplanningSuggestion(authedReq.authUser.id, req.params.id);
      const state = await loadPlannerState(authedReq.authUser);
      res.json({ state });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/debug/send-test-email', requireAuth, async (req, res, next) => {
    try {
      const authedReq = req as AuthenticatedRequest;
      if (!authedReq.authUser.email) {
        res.status(400).json({ error: 'Tu cuenta no tiene un email disponible para enviar la prueba.' });
        return;
      }

      const delivery = await sendTestEmail({
        to: authedReq.authUser.email,
        fullName:
          (typeof authedReq.authUser.user_metadata?.full_name === 'string' &&
            authedReq.authUser.user_metadata.full_name) ||
          (typeof authedReq.authUser.user_metadata?.name === 'string' &&
            authedReq.authUser.user_metadata.name) ||
          undefined,
      });

      res.json({
        ok: true,
        deliveryId: delivery.id,
        sentTo: authedReq.authUser.email,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/calendar/:provider/connect', requireAuth, async (req, res, next) => {
    try {
      if (req.params.provider !== 'google' && req.params.provider !== 'outlook') {
        res.status(400).json({ error: 'Proveedor de calendario no soportado.' });
        return;
      }
      const url = buildCalendarConnectUrl((req as AuthenticatedRequest).authUser.id, req.params.provider);
      res.json({ url });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/calendar/google/callback', async (req, res, next) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const verified = verifyOAuthState(state);
      await finalizeCalendarOAuth(verified.userId, 'google', code);
      await updateReplanningSettingsForUser(verified.userId, { googleCalendarEnabled: true });
      res.redirect(`${process.env.PUBLIC_APP_URL}?calendar=google_connected`);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/calendar/outlook/callback', async (req, res, next) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const verified = verifyOAuthState(state);
      await finalizeCalendarOAuth(verified.userId, 'outlook', code);
      await updateReplanningSettingsForUser(verified.userId, { outlookCalendarEnabled: true });
      res.redirect(`${process.env.PUBLIC_APP_URL}?calendar=outlook_connected`);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/calendar/:provider/sync', requireAuth, async (req, res, next) => {
    try {
      if (req.params.provider !== 'google' && req.params.provider !== 'outlook') {
        res.status(400).json({ error: 'Proveedor de calendario no soportado.' });
        return;
      }
      const authedReq = req as AuthenticatedRequest;
      const result = await processCalendarSyncForProvider(toOrchestratorUser(authedReq), req.params.provider);
      const state = await loadPlannerState(authedReq.authUser);
      res.json({ result, state });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/calendar/:provider/disconnect', requireAuth, async (req, res, next) => {
    try {
      if (req.params.provider !== 'google' && req.params.provider !== 'outlook') {
        res.status(400).json({ error: 'Proveedor de calendario no soportado.' });
        return;
      }
      const authedReq = req as AuthenticatedRequest;
      await disconnectCalendarConnectionForUser(authedReq.authUser.id, req.params.provider);
      const settings = await updateReplanningSettingsForUser(authedReq.authUser.id, {
        googleCalendarEnabled: req.params.provider === 'google' ? false : undefined,
        outlookCalendarEnabled: req.params.provider === 'outlook' ? false : undefined,
      });
      res.json({ settings });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/history/undo', requireAuth, async (req, res, next) => {
    try {
      const state = await undoPlannerState((req as AuthenticatedRequest).authUser);
      res.json({ state });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/history/redo', requireAuth, async (req, res, next) => {
    try {
      const state = await redoPlannerState((req as AuthenticatedRequest).authUser);
      res.json({ state });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/chat', requireAuth, maybeHandleMultipart, async (req, res, next) => {
    const authedReq = req as AuthenticatedRequest;
    const streamRequested = isStreamRequested(req);
    const requestStartedAt = performance.now();
    let replayRequestId: string | null = null;
    let replayCompleted = false;
    let replayReservationOwned = false;
      let selectedRoute:
        | {
            provider: string;
            model: string;
            fallbackProvider?: string;
            fallbackModel?: string;
            modelTier: 'fast' | 'heavy';
          }
        | null = null;
      let selectedIntent: ChatIntentRoute = 'conversation';

    try {
      const {
        requestId,
        message,
        displayMessage,
        history,
        tasks,
        calendarEvents,
        dependencies,
        workWindow,
        strategy,
        currentSchedule,
        diagnostics,
        scheduleBaseDate,
        clientDayStartIso,
        clientNowMinutes,
        clientWeekday,
        selectedDocumentIds,
      } = req.body ?? {};
      replayRequestId = assertReplayRequestId(requestId);

      const completedReplay = await findCompletedReplay(authedReq.authUser.id, replayRequestId);
      if (completedReplay) {
        if (streamRequested) {
          writeStreamEvent(res, {
            type: 'result',
            reply: completedReplay.reply,
            state: completedReplay.state,
          });
          res.end();
        } else {
          res.json({
            reply: completedReplay.reply,
            state: completedReplay.state,
          });
        }
        return;
      }

      const isMultipart = req.is('multipart/form-data');
      const rawMessage = isMultipart ? String(message ?? '') : message;
      const parsedHistory = isMultipart ? parseJsonField(history, []) : history ?? [];
      const parsedTasks = isMultipart ? parseJsonField(tasks, []) : tasks ?? [];
      const parsedCalendarEvents = isMultipart ? parseJsonField(calendarEvents, []) : calendarEvents ?? [];
      const parsedDependencies = isMultipart ? parseJsonField(dependencies, []) : dependencies ?? [];
      const parsedWorkWindow = isMultipart
        ? parseJsonField(workWindow, DEFAULT_PLANNER_STATE.workWindow)
        : workWindow ?? DEFAULT_PLANNER_STATE.workWindow;
      const parsedStrategy = isMultipart
        ? parseJsonField(strategy, DEFAULT_PLANNER_STATE.strategy)
        : strategy ?? DEFAULT_PLANNER_STATE.strategy;
      const parsedCurrentSchedule = isMultipart ? parseJsonField(currentSchedule, []) : currentSchedule ?? [];
      const parsedDiagnostics = isMultipart ? parseJsonField(diagnostics, null) : diagnostics ?? null;
      const parsedScheduleBaseDate = isMultipart
        ? String(scheduleBaseDate ?? '')
        : typeof scheduleBaseDate === 'string'
          ? scheduleBaseDate
          : '';
      const parsedClientDayStartIso = isMultipart
        ? String(clientDayStartIso ?? '')
        : typeof clientDayStartIso === 'string'
          ? clientDayStartIso
          : '';
      const parsedClientNowMinutes = Number(isMultipart ? clientNowMinutes : clientNowMinutes ?? NaN);
      const parsedClientWeekday = Number(isMultipart ? clientWeekday : clientWeekday ?? NaN);
      const parsedSelectedDocumentIds = isMultipart
        ? parseJsonField<string[]>(selectedDocumentIds, [])
        : Array.isArray(selectedDocumentIds)
          ? selectedDocumentIds
          : [];
      const replayReservation = await reserveChatReplay(authedReq.authUser.id, replayRequestId);
      replayReservationOwned = replayReservation === 'acquired';
      const attachments = await parseChatAttachments((req.files as Express.Multer.File[] | undefined) ?? []);
      const effectiveMessage =
        typeof rawMessage === 'string' && rawMessage.trim()
          ? rawMessage.trim()
          : attachments.length > 0
            ? 'Analiza los archivos adjuntos y ayúdame a planificar en base a su contenido.'
            : '';
      const persistedUserMessage =
        typeof displayMessage === 'string' && displayMessage.trim()
          ? displayMessage.trim()
          : effectiveMessage;
      const currentState = await loadPlannerState(authedReq.authUser);
      const recoveredReplay = findReplayResultInState(currentState, replayRequestId);
      if (recoveredReplay) {
        await completeChatReplay({
          userId: authedReq.authUser.id,
          requestId: replayRequestId,
          state: recoveredReplay.state,
          reply: recoveredReplay.reply,
        });
        replayCompleted = true;

        if (streamRequested) {
          writeStreamEvent(res, {
            type: 'result',
            reply: recoveredReplay.reply,
            state: recoveredReplay.state,
          });
          res.end();
        } else {
          res.json({
            reply: recoveredReplay.reply,
            state: recoveredReplay.state,
          });
        }
        return;
      }

      if (replayReservation === 'completed_elsewhere') {
        const completedReplay = await findCompletedReplay(authedReq.authUser.id, replayRequestId);
        if (completedReplay) {
          if (streamRequested) {
            writeStreamEvent(res, {
              type: 'result',
              reply: completedReplay.reply,
              state: completedReplay.state,
            });
            res.end();
          } else {
            res.json({
              reply: completedReplay.reply,
              state: completedReplay.state,
            });
          }
          return;
        }
      }

      if (replayReservation === 'pending_elsewhere') {
        throw new HttpError(
          409,
          'chat_request_in_progress',
          'Tu solicitud anterior sigue cerrándose. Tandeba la reintentará en unos segundos.',
        );
      }
      const authoritativeHistory = currentState.messages.map((entry) => ({
        role: entry.role,
        text: entry.text,
        metadata: entry.metadata,
      }));

      const classifyStartedAt = performance.now();
      const governance = await assertChannelAccess(authedReq.authUser, 'text');
      selectedRoute = governance.route;
      const classifyDurationMs = Math.round(performance.now() - classifyStartedAt);

      const documentRetrieval =
        shouldRetrieveDocumentsForMessage(effectiveMessage, parsedSelectedDocumentIds)
          ? await buildDocumentRetrievalContext(
              authedReq.authUser.id,
              effectiveMessage,
              parsedSelectedDocumentIds.length > 0 ? parsedSelectedDocumentIds : undefined,
            )
          : { hits: [], sources: [], contextText: '' };

      const aiStartedAt = performance.now();
      const aiResult = await chatWithSolverBackend(
        effectiveMessage,
        authoritativeHistory,
        currentState.tasks,
        currentState.calendarEvents,
        currentState.dependencies,
        currentState.workWindow,
        currentState.strategy,
        currentState.schedule,
        {
          scheduleBaseDate: parsedScheduleBaseDate,
          clientDayStartIso: parsedClientDayStartIso,
        },
        {
          primaryProvider: governance.route.provider,
          primaryModel: governance.route.model,
          fallbackProvider: governance.route.fallbackProvider,
          fallbackModel: governance.route.fallbackModel,
          modelTier: governance.route.modelTier,
        },
        selectedIntent,
        attachments,
        documentRetrieval,
        streamRequested
          ? {
              onRoutingStart: (payload) =>
                writeStreamEvent(res, { type: 'status', phase: 'routing', ...payload }),
              onThinkingStart: (payload) =>
                writeStreamEvent(res, { type: 'status', phase: 'thinking', ...payload }),
              onSearchingStart: (payload) =>
                writeStreamEvent(res, { type: 'status', phase: 'searching', ...payload }),
              onSearchingResults: (payload) =>
                writeStreamEvent(res, { type: 'status', phase: 'searching', ...payload }),
              onPlanningStart: (payload) =>
                writeStreamEvent(res, { type: 'status', phase: 'planning', ...payload }),
              onSavingStart: (payload) =>
                writeStreamEvent(res, { type: 'status', phase: 'saving', ...payload }),
            }
          : undefined,
      );
      const modelDurationMs = Math.round(performance.now() - aiStartedAt);
      selectedIntent = aiResult.intentRoute ?? selectedIntent;

      if (
        (selectedIntent === 'external_lookup' || selectedIntent === 'hybrid') &&
        !governance.effectivePlan.web_search_enabled
      ) {
        throw new Error('La b??squeda web no est?? habilitada para tu plan actual.');
      }

      const nextMessages = [
        ...currentState.messages,
        {
          role: 'user' as const,
          text: persistedUserMessage,
          metadata: {
            requestId: replayRequestId,
          },
        },
        {
          role: 'model' as const,
          text: aiResult.text,
          metadata: {
            messageType: aiResult.messageType,
            sources: aiResult.sources,
            requestId: replayRequestId,
          },
        },
      ];
      const nextTasks = aiResult.newTasks ?? currentState.tasks ?? [];
      const nextCalendarEvents = aiResult.newCalendarEvents ?? currentState.calendarEvents ?? [];
      const nextDependencies = aiResult.newDependencies ?? currentState.dependencies ?? [];
      const effectiveScheduleBaseDate =
        parsedClientDayStartIso || parsedScheduleBaseDate || new Date().toISOString();
      const shouldReschedule = aiResult.plannerMutation !== false;
      let savedState;
      let solveDurationMs = 0;
      let persistDurationMs = 0;

      if (shouldReschedule) {
        const serverNow = new Date();
        const nowMinutes = Number.isFinite(parsedClientNowMinutes)
          ? parsedClientNowMinutes
          : serverNow.getHours() * 60 + serverNow.getMinutes();
        const currentWeekday = Number.isFinite(parsedClientWeekday)
          ? parsedClientWeekday
          : serverNow.getDay();
        const solveStartedAt = performance.now();
        const result = solveSchedule(
          nextTasks,
          nextDependencies,
          nextCalendarEvents,
          currentState.workWindow,
          currentState.strategy,
          nowMinutes,
          7,
          15,
          currentState.schedule ?? undefined,
          DEFAULT_INTELLIGENT_CONFIG,
          currentWeekday,
        );
        solveDurationMs = Math.round(performance.now() - solveStartedAt);

        if (streamRequested) {
          writeStreamEvent(res, {
            type: 'status',
            phase: 'saving',
            message: 'Guardando la actualización en Tandeba...',
            sources: aiResult.sources ?? [],
          });
        }

        const persistStartedAt = performance.now();
        savedState = await savePlannerState(authedReq.authUser, {
          messages: nextMessages,
          tasks: nextTasks,
          calendarEvents: nextCalendarEvents,
          dependencies: nextDependencies,
          workWindow: currentState.workWindow,
          strategy: currentState.strategy,
          schedule: result.schedule,
          diagnostics: result.diagnostics ?? null,
          scheduleBaseDate: effectiveScheduleBaseDate,
        });
        persistDurationMs = Math.round(performance.now() - persistStartedAt);

        await recordScheduleRun(authedReq.authUser, {
          strategy: savedState.strategy,
          taskCount: savedState.tasks.length,
          score: result.score,
          status: result.diagnostics?.status ?? 'OPTIMAL',
          diagnostics: result.diagnostics ?? null,
          schedule: result.schedule,
          configUsed:
            savedState.strategy === 'intelligent' ? DEFAULT_INTELLIGENT_CONFIG : {},
        });
      } else {
        const persistStartedAt = performance.now();
        savedState = await appendChatMessages(
          authedReq.authUser,
          {
            ...currentState,
            scheduleBaseDate: parsedScheduleBaseDate || effectiveScheduleBaseDate,
          },
          nextMessages,
        );
        persistDurationMs = Math.round(performance.now() - persistStartedAt);
      }

      await completeChatReplay({
        userId: authedReq.authUser.id,
        requestId: replayRequestId,
        state: savedState,
        reply: aiResult.text,
      });
      replayCompleted = true;

      await recordUsageEvent({
        userId: authedReq.authUser.id,
        channel: 'text',
        route: {
          ...selectedRoute,
          model: aiResult.usage.model,
        },
        success: true,
        inputTokens: aiResult.usage.inputTokens,
        outputTokens: aiResult.usage.outputTokens,
      });

      console.info(
        '[agena.chat.metrics]',
        JSON.stringify({
          userId: authedReq.authUser.id,
          intent: selectedIntent,
          routeClass: selectedIntent,
          modelTier: selectedRoute?.modelTier ?? 'fast',
          provider: aiResult.usage.provider,
          model: aiResult.usage.model,
          plannerMutation: shouldReschedule,
          classifyMs: classifyDurationMs,
          modelMs: modelDurationMs,
          solverMs: solveDurationMs,
          persistMs: persistDurationMs,
          totalMs: Math.round(performance.now() - requestStartedAt),
          taskCount: nextTasks.length,
          eventCount: nextCalendarEvents.length,
          dependencyCount: nextDependencies.length,
        }),
      );

      if (aiResult.performedWebSearch) {
        await recordUsageEvent({
          userId: authedReq.authUser.id,
          channel: 'web_search',
          route: {
            provider: 'tavily',
            model: 'search-basic-or-advanced',
            modelTier: 'heavy',
          },
          success: true,
          countAsTextRequest: false,
        });
      }

      if (streamRequested) {
        writeStreamEvent(res, {
          type: 'result',
          reply: aiResult.text,
          state: savedState,
        });
        res.end();
      } else {
        res.json({
          reply: aiResult.text,
          state: savedState,
        });
      }
    } catch (error) {
      if (replayRequestId && replayReservationOwned && !replayCompleted) {
        try {
          await releasePendingChatReplay(authedReq.authUser.id, replayRequestId);
        } catch (replayError) {
          console.error('[api/chat] Failed to release chat replay reservation:', replayError);
        }
      }

      if (selectedRoute) {
        try {
          await recordUsageEvent({
            userId: authedReq.authUser.id,
            channel: 'text',
            route: selectedRoute,
            success: false,
            errorCode: parseErrorCode(error),
          });
          if (String(error).includes('Tavily')) {
            await recordUsageEvent({
              userId: authedReq.authUser.id,
              channel: 'web_search',
              route: {
                provider: 'tavily',
                model: 'search-basic-or-advanced',
                modelTier: 'heavy',
              },
              success: false,
              errorCode: parseErrorCode(error),
              countAsTextRequest: false,
            });
          }
        } catch (usageError) {
          console.error('[api/chat] Failed to record failed usage event:', usageError);
        }
      }

      if (streamRequested && res.headersSent) {
        writeStreamEvent(res, {
          type: 'error',
          error: error instanceof Error ? error.message : 'No pude procesar la solicitud.',
        });
        res.end();
        return;
      }

      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isHttpError(error)) {
      res.status(error.status).json({
        error: error.message,
        code: error.code,
      });
      return;
    }

    console.error('[server] Unhandled error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'No pude procesar la solicitud.',
    });
  });

  if (shouldUseViteDevServer()) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  registerLiveVoiceProxy(server);

  const runAutonomousLoop = async () => {
    const users = await listUsersForAutonomousReplanning();
    for (const user of users) {
      const shouldRun =
        user.settings.internalRiskDetectionEnabled ||
        user.settings.googleCalendarEnabled ||
        user.settings.outlookCalendarEnabled;
      if (!shouldRun) continue;
      try {
        await processAutonomousReplanningForUser(user);
      } catch (error) {
        console.error(`Autonomous replanning failed for user ${user.id}:`, error);
      }
    }
  };

  setTimeout(() => {
    runAutonomousLoop().catch((error) => {
      console.error('Initial autonomous replanning run failed:', error);
    });
  }, 15_000);

  setInterval(() => {
    runAutonomousLoop().catch((error) => {
      console.error('Scheduled autonomous replanning run failed:', error);
    });
  }, Number(process.env.REPLANNING_POLL_INTERVAL_MS || 5 * 60 * 1000));

  server.listen(port, '0.0.0.0', () => {
  console.log(`Tandeba server running on http://localhost:${port}`);
  });
};

startServer();
