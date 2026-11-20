import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants.js';

export async function loadSettings() {
  const res = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(res[STORAGE_KEYS.SETTINGS] || {}) };
}

export async function saveSettings(partial) {
  const current = await loadSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}
