import {
  DEFAULT_SETTINGS,
  PROVIDER_PRESETS,
  SCOPE_MODES,
  STORAGE_KEYS,
  getDefaultPrompt,
} from './constants.js';
import { getLocalizedDefaults, resolveLanguage } from './i18n.js';

function deriveScopeMode(stored = {}) {
  if (
    stored.scopeMode === SCOPE_MODES.RECENT_ARCHIVE ||
    stored.scopeMode === SCOPE_MODES.ALL_AI ||
    stored.scopeMode === SCOPE_MODES.RECENT_ONLY
  ) {
    return stored.scopeMode;
  }
  if (stored.onlyRecent === true) return SCOPE_MODES.RECENT_ONLY;
  if (stored.archiveNonRecent === false) return SCOPE_MODES.ALL_AI;
  return SCOPE_MODES.RECENT_ARCHIVE;
}

function scopeFlagsFromMode(scopeMode) {
  if (scopeMode === SCOPE_MODES.RECENT_ONLY) {
    return { scopeMode, onlyRecent: true, archiveNonRecent: false };
  }
  if (scopeMode === SCOPE_MODES.ALL_AI) {
    return { scopeMode, onlyRecent: false, archiveNonRecent: false };
  }
  return { scopeMode: SCOPE_MODES.RECENT_ARCHIVE, onlyRecent: false, archiveNonRecent: true };
}

export function getProviderConfig(settings, providerId) {
  const preset = PROVIDER_PRESETS[providerId] || PROVIDER_PRESETS.custom;
  const saved = settings?.providerConfigs?.[providerId];
  if (saved) {
    return {
      baseUrl: preset.needsUrl ? (saved.baseUrl ?? preset.baseUrl) : '',
      model: providerId === 'builtin' ? preset.model : (saved.model ?? preset.model),
      apiKey: preset.needsKey ? (saved.apiKey ?? '') : '',
    };
  }
  if (settings?.provider === providerId) {
    return {
      baseUrl: preset.needsUrl ? (settings.baseUrl ?? preset.baseUrl) : '',
      model: providerId === 'builtin' ? preset.model : (settings.model ?? preset.model),
      apiKey: preset.needsKey ? (settings.apiKey ?? '') : '',
    };
  }
  return {
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiKey: '',
  };
}

export async function loadSettings() {
  const res = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const stored = res[STORAGE_KEYS.SETTINGS] || {};
  const lang = resolveLanguage(stored.uiLanguage || DEFAULT_SETTINGS.uiLanguage);
  const locDefaults = getLocalizedDefaults(lang);

  const scopeMode = deriveScopeMode(stored);
  const scopeFlags = scopeFlagsFromMode(scopeMode);
  const provider = stored.provider && PROVIDER_PRESETS[stored.provider]
    ? stored.provider
    : DEFAULT_SETTINGS.provider;
  const preset = PROVIDER_PRESETS[provider];

  const existingConfigs =
    stored.providerConfigs && typeof stored.providerConfigs === 'object'
      ? { ...stored.providerConfigs }
      : {};

  // Migrate legacy flat provider settings into providerConfigs[provider]
  if (!existingConfigs[provider]) {
    existingConfigs[provider] = {
      baseUrl: preset.needsUrl ? (stored.baseUrl ?? preset.baseUrl) : '',
      model: provider === 'builtin' ? preset.model : (stored.model ?? preset.model),
      apiKey: preset.needsKey ? (stored.apiKey ?? '') : '',
    };
  }
  const activeCfg = existingConfigs[provider];

  return {
    ...DEFAULT_SETTINGS,
    archiveFolderName: locDefaults.archiveFolderName,
    frequentFolderName: locDefaults.frequentFolderName,
    customPrompt: getDefaultPrompt(lang),
    ...stored,
    ...scopeFlags,
    provider,
    baseUrl: preset.needsUrl ? (activeCfg.baseUrl ?? preset.baseUrl) : '',
    model: provider === 'builtin' ? preset.model : (activeCfg.model ?? preset.model),
    apiKey: preset.needsKey ? (activeCfg.apiKey ?? '') : '',
    providerConfigs: existingConfigs,
  };
}

export async function saveSettings(partial) {
  const current = await loadSettings();
  const merged = { ...current, ...partial };

  const scopeMode = partial.scopeMode !== undefined
    ? deriveScopeMode({ scopeMode: partial.scopeMode })
    : (partial.onlyRecent !== undefined || partial.archiveNonRecent !== undefined)
      ? deriveScopeMode({
          onlyRecent: merged.onlyRecent,
          archiveNonRecent: merged.archiveNonRecent,
        })
      : deriveScopeMode(merged);
  const scopeFlags = scopeFlagsFromMode(scopeMode);

  const provider = merged.provider && PROVIDER_PRESETS[merged.provider]
    ? merged.provider
    : current.provider;
  const preset = PROVIDER_PRESETS[provider];

  const providerConfigs = {
    ...(current.providerConfigs || {}),
    ...(partial.providerConfigs || {}),
  };

  if (
    partial.provider !== undefined ||
    partial.baseUrl !== undefined ||
    partial.model !== undefined ||
    partial.apiKey !== undefined
  ) {
    const prevCfg = getProviderConfig(current, provider);
    providerConfigs[provider] = {
      baseUrl: preset.needsUrl ? (partial.baseUrl !== undefined ? partial.baseUrl : prevCfg.baseUrl) : '',
      model: provider === 'builtin' ? preset.model : (partial.model !== undefined ? partial.model : prevCfg.model),
      apiKey: preset.needsKey ? (partial.apiKey !== undefined ? partial.apiKey : prevCfg.apiKey) : '',
    };
  }

  const activeCfg = getProviderConfig({ ...merged, providerConfigs }, provider);
  const next = {
    ...merged,
    ...scopeFlags,
    provider,
    baseUrl: activeCfg.baseUrl,
    model: activeCfg.model,
    apiKey: activeCfg.apiKey,
    providerConfigs,
  };

  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}
