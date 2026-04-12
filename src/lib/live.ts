import type { CalendarEvent, Dependency, ScheduledTask, Task, WorkWindow } from './solver';
import type { PlannerState, SearchSource } from './plannerState';

type LiveStatus = 'disconnected' | 'connecting' | 'connected';

type ClientEnvelope =
  | {
      type: 'auth';
      payload: {
        accessToken: string;
        context: {
          messages: PlannerState['messages'];
          tasks: Task[];
          calendarEvents: CalendarEvent[];
          dependencies: Dependency[];
          workWindow: WorkWindow;
          strategy: 'balanced' | 'survival' | 'intelligent';
          currentSchedule?: ScheduledTask[] | null;
        };
      };
    }
  | {
      type: 'context';
      payload: {
        messages: PlannerState['messages'];
        tasks: Task[];
        calendarEvents: CalendarEvent[];
        dependencies: Dependency[];
        workWindow: WorkWindow;
        strategy: 'balanced' | 'survival' | 'intelligent';
        currentSchedule?: ScheduledTask[] | null;
      };
    }
  | {
      type: 'audio';
      payload: {
        data: string;
        mimeType: string;
      };
    }
  | {
      type: 'disconnect';
    };

type ServerEnvelope =
  | { type: 'status'; payload: { status: LiveStatus } }
  | { type: 'audio'; payload: { data: string } }
  | { type: 'state'; payload: { state: PlannerState } }
  | { type: 'search_progress'; payload: { message: string; sources: SearchSource[] } }
  | { type: 'error'; payload: { message: string } };

function bufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function resolveLiveSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/live`;
}

export class LiveAgent {
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private playbackContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private nextPlayTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private isDisconnecting = false;
  private shouldStayConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private hasOpenedSocket = false;

  constructor(
    private onStateSync: (state: PlannerState) => void,
    private onStatusChange: (status: LiveStatus) => void,
    private getAccessToken: () => Promise<string | null>,
    private context: {
      messages: PlannerState['messages'];
      tasks: Task[];
      calendarEvents: CalendarEvent[];
      dependencies: Dependency[];
      workWindow: WorkWindow;
      strategy: 'balanced' | 'survival' | 'intelligent';
      currentSchedule?: ScheduledTask[] | null;
    },
    private onSearchProgress: (payload: { message: string; sources: SearchSource[] } | null) => void,
    private onError: (message: string) => void,
  ) {}

  updateContext(
    messages: PlannerState['messages'],
    tasks: Task[],
    calendarEvents: CalendarEvent[],
    dependencies: Dependency[],
    workWindow: WorkWindow,
    strategy: 'balanced' | 'survival' | 'intelligent',
    currentSchedule?: ScheduledTask[] | null,
  ) {
    this.context = { messages, tasks, calendarEvents, dependencies, workWindow, strategy, currentSchedule };
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({
        type: 'context',
        payload: this.context,
      });
    }
  }

  async connect() {
    this.shouldStayConnected = true;
    this.isDisconnecting = false;
    this.onStatusChange('connecting');
    try {
      if (!this.mediaStream) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      }
      if (!this.audioContext) {
        this.audioContext = new AudioContext({ sampleRate: 16000 });
      }
      if (!this.playbackContext) {
        this.playbackContext = new AudioContext({ sampleRate: 24000 });
        this.nextPlayTime = this.playbackContext.currentTime;
      }

      this.socket = new WebSocket(resolveLiveSocketUrl());
      this.socket.onopen = async () => {
        this.hasOpenedSocket = true;
        this.reconnectAttempts = 0;
        if (this.reconnectTimer !== null) {
          window.clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        const accessToken = await this.getAccessToken();
        if (!accessToken) {
          this.onError('Tu sesión ya no es válida. Vuelve a iniciar sesión.');
          this.disconnect(false);
          return;
        }

        this.send({
          type: 'auth',
          payload: {
            accessToken,
            context: this.context,
          },
        });
      };

      this.socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerEnvelope;
        if (message.type === 'status') {
          this.onStatusChange(message.payload.status);
          if (message.payload.status === 'connected' && !this.processor) {
            this.startRecording();
          }
          return;
        }

        if (message.type === 'audio') {
          this.onSearchProgress(null);
          this.playAudio(message.payload.data);
          return;
        }

        if (message.type === 'state') {
          this.onSearchProgress(null);
          this.onStateSync(message.payload.state);
          return;
        }

        if (message.type === 'search_progress') {
          this.onSearchProgress(message.payload);
          return;
        }

        if (message.type === 'error') {
          this.onError(message.payload.message);
          return;
        }
      };

      this.socket.onclose = () => {
        if (this.isDisconnecting) {
          return;
        }
        this.handleUnexpectedClose();
      };

      this.socket.onerror = () => {
        console.error('[live] WebSocket transport error');
      };
    } catch (error) {
      console.error('Failed to connect live agent:', error);
      this.onError('No pude acceder al micrófono o abrir la llamada.');
      this.disconnect(false);
    }
  }

  private handleUnexpectedClose() {
    this.cleanupSocketOnly();
    this.onStatusChange('disconnected');

    if (!this.shouldStayConnected) {
      return;
    }

    if (this.reconnectAttempts >= 2) {
      this.onSearchProgress(null);
      this.onError('La llamada se interrumpió durante una actualización de Tandeba. Recarga la página para continuar.');
      return;
    }

    const retryDelayMs = 1000 * (this.reconnectAttempts + 1);
    this.reconnectAttempts += 1;
    this.onError('Reconectando la llamada tras una actualización de Tandeba...');
    this.onStatusChange('connecting');
    this.reconnectTimer = window.setTimeout(() => {
      this.connect().catch((error) => {
        console.error('Failed to reconnect live agent:', error);
      });
    }, retryDelayMs);
  }

  private cleanupSocketOnly() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket = null;
    }
  }

  private send(message: ClientEnvelope) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private startRecording() {
    if (!this.audioContext || !this.mediaStream) return;
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        pcm16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
      }

      this.send({
        type: 'audio',
        payload: {
          data: bufferToBase64(pcm16.buffer),
          mimeType: 'audio/pcm;rate=16000',
        },
      });
    };
  }

  private playAudio(base64Audio: string) {
    if (!this.playbackContext) return;

    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer);

    const audioBuffer = this.playbackContext.createBuffer(1, pcm16.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) {
      channelData[i] = pcm16[i] / 32768;
    }

    const source = this.playbackContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.playbackContext.destination);

    const startTime = Math.max(this.playbackContext.currentTime, this.nextPlayTime);
    source.start(startTime);
    this.nextPlayTime = startTime + audioBuffer.duration;

    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter((item) => item !== source);
    };
  }

  disconnect(sendSignal = true) {
    this.isDisconnecting = true;
    this.shouldStayConnected = false;
    this.onStatusChange('disconnected');
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (sendSignal && this.socket?.readyState === WebSocket.OPEN) {
      this.send({ type: 'disconnect' });
    }

    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // ignore
      }
    });
    this.activeSources = [];
    this.onSearchProgress(null);

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.playbackContext) {
      this.playbackContext.close();
      this.playbackContext = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.reconnectAttempts = 0;
    this.hasOpenedSocket = false;
    this.isDisconnecting = false;
  }
}

