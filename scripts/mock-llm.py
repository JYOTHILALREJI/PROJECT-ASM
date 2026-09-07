#!/usr/bin/env python3
"""Deterministic OpenAI-compatible mock LLM for agent E2E testing.

Listens on :9999 and serves POST /v1/chat/completions. Responses are chosen by
scanning the request payload:

  • the model-identity question → echoes the identity line found in the SYSTEM
    prompt (proves the route really injects the model name);
  • "mark all employees present … all sites" → ONE attendance_mark action;
  • "… at Site A" → attendance_mark restricted to Site A;
  • observation "✅ Bulk attendance complete" → final confirmation answer
    (echoing the counts from the observation);
  • observation with a per-site toast ("Site Alpha") → another ACTION (the
    multi-target continuation guard must keep the loop going).

Run:  setsid python3 scripts/mock-llm.py &
"""
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer


def decide(payload: dict) -> str:
    msgs = payload.get('messages', [])
    text = json.dumps(msgs, ensure_ascii=False)
    # Intent comes from the latest REAL user turn. Context injections like
    # "[REMINDER] …" / "[AGENT OBSERVATION] …" are role=user too but always
    # start with '[', so they are excluded — and the daily session keeps
    # earlier questions in history, so only the LAST real turn counts.
    real_user = [m.get('content', '') for m in msgs if m.get('role') == 'user' and not m.get('content', '').startswith('[')]
    last_real = real_user[-1] if real_user else ''

    # 1) macro finished → final confirmation
    mo = re.search(r'✅ Bulk attendance complete — (\d+) employee\(s\) marked as ([^ ]+)[\s\S]*?across ([^.]+)\.', text)
    if mo:
        return json.dumps({'answer': f"✅ All done — we marked {mo.group(1)} employees {mo.group(2)} across {mo.group(3)}. The Attendance grid is refreshed."})

    # 2) multi-target partial success → pretend to finish early (premature
    #    final), then after the route's stern retry, continue with an action —
    #    proving the deterministic premature-final guard really flips it.
    if 'AGENT OBSERVATION' in text and 'Site Alpha' in text:
        if 'PREMATURE' in text:
            return json.dumps({'action': {'type': 'click', 'text': 'Mark all as Present'},
                               'thought': 'continuing with the next site'})
        return json.dumps({'answer': '✅ Done — Site Alpha is marked present for today.'})

    # 3) identity question (latest real user turn only) → echo the identity line from the system prompt
    if 'which model do you use now' in last_real:
        m = re.search(r'powered by the (.+?)\.', text)
        if m:
            ident = m.group(1).strip()
            return json.dumps(
                {'answer': f"We run on {ident} — that's the engine behind every reply and every task I do for you."})
        return json.dumps({'answer': 'IDENTITY LINE NOT FOUND IN SYSTEM PROMPT'})

    # 4) single-site request
    ms = re.search(r'mark all employees present[^"]*?at ([A-Za-z0-9 ]+?)["\\]', text)
    if ms and 'at site' in last_real.lower():
        return json.dumps({'action': {'type': 'attendance_mark', 'status': 'present', 'site': ms.group(1).strip()},
                           'thought': 'single-site bulk mark'})

    # 5) all-sites request
    if 'mark all employees present' in last_real:
        return json.dumps({'action': {'type': 'attendance_mark', 'status': 'present'},
                           'thought': 'one-shot all-sites bulk mark'})

    return json.dumps({'answer': 'Mock provider default answer.'})


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length).decode('utf-8', 'replace')
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {}
        content = decide(payload)
        body = json.dumps({
            'id': 'mock-1',
            'object': 'chat.completion',
            'model': payload.get('model', 'mock-model-1'),
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': content}, 'finish_reason': 'stop'}],
        }).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        print('MOCK served:', content[:120], flush=True)

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    HTTPServer(('127.0.0.1', 9999), Handler).serve_forever()
