import { IS_EXTENSION_CONTEXT } from './constants';

function getOriginPattern(urlString: string): string | null {
  try {
    const parsed = new URL(urlString);
    if (!parsed.protocol.startsWith('http')) {
      return null;
    }
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch (error) {
    console.error('Failed to parse URL for permission check:', urlString, error);
    return null;
  }
}

export async function ensureOriginPermission(urlString: string): Promise<boolean> {
  if (!IS_EXTENSION_CONTEXT) {
    return true;
  }

  if (!chrome.permissions) {
    return true;
  }

  const originPattern = getOriginPattern(urlString);
  if (!originPattern) {
    return false;
  }

  try {
    const alreadyGranted = await chrome.permissions.contains({ origins: [originPattern] });
    if (alreadyGranted) {
      return true;
    }

    return await chrome.permissions.request({ origins: [originPattern] });
  } catch (error) {
    console.error('Failed to request host permission for', originPattern, error);
    return false;
  }
}
