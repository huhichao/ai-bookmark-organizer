# Privacy Policy for AI 书签整理助手

Last updated: 2026-11-20

## Overview

AI 书签整理助手 ("the Extension") helps you analyze, deduplicate, categorize, and archive your Chrome bookmarks. Your privacy is central to how this extension is built.

## What Data the Extension Accesses

- **Bookmarks Data**: Bookmark IDs, titles, URLs, folder structure, and timestamps (`dateAdded`, `dateLastUsed`) accessed via Chrome's `chrome.bookmarks` API when you open and run analysis in the extension.
- **User Configuration**: Your selected AI mode, model name, custom Base URL, API Key (if provided), and organization preferences (such as recent cutoff days).

## How Data Is Stored

- All settings, API keys, and pre-organization bookmark snapshots are stored **locally** on your device using `chrome.storage.local`.
- The developer operates **no backend server** and never collects, views, stores, or sells your bookmarks or API keys.

## How Data Is Transmitted Off-Device

- **Chrome Built-in AI Mode & Manual Prompt Mode**: All bookmark processing stays 100% on your device; the extension makes zero network requests.
- **Configured Cloud / Custom AI API Mode**: When you explicitly click to run AI categorization, the extension sends only your bookmark titles and sanitized URLs (query parameters stripped by default to protect tokens/secrets) directly from your browser to the AI API endpoint you configured (for example OpenAI, DeepSeek, Anthropic, Google Gemini, or your custom endpoint). Please refer to your chosen AI provider's privacy policy for how they handle API requests.

## Data Retention and Deletion

- Bookmark snapshots and settings remain in local browser storage until you click "清除本地缓存/快照" in Settings or uninstall the extension.

## Contact

For privacy questions or feedback, please open an issue on the project's GitHub repository: https://github.com/huhichao/ai-bookmark-organizer/issues
