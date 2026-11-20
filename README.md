# AI 书签整理助手 (AI Bookmark Organizer)

基于 Google Chrome 官方 **Build with AI / Modern Web Guidance (`chrome-extensions` skill)** 构建的 Manifest V3 书签整理扩展。

## 核心设计

- **原生同步安全**：直接调用 `chrome.bookmarks` API 操作书签树，兼容 Chrome Sync，不会与云端同步产生冲突覆盖。
- **近期分类 + 历史归档**：将近期活跃书签与书签栏散落书签交由 AI 按主题归类，历史旧书签与临时链接统一归入「历史归档」。
- **本地先算账 + 脱敏**：本地完成精确 URL 去重与空文件夹清理；发送给 AI 前自动剥离敏感 Query 参数及不可见零宽字符。
- **三种 AI 模式**：
  1. **Chrome 内置 AI (`LanguageModel` Prompt API)**：零配置、完全离线运行。
  2. **自定义 AI API（BYOK）**：支持 OpenAI 兼容接口（OpenAI / DeepSeek / 阿里云百炼 / 硅基流动 / OpenRouter / 本地 Ollama）、Claude、Gemini；自定义中转域名通过 `optional_host_permissions` 按需动态授权。
  3. **免 Key 提示词模式**：一键复制脱敏清单与提示词给网页版 AI，粘回 JSON 即可预览并应用。
- **快照备份与一键撤销**：每次应用整理前自动保存本地书签树快照，支持一键回滚或导出 JSON 备份。

## 目录结构

- `manifest.json` — Manifest V3 清单（遵循最小权限原则）
- `src/background/service-worker.js` — 扩展后台（点击图标打开 Side Panel，无全局可变状态）
- `src/core/` — 纯 JS 核心引擎（分析、脱敏、AI 客户端、规划校验、快照、应用执行）
- `src/sidepanel/` — 侧边栏主界面（概览 → AI 预览 → 应用/撤销）
- `src/options/` — 设置页（AI 提供商配置、动态域名授权、连接测试、快照管理）
- `CHROMEWEBSTORE.md` — Chrome Web Store 上架元数据、权限说明与合规清单
- `PRIVACY.md` — 隐私政策文档
- `.agents/skills/` — 官方 `modern-web-guidance` 与 `chrome-extensions` 技能

## 本地开发与测试

```bash
# 运行核心逻辑单元测试
npm test

# 重新生成图标 (16/48/128 PNG)
npm run icons

# 检查 Web 平台现代规范兼容性
npm run scan:mwg

# 打包为可提交 Chrome Web Store 的 ZIP
npm run package
```

### 在 Chrome 中加载测试
1. 打开 `chrome://extensions` 并启用右上角 **开发者模式**
2. 点击 **加载已解压的扩展程序**，选择本项目根目录
3. 点击浏览器工具栏扩展图标即可打开侧边栏体验
