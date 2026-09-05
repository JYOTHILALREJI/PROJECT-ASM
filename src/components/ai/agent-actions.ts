'use client';

// In-app agent action executor for the AI assistant.
//
// The model plans ONE small step at a time (see /api/ai/chat); this module
// executes it inside the running page and returns a text observation that is
// fed back to the model. Hard safety properties:
//
//   • Navigation ONLY through the app's own Zustand store (useAppStore) and
//     ONLY to screens whitelisted in AGENT_VIEWS — there is no code path that
//     can open a URL, a new tab or anything outside the SPA.
//   • Clicks/fills/selects operate purely on the current document, and always
//     skip the assistant's own UI (marked with [data-asm-assistant]) so the
//     agent can never click its own chat controls.
//   • Every string that reaches the DOM is bounded (server-side validation +
//     local caps) and used only as match text / input values.

import { useAppStore } from '@/store/app-store';
import { AGENT_VIEWS, VIEW_LABELS } from '@/lib/app-ui-map';
import { todayDMY } from '@/components/documents/shared';

export interface AgentAction {
  type: 'navigate' | 'read' | 'click' | 'fill' | 'select' | 'wait' | 'noc_create';
  view?: string;
  text?: string;
  field?: string;
  value?: string;
  option?: string;
  ms?: number;
  // noc_create payload (server-validated): client + employees are required.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function inAssistant(el: Element): boolean {
  return !!el.closest('[data-asm-assistant]');
}

function isVisible(el: Element): boolean {
  if (inAssistant(el)) return false;
  const he = el as HTMLElement;
  if (he.hasAttribute('disabled') || he.getAttribute('aria-disabled') === 'true') return false;
  const style = window.getComputedStyle(he);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  // Elements inside closed portals have no box; fixed elements are always box-ful.
  if (!he.offsetParent && style.position !== 'fixed') return false;
  return true;
}

/** Human-ish label for an input: associated <label>, aria-label, name, id, placeholder. */
function inputLabel(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  const labels = typeof el.labels === 'undefined' ? [] : Array.from(el.labels ?? []);
  const labelText = labels.map((l) => l.textContent || '').join(' ').trim();
  const aria = el.getAttribute('aria-label') || '';
  return (labelText || aria || el.name || el.id || ('placeholder' in el ? el.placeholder : '') || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function describe(el: Element): string {
  const he = el as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const role = he.getAttribute('role') || '';
  const text = norm(he.textContent || '').slice(0, 60);
  if (tag === 'input' || tag === 'textarea') {
    const i = el as HTMLInputElement;
    const kind = i.type && i.type !== 'text' ? ` type=${i.type}` : '';
    const lab = inputLabel(i) ? ` label="${inputLabel(i).slice(0, 40)}"` : '';
    const ph = i.placeholder ? ` placeholder="${i.placeholder.slice(0, 40)}"` : '';
    // Values and placeholders are deliberately marked differently so the model
    // can never mistake grey hint text for what the field actually contains.
    const val = i.value ? ` VALUE="${i.value.slice(0, 40)}"` : ' (empty)';
    return `[input${kind}]${lab || ''}${ph || ''}${val}`;
  }
  if (tag === 'select') return `[select] ${inputLabel(el as unknown as HTMLInputElement).slice(0, 60) || text}`;
  if (role === 'combobox') return `[dropdown] ${text || '(unlabelled)'}`;
  if (/^h[1-4]$/.test(tag)) return `[heading] ${text}`;
  if (tag === 'a') return `[link] ${text}`;
  if (role === 'tab') return `[tab] ${text}`;
  return `[btn] ${text}`;
}

// ── read ─────────────────────────────────────────────────────────────────────
function readPage(): string {
  const view = useAppStore.getState().currentView;
  const heading = document.querySelector('main h1, main h2');
  const lines: string[] = [`Current screen: "${view}"${heading ? ` — ${norm(heading.textContent || '').slice(0, 70)}` : ''}.`, 'Visible elements:'];

  const nodes = Array.from(
    document.querySelectorAll(
      'aside h1, aside h2, aside button, main h1, main h2, main h3, main h4, main button, main a[href], main [role="button"], main [role="tab"], main [role="menuitem"], main input, main textarea, main select, main [role="combobox"]'
    )
  ) as HTMLElement[];

  for (const el of nodes) {
    if (lines.length >= 90) {
      lines.push('…(more elements exist — click or scroll to see them)');
      break;
    }
    if (!isVisible(el)) continue;
    const line = describe(el);
    if (line.endsWith('] ') || line.endsWith('] (unlabelled)')) continue;
    if (!lines.includes(line)) lines.push(line);
  }
  let out = lines.join('\n');
  if (out.length > 3500) out = `${out.slice(0, 3500)}\n…(truncated)`;
  return out;
}

// ── click ────────────────────────────────────────────────────────────────────
function clickableCandidates(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll(
      'main button, aside button, main a[href], main [role="button"], main [role="tab"], main [role="menuitem"], main [role="option"], main select, main [role="combobox"], [role="dialog"] button, [role="dialog"] [role="option"], [role="dialog"] [role="combobox"]'
    )
  ) as HTMLElement[];
}

function findByText(cands: HTMLElement[], text: string): HTMLElement | null {
  const t = norm(text);
  const visible = cands.filter(isVisible);
  return (
    visible.find((el) => norm(el.textContent || '') === t) ||
    visible.find((el) => (norm(el.textContent || '') || '').includes(t)) ||
    visible.find((el) => t.includes(norm(el.textContent || '')) && norm(el.textContent || '').length > 2) ||
    null
  );
}

function press(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  // Radix components (Select, DropdownMenu) open on pointerdown — fire the
  // full pointer sequence, then a plain click for ordinary buttons.
  const firePointer = (type: string) => {
    try {
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', view: window }));
    } catch {
      // PointerEvent unavailable — plain click still covers most cases
    }
  };
  firePointer('pointerdown');
  firePointer('pointerup');
  el.click();
}

function clickByText(text: string): string {
  const el = findByText(clickableCandidates(), text);
  if (!el) {
    const sample = clickableCandidates()
      .filter(isVisible)
      .slice(0, 15)
      .map((e) => describe(e))
      .join('\n');
    return `No button/tab/link matching "${text}" is visible right now.\nVisible clickable elements:\n${sample || '(none)'}`;
  }
  const label = norm(el.textContent || '').slice(0, 60);
  press(el);
  return `Clicked "${label}".`;
}

async function clickByTextVerified(text: string): Promise<string> {
  const before = norm(document.querySelector('main h1, main h2')?.textContent || '').slice(0, 60);
  const result = clickByText(text);
  if (!result.startsWith('Clicked')) return result;
  await sleep(900); // let React open dialogs / switch views
  const after = norm(document.querySelector('main h1, main h2')?.textContent || '').slice(0, 60);
  const dialogs = document.querySelectorAll('[role="dialog"]').length;
  return `${result} Screen heading is now: "${after || before}".${dialogs > 0 ? ` ${dialogs} dialog(s) now open.` : ''}`;
}

// ── fill ─────────────────────────────────────────────────────────────────────
function fieldCandidates(): (HTMLInputElement | HTMLTextAreaElement)[] {
  return Array.from(
    document.querySelectorAll(
      'main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([disabled]), main textarea:not([disabled]), [role="dialog"] input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([disabled]), [role="dialog"] textarea:not([disabled])'
    )
  ) as (HTMLInputElement | HTMLTextAreaElement)[];
}

function findField(field: string): HTMLInputElement | HTMLTextAreaElement | null {
  const t = norm(field);
  const visible = fieldCandidates().filter(isVisible);
  const byLabel = (el: HTMLInputElement | HTMLTextAreaElement) => norm(inputLabel(el));
  return (
    visible.find((el) => byLabel(el) === t) ||
    visible.find((el) => byLabel(el).includes(t)) ||
    visible.find((el) => norm(el.placeholder || '').includes(t) && el.placeholder) ||
    // Label-text sibling fallback: a <label> whose text matches, paired with
    // the next input that follows it in the DOM (common shadcn form layout).
    (() => {
      const labels = Array.from(document.querySelectorAll('main label, [role="dialog"] label')).filter(isVisible);
      const hit = labels.find((l) => norm(l.textContent || '').includes(t));
      if (!hit) return null;
      const forId = hit.getAttribute('for');
      if (forId) {
        const bound = document.getElementById(forId);
        if (bound && isVisible(bound)) return bound as HTMLInputElement;
      }
      let next = hit.nextElementSibling;
      while (next) {
        if (next.tagName === 'INPUT' || next.tagName === 'TEXTAREA') return next as HTMLInputElement;
        const inner = next.querySelector('input, textarea');
        if (inner && isVisible(inner)) return inner as HTMLInputElement;
        next = next.nextElementSibling;
      }
      return null;
    })() ||
    null
  );
}

function setReactValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function fillField(field: string, value: string): string {
  const el = findField(field);
  if (!el) {
    const sample = fieldCandidates()
      .filter(isVisible)
      .slice(0, 15)
      .map((e) => describe(e))
      .join('\n');
    return `No input matching "${field}" is visible right now.\nVisible inputs:\n${sample || '(none)'}`;
  }
  setReactValue(el, value);
  return `Filled "${inputLabel(el).slice(0, 60) || field}" with "${value.slice(0, 80)}".`;
}

// ── select ───────────────────────────────────────────────────────────────────
async function selectOption(field: string, option: string): Promise<string> {
  const t = norm(option);

  // 1) Native <select>
  const native = Array.from(document.querySelectorAll('main select, [role="dialog"] select')) as HTMLSelectElement[];
  const nativeMatch = native.filter(isVisible).find((s) => norm(inputLabel(s as unknown as HTMLInputElement)).includes(norm(field)) || norm(s.textContent || '').includes(t));
  if (nativeMatch) {
    const opt = Array.from(nativeMatch.options).find((o) => norm(o.textContent || '').includes(t));
    if (opt) {
      setReactValue(nativeMatch, opt.value);
      return `Selected "${norm(opt.textContent || '').slice(0, 60)}" in ${inputLabel(nativeMatch as unknown as HTMLInputElement).slice(0, 60) || 'the dropdown'}.`;
    }
  }

  // 2) Radix combobox: open the trigger, then pick the option from the portal.
  const triggers = Array.from(document.querySelectorAll('button[role="combobox"], [role="combobox"]')) as HTMLElement[];
  const visible = triggers.filter(isVisible);
  const trigger =
    visible.find((el) => norm(el.textContent || '').includes(norm(field))) ||
    visible.find((el) => norm(el.getAttribute('aria-label') || '').includes(norm(field))) ||
    visible[0];
  if (!trigger) return `No dropdown matching "${field}" is visible right now.`;
  press(trigger);
  await sleep(350);
  const options = (Array.from(document.querySelectorAll('[role="option"]')) as HTMLElement[]).filter(isVisible);
  const target =
    options.find((o) => norm(o.textContent || '') === t) ||
    options.find((o) => norm(o.textContent || '').includes(t));
  if (!target) {
    const list = options.slice(0, 15).map((o) => `- ${norm(o.textContent || '').slice(0, 60)}`).join('\n');
    return `Opened the dropdown but found no option matching "${option}". Available options:\n${list || '(none)'}`;
  }
  press(target);
  await sleep(150);
  // Close any stray popup by pressing Escape (harmless when already closed).
  return `Selected "${norm(target.textContent || '').slice(0, 60)}" in ${norm(trigger.textContent || '').slice(0, 40) || field}.`;
}

// ── navigate ─────────────────────────────────────────────────────────────────
async function navigate(view: string): Promise<string> {
  if (!(AGENT_VIEWS as readonly string[]).includes(view)) {
    return `Navigation to "${view}" is not allowed — only in-app screens: ${AGENT_VIEWS.join(', ')}.`;
  }
  const store = useAppStore.getState();
  // Detach detail views when leaving them so their fallback screens render.
  if (view !== 'noc_view') store.setSelectedNocId(null);
  if (view !== 'employee_detail' && view !== 'camp_detail' && view !== 'employee_hours_ledger') {
    store.setSelectedEmployeeId(null);
  }
  store.setCurrentView(view as Parameters<typeof store.setCurrentView>[0]);
  await sleep(1400); // let the page transition + data fetch settle
  const heading = norm(document.querySelector('main h1, main h2')?.textContent || '').slice(0, 70);
  return `Navigated to the "${VIEW_LABELS[view] ?? view}" screen.${heading ? ` Heading: "${heading}".` : ''}`;
}

// ── noc_create — deterministic one-shot NOC builder ─────────────────────────
// Walking the 5-step NOC wizard through dozens of model-driven micro-steps
// proved fragile (weak models stalled after one or two fills, or copied the
// form's grey placeholder text into values). This macro performs the WHOLE
// flow deterministically: open the wizard, fill every field from the
// user-provided payload (NEVER from on-screen hints), add every employee via
// search → tick → "Add selected" (manual-row fallback), then generate the NOC
// and read back its number. One action in, one rich observation out.
async function nocCreate(a: AgentAction): Promise<string> {
  const client = String(a.client || '').trim();
  const project = String(a.project || '').trim();
  const date = String(a.date || '').trim() || todayDMY();
  const employees = (Array.isArray(a.employees) ? a.employees : []).map((e) => String(e).trim()).filter(Boolean).slice(0, 50);
  const log: string[] = [];
  const pickButton = (match: (t: string) => boolean): HTMLElement | undefined =>
    (Array.from(document.querySelectorAll('main button')) as HTMLElement[]).filter(isVisible).find((b) => match(norm(b.textContent || '')));

  // 1) Be on the Documents page.
  if (useAppStore.getState().currentView !== 'documents') {
    log.push(await navigate('documents'));
  }

  // 2) Open the wizard (unless it is already open) and clear a stale
  //    "unsynced local changes" banner so it cannot restore old values.
  let clientInput = findField('Client Name');
  if (!clientInput) {
    log.push(await clickByTextVerified('Create NOC'));
    await sleep(500);
    const discard = pickButton((t) => t === 'discard');
    if (discard) {
      press(discard);
      log.push('Discarded an unsynced local draft banner.');
      await sleep(250);
    }
    clientInput = findField('Client Name');
  }
  if (!clientInput) {
    return `I could not open the NOC wizard — the Create NOC button is not reachable (missing permission, or the screen did not open). ${log.join(' ')}`;
  }

  // 3) Fill the details EXACTLY as the user provided them.
  setReactValue(clientInput, client);
  const fillOptional = (field: string, value: string) => {
    if (!value) return;
    const el = findField(field);
    if (el) setReactValue(el, value);
  };
  fillOptional('Project Name', project);
  fillOptional('NOC Date', date);
  fillOptional('Address Line 1', String(a.address1 || ''));
  fillOptional('Address Line 2', String(a.address2 || ''));
  fillOptional('City', String(a.city || ''));
  fillOptional('Country', String(a.country || ''));
  if (a.company) await selectOption('Issuing Company', String(a.company));
  log.push(`Filled the details: Client "${client}"${project ? `, Project "${project}"` : ''}, Date ${date}${a.city ? `, City "${a.city}"` : ''}.`);

  // 4) Employees: search → tick → "Add selected"; manual row when the
  //    database has no such employee. Already-present rows are a no-op.
  let added = 0;
  const addedNames: string[] = [];
  const missing: string[] = [];
  const rowNameInputs = () => Array.from(document.querySelectorAll('main input[placeholder="EMPLOYEE NAME"]')) as HTMLInputElement[];
  for (const name of employees) {
    const searchInput = findField('Search employees');
    if (!searchInput) {
      missing.push(name);
      continue;
    }
    const rowsBefore = rowNameInputs().length;
    setReactValue(searchInput, name);
    await sleep(1100); // debounce (250ms) + fetch + render
    const optionLabels = (Array.from(document.querySelectorAll('main label')) as HTMLElement[])
      .filter(isVisible)
      .filter((l) => l.querySelector('input[type="checkbox"]'));
    const target = optionLabels.find((l) => norm(l.textContent || '').includes(norm(name)));
    const checkbox = target ? (target.querySelector('input[type="checkbox"]') as HTMLInputElement | null) : null;
    if (checkbox && checkbox.disabled) {
      // already in the table (marked "added")
      added += 1;
      addedNames.push(name);
      continue;
    }
    if (checkbox) {
      // tick (verify React picked it up — retry once), then "Add selected"
      checkbox.click();
      await sleep(200);
      if (!checkbox.checked) {
        checkbox.click();
        await sleep(200);
      }
      const addBtn = pickButton((t) => t.startsWith('add selected'));
      if (addBtn) {
        press(addBtn);
        await sleep(450);
        if (rowNameInputs().length > rowsBefore) {
          added += 1;
          addedNames.push(name);
          setReactValue(searchInput, ''); // clear for the next search
          await sleep(200);
          continue;
        }
      }
    }
    // Not found in the database (or the pick failed) → add a manual row.
    const addManually = pickButton((t) => t.includes('add manually'));
    if (addManually) {
      press(addManually);
      await sleep(250);
      const nameInputs = rowNameInputs();
      const rowInput = nameInputs[nameInputs.length - 1];
      if (rowInput && nameInputs.length > rowsBefore) {
        setReactValue(rowInput, name.toUpperCase());
        added += 1;
        addedNames.push(`${name} (manual row — not found in the database)`);
        setReactValue(searchInput, '');
        await sleep(200);
        continue;
      }
    }
    missing.push(name);
    setReactValue(searchInput, '');
    await sleep(200);
  }
  log.push(
    `Employees: ${added}/${employees.length} on the NOC table${addedNames.length ? ` (${addedNames.join(', ')})` : ''}${
      missing.length ? ` — NOT FOUND: ${missing.join(', ')}` : ''
    }.`
  );
  if (missing.length > 0) {
    return `${log.join('\n')}\nSome employees were not found in the database and no manual row could be added, so I stopped BEFORE generating. Ask the user to check the names.`;
  }

  // 5) Generate.
  const generateBtn = pickButton((t) => t.includes('confirm & generate'));
  if (!generateBtn) {
    return `${log.join('\n')}\nI could not find the "Confirm & Generate NOC" button — the form may be in an unexpected state.`;
  }
  press(generateBtn);
  await sleep(2200);
  const mainText = norm(document.querySelector('main')?.textContent || '');
  const nocNumber = mainText.match(/noc-\d{4}-\d+/i)?.[0]?.toUpperCase();
  if (mainText.includes('noc generated') && nocNumber) {
    return `${log.join('\n')}\n✅ NOC generated: ${nocNumber} — ${client}${project ? ` · ${project}` : ''} · ${added} employee(s). It is stored in Documents → NOC and the page offers Print / Download PDF.`;
  }
  const toastText = (Array.from(document.querySelectorAll('[role="status"]')) as HTMLElement[])
    .filter(isVisible)
    .map((t) => norm(t.textContent || ''))
    .filter(Boolean)
    .join(' | ')
    .slice(0, 400);
  return `${log.join('\n')}\n⚠️ Generation did not complete.${toastText ? ` The page says: "${toastText}".` : ''} Ask the user to check the form.`;
}

// ── entry point ──────────────────────────────────────────────────────────────
export async function executeAgentAction(action: AgentAction): Promise<string> {
  try {
    switch (action.type) {
      case 'navigate':
        return await navigate(String(action.view || ''));
      case 'read':
        return readPage();
      case 'click':
        return await clickByTextVerified(String(action.text || ''));
      case 'fill':
        return fillField(String(action.field || ''), String(action.value ?? ''));
      case 'select':
        return await selectOption(String(action.field || ''), String(action.option || ''));
      case 'wait':
        await sleep(Math.min(Math.max(action.ms ?? 600, 100), 2000));
        return 'Waited.';
      case 'noc_create':
        return await nocCreate(action);
      default:
        return 'Unknown action type.';
    }
  } catch (err) {
    return `Action failed: ${err instanceof Error ? err.message : 'unknown error'}`;
  }
}
