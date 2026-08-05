import { describe, expect, it } from "vitest";
import { shouldRemountCompanyPageUi } from "../lib/company-page-adapter";

describe("company page adapter reconciliation", () => {
  const mountedAnchor = {} as HTMLElement;

  it("remounts when LinkedIn replaces the anchor for the same company", () => {
    expect(
      shouldRemountCompanyPageUi(
        mountedAnchor,
        {} as HTMLElement,
        true,
        "company:envato",
        "company:envato",
      ),
    ).toBe(true);
  });

  it("remounts when the company changes inside the same anchor", () => {
    expect(
      shouldRemountCompanyPageUi(
        mountedAnchor,
        mountedAnchor,
        true,
        "company:envato",
        "company:twine-net",
      ),
    ).toBe(true);
  });

  it("remounts when LinkedIn removes only the Shadow UI host", () => {
    expect(
      shouldRemountCompanyPageUi(
        mountedAnchor,
        mountedAnchor,
        false,
        "company:envato",
        "company:envato",
      ),
    ).toBe(true);
  });

  it("keeps the current UI when the anchor and company are unchanged", () => {
    expect(
      shouldRemountCompanyPageUi(
        mountedAnchor,
        mountedAnchor,
        true,
        "company:envato",
        "company:envato",
      ),
    ).toBe(false);
  });
});
