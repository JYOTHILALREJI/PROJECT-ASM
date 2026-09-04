import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { callLLM, extractJsonObject, type LlmMessage } from '@/lib/ai-client';
import { getDbSchemaDoc } from '@/lib/db-schema-doc';

// AI Assistant chat endpoint — two-pass "grounded SQL" flow.
//
//   Pass 1 (planner): the model sees the live SQLite schema + the conversation
//   and replies with either {"sql": "SELECT …"} (needs data) or {"answer": "…"}
//   (small talk / app questions).
//
//   If SQL is produced it is safety-checked (single read-only statement), run
//   with a hard row cap, and the results are fed back as an observation.
//
//   Pass 2 (responder): the model turns question + observation into a natural
//   language answer. SQL errors are also fed to pass 2 so the assistant can
//   apologise gracefully instead of blowing up.
//
// Every exchange is persisted to AiChatMessage so the chat survives reloads,
// folds, and re-opens with full history.

const MAX_CONTENT = 4000;
const HISTORY_LIMIT = 12;
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
  return rows.slice(0, ROW_CAP);
}

function truncate(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap)}\n…(truncated)`;
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
    'You can query the app database with READ-ONLY SQLite SQL.',
    'Reply with ONLY a minified JSON object — no prose, no markdown fences:',
    '  • If the question needs data, either:',
    '      {"sql":"SELECT …"}                       ← one query, or',
    '      {"sql":["SELECT …","SELECT …"]}          ← 2-3 queries when the question has',
    '                                                  several INDEPENDENT parts (preferred).',
    '    Each entry must be ONE single SELECT (or WITH) statement.',
    '    - Use ONLY the tables/columns listed below (exact SQLite names).',
    '    - Always include a LIMIT (max 200) for row lists. Prefer WHERE deletedAt IS NULL for live rows.',
    '    - Dates are stored as ISO datetime strings or YYYY-MM-DD text; use date(col) when needed.',
    '    - Never guess columns that are not listed.',
    '    - NEVER create cartesian products (e.g. `ON 1=1`, joining unrelated tables).',
    '    - COUNT(*) after a JOIN counts matched pairs, not entities: for two unrelated totals',
    '      (e.g. sites AND fines) use SEPARATE queries in the sql array, or COUNT(DISTINCT …).',
    '    - Aggregates (COUNT/SUM) need no LIMIT; row lists must have one.',
    '  • MAKE ANSWERS INSIGHTFUL — plan what data makes an answer genuinely useful:',
    '    - When the user asks for a count or total of real things (sites, employees, camps, fines, warnings, advances…),',
    '      do NOT stop at the bare number. ALSO fetch a named breakdown so the answer can list each item with its',
    '      count/value (e.g. total sites + per-site name and employee count, total fines + per-type or per-month sums).',
    '      Prefer 2 queries in the sql array: one aggregate + one grouped breakdown (GROUP BY, ORDER BY the measure DESC).',
    '    - Include human-readable names/labels in breakdown queries — never bare IDs alone.',
    '  • PLAN THE PRESENTATION: always include a "display" key — a short string describing the clearest way to show',
    '    the answer, e.g. {"display":"markdown table: Site | Employees"}, {"display":"one bold figure + grouped table"},',
    '    {"display":"bullet list of names"}, {"display":"short paragraph"}.',
    '  • If NO data is needed (greetings, how-do-I questions, general chat): {"answer":"…"} — reply warmly, first person,',
    '    as the company\'s own companion ("we/our"), 1-3 sentences.',
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
    '     - a small markdown table for row data — ALWAYS include names/labels, not just numbers',
    '       (e.g. | Site | Employees | with one row per site),',
    '     - bullets for short lists, or a single bold figure when there is nothing to break down.',
    '  • Add ONE short insight line when the data clearly supports it (largest site, most fined month, top employee,',
    '    a notable gap) — still strictly derived from the data, never speculation.',
    '  • Be detailed but tidy: every table cell meaningful, no filler sentences; let the table carry the detail.',
    '  • If the observation is empty or contains an error, say clearly that no matching data was found',
    '    (or that the lookup failed) — never fabricate numbers.',
    '  • Round money to 2 decimals with the currency code; big counts may be rounded sensibly.',
    '  • If the observation was truncated, mention that more rows exist.',
    '  • Greetings/small-talk (no observation): reply warmly in first person as the company\'s companion, 1-3 sentences.',
  ].join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = (body?.userId || '').trim();
    const sessionId = (body?.sessionId || '').trim();
    const content = typeof body?.content === 'string' ? body.content.trim() : '';

    if (!userId || !sessionId) {
      return NextResponse.json({ success: false, error: 'userId and sessionId are required' }, { status: 400 });
    }
    if (!content) {
      return NextResponse.json({ success: false, error: 'Message cannot be empty' }, { status: 400 });
    }
    if (content.length > MAX_CONTENT) {
      return NextResponse.json({ success: false, error: `Message too long (max ${MAX_CONTENT} characters)` }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } });
    if (!user || user.deletedAt) {
      return NextResponse.json({ success: false, error: 'Valid user required' }, { status: 400 });
    }

    const session = await db.aiChatSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    const userMessage = await db.aiChatMessage.create({
      data: { sessionId, role: 'user', content },
    });

    // Conversation history (before this message) for continuity.
    const prior = await db.aiChatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT + 1,
    });
    const history: LlmMessage[] = prior
      .slice(1) // drop the message we just created (it's added explicitly below)
      .reverse()
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const [schemaDoc, settingsRows] = await Promise.all([
      getDbSchemaDoc(),
      db.appSetting.findMany({
        where: { key: { in: ['currency', 'aiName', 'companyName', 'brandName'] } },
        select: { key: true, value: true },
      }),
    ]);
    const settingsMap: Record<string, string> = {};
    for (const row of settingsRows) settingsMap[row.key] = row.value;
    const currency = settingsMap.currency || 'AED';
    const assistantName = settingsMap.aiName || 'Nova';
    const companyName = settingsMap.companyName || 'Arabian Shield Manpower';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());

    // ── Pass 1: planner ────────────────────────────────────────────────
    const plannerMessages: LlmMessage[] = [
      { role: 'system', content: plannerSystemPrompt(schemaDoc, currency, today, assistantName, companyName) },
      ...history,
      { role: 'user', content },
    ];
    const planRaw = await callLLM(plannerMessages, { temperature: 0 });

    const planJson = extractJsonObject(planRaw);
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
                const retryRaw = await callLLM(
                  [
                    { role: 'system', content: plannerSystemPrompt(schemaDoc, currency, today, assistantName, companyName) },
                    ...history,
                    { role: 'user', content },
                    {
                      role: 'user',
                      content: `Your SQL failed.\nFailed SQL: ${truncate(statement, 800)}\nError: ${truncate(firstError, 400)}\nReply again with ONLY a corrected JSON object {"sql":"…"} using EXACTLY the tables and columns listed in the schema. No such-column guesses.`,
                    },
                  ],
                  { temperature: 0 }
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
        { role: 'user', content },
        {
          role: 'user',
          content: `QUERY RESULTS (observation):\n${observation ?? 'No query results.'}\n\n${
            displayPlan ? `PRESENTATION PLAN: ${displayPlan}\n\n` : ''
          }Answer the user's question now.`,
        },
      ];
      answerText = await callLLM(responderMessages, { temperature: 0.3 });
    }

    const assistantMessage = await db.aiChatMessage.create({
      data: { sessionId, role: 'assistant', content: answerText },
    });

    // Derive a session title from the first exchange.
    let title = session.title;
    if (title === 'New chat') {
      title = content.replace(/\s+/g, ' ').slice(0, 48) || 'New chat';
    }
    const updatedSession = await db.aiChatSession.update({
      where: { id: sessionId },
      data: { title, updatedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      data: {
        userMessage: { id: userMessage.id, role: 'user', content, createdAt: userMessage.createdAt },
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
