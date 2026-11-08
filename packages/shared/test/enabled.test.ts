import { describe, expect, it } from "vitest";
import { MainfastConfigError, sectionEnabled } from "../src/config.ts";

describe("sectionEnabled", () => {
  it("defaults to on and honors false", () => {
    expect(sectionEnabled({}, "owners")).toBe(true);
    expect(sectionEnabled({ owners: { failOn: "error" } }, "owners")).toBe(true);
    expect(sectionEnabled({ owners: { enabled: false } }, "owners")).toBe(false);
  });
  it("rejects a non-boolean", () => {
    expect(() => sectionEnabled({ owners: { enabled: "no" } }, "owners")).toThrow(MainfastConfigError);
  });
});
