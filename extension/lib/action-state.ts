const PAUSED_BADGE_COLOUR = "#526b67";

export async function updateActionState(enabled: boolean): Promise<void> {
  await Promise.all([
    browser.action.setBadgeText({ text: enabled ? "" : "OFF" }),
    browser.action.setBadgeBackgroundColor({ color: PAUSED_BADGE_COLOUR }),
    browser.action.setTitle({
      title: enabled
        ? "NZ Accredited Employer Inspector"
        : "NZ Accredited Employer Inspector — paused",
    }),
  ]);
}
