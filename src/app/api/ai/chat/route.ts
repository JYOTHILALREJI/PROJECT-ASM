import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { callLLM, extractJsonObject, credentialsFromMap, type LlmMessage } from '@/lib/ai-client';
import { getDbSchemaDoc } from '@/lib/db-schema-doc';
import { APP_UI_MAP, AGENT_VIEWS, VIEW_LABELS } from '@/lib/app-ui-map';
import { isAiAllowed, AI_ACCESS_DENIED } from '@/lib/ai-access';

// AI Assistant chat endpoint — two-pass "grounded SQL" flow + in-app agent.
//
//   Pass 1 (planner): the model sees the live SQLite schema, the app UI map and
//   the conversation, and replies with exactly ONE of:
//     {"sql":"SELECT …"} or {"sql":[…]}   — data needed (read-only SQL)
//     {"answer":"…"}                       — final text (also used to ask the
//                                            user for missing task details)
//     {"action":{…},"thought":"…"}         — one in-app agent step (navigate /
//                                            read / click / fill / select / wait)
//
//   If SQL is produced it is safety-checked (single read-only statement), run
//   with a hard row cap, and the results are fed to pass 2 (responder) which
//   writes the final companion-voiced answer.
//
//   Agent steps are executed CLIENT-SIDE (robo-assistant + agent-actions.ts):
//   the client runs the action inside the page DOM and calls this endpoint
//   again with an "observation". Observations are never persisted — only real
//   user messages and assistant step/answer messages are stored, so the loop
//   survives folds and reloads. The agent can NEVER leave the app: navigation
//   is whitelisted to AGENT_VIEWS and clicks/fills are confined to the page DOM.
//
// Every exchange is persisted to AiChatMessage so the chat survives reloads,
// folds, and re-opens with full history.

const MAX_CONTENT = 4000;
const MAX_OBSERVATION = 4000;
const HISTORY_LIMIT = 20;
const ROW_CAP = 200;
const OBSERVATION_CAP = 8000;

// Only single read-only statements are allowed.
const SQL_START_RE = /^\s*(select|with)\b/i;
const SQL_FORBIDDEN_RE = /\b(insert|update|delete|drop|alter|create|replace|pragma|attach|detach|vacuum|begin|commit|rollback|grant|revoke|reindex)\b/i;

function sanitizeSql(raw: string): string | null {
  let sql = raw.trim().replace(/^```(?:sql)?/i, '').replace(/```$/, '').trim();
  if (sql.endsWith(';')) sql = sql.slice(0, -1).trim();
  if (!sql || !SQL_START_RE.test(sql)) return null;
  if (SQL_FORBIDDEN_RE.test(sql)) return null;
  if (sql.includes(';')) return null; // multi-statement → reject
  if (sql.length > 4000) return null;
  return sql;
}

/** Run a read-only query with a guaranteed row cap. */
async function runReadonlyQuery(sql: string): Promise<Record<string, unknown>[]> {
  // Wrap so a LIMIT always applies even if the model forgot one. Wrapping a
  // WITH…SELECT inside a subquery is legal in SQLite; ORDER BY is preserved.
  const wrapped = `SELECT * FROM (${sql}) LIMIT ${ROW_CAP + 1}`;
  const rows = (await db.$queryRawUnsafe(wrapped)) as Record<string, unknown>[];
  return redactSecrets(rows.slice(0, ROW_CAP));
}

/**
 * Secrets never reach the model, not even accidentally via SELECT * FROM
 * AppSetting: the saved model-provider API key is redacted before the rows
 * are serialized into the planner/responder observations.
 */
function redactSecrets(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const r = { ...row } as Record<string, unknown>;
    if (String(r.key ?? '').toLowerCase() === 'aiapikey') {
      r.value = '[redacted — the API key is server-side only]';
    }
    for (const k of Object.keys(r)) {
      if (k.toLowerCase().includes('apikey')) r[k] = '[redacted]';
    }
    return r;
  });
}

// ── Agent action validation ──────────────────────────────────────────────────
// The planner may request exactly one small in-app step per reply. Everything
// is whitelisted here before it ever reaches the client: navigation only to
// known screens, bounded strings, capped waits. The client executor re-checks
// and additionally confines clicks/fills to the app's own page DOM.

export interface AgentAction {
  type: 'navigate' | 'read' | 'click' | 'fill' | 'select' | 'wait' | 'press_key' | 'toggle' | 'scroll' | 'noc_create';
  view?: string;
  text?: string;
  field?: string;
  value?: string;
  option?: string;
  ms?: number;
  key?: string;
  target?: string;
  dy?: number;
  // noc_create payload — a one-shot, fully-validated NOC draft description
  // extracted VERBATIM from the user's message (client + employees required).
  client?: string;
  project?: string;
  date?: string;
  address1?: string;
  address2?: string;
  city?: string;
  country?: string;
  company?: string;
  employees?: string[];
}

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

function validateAgentAction(raw: unknown): AgentAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const type = typeof a.type === 'string' ? a.type : '';
  switch (type) {
    case 'navigate': {
      const view = clampStr(a.view, 40);
      if (!view || !(AGENT_VIEWS as readonly string[]).includes(view)) return null;
      return { type: 'navigate', view };
    }
    case 'read':
      return { type: 'read' };
    case 'click': {
      const text = clampStr(a.text, 120);
      return text ? { type: 'click', text } : null;
    }
    case 'fill': {
      const field = clampStr(a.field, 120);
      // Value keeps inner spaces exactly; allow up to 400 chars.
      if (!field || typeof a.value !== 'string' || a.value.length > 400) return null;
      return { type: 'fill', field, value: a.value };
    }
    case 'select': {
      const field = clampStr(a.field, 120);
      const option = clampStr(a.option, 120);
      return field && option ? { type: 'select', field, option } : null;
    }
    case 'wait': {
      const ms = typeof a.ms === 'number' && a.ms > 0 ? Math.min(Math.round(a.ms), 2000) : 600;
      return { type: 'wait', ms };
    }
    case 'press_key': {
      const key = clampStr(a.key, 10)?.toLowerCase();
      return key && ['enter', 'escape', 'tab'].includes(key) ? { type: 'press_key', key } : null;
    }
    case 'toggle': {
      const field = clampStr(a.field, 120);
      return field ? { type: 'toggle', field } : null;
    }
    case 'scroll': {
      const target = clampStr(a.target, 10);
      const dy = typeof a.dy === 'number' && Math.abs(a.dy) >= 100 ? Math.max(-2000, Math.min(Math.round(a.dy), 2000)) : 700;
      return { type: 'scroll', target: target === 'dialog' ? 'dialog' : 'main', dy };
    }
    case 'noc_create': {
      // One-shot NOC builder: client + at least one employee are required;
      // everything else is optional (date defaults to today on the client).
      const client = clampStr(a.client, 200);
      const employeesRaw = Array.isArray(a.employees) ? a.employees : [];
      const employees = employeesRaw
        .filter((e): e is string => typeof e === 'string' && !!e.trim() && e.trim().length <= 120)
        .map((e) => e.trim())
        .slice(0, 50);
      if (!client || employees.length === 0) return null;
      const opt = (k: 'project' | 'date' | 'address1' | 'address2' | 'city' | 'country' | 'company') => {
        const v = a[k];
        return typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined;
      };
      return {
        type: 'noc_create',
        client,
        employees,
        project: opt('project'),
        date: opt('date'),
        address1: opt('address1'),
        address2: opt('address2'),
        city: opt('city'),
        country: opt('country'),
        company: opt('company'),
      };
    }
    default:
      return null;
  }
}

/** Friendly chat line describing an agent step (persisted as the assistant message). */
function describeAction(action: AgentAction): string {
  switch (action.type) {
    case 'navigate':
      return `⚙️ Opening the **${VIEW_LABELS[action.view ?? ''] ?? action.view}** page…`;
    case 'read':
      return '👀 Taking a look at what\'s on screen…';
    case 'click':
      return `🖱️ Clicking **${action.text}**…`;
    case 'fill':
      return `✍️ Filling **${action.field}**…`;
    case 'select':
      return `🔽 Selecting **${action.option}** in **${action.field}**…`;
    case 'wait':
      return '⏳ Giving the page a moment…';
    case 'press_key':
      return `⌨️ Pressing **${action.key === 'escape' ? 'Esc' : (action.key || '').toUpperCase()}**…`;
    case 'toggle':
      return `☑️ Toggling **${action.field}**…`;
    case 'scroll':
      return action.dy && action.dy < 0 ? '🖱️ Scrolling up…' : '🖱️ Scrolling down…';
    case 'noc_create':
      return `🛠️ Creating the NOC for **${action.client}**${action.project ? ` · ${action.project}` : ''} (${action.employees?.length ?? 0} employees)…`;
  }
}

function truncate(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap)}\n…(truncated)`;
}

/**
 * callLLM with automatic retry on provider rate-limits (HTTP 429). The agent
 * loop makes many calls in bursts — a hard-fail on the first 429 kills a
 * half-done task, so back off briefly and try again (3 attempts total).
 */
async function callLLMR(
  messages: LlmMessage[],
  opts: { temperature: number },
  creds: Parameters<typeof callLLM>[2]
): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callLLM(messages, opts, creds);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : '';
      if (/429|too many requests|rate.?limit/i.test(msg) && attempt < 2) {
        await new Promise((r) => setTimeout(r, attempt === 0 ? 2000 : 5000));
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI provider failed');
}

/**
 * JSON-serialize query rows safely. Prisma raw queries return BigInt for
 * SQLite INTEGER aggregates (COUNT/SUM) — plain JSON.stringify throws on
 * BigInt, so every value passes through a replacer first.
 */
function safeJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => {
      if (typeof v === 'bigint') return Number(v);
      if (v instanceof Date) return v.toISOString();
      if (v instanceof Uint8Array) return `<binary ${v.length} bytes>`;
      return v;
    },
    1
  );
}

function plannerSystemPrompt(
  schemaDoc: string,
  currency: string,
  today: string,
  assistantName: string,
  companyName: string
): string {
  return [
    `You are "${assistantName}", the AI companion inside ${companyName} — a workforce-management web app`,
    'for a manpower company (employees, sites, camps, attendance, salaries, fines, warnings,',
    'advances, leave, cancellations, uniform/materials registry, NOC documents).',
    `You and the user work for the SAME company — this data is "ours": always think "we/our".`,
    `Today's date is ${today} (Asia/Dubai). Money is displayed in ${currency}.`,
    '',
    'You have TWO superpowers: (1) read-only SQL over the app database, and (2) acting as an',
    'AGENT inside the app. You can do EVERYTHING the user could do by hand: move between ALL',
    'menus and pages, open every button, work inside every modal dialog and popup, fill forms,',
    'flip switches and checkboxes, confirm or cancel prompts. You can NEVER go outside the app.',
    '',
    'Reply with ONLY a minified JSON object — no prose, no markdown fences — exactly ONE of:',
    '',
    '1) DATA QUESTION (needs database facts):',
    '   {"sql":"SELECT …"} or {"sql":["SELECT …","SELECT …"],"display":"…"}',
    '   - Each entry: ONE read-only SELECT/WITH. Use ONLY the tables/columns listed below.',
    '   - INSIGHT RULE (mandatory): NEVER answer a "how many / how much" question with a bare number.',
    '     ALWAYS pair the aggregate with a second query that lists the ACTUAL ITEMS with human names and',
    '     useful context columns. People (supervisors, team leaders, workers…): SELECT the person rows',
    '     themselves — fullName + position/trade + their site (currentSite). The user expects names plus',
    '     assigned sites in a table. Sites: name + employee counts. Fines/warnings: date, employee, reason,',
    '     amount. Advances: employee, amount, balance.',
    '     Example — "how many supervisors do we have?" →',
    '       ["SELECT COUNT(*) FROM Employee WHERE isSupervisor = 1 AND deletedAt IS NULL",',
    '        "SELECT employeeId, fullName, position, currentSite FROM Employee WHERE isSupervisor = 1 AND deletedAt IS NULL LIMIT 200"]',
    '     (people flags are boolean columns: isSupervisor / isTeamLeader — do NOT filter by position text).',
    '   - Always include LIMIT (max 200) on row lists; aggregates need none. Prefer WHERE deletedAt IS NULL.',
    '   - LIVE DATA RULE: even if the same (or a similar) question was answered earlier in this',
    '     conversation, NEVER reproduce tables or numbers from history — history can be stale. Reply with',
    '     {"sql":…} again and query the database fresh every time.',
    '   - Include human-readable names/labels — never bare IDs alone.',
    '   - COUNT(*) after a JOIN counts matched pairs, not entities: use separate queries or COUNT(DISTINCT …).',
    '   - Dates are ISO datetime strings or YYYY-MM-DD text; use date(col) when needed. Never guess columns.',
    '   - "display" = how to present the answer, e.g. "markdown table: Name | Position | Site".',
    '',
    '2) AGENT STEP (user asks you to DO something in the app, or needs to find where something is):',
    '   {"action":{…},"thought":"one short sentence why"}',
    '   Action types (ONE per reply — after each you get an [AGENT OBSERVATION] with the result):',
    '     {"type":"navigate","view":"<key>"}      jump to a screen — view key MUST be one from the UI map',
    '     {"type":"read"}                          list everything visible: headings, buttons, form fields',
    '     {"type":"click","text":"Create NOC"}     click the first visible button/tab/link matching this text',
    '     {"type":"fill","field":"Client Name","value":"M/S PROSCAPE LLC"}',
    '                                              type into an input matched by label/placeholder/name',
    '     {"type":"select","field":"Company","option":"PROSCAPE"}  pick an option in a dropdown',
    '     {"type":"press_key","key":"enter"}      press Enter / Escape / Tab (submit, close a modal or popup, move on)',
    '     {"type":"toggle","field":"Notifications"}   flip a checkbox or switch matched by its visible text',
    '     {"type":"scroll","target":"main","dy":700}    scroll the page (or "dialog" — the open modal) to reach below-the-fold content',
    '     {"type":"wait","ms":800}                 wait for animations/data (max 2000)',
    '     {"type":"noc_create","client":"M/S NPC LLC","project":"NPC SHOBHA","date":"05-09-2026","employees":["SEED WORKER 001","SEED WORKER 002"]}',
    '                                              ONE-SHOT NOC BUILDER — see the NOC RULE below.',
    '   NOC RULE: for ANY request to create / prepare / make an NOC ("help me create this NOC", a pasted',
    '     WhatsApp message with client/project/employees…), reply with ONE noc_create action and extract',
    '     EVERY value VERBATIM from the user\u2019s message: client (required), project, date (DD-MM-YYYY — omit',
    '     it entirely if the user gave none; it defaults to today), address/city/country/company when given,',
    '     and employees = the COMPLETE list of employee names (required, up to 50). Do NOT walk the NOC wizard',
    '     manually with navigate/click/fill steps — noc_create does the whole flow (opens the wizard, fills',
    '     every field, adds every employee, generates the NOC) in a single step. If the client name or the',
    '     employee list is missing, ask for it with {"answer":"…"} first.',
    '   Agent rules:',
    '   - FULL COVERAGE: every screen, every button, every modal is within your reach. Multi-step',
    '     tasks are expected — a typical flow is: navigate → read → click (opens a modal) → read',
    '     (the modal\u2019s fields are listed too, with an OPEN MODAL line) → fill/select/toggle each field',
    '     → click the primary save/create button → if a confirmation popup appears ("Are you sure?",',
    '     delete prompts), click its confirm button; if a mistake popup appears, press Escape and retry.',
    '   - Long pages hide elements below the fold: if the button/field you need is not in the read',
    '     output, scroll (target main or dialog) and read again — never claim something does not exist',
    '     before scrolling.',
    '   - Dropdowns that open a search box: the select action types your option into it automatically.',
    '   - TRIGGER: whenever the user asks you to DO something — "open/go to/take me to X", "create an NOC",',
    '     "fill in this form", "click Y for me", "add this employee" — you MUST reply with an ACTION, never',
    '     with text instructions. Only a "where is / how do I" question that does NOT ask you to act gets a',
    '     plain {"answer":…} from the UI map.',
    '   - ONE small step at a time; observe, then decide. After any click, "read" before filling.',
    '   - VALUE FIDELITY (critical): every fill/select/noc_create value MUST be copied VERBATIM from the',
    '     user\u2019s own words. NEVER fill the grey placeholder/example text you see on screen — those are hints,',
    '     not values. NEVER invent names, companies or projects. If a required value was not provided, ask',
    '     with {"answer":"…"} instead of guessing.',
    '   - KEEP GOING: never pause mid-task to ask permission ("shall I continue?") and never stop after a',
    '     few steps — keep issuing actions until the task is truly complete. Stop ONLY when a REQUIRED detail',
    '     is missing (then ask) or the task is finished (then confirm).',
    '   - Fill fields in a logical order, then click the submit/create button only when everything needed is filled.',
    '   - If required details are MISSING (e.g. which company? which employees?), stop and ask with',
    '     {"answer":"…question…"} — list exactly what you need. The user replies, then you resume.',
    '   - When the task is finished, confirm with {"answer":"…"} summarizing what you did (we-voice).',
    '   - NEVER write step lines yourself ("⚙️ Opening…", "🖱️ Clicking…", "✍️ Filling…") — those are',
    '     system-generated. If you catch yourself writing one, STOP and return the raw action JSON instead.',
    '   - You operate strictly inside this app. No external sites, no other tools.',
    '   - If the user asks to open anything OUTSIDE this app (a website, URL, another program), do NOT',
    '     navigate anywhere as a substitute — reply {"answer":"…"} explaining you can only move around',
    '     inside our own app, and list what you can do instead.',
    '',
    '3) FINAL TEXT (no data or action needed):',
    '   {"answer":"…"} — warm, first-person, we/our voice.',
    '',
    'EXAMPLES of correct replies:',
    '  user: "Open the documents page for me"        → {"action":{"type":"navigate","view":"documents"},"thought":"user asked to open it"}',
    '  user: "Go to attendance"                      → {"action":{"type":"navigate","view":"attendance"},"thought":"…"}',
    '  user: "where do I create an NOC?"             → {"answer":"Documents & NOC → Create NOC …"} (question, not a request to act)',
    '  user: "how many supervisors do we have?"      → {"sql":[count, named rows],"display":"markdown table: ID | Name | Site"}',
    '  user: "Create an NOC for M/S Proscape, 5 workers, Dubai Marina" → {"action":{"type":"noc_create","client":"M/S PROSCAPE LLC","employees":["SEED WORKER 001","SEED WORKER 002","SEED WORKER 003","SEED WORKER 004","SEED WORKER 005"],"city":"Dubai"},"thought":"start the one-shot NOC flow"}',
    '  user: "HELP ME CREATE THIS NOC CLIENT: M/S NPC LLC PROJECT: NPC SHOBHA EMPLOYEES: SEED WORKER 001 … 005" → {"action":{"type":"noc_create","client":"M/S NPC LLC","project":"NPC SHOBHA","employees":["SEED WORKER 001","SEED WORKER 002","SEED WORKER 003","SEED WORKER 004","SEED WORKER 005"]},"thought":"pasted NOC request"}',
    '',
    APP_UI_MAP,
    '',
    'Database schema (table (columns) — hints):',
    schemaDoc,
  ].join('\n');
}

function responderSystemPrompt(
  currency: string,
  today: string,
  assistantName: string,
  companyName: string
): string {
  return [
    `You are "${assistantName}", the friendly AI companion inside ${companyName} — a workforce-management app.`,
    `You know everything about the company and you and the user are on the SAME team: always speak as "we/our".`,
    `Say "We have 6 sites", NEVER "You have 6 sites". Warm, confident, human — a colleague who knows the numbers by heart.`,
    `Today is ${today} (Asia/Dubai). Money is displayed in ${currency} (e.g. ${currency} 1,250.00).`,
    '',
    'Answer the user using ONLY the QUERY RESULTS observation provided (never invent data).',
    'Structure every data answer in two parts:',
    '  1. DIRECT ANSWER — one sentence leading with the key figure in bold, phrased as "we"',
    '     (e.g. "**We have 6 active sites** at the moment.").',
    '  2. SUPPORTING DETAIL — follow the PRESENTATION PLAN if one is provided:',
    '     - when the observation contains named rows (people, sites, fines…), you MUST show them in a',
    '       small markdown table with the useful columns (e.g. | Name | Position | Site |) — NEVER reduce',
    '       named rows to just a count or vague prose, and never hide them in bullets when a table fits;',
    '     - bullets only for genuinely short lists, or a single bold figure when there is nothing to break down.',
    '  • Add ONE short insight line when the data clearly supports it (largest site, most fined month, top employee,',
    '    a notable gap) — still strictly derived from the data, never speculation.',
    '  • Be detailed but tidy: every table cell meaningful, no filler sentences; let the table carry the detail.',
    '  • Render empty or null values in tables as "—" — never print the raw word null.',
    '  • If the observation is empty or contains an error, say clearly that no matching data was found',
    '    (or that the lookup failed) — never fabricate numbers.',
    '  • Round money to 2 decimals with the currency code; big counts may be rounded sensibly.',
    '  • If the observation was truncated, mention that more rows exist.',
    '  • LARGE RESULT RULE: never dump hundreds of rows into chat. When a result has more than 25 rows,',
    '    show the first 25 (or the most important 25, e.g. top by amount/date) in the table and end with',
    '    a line like "— showing 25 of 187; ask me to narrow it down (by site, month or name)".',
    '  • Greetings/small-talk (no observation): reply warmly in first person as the company\'s companion, 1-3 sentences.',
  ].join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = (body?.userId || '').trim();
    const sessionId = (body?.sessionId || '').trim();
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    // Agent loop: the client sends back what happened after executing a step.
    const agentObservationRaw = typeof body?.observation === 'string' ? body.observation.trim() : '';
    const agentObservation = agentObservationRaw ? agentObservationRaw.slice(0, MAX_OBSERVATION) : '';
    // Which screen the user/agent is currently on (best-effort context).
    const currentViewRaw = typeof body?.view === 'string' ? body.view.trim() : '';
    const currentView = (AGENT_VIEWS as readonly string[]).includes(currentViewRaw) ? currentViewRaw : '';

    if (!userId || !sessionId) {
      return NextResponse.json({ success: false, error: 'userId and sessionId are required' }, { status: 400 });
    }
    if (!content && !agentObservation) {
      return NextResponse.json({ success: false, error: 'Message cannot be empty' }, { status: 400 });
    }
    if (content.length > MAX_CONTENT) {
      return NextResponse.json({ success: false, error: `Message too long (max ${MAX_CONTENT} characters)` }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } });
    if (!user || user.deletedAt) {
      return NextResponse.json({ success: false, error: 'Valid user required' }, { status: 400 });
    }

    // Permission gate — the AI assistant is usable only by the super admin
    // and by accounts the super admin granted the "AI Assistant" permission.
    if (!(await isAiAllowed(userId))) {
      return NextResponse.json({ success: false, error: AI_ACCESS_DENIED }, { status: 403 });
    }

    const session = await db.aiChatSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    // Real user messages are persisted; agent observations are context-only.
    const userMessage = content
      ? await db.aiChatMessage.create({ data: { sessionId, role: 'user', content } })
      : null;

    // Conversation history for continuity. When a new user message was just
    // created we drop the newest row (it's added explicitly below); on
    // observation-only agent steps the newest row is the assistant's own step
    // line and stays in history.
    const prior = await db.aiChatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT + 1,
    });
    const history: LlmMessage[] = (content ? prior.slice(1) : prior)
      .reverse()
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const [schemaDoc, settingsRows] = await Promise.all([
      getDbSchemaDoc(),
      db.appSetting.findMany({
        where: { key: { in: ['currency', 'aiName', 'companyName', 'brandName', 'aiApiKey', 'aiBaseUrl', 'aiModel'] } },
        select: { key: true, value: true },
      }),
    ]);
    const settingsMap: Record<string, string> = {};
    for (const row of settingsRows) settingsMap[row.key] = row.value;
    const currency = settingsMap.currency || 'AED';
    const assistantName = settingsMap.aiName || 'Nova';
    const companyName = settingsMap.companyName || 'Arabian Shield Manpower';
    // Model provider saved by the super admin in Settings → AI Assistant.
    // null → env credentials, then the built-in provider.
    const aiCreds = credentialsFromMap(settingsMap);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());

    // ── Pass 1: planner ────────────────────────────────────────────────
    // Conversation context beyond persisted history (agent awareness) —
    // shared by the planner, the SQL self-heal retry and the responder.
    const contextMessages: LlmMessage[] = [];
    if (currentView) {
      contextMessages.push({
        role: 'user',
        content: `[APP STATE] The user is currently viewing the "${currentView}" screen (${VIEW_LABELS[currentView] ?? currentView}).`,
      });
    }
    if (content) contextMessages.push({ role: 'user', content });
    // Nudge the planner toward the action format when the message reads like
    // an imperative in-app request (models sometimes drift to how-to text).
    // Requests mentioning URLs / outside destinations are excluded — those
    // must get a polite refusal, not a substitute navigation.
    const externalIntent = /https?:\/\/|www\.|\b(google|youtube|facebook|instagram|whatsapp\.com|twitter|x\.com|linkedin|chrome|browser|internet)\b/i.test(content);
    const actionIntent = /\b(open|go to|goto|take me to|show me|navigate|bring me|switch to|jump to|create|make|fill|add)\b/i.test(content) && !externalIntent;
    if (actionIntent) {
      contextMessages.push({
        role: 'user',
        content:
          '[REMINDER] This request asks you to ACT inside the app. Your ENTIRE reply must be a single JSON object WITH an "action" key, e.g. {"action":{"type":"navigate","view":"documents"},"thought":"…"} — or, ONLY if details are missing, {"answer":"…question…"}. Writing a sentence or a step line (⚙️/🖱️/✍️) describing what you would do is FORBIDDEN for this request.',
      });
      // VALUE BINDING — messages that carry explicit "FIELD = VALUE" pairs must
      // have those values copied verbatim into fill actions. Weak models tend
      // to echo the on-screen placeholder instead of the user's own value.
      if (/[A-Za-z][A-Za-z ]{1,30}\s*[=:]\s*\S/.test(content)) {
        contextMessages.push({
          role: 'user',
          content:
            '[VALUE BINDING] The user\'s message contains explicit field values (KEY = VALUE or KEY: VALUE). For every fill action, copy each VALUE EXACTLY as written after the = or : — e.g. for "Site Name = QA Agent Site 21" reply {"action":{"type":"fill","field":"Site Name","value":"QA Agent Site 21"}}. NEVER use the grey placeholder/example text visible on the screen as a value — those are hints, and the executor will refuse them.',
        });
      }
    }
    if (agentObservation) {
      // The macro reports success in its observation — tell the model the task
      // is COMPLETE so it confirms instead of burning extra read/click turns.
      const macroDone = agentObservation.includes('✅ NOC generated');
      contextMessages.push({
        role: 'user',
        content: `[AGENT OBSERVATION] Result of your last action:\n${agentObservation}\n\n${
          macroDone
            ? 'The task is COMPLETE — the NOC was generated successfully. Reply NOW with {"answer":"…"} confirming the result (mention the NOC number and the client in our we-voice). Do NOT run any more actions.'
            : 'The task is IN PROGRESS. Your ENTIRE reply must be a single JSON object WITH an "action" key for the next step ({"action":{"type":"…",…},"thought":"…") — or {"answer":"…"} ONLY to ask a missing-detail question or confirm completion. NEVER write a step line (⚙️/🖱️/✍️) — return the raw action JSON instead.'
        }`,
      });
    }

    const plannerMessages: LlmMessage[] = [
      { role: 'system', content: plannerSystemPrompt(schemaDoc, currency, today, assistantName, companyName) },
      ...history,
      ...contextMessages,
    ];
    const planRaw = await callLLMR(plannerMessages, { temperature: 0 }, aiCreds);

    // ── Agent recovery ladder (deterministic, weak-model-proof) ──────────
    // Weak models drift mid-task: they answer with a step LINE ("⚙️ Opening…"),
    // with plain prose, or with nothing JSON-like at all — after being told to
    // return an action. Left alone that kills the loop mid-task. Ladder:
    //   1. one stern retry demanding the action JSON;
    //   2. if the reply is still not an action, decide deterministically:
    //      • a clear completion / missing-detail question is RESPECTED (final);
    //      • anything else becomes a synthetic {"action":{"type":"read"}} so
    //        the loop keeps moving — the next turn carries a fresh observation
    //        plus the reminder, which is usually enough to unstick the model.
    // Both first-turn action requests and mid-task observation turns are covered.
    let planJson = extractJsonObject(planRaw);

    const STEP_LINE_RE = /^[\u2699\uFE0F\uD83D\uDDFB\u270D\uD83D\uDD3C\uD83D\uDC41\u23F3\u2712]/u;
    const looksFinal = (s: string) =>
      /✅|\b(done|completed|created|finished|generated|added|submitted|deleted|saved|opened|already|need|which|what is|please provide)\b/i.test(s);

    const midTaskStall =
      agentObservation &&
      !(planJson !== null && planJson.action !== undefined) &&
      (
        planJson === null ||
        (typeof planJson.answer === 'string' && planJson.answer.trim() && (STEP_LINE_RE.test(planJson.answer.trim()) || !looksFinal(planJson.answer.trim()))) ||
        (planJson.answer === undefined && planJson.sql === undefined)
      );
    const firstTurnStall =
      !agentObservation &&
      content &&
      actionIntent &&
      planJson !== null &&
      planJson.action === undefined &&
      planJson.sql === undefined &&
      typeof planJson.answer === 'string' &&
      !!planJson.answer.trim();

    if (midTaskStall || firstTurnStall) {
      const stern =
        'You did NOT follow the action protocol. Reply again with ONLY a single minified JSON object WITH an "action" key for your next step, e.g. {"action":{"type":"read"},"thought":"…"}, {"action":{"type":"navigate","view":"employees"},"thought":"…"} or {"action":{"type":"click","text":"Add Site"},"thought":"…"}. NO prose, NO step lines, NO markdown. Only {"answer":"…"} if you are asking a missing-detail question or confirming the task is complete.';
      const retryRaw = await callLLMR([...plannerMessages, { role: 'user', content: stern }], { temperature: 0 }, aiCreds);
      const retryPlan = extractJsonObject(retryRaw);
      if (retryPlan !== null && retryPlan.action !== undefined) {
        planJson = retryPlan;
      } else if (midTaskStall) {
        // Deterministic continuation: keep the loop alive with a fresh read.
        planJson = { action: { type: 'read' } };
      }
    }

    // ── Agent step? Checked BEFORE the SQL/answer paths — an action reply
    //    never runs SQL. Invalid actions neutralize into a graceful answer.
    if (planJson !== null && planJson.action !== undefined) {
      const action = validateAgentAction(planJson.action);
      if (action) {
        const stepText = describeAction(action);
        const stepMessage = await db.aiChatMessage.create({
          data: { sessionId, role: 'assistant', content: stepText },
        });
        const thought = typeof planJson.thought === 'string' ? planJson.thought.trim().slice(0, 200) : null;
        await db.aiChatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
        return NextResponse.json({
          success: true,
          data: {
            userMessage: userMessage
              ? { id: userMessage.id, role: 'user', content: userMessage.content, createdAt: userMessage.createdAt }
              : null,
            assistantMessage: {
              id: stepMessage.id,
              role: 'assistant',
              content: stepMessage.content,
              createdAt: stepMessage.createdAt,
            },
            action,
            thought,
            agent: true,
          },
        });
      }
      // Rejected action → neutralize into a graceful direct answer. For a
      // noc_create that failed validation the missing pieces are known — ask
      // for them concretely instead of the generic rejection text.
      if (planJson.action && (planJson.action as Record<string, unknown>).type === 'noc_create') {
        const pa = planJson.action as Record<string, unknown>;
        const hasClient = typeof pa.client === 'string' && !!pa.client.trim();
        const empCount = Array.isArray(pa.employees)
          ? pa.employees.filter((e) => typeof e === 'string' && !!e.trim()).length
          : 0;
        const need: string[] = [];
        if (!hasClient) need.push('the client / company name');
        if (empCount === 0) need.push('the employee names to include (one or more)');
        planJson.answer = `I can create that NOC right away — I just need ${need.join(' and ')}. The date is optional (I will use today unless you give one), and you can paste the request exactly as it came from WhatsApp and I will read it.`;
      } else {
        delete planJson.action;
        delete planJson.sql;
        delete planJson.display;
        planJson.answer =
          'I could not perform that step — it was rejected as unsafe or unknown. You can ask me to open any of our pages (Dashboard, Employees, Sites, Camps, Attendance, Documents, Accounts, Settings…) or to fill in a form for you, and I will do it step by step.';
      }
    }

    // ── Live-data guard ─────────────────────────────────────────────
    // Data questions must be answered from FRESH SQL, never from remembered
    // history. If the planner tried to hand back a prose answer (possibly a
    // table copied from an earlier turn) for an obvious data question, give
    // it one stern retry demanding queries. Weak/self-hosted models need
    // this deterministic guard — the prompt alone is not always enough.
    const dataQuestionRe =
      /\b(how many|how much|count (of|all)|list (all|the|me)|show (all|me all|me the)|which (sites|employees|camps|admins)|who (are|is) (our|the))\b/i;
    if (
      planJson !== null &&
      content &&
      !agentObservation &&
      typeof planJson.answer === 'string' &&
      planJson.answer.trim() &&
      planJson.sql === undefined &&
      dataQuestionRe.test(content)
    ) {
      const retryRaw = await callLLMR(
        [
          ...plannerMessages,
          {
            role: 'user',
            content:
              'That was prose, but this is a LIVE DATA question — it must be answered from fresh database queries, NEVER from numbers or tables said earlier in this conversation. Reply again with ONLY {"sql":"…"} or {"sql":["…","…"],"display":"…"} against the listed tables (keep the named-breakdown rule). Only if the database genuinely cannot answer it, keep {"answer":…} with no remembered figures.',
          },
        ],
        { temperature: 0 },
        aiCreds
      );
      const retryPlan = extractJsonObject(retryRaw);
      if (retryPlan !== null && retryPlan.sql !== undefined) planJson = retryPlan;
    }

    let sql: string | null = null;
    let directAnswer: string | null = null;
    // The planner's presentation hint for pass 2 (how to show the data).
    let displayPlan: string | null = null;
    // null observation → the answer is already final (no pass 2 needed)
    let observation: string | null = null;
    let rowCount = 0;
    let truncated = false;

    if (planJson === null) {
      // Planner replied in prose (no JSON object at all) — use it as the answer.
      directAnswer = planRaw.trim().slice(0, MAX_CONTENT);
    } else {
      if (typeof planJson.display === 'string' && planJson.display.trim()) {
        displayPlan = planJson.display.trim().slice(0, 300);
      }
      // Normalize the planner's SQL field: string or array (max 3 queries).
      const rawSql = planJson.sql;
      const candidates: string[] = Array.isArray(rawSql)
        ? rawSql.filter((s): s is string => typeof s === 'string' && !!s.trim()).slice(0, 3)
        : typeof rawSql === 'string' && rawSql.trim()
          ? [rawSql]
          : [];

      if (candidates.length > 0) {
        const sanitized = candidates.map((c) => sanitizeSql(c));
        if (sanitized.some((s) => s === null)) {
          // Unsafe SQL never reaches the database — pass 2 explains it gracefully.
          observation =
            'The generated query was rejected (only ONE read-only SELECT/WITH statement per query against the listed tables is allowed).';
        } else {
          const obsParts: string[] = [];
          const executed: string[] = [];
          let totalRows = 0;
          for (let i = 0; i < sanitized.length; i++) {
            const statement = sanitized[i] as string;
            executed.push(statement);
            try {
              const rows = await runReadonlyQuery(statement);
              totalRows += rows.length;
              obsParts.push(
                `Query ${i + 1} → ${rows.length} row(s):\n${truncate(safeJson(rows), Math.ceil(OBSERVATION_CAP / sanitized.length))}`
              );
            } catch (err) {
              // ── Self-heal: one retry where the planner sees its own SQL error ──
              const firstError = err instanceof Error ? err.message : 'Unknown SQL error';
              let healed = false;
              try {
                const retryRaw = await callLLMR(
                  [
                    {
                      role: 'system',
                      content: plannerSystemPrompt(schemaDoc, currency, today, assistantName, companyName),
                    },
                    ...history,
                    ...contextMessages,
                    {
                      role: 'user',
                      content: `Your SQL failed.\nFailed SQL: ${truncate(statement, 800)}\nError: ${truncate(firstError, 400)}\nReply again with ONLY a corrected JSON object {"sql":"…"} using EXACTLY the tables and columns listed in the schema. No such-column guesses.`,
                    },
                  ],
                  { temperature: 0 },
                  aiCreds
                );
                const retryPlan = extractJsonObject(retryRaw);
                const retrySqlRaw =
                  retryPlan && typeof retryPlan.sql === 'string' ? sanitizeSql(retryPlan.sql) : null;
                if (retrySqlRaw) {
                  const rows = await runReadonlyQuery(retrySqlRaw);
                  executed[executed.length - 1] = retrySqlRaw;
                  totalRows += rows.length;
                  obsParts.push(
                    `Query ${i + 1} → ${rows.length} row(s):\n${truncate(safeJson(rows), Math.ceil(OBSERVATION_CAP / sanitized.length))}`
                  );
                  healed = true;
                }
              } catch {
                // heal attempt failed — fall through to the original error
              }
              if (!healed) {
                obsParts.push(`Query ${i + 1} SQL error: ${truncate(firstError, 400)}`);
              }
            }
          }
          sql = executed.join('\n;\n');
          rowCount = totalRows;
          truncated = totalRows >= ROW_CAP;
          observation = obsParts.join('\n\n');
        }
      } else if (typeof planJson.answer === 'string' && planJson.answer.trim()) {
        directAnswer = planJson.answer.trim();
      } else {
        // JSON parsed but contained neither key — force a grounded pass 2.
        observation = 'No query results were produced.';
      }
    }

    // ── Pass 2: responder (only when an observation exists) ────────────
    let answerText: string;
    if (directAnswer !== null) {
      answerText = directAnswer;
    } else {
      const responderMessages: LlmMessage[] = [
        { role: 'system', content: responderSystemPrompt(currency, today, assistantName, companyName) },
        ...history,
        ...contextMessages,
        {
          role: 'user',
          content: `QUERY RESULTS (observation):\n${observation ?? 'No query results.'}\n\n${
            displayPlan ? `PRESENTATION PLAN: ${displayPlan}\n\n` : ''
          }Answer the user's question now.`,
        },
      ];
      answerText = await callLLMR(responderMessages, { temperature: 0.3 }, aiCreds);
    }

    const assistantMessage = await db.aiChatMessage.create({
      data: { sessionId, role: 'assistant', content: answerText },
    });

    // Derive a session title from the first exchange.
    let title = session.title;
    if (title === 'New chat' && content) {
      title = content.replace(/\s+/g, ' ').slice(0, 48) || 'New chat';
    }
    const updatedSession = await db.aiChatSession.update({
      where: { id: sessionId },
      data: { title, updatedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      data: {
        userMessage: userMessage
          ? { id: userMessage.id, role: 'user', content: userMessage.content, createdAt: userMessage.createdAt }
          : null,
        assistantMessage: {
          id: assistantMessage.id,
          role: 'assistant',
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
        },
        session: { id: updatedSession.id, day: updatedSession.day, title: updatedSession.title, updatedAt: updatedSession.updatedAt },
        meta: { sqlUsed: sql || null, rowsFetched: rowCount },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
