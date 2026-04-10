/**
 * Telemetry Service (Mock for Production)
 * Captures metrics, errors, and performance data for the scheduling engine.
 */

export interface SolverTelemetryEvent {
  event: 'solver_execution';
  durationMs: number;
  taskCount: number;
  strategy: string;
  status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'TIMEOUT' | 'INVALID_INPUT';
  configUsed: Record<string, any>;
  error?: string;
  timestamp: string;
}

class TelemetryService {
  private events: any[] = [];

  trackSolverExecution(data: Omit<SolverTelemetryEvent, 'event' | 'timestamp'>) {
    const event: SolverTelemetryEvent = {
      ...data,
      event: 'solver_execution',
      timestamp: new Date().toISOString(),
    };
    
    this.events.push(event);
    
    // In production, this would be sent to Datadog, New Relic, or an ELK stack.
    console.log('[Telemetry] Solver Event Tracked:', JSON.stringify(event));
    
    // Alerting threshold: If solver takes more than 2 seconds, flag it.
    if (data.durationMs > 2000) {
      console.warn(`[Telemetry Alert] Solver execution degraded: ${data.durationMs}ms for ${data.taskCount} tasks.`);
    }
  }

  getRecentEvents() {
    return this.events.slice(-50);
  }
}

export const telemetry = new TelemetryService();
