import type { Server as HttpServer } from 'http';
import { WebSocketServer } from 'ws';

// Voice agent is currently being refactored.
// Stubbed out to allow server compilation.
export const registerLiveVoiceProxy = (_server: HttpServer): void => {
  console.log('[voice] Live voice proxy disabled during refactor.');
};
