# Chrome Web Store Listing — AI 书签整理助手

> Last Updated: 2026-11-20

## Store Listing

**Extension Name** [REQUIRED]
AI 书签整理助手

**Short Description** [REQUIRED]
使用 Chrome 内置 AI 或自定义大模型 API 分批整理书签：近期书签智能分类、历史书签自动归档、重复项清理，先预览后生效，支持一键撤销。

**Detailed Description** [REQUIRED]
帮助你将杂乱的浏览器书签按“近期常用 + 历史归档”高效整理清楚，全程先预览确认、再安全执行，并支持随时一键还原。

核心功能
1. 书签体检概览：快速统计书签总数、重复网址数量、空文件夹数量以及近期活跃书签分布。
2. 多种 AI 模式自由选择：支持浏览器本地内置 AI（免配置离线可用）、自定义 OpenAI 兼容 / DeepSeek / Claude / Gemini / 本地 Ollama 接口，以及免 Key 的提示词导出-JSON 粘回模式。
3. 近期分类与历史归档：将近期新增或书签栏散落的书签按主题整理到清晰的文件夹，将早期旧书签、过期链接完整移入「历史归档」，不丢失任何收藏。
4. 自动去重与清理：安全移除完全重复的网址并保留最新记录，自动清理空文件夹与标题中的不可见乱码字符。
5. 预览与一键撤销：整理前先生成树状预览供你确认；执行前自动保存本地快照，不满意可随时一键恢复或导出备份文件。

隐私与安全说明
你的 API Key 与书签快照仅保存在本地浏览器中。扩展不会收集、上传或出售你的书签数据到开发者服务器；当你主动使用云端模型时，仅会发送脱敏后的书签标题与简化网址（自动剔除查询参数中的敏感字段）到你自行指定的模型服务商。

开源与反馈
本项目采用 MIT 协议开源，欢迎在 GitHub 查阅源码或提交建议与反馈：
https://github.com/huhichao/ai-bookmark-organizer

**Official Website / Homepage URL** [RECOMMENDED]
https://github.com/huhichao/ai-bookmark-organizer

**Support URL** [RECOMMENDED]
https://github.com/huhichao/ai-bookmark-organizer/issues

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Analyzes and organizes browser bookmarks into categorized recent folders and historical archives with deduplication and snapshot undo.

**Primary Language** [REQUIRED]
Chinese (Simplified)

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ✅ Ready | `assets/store-screenshot-1.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ✅ Ready | `assets/store-screenshot-2.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |

### Screenshot Notes
- Screenshot 1: Side panel showing bookmark audit summary + AI categorization preview tree before applying.
- Screenshot 2: Options page showing AI provider selection (Built-in AI / BYOK API / Prompt export mode) and snapshot backup controls.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `bookmarks` | permissions | Required to read the user's bookmark tree for analysis, create organized category and archive folders, move bookmarks, update cleaned titles, remove exact duplicate URLs, and restore snapshots on undo. |
| `storage` | permissions | Required to save user AI provider settings locally and store pre-organization bookmark tree snapshots so users can undo changes at any time. |
| `sidePanel` | permissions | Required to display the interactive bookmark analysis, preview, and one-click apply/undo interface in Chrome's side panel alongside browsing. |
| Official AI API hosts (`api.openai.com`, `api.deepseek.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `dashscope.aliyuncs.com`, `openrouter.ai`, `api.siliconflow.cn`, `localhost`, `127.0.0.1`) | host_permissions | Required so the extension can send sanitized bookmark titles and URL origins directly to the AI API endpoint chosen and configured by the user. |
| `https://*/*`, `http://*/*` | optional_host_permissions | Requested dynamically at runtime only when the user explicitly enters a custom third-party AI API Base URL in Settings and clicks to authorize that specific origin. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes (only user-initiated transmission to user-configured AI endpoints; zero developer-side collection)

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | Yes (User API Key stored locally) | Only as Authorization header to user-chosen AI endpoint | Authenticate user-configured AI model requests | No (only user's chosen AI provider) |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | No | No | — | No |
| User activity | No | No | — | No |
| Website content | Bookmark titles & sanitized URLs only | Only when user runs cloud AI classification | Categorize bookmarks into folders | Only user's chosen AI provider |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used or transferred for purposes unrelated to the item's core functionality
- [x] Data is NOT used or transferred to determine creditworthiness or for lending purposes

### Privacy Policy URL
- Public URL: `https://github.com/huhichao/ai-bookmark-organizer/blob/main/PRIVACY.md` (or enable GitHub Pages and point to the rendered page before CWS submission)

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 0.1.2 | 2026-11-20 | Move Side Panel status feedback to a sticky color-coded banner below the header, add button loading states, and auto-sync settings changes from Options. |
| 0.1.1 | 2026-11-20 | Show inline AI connection/validation status directly in Options AI card, add 20s fetch timeout, and skip redundant permission prompts for pre-granted manifest hosts. |
| 0.1.0 | 2026-11-20 | Initial Manifest V3 project scaffold with side panel UI, snapshot undo, local analyzer/dedup, Built-in AI + BYOK + manual JSON modes. |
