import { DEFAULT_SETTINGS, STORAGE_KEYS, getDefaultPrompt } from './constants.js';
import { getLocalizedDefaults, resolveLanguage } from './i18n.js';

export async function loadSettings() {
  const res = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const stored = res[STORAGE_KEYS.SETTINGS] || {};
  const lang = resolveLanguage(stored.uiLanguage || DEFAULT_SETTINGS.uiLanguage);
  const locDefaults = getLocalizedDefaults(lang);

  return {
    ...DEFAULT_SETTINGS,
    archiveFolderName: locDefaults.archiveFolderName,
    frequentFolderName: locDefaults.frequentFolderName,
    customPrompt: getDefaultPrompt(lang),
    ...stored,
  };
}

export async function saveSettings(partial) {
  const current = await loadSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}
