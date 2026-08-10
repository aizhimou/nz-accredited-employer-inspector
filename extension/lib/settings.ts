export const EXTENSION_ENABLED_STORAGE_KEY = "nz-aei-enabled";

export function readEnabledSetting(value: unknown): boolean {
  return value !== false;
}

export async function isExtensionEnabled(): Promise<boolean> {
  try {
    const stored = await browser.storage.local.get(EXTENSION_ENABLED_STORAGE_KEY);
    return readEnabledSetting(stored[EXTENSION_ENABLED_STORAGE_KEY]);
  } catch {
    return true;
  }
}

export async function setExtensionEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [EXTENSION_ENABLED_STORAGE_KEY]: enabled });
}
