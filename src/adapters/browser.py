"""Explicit browser fallback for user-approved sites only."""

from __future__ import annotations

from .html import fetch as fetch_html


def fetch(company: str, url: str, timeout_ms: int = 20_000) -> list[dict[str, object]]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError(
            "browser fallback requested but Playwright is not installed; "
            "install it explicitly with 'python -m pip install playwright' "
            "and 'python -m playwright install chromium'"
        ) from exc

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            rendered_html = page.content()

            class RenderedPage:
                def get_text(self, _url: str) -> str:
                    return rendered_html

            return fetch_html(company, url, RenderedPage())
        finally:
            browser.close()
