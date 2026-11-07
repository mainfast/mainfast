import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readRepoFile, repoPathKind, UnsafeRepoPathError } from "../src/repo-file.ts";

const root = mkdtempSync(join(tmpdir(), "repo-file-"));
const outside = mkdtempSync(join(tmpdir(), "repo-file-out-"));
writeFileSync(join(root, "a.txt"), "hello");
mkdirSync(join(root, "dir"));
writeFileSync(join(outside, "secret"), "secret");
symlinkSync(join(outside, "secret"), join(root, "link"));
symlinkSync(outside, join(root, "linkdir"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("readRepoFile", () => {
  it("reads a regular file; undefined when absent", () => {
    expect(readRepoFile(root, "a.txt")).toBe("hello");
    expect(readRepoFile(root, "nope.txt")).toBeUndefined();
    expect(readRepoFile(root, "a.txt/under")).toBeUndefined();
  });
  it("refuses symlinks, escapes, absolute paths, directories and oversized files", () => {
    for (const rel of ["link", "linkdir/secret", "../x", "dir/../../x", join(outside, "secret"), "dir"]) {
      expect(() => readRepoFile(root, rel), rel).toThrow(UnsafeRepoPathError);
    }
    expect(() => readRepoFile(root, "a.txt", 2)).toThrow(/too large/);
  });
  it("names what it finds", () => {
    expect(repoPathKind(root, "a.txt")).toBe("file");
    expect(repoPathKind(root, "dir")).toBe("directory");
    expect(repoPathKind(root, "nope")).toBeUndefined();
  });
});
