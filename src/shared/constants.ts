
export const PORT_NAME: string = 'lm-plugin-port';
export const STORAGE_KEY: string = 'lm-plugin-storage';
export const STATE_KEY: string = 'lm-plugin-state';
export const IS_EXTENSION_CONTEXT = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
