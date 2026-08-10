import { describe, expect, it } from "vitest";
import { readEnabledSetting } from "../lib/settings";

describe("extension enabled setting", () => {
  it("defaults to enabled when no setting exists", () => {
    expect(readEnabledSetting(undefined)).toBe(true);
  });

  it("pauses only for an explicit false value", () => {
    expect(readEnabledSetting(false)).toBe(false);
    expect(readEnabledSetting(true)).toBe(true);
    expect(readEnabledSetting("false")).toBe(true);
  });
});
