/**
 * HELIX AI Engineering Operating System — Observability & Tracing
 * Records execution spans, metrics, token counts, durations, and tool calls.
 * Provides an event emitter for real-time SSE streaming to the frontend AI Office.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export class ObservabilityService extends EventEmitter {
  constructor() {
    super();
    this.traces = []; // in-memory trace buffer
    this.maxTraces = 1000;
  }

  /**
   * Starts a new trace span for an agent task execution.
   */
  startSpan({ workflowId, taskId, agentRole, taskTitle }) {
    const spanId = `span_${randomUUID()}`;
    const span = {
      spanId,
      workflowId,
      taskId,
      agentRole,
      taskTitle,
      startTime: Date.now(),
      status: 'running',
      toolsCalled: [],
      model: null,
      provider: null,
      durationMs: 0,
      error: null,
      artifactsCreated: [],
    };

    this.emitEvent('span_started', span);
    return span;
  }

  /**
   * Records a tool call made during the span.
   */
  recordToolCall(span, { toolName, args, result, durationMs }) {
    const record = {
      toolName,
      args: typeof args === 'object' ? JSON.stringify(args).slice(0, 200) : String(args),
      durationMs,
      timestamp: new Date().toISOString(),
    };
    span.toolsCalled.push(record);
    this.emitEvent('tool_called', { spanId: span.spanId, ...record });
  }

  /**
   * Concludes a span with successful output or error.
   */
  endSpan(span, { status = 'completed', model, provider, usage, error = null, artifacts = [] } = {}) {
    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.status = status;
    span.model = model || span.model;
    span.provider = provider || span.provider;
    span.usage = usage || null;
    span.error = error ? (error.message || String(error)) : null;
    span.artifactsCreated = (artifacts || []).map((a) => a.path || a.name);

    this.traces.push(span);
    if (this.traces.length > this.maxTraces) {
      this.traces.shift();
    }

    this.emitEvent('span_completed', span);
    return span;
  }

  /**
   * Emits workflow-level state change events (subscribed by SSE handlers).
   */
  emitEvent(type, payload) {
    const event = {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      payload,
    };
    this.emit('workflow_event', event);
    return event;
  }

  /**
   * Queries traces by workflow ID.
   */
  getTracesForWorkflow(workflowId) {
    return this.traces.filter((t) => t.workflowId === workflowId);
  }

  /**
   * Aggregates telemetry metrics for a workflow.
   */
  getWorkflowMetrics(workflowId) {
    const workflowTraces = this.getTracesForWorkflow(workflowId);
    const totalDurationMs = workflowTraces.reduce((acc, t) => acc + t.durationMs, 0);
    const completedCount = workflowTraces.filter((t) => t.status === 'completed').length;
    const failedCount = workflowTraces.filter((t) => t.status === 'failed').length;

    return {
      workflowId,
      totalSpans: workflowTraces.length,
      completed: completedCount,
      failed: failedCount,
      totalDurationMs,
      agentBreakdown: workflowTraces.map((t) => ({
        agent: t.agentRole,
        model: t.model,
        durationMs: t.durationMs,
        status: t.status,
      })),
    };
  }
}

export const globalObservability = new ObservabilityService();
