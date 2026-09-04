'use client';

import React, { useCallback, useEffect, useReducer, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  Bot,
  Database,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth-store';
import { useAppStore } from '@/store/app-store';
import { useSettingsStore } from '@/store/settings-store';
import { RoboFace, type RoboStatus } from '@/components/ai/robo-face';
import { subscribeAgentLoop, getAgentJob, getJobVersion, isJobRunning, startAgentJob } from '@/components/ai/agent-loop';
import { toast } from '@/hooks/use-toast';

// ─── Layout constants ────────────────────────────────────────────────────────
const FACE = 76; // face hit-box (px)
const EDGE = 8; // min distance from viewport edges
const POS_KEY = 'asm_robo_pos_v1';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metaRows?: number;
  error?: boolean;
}

interface SessionInfo {
  id: string;
  day: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

function clampPos(p: { x: number; y: number }, vw: number, vh: number) {
  return {
    x: Math.max(EDGE, Math.min(p.x, vw - FACE - EDGE)),
    y: Math.max(EDGE, Math.min(p.y, vh - FACE - EDGE)),
  };
}

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
}

function yesterdayKey(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(d);
}

function dayLabel(day: string): string {
  if (day === todayKey()) return 'Today';
  if (day === yesterdayKey()) return 'Yesterday';
  const [y, m, d] = day.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return day;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Markdown component styling for assistant bubbles. Everything is built to
// survive wide/long content: tables scroll inside the bubble, words wrap,
// nothing overflows the chat panel.
const mdComponents: Components = {
  p: ({ children }) => <p className="mb-1.5 break-words leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="min-w-0 break-words pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="break-words rounded bg-slate-900 px-1 py-0.5 font-mono text-[11px] text-cyan-300">{children}</code>
  ),
  pre: ({ children }) => <pre className="mb-1.5 overflow-x-auto rounded-lg bg-slate-900 p-2 text-[11px] last:mb-0">{children}</pre>,
  table: ({ children }) => (
    <div className="mb-1.5 max-w-full overflow-x-auto rounded-lg border border-slate-600/60 last:mb-0">
      <table className="w-full min-w-[280px] max-w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap border-b border-slate-600/60 bg-slate-700/50 px-2 py-1.5 text-left font-semibold text-white">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-slate-700/50 px-2 py-1.5 align-top break-words">{children}</td>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 underline">{children}</a>
  ),
};

const SUGGESTIONS = [
  'How many employees do we have?',
  'Total fines this year',
  'Show the newest employees',
];

export function RoboAssistant() {
  const { user } = useAuthStore();
  const brandName = useSettingsStore((s) => s.settings.brandName);
  const aiName = useSettingsStore((s) => s.settings.aiName);
  const brandLogo = useSettingsStore((s) => s.settings.brandLogo);

  // ── Positioning / drag state ──
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState({ w: 1280, h: 800 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const posRef = useRef<{ x: number; y: number } | null>(null);

  // ── Chat state ──
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingSession, setLoadingSession] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [status, setStatus] = useState<RoboStatus>('idle');

  const initializedRef = useRef(false);
  const speakingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const notifiedJobRef = useRef<string | null>(null);

  // Agent loop lives OUTSIDE React (module singleton) so remounts / Fast
  // Refresh can't kill an in-flight task. Subscribe + force re-render.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeAgentLoop(forceUpdate), [forceUpdate]);

  const panelW = Math.min(400, Math.max(300, viewport.w - 24));
  const panelH = Math.min(560, Math.max(340, viewport.h - 90));
  const railOverlay = viewport.w < 640;

  // ── Mount: restore position, measure viewport, re-clamp on resize ──
  useEffect(() => {
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setViewport({ w: vw, h: vh });
      setPos((prev) => {
        if (prev) return clampPos(prev, vw, vh);
        // First visit: default = bottom-right corner
        try {
          const raw = localStorage.getItem(POS_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as { x: number; y: number };
            if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
              return clampPos(parsed, vw, vh);
            }
          }
        } catch {
          // ignore corrupt storage
        }
        return { x: vw - FACE - 28, y: vh - FACE - 32 };
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // ── Bootstrap sessions (fresh chat per day) once per page load ──
  const bootstrap = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`/api/ai/sessions?userId=${encodeURIComponent(user.id)}&ensureToday=1`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setSessions(data.data.sessions || []);
        if (data.data.today?.id) {
          setCurrentSessionId(data.data.today.id);
          setMessages(data.data.todayMessages || []);
        }
      }
    } catch {
      // assistant stays closed-safe on failure
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || initializedRef.current) return;
    initializedRef.current = true;
    void bootstrap();
  }, [user?.id, bootstrap]);

  // ── Panel placement — computed from the face position + available space ──
  const placement = useMemo(() => {
    if (!pos) return null;
    const spaceRight = viewport.w - (pos.x + FACE);
    const spaceLeft = pos.x;

    let side: 'right' | 'left';
    if (pos.x + FACE + 12 + panelW <= viewport.w - 12) {
      side = 'right';
    } else if (pos.x - 12 - panelW >= 12) {
      side = 'left';
    } else {
      side = spaceRight >= spaceLeft ? 'right' : 'left';
    }
    let left = side === 'right' ? pos.x + FACE + 12 : pos.x - panelW - 12;
    left = Math.max(12, Math.min(left, viewport.w - panelW - 12));

    let below = true;
    let top = pos.y + FACE + 12;
    if (top + panelH > viewport.h - 12) {
      below = false;
      top = pos.y - panelH - 12;
    }
    top = Math.max(12, Math.min(top, viewport.h - panelH - 12));

    return { left, top, side, below };
  }, [pos, viewport, panelW, panelH]);

  // ── Auto-scroll messages ──
  const jobVersion = getJobVersion();
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, open, jobVersion]);

  // ── Escape folds the panel ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => () => {
    if (speakingTimer.current) clearTimeout(speakingTimer.current);
  }, []);

  // ── Drag handlers (pointer events, click vs drag threshold) ──
  const onFacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!pos) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, moved: false };
  };

  const onFacePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!d.moved) setDragging(true);
    d.moved = true;
    const next = clampPos({ x: d.origX + dx, y: d.origY + dy }, window.innerWidth, window.innerHeight);
    posRef.current = next;
    setPos(next);
  };

  const onFacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be released
    }
    if (!d) return;
    if (!d.moved) {
      setOpen((o) => !o); // click → fold/unfold
    } else if (posRef.current) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(posRef.current));
      } catch {
        // ignore
      }
    }
  };

  const onFaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((o) => !o);
    }
  };

  // ── Session helpers ──
  const loadSession = async (sessionId: string) => {
    if (!user?.id || sending) return;
    setLoadingSession(true);
    try {
      const res = await fetch(
        `/api/ai/sessions?userId=${encodeURIComponent(user.id)}&sessionId=${encodeURIComponent(sessionId)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (data.success) {
        setCurrentSessionId(sessionId);
        setMessages(
          (data.data.messages || []).map((m: { id: string; role: string; content: string; createdAt: string }) => ({
            id: m.id,
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
            createdAt: m.createdAt,
          }))
        );
      }
      if (railOverlay) setRailOpen(false);
    } catch {
      // keep current view
    } finally {
      setLoadingSession(false);
    }
  };

  // ── Send ──
  // Thin: starts the module-level agent job (survives remounts) and returns.
  // All rendering/notify side effects flow through the subscription above and
  // the completion effect below.
  const send = (raw?: string) => {
    const content = (raw ?? input).trim();
    if (!content || !currentSessionId || !user?.id) return;
    if (isJobRunning(currentSessionId)) return;
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setInput('');
    startAgentJob(user.id, currentSessionId, content, useAppStore.getState().currentView);
  };

  // ── Agent job completion: fold messages into the transcript, update the
  //    session rail, notify the user, make the face speak.
  useEffect(() => {
    const j = getAgentJob();
    if (!j || j.status === 'running' || notifiedJobRef.current === j.id) return;
    notifiedJobRef.current = j.id;
    if (j.sessionId !== currentSessionId) return;

    const ids = new Set(j.messages.map((m) => m.id));
    setMessages((m) => [...m.filter((x) => !ids.has(x.id)), ...j.messages]);
    if (j.sessionPatch) {
      setSessions((ss) => {
        const target = ss.find((s) => s.id === j.sessionId);
        const updated: SessionInfo = target
          ? { ...target, title: j.sessionPatch?.title || target.title, updatedAt: j.sessionPatch?.updatedAt || target.updatedAt }
          : {
              id: j.sessionId,
              day: j.sessionPatch?.day || todayKey(),
              title: (j.sessionPatch?.title || 'New chat').slice(0, 48),
              updatedAt: j.sessionPatch?.updatedAt || new Date().toISOString(),
              messageCount: 2,
            };
        return [updated, ...ss.filter((s) => s.id !== j.sessionId)];
      });
    }
    if (!open || j.agentSteps > 0) {
      const last = [...j.messages].reverse().find((m) => m.role === 'assistant' && !m.error);
      toast({
        title: j.agentSteps > 0 ? `${aiName || 'Nova'} finished your task` : `${aiName || 'Nova'} replied`,
        description: (last?.content || '').replace(/[#*`>|]/g, '').trim().slice(0, 90) || 'Open the chat to read it.',
      });
    }
    setStatus('speaking');
    if (speakingTimer.current) clearTimeout(speakingTimer.current);
    speakingTimer.current = setTimeout(() => setStatus('idle'), 2200);
  }, [jobVersion, currentSessionId, open, aiName]);

  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // Group sessions by day for the rail.
  const groupedSessions = useMemo(() => {
    const groups: Array<{ label: string; items: SessionInfo[] }> = [];
    for (const s of sessions) {
      const label = dayLabel(s.day);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(s);
      else groups.push({ label, items: [s] });
    }
    return groups;
  }, [sessions]);

  // Merge persisted history with live agent-job messages (deduped by id —
  // a mid-job remount reloads persisted copies of the same step messages).
  const activeJob = getAgentJob();
  const jobForSession = activeJob && activeJob.sessionId === currentSessionId ? activeJob : null;
  const sending = !!jobForSession && jobForSession.status === 'running';
  const faceStatus: RoboStatus = sending ? 'thinking' : status;
  const visible = useMemo(() => {
    if (!jobForSession) return messages;
    const ids = new Set(jobForSession.messages.map((m) => m.id));
    return [...messages.filter((m) => !ids.has(m.id)), ...jobForSession.messages];
    // jobVersion bumps whenever the job mutates — recompute then.
  }, [messages, currentSessionId, jobVersion]);

  if (!user || !pos) return null;

  const transformOrigin = `${placement?.side === 'right' ? 'left' : 'right'} ${placement?.below ? 'top' : 'bottom'}`;

  return (
    <>
      {/* ── Chat panel ── */}
      <AnimatePresence>
        {open && placement && (
          <motion.div
            key="asm-ai-chat"
            data-asm-assistant
            className="fixed z-[60] flex overflow-hidden rounded-2xl border border-slate-600/70 bg-slate-800/95 shadow-2xl shadow-black/50 backdrop-blur-md"
            style={{ left: placement.left, top: placement.top, width: panelW, height: panelH, transformOrigin }}
            initial={{ opacity: 0, scale: 0.55, x: placement.side === 'right' ? -26 : 26, y: placement.below ? -20 : 20 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.55, x: placement.side === 'right' ? -26 : 26, y: placement.below ? -20 : 20 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            role="dialog"
            aria-label="AI assistant chat"
          >
            {/* Session rail (overlay-style on narrow screens) */}
            {railOpen && (
              <div
                className={cn(
                  'flex w-44 shrink-0 flex-col border-r border-slate-700 bg-slate-900/80',
                  railOverlay && 'absolute inset-y-0 left-0 z-10 shadow-2xl'
                )}
              >
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Chats</span>
                  <span className="text-[10px] text-slate-500">{sessions.length}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                  {loadingSession && (
                    <div className="flex items-center gap-2 px-2 py-2 text-xs text-slate-500">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                    </div>
                  )}
                  {groupedSessions.map((group) => (
                    <div key={group.label} className="mb-2">
                      <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        {group.label}
                      </p>
                      {group.items.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => void loadSession(s.id)}
                          className={cn(
                            'mb-0.5 w-full rounded-lg px-2 py-1.5 text-left transition-colors',
                            s.id === currentSessionId
                              ? 'bg-blue-500/15 text-blue-300'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          )}
                        >
                          <span className="block truncate text-xs font-medium">{s.title}</span>
                          <span className="block text-[10px] text-slate-500">{s.messageCount} messages</span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {sessions.length === 0 && !loadingSession && (
                    <p className="px-2 py-3 text-[11px] text-slate-500">No chats yet — say hello below.</p>
                  )}
                </div>
              </div>
            )}

            {/* Main column */}
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Header */}
              <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-700 bg-slate-900/70 px-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-500/15">
                  {brandLogo ? (
                     
                    <img src={brandLogo} alt="" className="h-5 w-5 rounded object-contain" />
                  ) : (
                    <Bot className="h-4 w-4 text-cyan-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{aiName || 'Nova'}</p>
                  <p className="text-[10px] leading-tight text-slate-400">
                    {sending ? 'Thinking…' : `Your ${brandName || 'ASM'} companion — online`}
                  </p>
                </div>
                <button
                  onClick={() => setRailOpen((r) => !r)}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-700 hover:text-white',
                    railOpen && !railOverlay && 'bg-slate-700 text-white'
                  )}
                  title={railOpen ? 'Hide chat history' : 'Show chat history'}
                  aria-label="Toggle chat history"
                >
                  {railOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
                  title="Fold chat"
                  aria-label="Close chat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {visible.length === 0 && !sending && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <RoboFace size={64} status="idle" />
                    <div>
                      <p className="text-sm font-semibold text-white">Hi, I&apos;m {aiName || 'Nova'} 👋</p>
                      <p className="mx-auto mt-1 max-w-[260px] text-xs text-slate-400">
                        I know our workforce inside out — employees, attendance, salaries, fines, camps and more.
                        Ask me anything and I&apos;ll pull the numbers straight from our database.
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => void send(s)}
                          className="rounded-full border border-slate-600 bg-slate-700/50 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {visible.map((m) =>
                  m.role === 'user' ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-blue-600 px-3.5 py-2 text-sm text-white shadow-sm">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex justify-start">
                      <div
                        className={cn(
                          'max-w-[88%] overflow-hidden rounded-2xl rounded-bl-md px-3.5 py-2 text-sm shadow-sm',
                          m.error
                            ? 'border border-red-500/30 bg-red-500/10 text-red-300'
                            : 'border border-slate-600/60 bg-slate-700/50 text-slate-100'
                        )}
                      >
                        {m.error ? (
                          <span className="flex items-start gap-2">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{m.content}</span>
                          </span>
                        ) : (
                          <>
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                              {m.content}
                            </ReactMarkdown>
                            {!!m.metaRows && (
                              <div className="mt-1.5 flex items-center gap-1 border-t border-slate-600/40 pt-1.5 text-[10px] text-emerald-400/90">
                                <Database className="h-3 w-3" />
                                Fetched {m.metaRows} row{m.metaRows === 1 ? '' : 's'} from the database
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )
                )}

                {sending && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-600/60 bg-slate-700/50 px-3.5 py-2.5">
                      <span className="asm-robo-dot h-1.5 w-1.5 rounded-full bg-cyan-400" />
                      <span className="asm-robo-dot h-1.5 w-1.5 rounded-full bg-cyan-400" style={{ animationDelay: '0.15s' }} />
                      <span className="asm-robo-dot h-1.5 w-1.5 rounded-full bg-cyan-400" style={{ animationDelay: '0.3s' }} />
                      <span className="ml-1 text-xs text-slate-400">querying the database…</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="shrink-0 border-t border-slate-700 p-2.5">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={onInputChange}
                    onKeyDown={onInputKeyDown}
                    rows={1}
                    maxLength={4000}
                    placeholder="Ask about employees, salaries, attendance…"
                    className="max-h-[110px] min-h-[38px] flex-1 resize-none rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500/60 focus:outline-none"
                  />
                  <button
                    onClick={() => void send()}
                    disabled={sending || !input.trim()}
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all',
                      sending || !input.trim()
                        ? 'cursor-not-allowed bg-slate-700 text-slate-500'
                        : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                    )}
                    title="Send (Enter)"
                    aria-label="Send message"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1 px-1 text-[10px] text-slate-500">
                  Enter to send · Shift+Enter for a new line · drag the robot anywhere
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Draggable robo face ── */}
      <div
        data-asm-assistant
        role="button"
        tabIndex={0}
        aria-label="AI assistant — click to open chat, drag to move"
        onPointerDown={onFacePointerDown}
        onPointerMove={onFacePointerMove}
        onPointerUp={onFacePointerUp}
        onPointerCancel={onFacePointerUp}
        onKeyDown={onFaceKeyDown}
        className={cn(
          'fixed z-[70] cursor-grab touch-none rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-cyan-400/70',
          dragging && 'cursor-grabbing'
        )}
        style={{ left: pos.x, top: pos.y, width: FACE, height: FACE }}
        title="AI Assistant"
      >
        {/* Halo glow */}
        <div
          className={cn(
            'pointer-events-none absolute inset-1 rounded-full transition-opacity',
            open ? 'opacity-100' : 'opacity-60'
          )}
          style={{ boxShadow: '0 0 26px 4px rgba(34,211,238,0.35)' }}
        />
        <RoboFace size={FACE} status={faceStatus} className="pointer-events-none" />
      </div>
    </>
  );
}
