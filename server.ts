import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

import { runAgent } from './server/ai.js';
import { requireAuth, type AuthenticatedRequest } from './server/auth.js';
import { solveSchedule, DEFAULT_INTELLIGENT_CONFIG } from './src/lib/solver.js';
import { 
  loadPlannerState, 
  savePlannerState, 
  appendChatMessage 
} from './server/state.js';
import type { PlannerState } from './src/lib/plannerState.js';
import { DEFAULT_PLANNER_STATE } from './src/lib/plannerState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const startServer = async () => {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const server = createServer(app);
  const upload = multer({ storage: multer.memoryStorage() });

  app.use(express.json({ limit: '2mb' }));

  // Healthcheck
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'Tandeba 2.0' }));

  // Load State
  app.get('/api/state', requireAuth, async (req, res, next) => {
    try {
      const state = await loadPlannerState((req as AuthenticatedRequest).authUser);
      res.json({ state });
    } catch (error) { next(error); }
  });

  // Chat / Action Endpoint
  app.post('/api/chat', requireAuth, upload.any(), async (req, res, next) => {
    const authedReq = req as AuthenticatedRequest;
    const { message } = req.body ?? {};

    try {
      // 1. Load current state
      const currentState = await loadPlannerState(authedReq.authUser);
      
      // 2. Prepare history for AI
      const history = (currentState.messages || []).slice(-6).map(m => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.text
      }));

      // 3. Run AI Agent
      const agentResponse = await runAgent({
        userMessage: message,
        history,
        tasks: currentState.tasks,
        calendarEvents: currentState.calendarEvents,
        dependencies: currentState.dependencies,
        schedule: currentState.schedule,
        workWindow: currentState.workWindow,
        strategy: currentState.strategy
      });

      // 4. Detect if changes occurred (Agent returned new lists?)
      const hasChanges = JSON.stringify(currentState.tasks) !== JSON.stringify(agentResponse.tasks) ||
                         JSON.stringify(currentState.calendarEvents) !== JSON.stringify(agentResponse.calendarEvents);

      let savedState;

      if (hasChanges) {
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

      res.json({ state: savedState });
    } catch (error) {
      next(error);
    }
  });

  // Vite / Static Assets
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
  }

  server.listen(port, '0.0.0.0', () => console.log(`Tandeba 2.0 running on port ${port}`));
};

startServer();
