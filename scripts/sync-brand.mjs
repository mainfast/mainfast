// Rewrites every machine-read brand field in the suite from brand.json:
//   <pkg>/action.yml       name, description, author, branding, runs.main
//   <pkg>/package.json     name, description, license, author, bin, main, files, homepage, bugs, repository
//   <pkg>/examples/**/*.yml   `uses: <org>/<slug>@vN` (also rewrites the older <org>/<repo>/<slug>) and Intact's workflow name
//   LICENSE (root and per package)
// TypeScript needs nothing generated: it imports brand.json through @mainfast/shared/brand.
// Prose (README.md, docs/, SKILL.md) is not rewritten: grep for the old value after a rename.
//
//   node scripts/sync-brand.mjs           write changes
//   node scripts/sync-brand.mjs --check   exit 1 and list files that drifted (CI, test/brand.test.ts)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = JSON.parse(readFileSync(join(ROOT, "brand.json"), "utf8"));
const S = brand.suite;
const q = (s) => JSON.stringify(s); // a JSON string is a valid YAML double-quoted scalar

export function licenseText() {
  return `MIT License

Copyright (c) ${S.copyrightYear} ${S.author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

const repoUrl = `git+https://github.com/${S.githubOrg}/${S.githubRepo}.git`;

function actionYml(slug, p, s) {
  const lines = s.split("\n");
  const out = [];
  let inBranding = false;
  for (const line of lines) {
    if (/^branding:\s*$/.test(line)) {
      inBranding = true;
      out.push("branding:", `  icon: ${q(p.branding.icon)}`, `  color: ${q(p.branding.color)}`);
      continue;
    }
    if (inBranding) {
      if (/^\s+\S/.test(line)) continue; // old branding entries
      inBranding = false;
    }
    if (/^name: /.test(line)) out.push(`name: ${q(p.productName)}`);
    else if (/^description: /.test(line)) out.push(`description: ${q(p.description)}`);
    else if (/^author: /.test(line)) out.push(`author: ${q(S.author)}`);
    else if (/^  main: /.test(line)) out.push(`  main: "dist/index.cjs"`);
    else out.push(line);
  }
  return out.join("\n");
}

function packageJson(slug, p, s) {
  const pkg = JSON.parse(s);
  const next = {
    name: p.npmName,
    version: pkg.version ?? S.version,
    private: pkg.private ?? true,
    description: `${p.productName}: ${p.tagline}.`,
    license: S.license,
    author: S.author,
    type: "module",
    engines: pkg.engines ?? { node: ">=20" },
    bin: { [p.cliName]: "dist/cli.cjs" },
    main: "dist/lib.cjs",
    files: ["dist", "action.yml", "README.md", "LICENSE"],
    ...pkg,
  };
  // Generated fields win over whatever the file had.
  Object.assign(next, {
    name: p.npmName,
    description: `${p.productName}: ${p.tagline}.`,
    license: S.license,
    author: S.author,
    bin: { [p.cliName]: "dist/cli.cjs" },
    main: "dist/lib.cjs",
    files: ["dist", "action.yml", "README.md", "LICENSE"],
    homepage: `${S.homepageUrl}/tree/main/${slug}#readme`,
    bugs: { url: S.issuesUrl },
    repository: { type: "git", url: repoUrl, directory: slug },
  });
  return JSON.stringify(next, null, 2) + "\n";
}

function exampleYml(slug, p, s) {
  const re = new RegExp(`uses: [\\w.-]+/(?:[\\w.-]+/)?${slug}@v\\d+`, "g");
  let out = s.replace(re, `uses: ${p.actionRef}`);
  if (slug === "intact") out = out.replace(/^name: .*$/m, `name: ${p.productName}`);
  return out;
}

function ymlFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...ymlFiles(p));
    else if (/\.ya?ml$/.test(name)) out.push(p);
  }
  return out;
}

/** Every file the sync owns, with its current and wanted content. */
export function plannedFiles() {
  const files = [];
  const plan = (path, fn) => {
    const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    files.push({ path, before, after: fn(before ?? "") });
  };
  plan(join(ROOT, "LICENSE"), () => licenseText());
  for (const [slug, p] of Object.entries(brand.products)) {
    const dir = join(ROOT, slug);
    plan(join(dir, "LICENSE"), () => licenseText());
    plan(join(dir, "action.yml"), (s) => actionYml(slug, p, s));
    plan(join(dir, "package.json"), (s) => packageJson(slug, p, s));
    for (const f of ymlFiles(join(dir, "examples"))) plan(f, (s) => exampleYml(slug, p, s));
  }
  plan(join(ROOT, "packages/shared/LICENSE"), () => licenseText());
  plan(join(ROOT, "cli/LICENSE"), () => licenseText());
  return files;
}

export function drifted() {
  return plannedFiles().filter((f) => f.before !== f.after).map((f) => relative(ROOT, f.path));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const files = plannedFiles().filter((f) => f.before !== f.after);
  if (check) {
    if (files.length) {
      console.error(`brand drift (run npm run brand:sync):\n${files.map((f) => `  ${relative(ROOT, f.path)}`).join("\n")}`);
      process.exit(1);
    }
    console.log("brand fields in sync");
  } else {
    for (const f of files) writeFileSync(f.path, f.after);
    console.log(files.length ? `updated: ${files.map((f) => relative(ROOT, f.path)).join(", ")}` : "brand fields already in sync");
  }
}
