// eval script: inspect Browser Move Test rows at both sites
(() => {
  const spans = document.evaluate("//*[contains(text(),'Browser Move Test')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  const seen = {};
  const out = [];
  for (let i = 0; i < spans.snapshotLength; i++) {
    const n = spans.snapshotItem(i);
    const row = n.closest('.flex.items-stretch');
    if (!row) continue;
    let site = 'unknown';
    let el = row;
    while (el && el.parentElement) {
      el = el.parentElement;
      const m = (el.innerText || '').match(/(Riyadh Tower Site|Jeddah Mall Project)/);
      if (m) { site = m[1]; break; }
    }
    if (seen[site]) continue;
    seen[site] = true;
    const q = (day) => {
      const c = row.querySelector('button[data-cell="' + day + '"]');
      if (!c) return 'merged';
      const ro = c.getAttribute('tabindex') === '-1';
      return (c.textContent || '(empty)') + '/' + (ro ? 'ro' : 'edit');
    };
    // merged cell labels
    const merged = Array.from(row.querySelectorAll('.flex.items-center.justify-center'))
      .filter(d => (d.className || '').includes('bg-slate-700/40'))
      .map(d => (d.textContent || '').trim()).filter(Boolean);
    out.push({ site, faded: String(row.className).includes('opacity'), d1: q(1), d2: q(2), d3: q(3), mergedCells: merged });
  }
  return JSON.stringify(out);
})()
