export const MESSAGES = {
  zh_CN: {
    appName: 'AI 书签整理助手',
    settingsTitle: 'AI 书签整理助手 — 设置',
    settingsHeader: 'AI 书签整理助手 · 设置',
    settingsDesc: '配置 AI 模型接口、整理规则及本地快照备份。所有 API Key 仅存储在本地浏览器。',
    btnSettings: '设置',
    btnRescan: '重新扫描',
    loadingConfig: '加载配置中...',
    modelUnset: '未指定模型',

    secScanTitle: '1. 书签扫描概览',
    statTotal: '总书签',
    statActive: '待AI归类',
    statDup: '重复网址',
    statEmpty: '空文件夹',
    scanningInit: '正在读取书签树...',
    scopeIncludeArchived: '包含「历史归档」内书签',
    scopeIgnoreDate: '忽略天数全量分类',
    scopeExtractFrequent: '提取近期访问到「常用」',

    secPlanTitle: '2. 生成整理预览',
    btnCustomPrompt: '自定义提示词',
    tabApiMode: 'API 自动分类',
    tabManualMode: '免 Key 网页 AI 模式',
    apiModeHint: '直接调用你在「设置」中配置的大模型 API（或 Chrome 内置 AI）自动生成分类方案。',
    btnAiPlan: 'AI 智能分类预览',
    btnAiPlanning: 'AI 分类中...',
    manualIntro: '无需配置 API Key，借用网页版 DeepSeek / ChatGPT / Claude 等免费完成分类：',
    manualStep1: '点击复制脱敏书签清单与提示词（已自动剥离 URL 参数保护隐私）',
    btnCopyPrompt: '1. 复制提示词与清单',
    btnCopied: '已复制 ✓',
    manualStep2: '打开任意网页版 AI 对话框粘贴发送，复制它返回的 JSON 结果',
    manualStep3: '将 JSON 粘贴到下方并生成预览：',
    manualJsonPlaceholder: '粘贴 AI 返回的 JSON，例如 {"folders":[...],"assignments":[...]}',
    btnParseManual: '3. 解析 JSON 生成预览',
    previewTitle: '整理方案预览',

    secApplyTitle: '3. 执行与撤销',
    btnApply: '应用整理方案',
    btnApplying: '正在整理...',
    btnUndo: '撤销上次整理',
    btnUndoing: '正在恢复...',
    statusReady: '就绪。应用前会自动保存本地快照，随时可一键撤销。',

    // SidePanel dynamic statuses
    scanNoteFreq: '「{frequentFolder}」{frequentCount} 条、',
    scanNoteMain: '{freqPart}待 AI 归类 {activeCount} 条，其余 {historicalCount} 条保留在「{archiveFolder}」。',
    previewSummary: '新建/复用 {foldersCount} 个主题文件夹（{activeTotal} 条），临时链接 {tempCount} 条，去重 {dupCount} 条。',
    previewMore: '... 还有 {count} 条',
    tempFolderPath: '{archiveFolder} / {tempFolder}',
    statusSwitchedApi: '已切换到 API 自动分类模式。',
    statusSwitchedManual: '已切换到免 Key 网页 AI 模式：按 1 → 2 → 3 步骤操作即可。',
    statusScopeUpdated: '范围已更新：{freqPart}当前待 AI 归类 {activeCount} 条。',
    statusScanning: '正在扫描书签...',
    statusScanDone: '扫描完成，可点击「AI 智能分类预览」或使用「免 Key 提示词模式」。',
    statusScanFail: '扫描失败: {err}',
    statusMissingKey: '未检测到 API Key：请点击右上角「设置」填写，或使用「免 Key 提示词模式」。',
    statusAiRunning: '正在连接 AI 生成分类方案，请稍候...',
    statusAiDone: 'AI 分类预览已生成！请在下方核对后点击「应用整理方案」。',
    statusAiFail: 'AI 生成失败: {err}',
    statusCopied: '已复制 {count} 条脱敏书签及提示词，请粘贴给网页版 AI。',
    statusJsonOk: 'JSON 解析成功！请在下方预览确认后点击「应用整理方案」。',
    statusJsonFail: 'JSON 解析失败: {err}',
    statusApplyDone: '整理完成！已归类 {movedActive} 条、临时链接 {movedTemp} 条、归档旧文件夹 {archivedOldFolders} 个、去重 {removedDuplicates} 条、清理空文件夹 {removedEmpty} 个。',
    statusApplyFail: '应用失败: {err}',
    statusUndoing: '正在从快照恢复书签...',
    statusUndoDone: '已恢复到整理前的书签状态。',
    statusUndoFail: '恢复失败: {err}',

    // Progress strings from core
    progBatch: '正在请求 AI 分类第 {cur}/{total} 批（共 {count} 条）...',
    progSnapshot: '正在保存整理前快照（支持随时撤销）...',
    progDedup: '正在清理 {count} 条重复书签...',
    progCreateFolders: '正在创建主题分类文件夹...',
    progMoveActive: '正在移动并归类近期书签...',
    progArchiveOld: '正在归档历史文件夹与旧书签...',
    progPruneEmpty: '正在清理空文件夹...',

    // Options page
    optLangCard: '界面与输出语言',
    optUiLangLabel: '语言设置（界面与默认分类语言）',
    optLangAuto: '跟随浏览器语言 (Auto)',
    optLangZh: '简体中文',
    optLangEn: 'English',
    optLangHint: '切换语言后将自动更新界面文本；若未修改过默认目录名或提示词，也会同步切换为对应语言模板。',
    optAiCard: 'AI 模型配置',
    optProvider: 'AI 提供商',
    optBaseUrl: 'API Base URL',
    optBaseUrlHint: '使用自定义中转域名时，保存或测试将按需请求该单个域名的网络访问权限。',
    optModel: '模型名称',
    optApiKey: 'API Key',
    optBtnSaveAi: '保存配置（按需授权域名）',
    optBtnTestAi: '测试连接',
    optTestingAi: '测试中...',
    optRulesCard: '整理规则与隐私',
    optRecentDays: '近期活跃天数窗口',
    optBatchSize: 'AI 单批处理条数',
    optArchiveName: '历史归档文件夹名称',
    optArchiveLoc: '历史归档存放位置',
    optLocBarEnd: '书签栏末尾',
    optLocOther: '「其他书签」根目录下',
    optIncludeRootLoose: '始终整理书签栏根目录散落书签',
    optIncludeArchived: '包含「历史归档」目录内的书签（关闭时跳过已归档目录）',
    optIgnoreDate: '忽略近期天数限制（全量书签交由 AI 重新分类）',
    optExtractFrequent: '自动提取近期点击访问的书签到「常用」文件夹',
    optDeduplicate: '自动清理完全重复的网址（保留最新）',
    optRemoveEmpty: '归档后自动移除空文件夹',
    optStripQuery: '发送给 AI 前自动剥离 URL 查询参数（保护隐私）',
    optFrequentDays: '「常用」最近访问天数',
    optFrequentMax: '「常用」最多提取条数',
    optPromptTemplate: '预设提示词模板（快速切换风格）',
    optCustomPrompt: '自定义分类提示词（System Prompt）',
    optBtnResetPrompt: '恢复默认提示词',
    optPromptPlaceholder: '填写你的书签分类规则与文件夹偏好...',
    optPromptHint: '可按自己的习惯自由修改分类逻辑；JSON 输出格式校验由系统自动附带，无需手写 Schema。',
    optBtnSaveRules: '保存规则设置',
    optSnapshotCard: '本地快照与数据管理',
    optSnapshotChecking: '正在检查快照...',
    optSnapshotNone: '暂无本地快照。首次执行书签整理时会自动生成。',
    optSnapshotInfo: '最近快照时间：{dt}（含 {count} 条书签）',
    optBtnExportSnap: '导出上次快照 JSON',
    optBtnClearSnap: '清除本地快照',
    optAboutCard: '关于与开源',
    optAboutText: '本项目基于 MIT 协议开源，所有代码公开可审计：',
    optLinkRepo: 'GitHub 仓库',
    optLinkIssues: '问题反馈',
    optLinkPrivacy: '隐私政策',

    // Options statuses
    optErrEmptyUrl: '请先填写 API Base URL（需以 http:// 或 https:// 开头）。',
    optErrInvalidUrl: 'API Base URL 格式无效，请以 http:// 或 https:// 开头。',
    optErrEmptyModel: '请先填写模型名称。',
    optErrEmptyKey: '请先填写 API Key。',
    optErrPermDenied: '未授予目标 API 域名网络权限，请检查 Base URL 格式并允许权限请求。',
    optErrTestPermDenied: '未授予目标 API 域名网络权限，无法测试。',
    optSavedAi: 'AI 接口配置已保存。',
    optSaveFail: '保存失败: {err}',
    optTestReqPerm: '正在请求接口权限并测试连接...',
    optTestSending: '正在发送测试请求，请稍候...',
    optTestOk: '连接成功！模型响应：{reply}',
    optTestFail: '连接测试失败: {err}',
    optTplLoaded: '已加载模板「{label}」，可微调后点击「保存规则设置」。',
    optPromptReset: '已恢复默认分类提示词（记得点击「保存规则设置」生效）。',
    optRulesSaved: '整理规则与提示词已保存。',
    optSnapCleared: '已清除本地快照。',
    optLangSaved: '语言已切换，默认模板与目录名已同步更新。',
  },

  en: {
    appName: 'AI Bookmark Organizer',
    settingsTitle: 'AI Bookmark Organizer — Settings',
    settingsHeader: 'AI Bookmark Organizer · Settings',
    settingsDesc: 'Configure your AI provider, organizing rules, and local snapshots. API keys stay strictly in your browser.',
    btnSettings: 'Settings',
    btnRescan: 'Rescan',
    loadingConfig: 'Loading settings...',
    modelUnset: 'No model selected',

    secScanTitle: '1. Bookmark Overview',
    statTotal: 'Total',
    statActive: 'To Organize',
    statDup: 'Duplicates',
    statEmpty: 'Empty Folders',
    scanningInit: 'Reading bookmark tree...',
    scopeIncludeArchived: 'Include archived folder',
    scopeIgnoreDate: 'Organize all dates',
    scopeExtractFrequent: 'Extract recently visited to "Frequent"',

    secPlanTitle: '2. Generate Preview',
    btnCustomPrompt: 'Custom Prompt',
    tabApiMode: 'Auto via API',
    tabManualMode: 'No-Key Web AI Mode',
    apiModeHint: 'Use your configured LLM API (or Chrome Built-in AI) to categorize bookmarks automatically.',
    btnAiPlan: 'Generate AI Preview',
    btnAiPlanning: 'Categorizing...',
    manualIntro: 'No API key needed — use any web AI (ChatGPT, Claude, DeepSeek, etc.) for free:',
    manualStep1: 'Copy the sanitized bookmark list & prompt (URL query params stripped for privacy)',
    btnCopyPrompt: '1. Copy Prompt & List',
    btnCopied: 'Copied ✓',
    manualStep2: 'Paste into any web AI chat and copy its JSON response',
    manualStep3: 'Paste the JSON below and parse preview:',
    manualJsonPlaceholder: 'Paste AI JSON here, e.g. {"folders":[...],"assignments":[...]}',
    btnParseManual: '3. Parse JSON Preview',
    previewTitle: 'Organization Preview',

    secApplyTitle: '3. Apply & Undo',
    btnApply: 'Apply Changes',
    btnApplying: 'Applying...',
    btnUndo: 'Undo Last Apply',
    btnUndoing: 'Restoring...',
    statusReady: 'Ready. A local snapshot is saved automatically before every apply.',

    // SidePanel dynamic statuses
    scanNoteFreq: '"{frequentFolder}": {frequentCount}, ',
    scanNoteMain: '{freqPart}to organize: {activeCount}, remaining {historicalCount} kept in "{archiveFolder}".',
    previewSummary: '{foldersCount} category folders ({activeTotal} bookmarks), {tempCount} temporary links, {dupCount} duplicates removed.',
    previewMore: '... and {count} more',
    tempFolderPath: '{archiveFolder} / {tempFolder}',
    statusSwitchedApi: 'Switched to Auto via API mode.',
    statusSwitchedManual: 'Switched to No-Key Web AI mode: follow steps 1 → 2 → 3.',
    statusScopeUpdated: 'Scope updated: {freqPart}{activeCount} bookmarks to organize.',
    statusScanning: 'Scanning bookmarks...',
    statusScanDone: 'Scan complete. Click "Generate AI Preview" or switch to "No-Key Web AI Mode".',
    statusScanFail: 'Scan failed: {err}',
    statusMissingKey: 'API Key missing: open "Settings" to add one, or use "No-Key Web AI Mode".',
    statusAiRunning: 'Contacting AI to categorize bookmarks...',
    statusAiDone: 'AI preview ready! Review below and click "Apply Changes".',
    statusAiFail: 'AI categorization failed: {err}',
    statusCopied: 'Copied {count} sanitized bookmarks & prompt. Paste it into your web AI chat.',
    statusJsonOk: 'JSON parsed! Review the preview below and click "Apply Changes".',
    statusJsonFail: 'Invalid JSON: {err}',
    statusApplyDone: 'Done! Organized {movedActive} bookmarks, moved {movedTemp} temp links, archived {archivedOldFolders} old folders, removed {removedDuplicates} duplicates and {removedEmpty} empty folders.',
    statusApplyFail: 'Apply failed: {err}',
    statusUndoing: 'Restoring bookmarks from snapshot...',
    statusUndoDone: 'Bookmarks restored to pre-organization snapshot.',
    statusUndoFail: 'Restore failed: {err}',

    // Progress strings from core
    progBatch: 'Categorizing batch {cur}/{total} ({count} items)...',
    progSnapshot: 'Saving pre-organization snapshot...',
    progDedup: 'Removing {count} duplicate bookmarks...',
    progCreateFolders: 'Creating category folders...',
    progMoveActive: 'Moving and categorizing active bookmarks...',
    progArchiveOld: 'Archiving historical folders...',
    progPruneEmpty: 'Pruning empty folders...',

    // Options page
    optLangCard: 'Language',
    optUiLangLabel: 'Interface & Default Output Language',
    optLangAuto: 'Follow Browser Language (Auto)',
    optLangZh: '简体中文',
    optLangEn: 'English',
    optLangHint: 'Switches UI labels immediately and updates default folder names / prompts when unchanged.',
    optAiCard: 'AI Provider Settings',
    optProvider: 'AI Provider',
    optBaseUrl: 'API Base URL',
    optBaseUrlHint: 'For custom relay domains, saving or testing requests permission for that specific origin only.',
    optModel: 'Model Name',
    optApiKey: 'API Key',
    optBtnSaveAi: 'Save Settings (Authorize Host)',
    optBtnTestAi: 'Test Connection',
    optTestingAi: 'Testing...',
    optRulesCard: 'Organizing Rules & Privacy',
    optRecentDays: 'Recent Activity Window (Days)',
    optBatchSize: 'AI Batch Size',
    optArchiveName: 'Archive Folder Name',
    optArchiveLoc: 'Archive Location',
    optLocBarEnd: 'End of Bookmarks Bar',
    optLocOther: 'Under "Other Bookmarks"',
    optIncludeRootLoose: 'Always include loose bookmarks on Bookmarks Bar',
    optIncludeArchived: 'Include bookmarks inside Archive folder',
    optIgnoreDate: 'Organize all dates (ignore recent days window)',
    optExtractFrequent: 'Extract recently visited bookmarks into "Frequent" folder',
    optDeduplicate: 'Automatically remove exact duplicate URLs (keep latest)',
    optRemoveEmpty: 'Remove empty folders after archiving',
    optStripQuery: 'Strip URL query params before sending to AI (privacy)',
    optFrequentDays: '"Frequent" Visited Window (Days)',
    optFrequentMax: '"Frequent" Max Items',
    optPromptTemplate: 'Preset Prompt Template',
    optCustomPrompt: 'Custom Classification Prompt (System Prompt)',
    optBtnResetPrompt: 'Reset to Default',
    optPromptPlaceholder: 'Describe your bookmark categorization rules and folder preferences...',
    optPromptHint: 'Customize your categorization logic freely; the strict JSON output contract is appended automatically.',
    optBtnSaveRules: 'Save Rules & Prompt',
    optSnapshotCard: 'Local Snapshot & Backup',
    optSnapshotChecking: 'Checking snapshot...',
    optSnapshotNone: 'No local snapshot yet. One is saved automatically on first apply.',
    optSnapshotInfo: 'Last snapshot: {dt} ({count} bookmarks)',
    optBtnExportSnap: 'Export Snapshot JSON',
    optBtnClearSnap: 'Clear Snapshot',
    optAboutCard: 'About & Open Source',
    optAboutText: 'Open-source under the MIT License:',
    optLinkRepo: 'GitHub Repo',
    optLinkIssues: 'Issues',
    optLinkPrivacy: 'Privacy Policy',

    // Options statuses
    optErrEmptyUrl: 'Please enter an API Base URL (starting with http:// or https://).',
    optErrInvalidUrl: 'Invalid API Base URL. Must start with http:// or https://.',
    optErrEmptyModel: 'Please enter a model name.',
    optErrEmptyKey: 'Please enter an API Key.',
    optErrPermDenied: 'Host permission denied. Please check the URL and grant permission.',
    optErrTestPermDenied: 'Host permission denied; cannot test connection.',
    optSavedAi: 'AI provider settings saved.',
    optSaveFail: 'Save failed: {err}',
    optTestReqPerm: 'Requesting host permission and testing...',
    optTestSending: 'Sending test request...',
    optTestOk: 'Connected! Model reply: {reply}',
    optTestFail: 'Connection test failed: {err}',
    optTplLoaded: 'Loaded template "{label}". Click "Save Rules & Prompt" to apply.',
    optPromptReset: 'Reset to default prompt. Click "Save Rules & Prompt" to save.',
    optRulesSaved: 'Rules and custom prompt saved.',
    optSnapCleared: 'Local snapshot cleared.',
    optLangSaved: 'Language updated.',
  },
};

export function detectBrowserLanguage() {
  try {
    const uiLang = globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'en';
    return String(uiLang).toLowerCase().startsWith('zh') ? 'zh_CN' : 'en';
  } catch {
    return 'en';
  }
}

export function resolveLanguage(uiLanguage = 'auto') {
  if (uiLanguage === 'zh_CN' || uiLanguage === 'en') return uiLanguage;
  return detectBrowserLanguage();
}

export function getLocalizedDefaults(lang = resolveLanguage('auto')) {
  if (lang === 'zh_CN') {
    return {
      archiveFolderName: '历史归档',
      frequentFolderName: '常用',
      tempFolderName: '临时与一次性链接',
      fallbackFolderName: '近期待归类',
    };
  }
  return {
    archiveFolderName: 'Archive',
    frequentFolderName: 'Frequent',
    tempFolderName: 'Temporary Links',
    fallbackFolderName: 'Recent Unsorted',
  };
}

export function t(key, vars = {}, lang = resolveLanguage('auto')) {
  const dict = MESSAGES[lang] || MESSAGES.en;
  let template = dict[key] ?? MESSAGES.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    template = template.replaceAll(`{${k}}`, String(v ?? ''));
  }
  return template;
}

export function applyI18nToDocument(lang = resolveLanguage('auto')) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang === 'zh_CN' ? 'zh-CN' : 'en';
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n');
    if (key) node.textContent = t(key, {}, lang);
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = node.getAttribute('data-i18n-placeholder');
    if (key) node.setAttribute('placeholder', t(key, {}, lang));
  }
  const titleKey = document.body?.getAttribute('data-i18n-title');
  if (titleKey) document.title = t(titleKey, {}, lang);
}
