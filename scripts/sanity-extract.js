// Sanity check: extractJsonObject multi-object handling (run with tsx/ts-node-free approach: transpile inline).
const s = '{"action":{"type":"fill","field":"Site Name","value":"QA Agent Site 21"},"thought":"x"}\n{"action":{"type":"fill","field":"Client","value":"M/S NPC LLC"}}';
const cleaned = s;
const first = cleaned.indexOf('{');
let depth = 0, inStr = false, esc = false, found = null;
for (let i = first; i < cleaned.length; i++) {
  const ch = cleaned[i];
  if (esc) { esc = false; }
  else if (ch === '\\') { esc = true; }
  else if (ch === '"') { inStr = !inStr; }
  else if (!inStr) {
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { found = cleaned.slice(first, i + 1); break; }
    }
  }
}
const parsed = JSON.parse(found);
console.log('FIRST OBJ field:', parsed.action.field, '| value:', parsed.action.value);
if (parsed.action.field === 'Site Name' && parsed.action.value === 'QA Agent Site 21') console.log('SANITY OK');
else { console.log('SANITY FAIL'); process.exit(1); }
