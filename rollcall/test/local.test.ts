import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readLocalWorkflows } from "../src/local.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "rollcall-local-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("readLocalWorkflows", () => {
  it("reads the regular workflow files, and nothing when there are none", () => {
    const d = tmp();
    expect(readLocalWorkflows(d)).toBeUndefined();
    mkdirSync(join(d, ".github/workflows"), { recursive: true });
    writeFileSync(join(d, ".github/workflows/b.yml"), "b");
    writeFileSync(join(d, ".github/workflows/a.yaml"), "a");
    writeFileSync(join(d, ".github/workflows/note.txt"), "x");
    expect(readLocalWorkflows(d)).toEqual([
      { path: ".github/workflows/a.yaml", text: "a" },
      { path: ".github/workflows/b.yml", text: "b" },
    ]);
  });

  it("skips a symlinked workflow file", () => {
    const d = tmp();
    const secret = join(tmp(), "secret.yml");
    writeFileSync(secret, "secret");
    mkdirSync(join(d, ".github/workflows"), { recursive: true });
    symlinkSync(secret, join(d, ".github/workflows/x.yml"));
    expect(readLocalWorkflows(d)).toEqual([]);
  });

  it("refuses a symlinked workflows directory", () => {
    const d = tmp();
    const elsewhere = tmp();
    writeFileSync(join(elsewhere, "x.yml"), "secret");
    mkdirSync(join(d, ".github"));
    symlinkSync(elsewhere, join(d, ".github/workflows"));
    expect(() => readLocalWorkflows(d)).toThrow(/symlink/);
  });
});
