'use client';

// Remount-proof agent loop runner.
//
// The agent loop (send question → model returns action → execute in page →
// feed observation back → …) used to live inside the React component, so any
// remount (dev Fast Refresh when a newly-visited page lazy-compiles, Strict
// Mode, future layout changes) silently killed the in-flight loop. It now
// runs in a module-level singleton job that:
//
//   • keeps producing messages no matter what happens to the UI tree,
//   • notifies subscribers after every change (they re-render on force),
//   • lets the component re-attach at any time and merge job messages into
//     the visible transcript (deduped by id against server-persisted copies).

import { useAppStore } from '@/store/app-store';
import { useSettingsStore } from '@/store/settings-store';
import { executeAgentAction, type AgentAction } from '@/components/ai/agent-actions';

export interface AgentLoopMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metaRows?: number;
  error?: boolean;
}

export type AgentJobStatus = 'running' | 'done' | 'failed';

export interface AgentJob {
  id: string;
  userId: string;
  sessionId: string;
  messages: AgentLoopMessage[];
  status: AgentJobStatus;
  agentSteps: number;
  error?: string;
  sessionPatch: { title?: string; updatedAt?: string; day?: string } | null;
}

// Generous cap: NOC-sized tasks run through the one-shot noc_create macro,
// but free-form multi-step flows (open → read → click → fill → …) still need
// headroom. The guard pauses gracefully and offers "continue" when tripped.
const MAX_STEPS = 40;

let activeJob: AgentJob | null = null;
let version = 0;
const listeners = new Set<() => void>();

const emit = () => {
  version += 1;
  listeners.forEach((l) => l());
};

export function subscribeAgentLoop(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getAgentJob(): AgentJob | null {
  return activeJob;
}

/** Monotonic counter bumped on every job change — use as an effect dep. */
export function getJobVersion(): number {
  return version;
}

/** True when a job is running for this session (blocks the composer). */
export function isJobRunning(sessionId: string): boolean {
  return !!activeJob && activeJob.status === 'running' && activeJob.sessionId === sessionId;
}

function push(job: AgentJob, msg: AgentLoopMessage): void {
  job.messages.push(msg);
  emit();
}

// Notification-center integration: when the agent actually DID work (navigated,
// clicked, filled forms), the finished/paused task also lands in the user's
// notification feed — so it is visible even if the chat panel was folded.
function notifyCompletion(job: AgentJob, paused: boolean): void {
  if (job.agentSteps === 0) return; // plain chat replies never create feed noise
  const last = [...job.messages].reverse().find((m) => m.role === 'assistant' && !m.error);
  const preview =
    (last?.content || '').replace(/[#*`>|]/g, '').trim().slice(0, 140) ||
    (paused ? 'The task is partially done.' : 'Open the chat to read the result.');
  const assistantName = useSettingsStore.getState().settings.aiName || 'Nova';
  void fetch('/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: job.userId,
      title: paused ? `${assistantName} paused your task` : `${assistantName} finished your task`,
      message: preview,
      type: 'agent',
    }),
  }).catch(() => undefined); // never break the chat over a feed failure
}

export function startAgentJob(
  userId: string,
  sessionId: string,
  content: string,
  view: string
): AgentJob | null {
  if (activeJob && activeJob.status === 'running') return activeJob;
  const job: AgentJob = {
    id: `job-${Date.now()}`,
    userId,
    sessionId,
    messages: [{ id: `tmp-${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString() }],
    status: 'running',
    agentSteps: 0,
    sessionPatch: null,
  };
  activeJob = job;
  emit();
  void runJob(job, content, view);
  return job;
}

async function runJob(job: AgentJob, content: string, _initialView: string): Promise<void> {
  let observation: string | null = null;
  let firstTurn = true;
  // Loop circuit-breaker: weak models sometimes repeat the same mutating
  // action forever (e.g. filling a field whose value was never provided).
  // After 3 identical consecutive mutating steps the job pauses gracefully
  // instead of burning the step budget. read/wait are exempt — legitimate
  // flows re-read while waiting for data.
  const GUARDED_TYPES = new Set(['fill', 'select', 'click', 'toggle', 'navigate', 'press_key']);
  let lastSig: string | null = null;
  let repeats = 0;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: job.userId,
          sessionId: job.sessionId,
          ...(firstTurn ? { content } : {}),
          ...(observation !== null ? { observation } : {}),
          view: useAppStore.getState().currentView,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        push(job, {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: data.error || 'The AI provider could not be reached. Check the AI_API_TOKEN env settings.',
          createdAt: new Date().toISOString(),
          error: true,
        });
        job.error = data.error || 'provider error';
        job.status = 'failed';
        emit();
        return;
      }
      const d = data.data;
      if (firstTurn && d.userMessage) {
        // Swap the optimistic bubble for the persisted one.
        job.messages = job.messages.map((m) =>
          m.id.startsWith('tmp-')
            ? { id: d.userMessage.id, role: 'user', content: d.userMessage.content, createdAt: d.userMessage.createdAt }
            : m
        );
        emit();
      }
      if (d.session) job.sessionPatch = d.session;
      firstTurn = false;

      if (d.action) {
        const sig = JSON.stringify(d.action);
        if (sig === lastSig && GUARDED_TYPES.has((d.action as { type?: string }).type || '')) {
          repeats += 1;
        } else {
          repeats = 0;
          lastSig = sig;
        }
        if (repeats >= 2) {
          // Third consecutive identical mutating action — stop looping.
          push(job, {
            id: `loop-${Date.now()}`,
            role: 'assistant',
            content:
              '⏸️ I stopped because I caught myself repeating the same step without progress — that usually means a value I need was not provided, or the element I am targeting does not exist. Tell me the value to use (or say "continue" to let me try again).',
            createdAt: new Date().toISOString(),
          });
          job.status = 'done';
          notifyCompletion(job, true);
          emit();
          return;
        }
        job.agentSteps += 1;
        push(job, {
          id: d.assistantMessage.id,
          role: 'assistant',
          content: d.assistantMessage.content,
          createdAt: d.assistantMessage.createdAt,
        });
        observation = await executeAgentAction(d.action as AgentAction);
        continue;
      }

      // ── Final answer ──
      push(job, {
        id: d.assistantMessage.id,
        role: 'assistant',
        content: d.assistantMessage.content,
        createdAt: d.assistantMessage.createdAt,
        metaRows: d.meta?.rowsFetched || 0,
      });
      job.status = 'done';
      notifyCompletion(job, false);
      emit();
      return;
    }

    // Step guard tripped — hand control back gracefully.
    push(job, {
      id: `pause-${Date.now()}`,
      role: 'assistant',
      content: '⏸️ I paused — the task is partially done (I ran out of steps, the form may be half-filled). Say "continue" and I will pick up right where I left off.',
      createdAt: new Date().toISOString(),
    });
    job.status = 'done';
    notifyCompletion(job, true);
    emit();
  } catch {
    push(job, {
      id: `err-${Date.now()}`,
      role: 'assistant',
      content: 'Network error — the assistant could not be reached. Please try again.',
      createdAt: new Date().toISOString(),
      error: true,
    });
    job.error = 'network error';
    job.status = 'failed';
    emit();
  }
}

// Read-only E2E debug hook.
if (typeof window !== 'undefined') {
  (window as unknown as { __asmAgentDebug?: () => unknown }).__asmAgentDebug = () =>
    activeJob
      ? { id: activeJob.id, status: activeJob.status, steps: activeJob.agentSteps, messages: activeJob.messages.length, sessionId: activeJob.sessionId }
      : null;
}
