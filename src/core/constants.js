export const STORAGE_KEYS = {
  SETTINGS: 'abo_settings_v1',
  SNAPSHOT: 'abo_last_snapshot_v1',
};

export const PROVIDER_PRESETS = {
  builtin: {
    id: 'builtin',
    label: 'Chrome 内置 AI (LanguageModel / Gemini Nano)',
    labelEn: 'Chrome Built-in AI (LanguageModel / Gemini Nano)',
    needsKey: false,
    needsUrl: false,
    baseUrl: '',
    model: 'gemini-nano',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    labelEn: 'OpenAI',
    needsKey: true,
    needsUrl: true,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    labelEn: 'DeepSeek',
    needsKey: true,
    needsUrl: true,
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  dashscope: {
    id: 'dashscope',
    label: '阿里云百炼 (DashScope 兼容接口)',
    labelEn: 'Alibaba DashScope (OpenAI-compatible)',
    needsKey: true,
    needsUrl: true,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  siliconflow: {
    id: 'siliconflow',
    label: '硅基流动 (SiliconFlow)',
    labelEn: 'SiliconFlow',
    needsKey: true,
    needsUrl: true,
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    labelEn: 'Anthropic Claude',
    needsKey: true,
    needsUrl: true,
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-haiku-latest',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini API',
    labelEn: 'Google Gemini API',
    needsKey: true,
    needsUrl: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
  },
  ollama: {
    id: 'ollama',
    label: '本地 Ollama (OpenAI 兼容)',
    labelEn: 'Local Ollama (OpenAI-compatible)',
    needsKey: false,
    needsUrl: true,
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
  },
  custom: {
    id: 'custom',
    label: '自定义 OpenAI 兼容接口',
    labelEn: 'Custom OpenAI-compatible Endpoint',
    needsKey: true,
    needsUrl: true,
    baseUrl: '',
    model: '',
  },
};

export function getProviderLabel(providerId, lang = 'zh_CN') {
  const preset = PROVIDER_PRESETS[providerId];
  if (!preset) return providerId;
  return lang === 'en' ? (preset.labelEn || preset.label) : preset.label;
}

export const DEFAULT_CLASSIFICATION_PROMPT = `你是一个专业的浏览器书签整理助手。
你的任务是将用户提供的书签归类到清晰简洁的主题文件夹中，并识别出明显属于一次性/过期促销/临时测试/隐私政策页的链接（归入 "__TEMP__" 特殊桶，表示放入「历史归档/临时与一次性链接」）。

分类原则：
1. 主题文件夹数量控制在 4～8 个之间，名称简短清晰（纯中文或常见英文缩写，不加多余符号），例如：AI 对话与工具、AI API与订阅、开发与技术、运维与网络、工作与项目、设计与效率。
2. 每个书签只能分配到一个目标文件夹，必须保留原始 id 不变。
3. 如果书签标题存在明显乱码、零宽字符或多余前缀，可在 rename 中给出清理后的标题；否则不要改名。`;

export const DEFAULT_CLASSIFICATION_PROMPT_EN = `You are a professional browser bookmark organizer.
Your task is to categorize the user's bookmarks into clean, concise topic folders and identify obvious one-off links, expired promos, temporary tests, or privacy-policy pages (assign those to "__TEMP__" so they go into Archive / Temporary Links).

Rules:
1. Keep topic folders between 4 and 8 with short, clear names (for example: AI Tools & Chat, AI APIs & Billing, Dev & Tech, Ops & Network, Work & Projects, Design & Productivity).
2. Assign every bookmark to exactly one folder and preserve its original id unchanged.
3. If a bookmark title contains garbled characters, zero-width formatting characters, or noisy prefixes, provide a cleaned title in "rename"; otherwise omit "rename".`;

export const PROMPT_TEMPLATES_BY_LANG = {
  zh_CN: {
    balanced: {
      id: 'balanced',
      label: '默认：综合主题 + 临时链接隔离',
      prompt: DEFAULT_CLASSIFICATION_PROMPT,
    },
    minimal_top: {
      id: 'minimal_top',
      label: '极简：常用置顶 + 精简大类',
      prompt: `你是一个追求极简的浏览器书签整理助手。
你的任务是帮用户把书签精简为最少、最顺手的顶层目录：

分类原则：
1. 优先把明显高频的日常核心入口（如主力 AI 对话、常用笔记、登录入口，控制在 5～10 条）放入「常用置顶」。
2. 其余书签按 3～5 个宽泛大类归组（例如：AI 与工具、工作与开发、生活与阅读），避免出现只有一两条的小文件夹。
3. 明显过期促销、单次测试页或一次性验证链接，归入 "__TEMP__"。
4. 保留原始 id 不变；有明显乱码或多余站点前缀时可通过 rename 精简标题。`,
    },
    dev_focus: {
      id: 'dev_focus',
      label: '研发工程向（按技术栈细分）',
      prompt: `你是一个服务资深软件工程师的书签整理助手。
请按软件研发与工程工作流对书签进行专业分组：

分类原则：
1. 推荐分类方向（按实际书签动态取舍，控制在 5～8 个文件夹）：AI 模型与 Agent、AI API与算力、前端与 UI、后端与数据库、运维与网络、产品与设计、项目与办公。
2. 一次性活动页、过期优惠、临时排查帖子或无效测试链接，归入 "__TEMP__"。
3. 保留原始 id 不变；若标题含过多 SEO 后缀或零宽不可见字符，可在 rename 中适度清洗。`,
    },
    life_work: {
      id: 'life_work',
      label: '大众通用：工作 / 学习 / 工具 / 生活',
      prompt: `你是一个面向日常用户的浏览器书签整理助手。
请用最直观通俗的日常分类方式整理书签，避免晦涩技术术语：

分类原则：
1. 尽量归入 4～6 个生活化大类：工作办公、学习资料、效率工具、AI 助手、影音娱乐、购物与生活。
2. 一次性活动页、过期优惠或临时页面，归入 "__TEMP__"。
3. 保留原始 id 不变；标题存在乱码或冗长后缀时可在 rename 中清理。`,
    },
  },
  en: {
    balanced: {
      id: 'balanced',
      label: 'Default: Balanced Topics + Temp Isolation',
      prompt: DEFAULT_CLASSIFICATION_PROMPT_EN,
    },
    minimal_top: {
      id: 'minimal_top',
      label: 'Minimal: Pinned Core + Broad Groups',
      prompt: `You are a minimalist browser bookmark organizer.
Keep the bookmarks bar as clean and compact as possible:

Rules:
1. Put obvious daily core portals (main AI chats, notes, login portals; 5–10 items max) into "Pinned Core".
2. Group the rest into 3–5 broad folders (e.g., AI & Tools, Work & Dev, Reading & Life); avoid tiny 1-item folders.
3. Send expired promos, one-off pages, or temporary test links to "__TEMP__".
4. Keep every original id unchanged; clean garbled prefixes via "rename" if needed.`,
    },
    dev_focus: {
      id: 'dev_focus',
      label: 'Developer: Tech Stack Focused',
      prompt: `You are a bookmark organizer tailored for software engineers.
Group bookmarks cleanly by engineering workflow:

Rules:
1. Recommended folders (5–8 folders based on actual items): AI & Agents, AI APIs & Cloud, Frontend & UI, Backend & Data, DevOps & Network, Design & Docs, Work & Projects.
2. Send one-off troubleshooting threads, expired promos, or temporary URLs to "__TEMP__".
3. Keep every original id unchanged; strip noisy SEO suffixes or zero-width chars via "rename".`,
    },
    life_work: {
      id: 'life_work',
      label: 'General: Work / Learning / Tools / Life',
      prompt: `You are a friendly bookmark organizer for everyday users.
Use intuitive, non-technical category names:

Rules:
1. Group bookmarks into 4–6 everyday folders: Work & Office, Learning & Docs, Tools & Utilities, AI Assistants, Media & Reading, Shopping & Life.
2. Send expired promos or one-off temporary pages to "__TEMP__".
3. Keep every original id unchanged; clean garbled titles via "rename" if needed.`,
    },
  },
};

export const PROMPT_TEMPLATES = PROMPT_TEMPLATES_BY_LANG.zh_CN;

export function getDefaultPrompt(lang = 'zh_CN') {
  return lang === 'en' ? DEFAULT_CLASSIFICATION_PROMPT_EN : DEFAULT_CLASSIFICATION_PROMPT;
}

export function getPromptTemplates(lang = 'zh_CN') {
  return PROMPT_TEMPLATES_BY_LANG[lang] || PROMPT_TEMPLATES_BY_LANG.en;
}

export const DEFAULT_SETTINGS = {
  uiLanguage: 'auto', // 'auto' | 'zh_CN' | 'en'
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  recentDays: 365,
  includeRootLoose: true,
  includeArchived: false,
  ignoreDateCutoff: false,
  extractFrequent: false,
  frequentFolderName: '常用',
  frequentDays: 90,
  frequentMaxCount: 12,
  deduplicateArchive: true,
  removeEmptyFolders: true,
  archiveLocation: 'bar_end', // 'bar_end' | 'other'
  archiveFolderName: '历史归档',
  stripQueryParams: true,
  batchSize: 60,
  customPrompt: '',
  customPromptHint: '',
};
