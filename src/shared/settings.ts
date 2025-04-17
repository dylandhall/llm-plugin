import { STORAGE_KEY } from './constants';
import { defaultAppSettings } from './defaults';
import { appSettings } from './types';

export async function saveSettings(settings: appSettings): Promise<void> {
  try{
    await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  } catch (e) {
    console.error('Error saving settings: ', settings, 'storage key: ', STORAGE_KEY, 'last chrome error: ', chrome.runtime.lastError, 'exception: ', e);
  }
}

export async function getSettings(): Promise<appSettings> {
  try {
    const result = await chrome.storage.sync.get([STORAGE_KEY]);
    return result[STORAGE_KEY] ?? defaultAppSettings;
  } catch (e) {
    console.error('Error getting settings: ', 'storage key: ', STORAGE_KEY, 'last chrome error: ', chrome.runtime.lastError, 'exception: ', e);
    return defaultAppSettings;
  }
}
