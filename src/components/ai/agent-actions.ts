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

export interface AgentAction {
  type: 'navigate' | 'read' | 'click' | 'fill' | 'select' | 'wait';
  view?: string;
  text?: string;
  field?: string;
  value?: string;
  option?: string;
  ms?: number;
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
    const val = i.value ? ` = "${i.value.slice(0, 40)}"` : '';
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
      default:
        return 'Unknown action type.';
    }
  } catch (err) {
    return `Action failed: ${err instanceof Error ? err.message : 'unknown error'}`;
  }
}
