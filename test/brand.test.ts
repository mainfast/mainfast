// Brand drift: every machine-read brand field in the suite comes from brand.json.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { PRODUCTS, SUITE } from "../packages/shared/src/brand.ts";
// @ts-expect-error plain .mjs script without types
import { drifted, licenseText, ROOT } from "../scripts/sync-brand.mjs";

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("brand.json is the one brand source", () => {
  it("no generated file has drifted (run `npm run brand:sync`)", () => {
    expect(drifted()).toEqual([]);
  });

  it.each(PRODUCTS.map((p) => [p.slug, p] as const))("%s: action.yml, package.json and LICENSE match", (slug, p) => {
    const dir = join(ROOT, slug);
    const action = parse(readFileSync(join(dir, "action.yml"), "utf8"), { strict: true }) as Record<string, any>;
    expect(action.name).toBe(p.productName);
    expect(action.author).toBe(SUITE.author);
    expect(action.runs).toEqual({ using: "node24", main: "dist/index.cjs" });
    expect(Object.keys(action.inputs)).toContain("license");
    // GitHub evaluates expressions anywhere in action.yml and rejects `secrets` there, even in a
    // description: the action then fails to load. actionlint does not catch it.
    expect(readFileSync(join(dir, "action.yml"), "utf8")).not.toMatch(/\bsecrets\./);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg).toMatchObject({ name: p.npmName, license: "MIT", main: "dist/lib.cjs", bin: { [p.cliName]: "dist/cli.cjs" } });
    expect(readFileSync(join(dir, "LICENSE"), "utf8")).toBe(licenseText());
  });

  it.each(PRODUCTS.map((p) => [p.slug, p] as const))("%s: no brand literal in src/ (names come from brand.json)", (slug, p) => {
    // The bare org equals the config file stem (`mainfast`, `.mainfast.yml`), so look for it as a repo path.
    const literals = [`${SUITE.githubOrg}/${SUITE.githubRepo}`, `github.com/${SUITE.githubOrg}`, p.productName, p.commentMarker, p.actionRef];
    for (const f of tsFiles(join(ROOT, slug, "src"))) {
      const text = readFileSync(f, "utf8");
      for (const lit of literals) expect(text.includes(lit), `${f} contains "${lit}"`).toBe(false);
    }
  });

  it("names are unique across products", () => {
    for (const key of ["productName", "checkName", "commentMarker", "actionRef", "cliName", "npmName"] as const) {
      const values = PRODUCTS.map((p) => p[key]);
      expect(new Set(values).size, key).toBe(values.length);
    }
  });

  it("the root LICENSE is MIT, Mainfast authors, 2026", () => {
    const text = readFileSync(join(ROOT, "LICENSE"), "utf8");
    expect(text).toContain("MIT License");
    expect(text).toContain("Copyright (c) 2026 Mainfast authors");
    expect(existsSync(join(ROOT, "LICENSES.md"))).toBe(true);
  });
});
