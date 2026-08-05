const CLIENT_ID_STORAGE_KEY = "nz-aei-client-id";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function getClientId(): Promise<string> {
  const stored = await browser.storage.local.get(CLIENT_ID_STORAGE_KEY);
  const existing = stored[CLIENT_ID_STORAGE_KEY];
  if (typeof existing === "string" && UUID_PATTERN.test(existing)) {
    return existing.toLowerCase();
  }

  const clientId = crypto.randomUUID();
  await browser.storage.local.set({ [CLIENT_ID_STORAGE_KEY]: clientId });
  return clientId;
}
