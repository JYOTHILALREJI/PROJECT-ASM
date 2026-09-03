#!/bin/bash
# One-shot UI test for the Documents module: start server, login, build a NOC,
# verify archive/viewer/download, then exercise Employee Documents.
set +e
cd /home/z/my-project

pkill -f "next dev" 2>/dev/null
sleep 2
nohup node node_modules/next/dist/bin/next dev -p 3000 >> scripts/dev-server.log 2>&1 &
sleep 10
curl -s -o /dev/null -w "server:%{http_code}\n" http://localhost:3000 --max-time 60

AB="agent-browser"

echo "== open + login =="
$AB open http://localhost:3000 >/dev/null 2>&1
sleep 4
$AB eval "
(async () => {
  const setVal = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')];
  const email = inputs.find(i => i.type === 'email' || i.placeholder?.match(/email/i));
  const pass = inputs.find(i => i.type === 'password');
  if (!email || !pass) return 'no login form (already logged in?)';
  setVal(email, 'admin@asm.com');
  setVal(pass, 'admin123');
  await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('button')].find(b => b.textContent.match(/Sign In/i))?.click();
  return 'submitted';
})()
" 2>&1 | tail -1
sleep 5

echo "== navigate to Documents =="
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Documents')?.textContent || 'NOT FOUND'" 2>&1 | tail -1
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Documents')?.click(); 'clicked'" 2>&1 | tail -1
sleep 3
$AB eval "document.body.textContent.includes('Automated NOC letters') ? 'documents page open' : 'documents page MISSING'" 2>&1 | tail -1

echo "== fill client details =="
$AB eval "
(() => {
  const setVal = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')];
  const byPlaceholder = (p) => inputs.find(i => i.placeholder === p);
  setVal(byPlaceholder('M/S PROSCAPE LLC'), 'M/S PROSCAPE LLC');
  setVal(byPlaceholder('ARABIAN RANCHES'), 'ARABIAN RANCHES');
  const ta = document.querySelector('textarea');
  if (ta) setVal(ta, 'Business Bay-Bay Square\nDubai, UAE');
  return 'client fields set';
})()
" 2>&1 | tail -1

echo "== pick employees from DB =="
$AB eval "
(() => {
  const setVal = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const search = [...document.querySelectorAll('input')].find(i => i.placeholder?.startsWith('Search by name'));
  if (!search) return 'no search input';
  setVal(search, 'a');
  return 'searched';
})()
" 2>&1 | tail -1
sleep 2
$AB eval "
(() => {
  const opts = [...document.querySelectorAll('button')].filter(b => b.closest('div')?.className?.includes('rounded-lg border border-slate-700') && b.querySelector('.text-sm'));
  const pick = [...document.querySelectorAll('div.absolute button, div[class*=mt-1] button')].filter(b => b.querySelector('.text-slate-200'));
  if (!pick.length) return 'no options';
  pick[0].click();
  return 'picked: ' + pick[0].querySelector('.text-slate-200').textContent;
})()
" 2>&1 | tail -1
sleep 1
$AB eval "
(() => {
  const search = [...document.querySelectorAll('input')].find(i => i.placeholder?.startsWith('Search by name'));
  const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  setVal(search, 'e');
  return 'search2';
})()
" 2>&1 | tail -1
sleep 2
$AB eval "
(() => {
  const pick = [...document.querySelectorAll('div.absolute button, div[class*=mt-1] button')].filter(b => b.querySelector('.text-slate-200'));
  if (!pick.length) return 'no options 2';
  pick[0].click();
  return 'picked2: ' + pick[0].querySelector('.text-slate-200').textContent;
})()
" 2>&1 | tail -1

echo "== edit a cell + add blank row =="
$AB eval "
(() => {
  const rowInput = [...document.querySelectorAll('table input')];
  if (rowInput.length < 5) return 'table too small';
  const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  setVal(rowInput[1], 'EDITED NAME TEST');
  return 'edited first row name';
})()
" 2>&1 | tail -1
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Blank row'))?.click(); 'blank added'" 2>&1 | tail -1
sleep 1
$AB eval "
(() => {
  const tables = [...document.querySelectorAll('table')];
  const rows = tables[0] ? tables[0].querySelectorAll('tbody tr').length : 0;
  return 'table rows now: ' + rows;
})()
" 2>&1 | tail -1
# remove the blank row again (last X button)
$AB eval "
(() => {
  const btns = [...document.querySelectorAll('table tbody button[title=\\\"Remove row\\\"]')];
  btns[btns.length - 1]?.click();
  return 'blank row removed';
})()
" 2>&1 | tail -1

echo "== sort by Name =="
$AB eval "
(() => {
  const th = [...document.querySelectorAll('th button')].find(b => b.textContent.includes('Name'));
  th?.click(); return th ? 'sorted asc' : 'no header';
})()
" 2>&1 | tail -1

echo "== preview NOC =="
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Preview NOC'))?.click(); 'preview clicked'" 2>&1 | tail -1
sleep 6
$AB eval "
(() => {
  const f = document.querySelector('iframe[title=\"NOC PDF\"]');
  return f && f.src ? 'iframe live: ' + f.src.slice(0, 30) : 'NO IFRAME';
})()
" 2>&1 | tail -1
$AB screenshot scripts/verify-docs-preview.png >/dev/null 2>&1

echo "== confirm & prepare NOC =="
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Confirm & Prepare NOC'))?.click(); 'save clicked'" 2>&1 | tail -1
sleep 7
$AB eval "
(() => {
  const f = document.querySelector('iframe[title=\"NOC PDF\"]');
  const archive = document.body.textContent.includes('NOC Archive');
  const file = document.body.textContent.match(/NOC PROSCAPE[^\"']*\.(pdf)/);
  return 'iframe: ' + (f && f.src ? 'yes' : 'no') + ' | archive: ' + archive + ' | saved file: ' + (document.body.textContent.includes('NOC PROSCAPE LLC ARABIAN RANCHES'));
})()
" 2>&1 | tail -1

echo "== archive grouping =="
$AB eval "
(() => {
  const t = document.body.textContent;
  return JSON.stringify({
    clientFolder: t.includes('M/S PROSCAPE LLC'),
    monthGroup: t.includes('September 2026'),
  });
})()
" 2>&1 | tail -1
$AB screenshot scripts/verify-docs-saved.png >/dev/null 2>&1

echo "== print button triggers iframe print =="
$AB eval "
(() => {
  const printBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Print'));
  let called = false;
  const orig = HTMLIFrameElement.prototype;
  printBtn?.click();
  return printBtn ? 'print clicked' : 'no print button';
})()
" 2>&1 | tail -1
sleep 2
$AB eval "document.querySelectorAll('iframe').length + ' iframes on page (print iframe appears)' " 2>&1 | tail -1

echo "== employee documents tab =="
$AB eval "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Employee Documents'))?.click(); 'tab clicked'" 2>&1 | tail -1
sleep 2
$AB eval "
(() => {
  const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const search = [...document.querySelectorAll('input')].find(i => i.placeholder?.startsWith('Search employee'));
  if (!search) return 'no employee search';
  setVal(search, 'a');
  return 'searched employees';
})()
" 2>&1 | tail -1
sleep 2
$AB eval "
(() => {
  const pick = [...document.querySelectorAll('div.absolute button, div[class*=mt-1] button')].filter(b => b.querySelector('.text-slate-200'));
  if (!pick.length) return 'no employee options';
  pick[0].click();
  return 'selected employee';
})()
" 2>&1 | tail -1
sleep 2
$AB eval "
(() => {
  const t = document.body.textContent;
  return JSON.stringify({ passport: t.includes('Passport'), idCard: t.includes('ID Card'), visa: t.includes('Visa'), other: t.includes('Other Documents') });
})()
" 2>&1 | tail -1

echo "== upload passport scan via file input =="
cat > /tmp/demo-passport.pdf.make.py << 'PY'
import fitz
doc = fitz.open(); p = doc.new_page(); p.insert_text((72,100), "Passport Scan Demo", fontsize=22); doc.save('/tmp/demo-passport.pdf'); doc.close()
PY
python3 /tmp/demo-passport.pdf.make.py
$AB eval "
(() => {
  const inp = [...document.querySelectorAll('input[type=file]')][0];
  if (!inp) return 'no file input';
  inp.style.display = 'block'; inp.style.opacity = '1'; inp.style.position = 'static';
  return 'file input revealed';
})()
" 2>&1 | tail -1
$AB upload "input[type=file]:not([style*='display: none'])" /tmp/demo-passport.pdf 2>&1 | tail -1 || $AB upload "input[type=file]" /tmp/demo-passport.pdf 2>&1 | tail -1
sleep 4
$AB eval "
(() => {
  const t = document.body.textContent;
  return t.includes('demo-passport.pdf') ? 'passport doc listed' : 'doc NOT listed';
})()
" 2>&1 | tail -1
$AB screenshot scripts/verify-docs-employee.png >/dev/null 2>&1

echo "== rename document =="
$AB eval "
(() => {
  const btn = [...document.querySelectorAll('button[title=Rename]')][0];
  btn?.click(); return btn ? 'rename opened' : 'no rename btn';
})()
" 2>&1 | tail -1
sleep 1
$AB eval "
(() => {
  const dlg = document.querySelector('[role=alertdialog] input, [data-slot=alert-dialog-content] input, .bg-slate-800.border-slate-700 input');
  if (!dlg) return 'no dialog input';
  const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  setVal(dlg, 'Passport Scan 2026 (demo)');
  return 'typed name';
})()
" 2>&1 | tail -1
$AB eval "
(() => {
  const dlg = [...document.querySelectorAll('[role=alertdialog]')].find(d => d.textContent.includes('Rename document'));
  const save = [...(dlg?.querySelectorAll('button') || [])].find(b => b.textContent.includes('Save'));
  save?.click(); return save ? 'saved' : 'no save';
})()
" 2>&1 | tail -1
sleep 2
$AB eval "document.body.textContent.includes('Passport Scan 2026 (demo)') ? 'rename OK' : 'rename FAILED'" 2>&1 | tail -1

echo "== delete document =="
$AB eval "
(() => {
  const btn = [...document.querySelectorAll('button[title=Delete]')][0];
  btn?.click(); return btn ? 'delete opened' : 'no delete btn';
})()
" 2>&1 | tail -1
sleep 1
$AB eval "
(() => {
  const dlg = [...document.querySelectorAll('[role=alertdialog]')].find(d => d.textContent.includes('Delete this document?'));
  const del = [...(dlg?.querySelectorAll('button') || [])].find(b => b.textContent.includes('Delete'));
  del?.click(); return del ? 'confirmed' : 'no confirm';
})()
" 2>&1 | tail -1
sleep 2
$AB eval "document.body.textContent.includes('demo-passport.pdf') ? 'still there (FAIL)' : 'doc deleted OK'" 2>&1 | tail -1

echo "== final screenshots =="
$AB screenshot scripts/verify-docs-final.png >/dev/null 2>&1
echo "UI TEST COMPLETE"
