#!/bin/bash
# Task 21-c browser E2E — the user's EXACT failing message, REAL client loop:
# "IN SETTINGS CHANGE COMPANY SHORT NAME TO BCC"
# Expected: navigate Settings → read → fill Brand text with BCC → Apply Settings →
# clear confirmation + sidebar shows BCC. NO fake step line, NO silent stop.
set -u
cd /home/z/my-project
OUT=scripts/t21c-e2e.log
: > "$OUT"
AB="agent-browser"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT"; }

log "open app"
$AB set viewport 1440 900 >>"$OUT" 2>&1
$AB open http://localhost:3000 >>"$OUT" 2>&1
sleep 3

log "login"
$AB find placeholder "Email" fill "admin@asm.com" >>"$OUT" 2>&1
$AB find placeholder "Password" fill "admin123" >>"$OUT" 2>&1
$AB find role button click --name "Sign in" >>"$OUT" 2>&1
sleep 5

log "open assistant panel"
$AB click '[aria-label="AI assistant — click to open chat, drag to move"]' >>"$OUT" 2>&1
sleep 2

log "send the user's exact message"
$AB find placeholder "Ask about employees, salaries, attendance…" fill "IN SETTINGS CHANGE COMPANY SHORT NAME TO BCC" >>"$OUT" 2>&1
$AB find role button click --name "Send message" >>"$OUT" 2>&1

log "poll agent loop (max 210s)"
DONE=""
for i in $(seq 1 42); do
  sleep 5
  ST=$($AB eval "JSON.stringify(window.__asmAgentDebug ? window.__asmAgentDebug() : null)" 2>>"$OUT" | tail -1)
  log "poll $i: $ST"
  echo "$ST" | grep -q '"status":"done"' && DONE=1 && break
  echo "$ST" | grep -q '"status":"failed"' && break
done

log "final debug state: $ST"
log "---- chat transcript (assistant messages) ----"
$AB eval "JSON.stringify(Array.from(document.querySelectorAll('[data-asm-assistant] .text-sm, [data-asm-assistant] [class*=text-]')).map(n=>n.textContent).filter(t=>t&&t.trim()).slice(-8))" 2>>"$OUT" | tail -3

log "---- verification ----"
$AB eval "JSON.stringify({brandInput: (document.querySelector('#brandName')||{}).value, companyInput: (document.querySelector('#companyName')||{}).value, sidebarBrand: (document.querySelector('.asm-gradient-text')||{}).textContent})" 2>>"$OUT" | tail -2
$AB screenshot scripts/qa-task21c-settings-agent.png >>"$OUT" 2>&1
log "screenshot saved: scripts/qa-task21c-settings-agent.png"
$AB close >>"$OUT" 2>&1
log "E2E finished"
