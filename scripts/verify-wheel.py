#!/usr/bin/env python3
"""Real mouse-wheel scroll verification for the uniform registry employee combobox."""
import sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:3000'


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = ctx.new_page()
        page.goto(BASE, wait_until='networkidle')

        # login if needed
        if page.get_by_placeholder('Email address').count() > 0 or page.locator('input[type=email]').count() > 0:
            page.locator('input[type=email]').fill('admin@asm.com')
            page.locator('input[type=password]').fill('admin123')
            page.locator('button[type=submit], button:has-text("Log In")').first.click()
            page.wait_for_timeout(2500)

        # navigate to Materials Registry via sidebar
        page.locator('button:has-text("Materials Registry")').first.click()
        page.wait_for_timeout(1500)
        page.locator('button:has-text("New Entry")').first.click()
        page.wait_for_timeout(800)

        # open employee combobox
        page.locator('button:has-text("Search employee...")').first.click()
        page.wait_for_timeout(800)

        info = page.evaluate("""() => {
            const el = document.querySelector('[cmdk-list]');
            const r = el.getBoundingClientRect();
            return {x: r.x, y: r.y, w: r.width, h: r.height, scrollTop: el.scrollTop,
                    scrollHeight: el.scrollHeight, clientHeight: el.clientHeight};
        }""")
        print('list rect:', info)

        cx = info['x'] + info['w'] / 2
        cy = info['y'] + info['h'] / 2

        # Move mouse over the list and wheel down
        page.mouse.move(cx, cy)
        page.mouse.wheel(0, 400)
        page.wait_for_timeout(500)
        after = page.evaluate("document.querySelector('[cmdk-list]').scrollTop")
        print(f'scrollTop after wheel(0,400): {after}')
        page.mouse.wheel(0, 400)
        page.wait_for_timeout(500)
        after2 = page.evaluate("document.querySelector('[cmdk-list]').scrollTop")
        print(f'scrollTop after wheel(0,800 cumulative): {after2}')

        # also verify synthetic cancelable wheel is not prevented (react-remove-scroll check)
        prevented = page.evaluate("""() => {
            const el = document.querySelector('[cmdk-list]');
            const r = el.getBoundingClientRect();
            const ev = new WheelEvent('wheel', {bubbles: true, cancelable: true, deltaY: 120,
                                                clientX: r.x + r.width/2, clientY: r.y + r.height/2});
            el.dispatchEvent(ev);
            return ev.defaultPrevented;
        }""")
        print(f'synthetic wheel defaultPrevented: {prevented}')

        ok = after > 0 or after2 > 0
        print('WHEEL SCROLL:', 'WORKS ✅' if ok else 'BLOCKED ❌')
        browser.close()
        sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
