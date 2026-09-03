#!/bin/bash
# E2E: dashboard, NOC workspace (draft -> final), template settings, detail-page docs
set +e
cd /home/z/my-project
pkill -f "next dev" 2>/dev/null; sleep 2
nohup node node_modules/next/dist/bin/next dev -p 3000 >> scripts/dev-server.log 2>&1 &
sleep 9
AB="agent-browser"

$AB open http://localhost:3000 >/dev/null 2>&1; sleep 4
$AB eval "
(async () => {
  const inputs = [...document.querySelectorAll('input')];
  const email = inputs.find(i => i.type === 'email'); const pass = inputs.find(i => i.type === 'password');
  if (email && pass) {
    const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    setVal(email, 'admin@asm.com'); setVal(pass, 'admin123');
    await new Promise(r => setTimeout(r, 300));
    [...document.querySelectorAll('button')].find(b => b.textContent.match(/Sign In/i))?.click();
    return 'login submitted';
  }
  return 'already logged in';
})()
" 2>&1 | tail -1
sleep 5
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Documents')?.click(); 'nav'" 2>&1 | tail -1
sleep 3
echo "== dashboard =="
$AB eval "
(() => { const t = document.body.textContent;
  return JSON.stringify({ cards: t.includes('Total NOCs') && t.includes('Draft NOCs') && t.includes('Employees With Documents'), recent: t.includes('Recent Documents') });
})()
" 2>&1 | tail -1
$AB screenshot scripts/verify-docs2-dashboard.png >/dev/null 2>&1

echo "== noc tab: list =="
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'NOC')?.click(); 'noc tab'" >/dev/null 2>&1
sleep 2
$AB eval "(() => { const t = document.body.textContent; return JSON.stringify({ list: t.includes('All NOCs'), folders: t.includes('Client Folders'), search: t.includes('Create NOC') }); })()" 2>&1 | tail -1

echo "== create workspace: fill + multi-select =="
$AB eval "[...document.querySelectorAll('button')].filter(b => b.textContent.includes('Create NOC'))[0]?.click(); 'create'" 2>&1 | tail -1
sleep 2
$AB eval "
(() => {
  const setVal = (el, v) => { const p = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const inputs = [...document.querySelectorAll('input')];
  const byPh = (p) => inputs.find(i => i.placeholder === p);
  setVal(byPh('M/S PROSCAPE LLC'), 'M/S UI TEST LLC');
  setVal(byPh('ARABIAN RANCHES'), 'UI PROJECT');
  setVal(byPh('Business Bay-Bay Square'), 'Test Street 1');
  setVal(byPh('Dubai'), 'Dubai');
  setVal(byPh('UAE'), 'UAE');
  return 'details filled';
})()
" 2>&1 | tail -1
$AB eval "
(() => {
  const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const search = [...document.querySelectorAll('input')].find(i => i.placeholder?.startsWith('Search by name'));
  setVal(search, 'a'); return 'search open';
})()
" 2>&1 | tail -1
sleep 2
$AB eval "
(() => {
  const boxes = [...document.querySelectorAll('label input[type=checkbox]')];
  boxes.slice(0, 2).forEach(b => { if (!b.checked) b.click(); });
  return 'ticked ' + Math.min(2, boxes.length);
})()
" 2>&1 | tail -1
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Add selected'))?.click(); 'added'" 2>&1 | tail -1
sleep 1
$AB eval "document.querySelectorAll('table tbody tr').length + ' rows in NOC table'" 2>&1 | tail -1

echo "== warnings + preview + generate =="
$AB eval "(() => document.body.textContent.includes('missing a passport number') ? 'warning shown' : 'no warning')" 2>&1 | tail -1
$AB eval "
(() => {
  const firstRow = [...document.querySelectorAll('table tbody input')];
  if (firstRow.length > 4) {
    const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    setVal(firstRow[4], 'UP000111');
  }
  return 'passport filled';
})()
" 2>&1 | tail -1
sleep 2
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Preview NOC'))?.click(); 'preview'" 2>&1 | tail -1
sleep 5
$AB eval "(() => { const f = document.querySelector('iframe[title=\"NOC PDF\"]'); return f && f.src.startsWith('blob:') ? 'preview iframe ok' : 'NO PREVIEW'; })()" 2>&1 | tail -1
$AB screenshot scripts/verify-docs2-preview.png >/dev/null 2>&1
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Confirm & Generate'))?.click(); 'generate'" 2>&1 | tail -1
sleep 6
$AB eval "
(() => { const t = document.body.textContent;
  const m = t.match(/NOC-2026-\d{6}/);
  return JSON.stringify({ complete: t.includes('NOC Generated'), stored: t.includes('Automatically stored'), number: m ? m[0] : null });
})()
" 2>&1 | tail -1
$AB screenshot scripts/verify-docs2-generated.png >/dev/null 2>&1

echo "== template settings =="
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'NOC Template')?.click(); 'template tab'" >/dev/null 2>&1
sleep 2
$AB eval "
(() => {
  const ta = document.querySelector('textarea');
  const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  setVal(ta, 'UI test wording for {{company}} — updated.');
  setTimeout(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Save Template'))?.click(), 200);
  return 'template edited';
})()
" 2>&1 | tail -1
sleep 2
$AB eval "(() => document.body.textContent.includes('NOC template saved') ? 'template saved toast' : 'toast check')" 2>&1 | tail -1

echo "== employee detail page docs =="
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Employees')?.click(); 'employees'" >/dev/null 2>&1
sleep 2
$AB eval "
(() => {
  const link = [...document.querySelectorAll('a, button, tr')].find(el => el.textContent?.includes('Jyothilal Reji'));
  link?.click(); return 'opened employee';
})()
" 2>&1 | tail -1
sleep 3
$AB eval "(() => { const t = document.body.textContent; return JSON.stringify({ docsSection: t.includes('Passport') && t.includes('ID Card') && t.includes('Visa') && t.includes('Missing'), detail: t.includes('Employee ID') }); })()" 2>&1 | tail -1
$AB screenshot scripts/verify-docs2-detail.png >/dev/null 2>&1

echo "E2E COMPLETE"
