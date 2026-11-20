# Privacy Policy for AI Bookmark Organizer (AI 书签整理助手)

Last updated: 2026-11-20

## Overview

AI Bookmark Organizer ("the Extension") helps you analyze, deduplicate, categorize, and archive your Chrome bookmarks. Your privacy is central to how this extension is built.

## What Data the Extension Accesses

- **Web History (Bookmarks Data)**: Bookmark IDs, titles, URLs, folder structure, and timestamps (`dateAdded`, `dateLastUsed`) accessed via Chrome's `chrome.bookmarks` API when you open and run analysis in the extension. The extension does **not** inject content scripts, does **not** read webpage DOM content, and does **not** access `chrome.history`.
- **Authentication Information (User-Provided API Keys)**: If you choose a cloud AI provider in Settings, your self-provided API key and endpoint settings are saved locally in `chrome.storage.local` so you do not have to re-enter them.

## How Data Is Stored

- All settings, API keys, and pre-organization bookmark snapshots are stored **locally** on your device using `chrome.storage.local`.
- The developer operates **no backend server** and never collects, views, stores, or sells your bookmarks or API keys.

## How Data Is Transmitted Off-Device

- **Chrome Built-in AI Mode & No-Key Web AI Mode**: All bookmark processing stays 100% on your device; the extension makes zero network requests.
- **Configured Cloud / Custom AI API Mode**: When you explicitly click to run AI categorization, the extension sends only your bookmark titles and sanitized URLs (query parameters stripped by default to protect tokens/secrets), authenticated with your own API key, directly from your browser to the AI API endpoint you configured (for example OpenAI, DeepSeek, Anthropic, Google Gemini, or your custom endpoint). Please refer to your chosen AI provider's privacy policy for how they handle API requests.

## Data Retention and Deletion

- Bookmark snapshots and settings remain in local browser storage until you click "Clear Snapshot" ("清除本地快照") in Settings or uninstall the extension.

## Contact

For privacy questions or feedback, please open an issue on the project's GitHub repository: https://github.com/huhichao/ai-bookmark-organizer/issues
