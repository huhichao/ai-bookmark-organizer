import { STORAGE_KEYS } from '../core/constants.js';
import { loadSettings, saveSettings } from '../core/storage.js';

// Open side panel automatically when clicking the toolbar icon
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
  console.error('Failed to set side panel behavior:', err);
});

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  if (!existing[STORAGE_KEYS.SETTINGS]) {
    const initial = await loadSettings();
    await saveSettings(initial);
  }
});
