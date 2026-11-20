# AI Bookmark Organizer — Agent Guidelines

This project is a Chrome Extension (Manifest V3) built following Chrome's official **Build with AI / Modern Web Guidance** workflow.

## Installed Skills

- `.agents/skills/chrome-extensions/SKILL.md` — Manifest V3 rules, extension APIs, and Chrome Web Store submission workflow.
- `.agents/skills/modern-web-guidance/SKILL.md` — Modern Web platform guidance and `LanguageModel` (Prompt API) usage.

## Mandatory Rules

1. **Follow `chrome-extensions` skill guidance** whenever creating or modifying any extension file (`manifest.json`, service worker, side panel, options, permissions).
2. **Keep `CHROMEWEBSTORE.md` in sync**: Whenever permissions, user-facing features, privacy behavior, icons, or version change, update `CHROMEWEBSTORE.md` (and `PRIVACY.md` if data practices change).
3. **Always Manifest V3**:
   - Use `async`/`await` (no `.then()` chains).
   - No inline `<script>` or inline event handlers in HTML.
   - Do not store mutable state in service worker globals; use `chrome.storage`.
   - Call `chrome.permissions.request()` synchronously on user gesture before any `await`.
   - Never use `eval()`, `new Function()`, or remote code execution.
4. **Verify before finishing**:
   - Run `npm test` (`node --test tests/*.test.mjs`) to verify pure core logic.
   - Verify all referenced icons exist at exact declared pixel dimensions.
