// One `.mainfast.yml` schema for the whole suite, checked against every product's parser.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { parseConfig as intact, INTACT_KEYS } from "../intact/src/config.ts";
import { DEFAULT_OUT_OF_ORDER, parseConfig as migrations, KNOWN_KEYS as MIGRATIONS_KEYS } from "../migrations/src/config.ts";
import { FRAMEWORKS } from "../migrations/src/types.ts";
import { parseConfig as rollcall, KNOWN_KEYS as ROLLCALL_KEYS } from "../rollcall/src/config.ts";
import { parseConfig as owners, KNOWN_KEYS as OWNERS_KEYS } from "../owners/src/config.ts";
import { parsePolicy as evidence } from "../evidence/src/config.ts";
import { FLAG_IDS } from "../evidence/src/types.ts";
import { TOP_LEVEL_KEYS } from "../packages/shared/src/config.ts";

const ROOT = join(import.meta.dirname, "..");
const schema = JSON.parse(readFileSync(join(ROOT, "schema/mainfast.schema.json"), "utf8"));
const ajv = new (Ajv2020 as unknown as typeof Ajv2020.default)({ allErrors: true, strict: true, allowUnionTypes: true });
const validate = ajv.compile(schema);
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Every product parses `text` without an error or a warning. */
function allAccept(text: string): void {
  intact(text);
  migrations(text);
  rollcall(text);
  owners(text);
  expect(evidence(text).warnings).toEqual([]);
}

const EXAMPLES = [
  "schema/example.mainfast.yml",
  "intact/examples/.mainfast.yml",
  "migrations/.mainfast.example.yml",
  "rollcall/.mainfast.example.yml",
  "owners/.mainfast.example.yml",
  "evidence/examples/mainfast.yml",
];

describe("schema/mainfast.schema.json", () => {
  it.each(EXAMPLES)("%s validates and every product accepts it silently", (path) => {
    const text = read(path);
    const ok = validate(parse(text));
    expect(validate.errors ?? [], path).toEqual([]);
    expect(ok).toBe(true);
    allAccept(text);
  });

  it("top level: the schema and the shared loader agree on the keys", () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...TOP_LEVEL_KEYS].sort());
  });

  it("section keys: the schema matches each product's parser", () => {
    const keys = (s: string) => Object.keys(schema.properties[s].properties).sort();
    expect(keys("intact")).toEqual([...INTACT_KEYS].sort());
    expect(keys("migrations")).toEqual([...MIGRATIONS_KEYS].sort());
    expect(keys("rollcall")).toEqual([...ROLLCALL_KEYS].sort());
    expect(keys("owners")).toEqual([...OWNERS_KEYS].sort());
    // Evidence reports unknown keys as warnings: every schema key must be warning-free.
    for (const k of keys("evidence")) {
      const w = evidence(`evidence:\n  ${k}: null\n`).warnings.filter((x) => x.includes("unknown key"));
      expect(w, k).toEqual([]);
    }
    expect(schema.properties.evidence.properties.flags.propertyNames.enum).toEqual([...FLAG_IDS]);
    expect(schema.properties.migrations.properties.paths.propertyNames.enum).toEqual([...FRAMEWORKS]);
  });

  it("intact.use_default_ignores defaults to false (lockfiles are checked)", () => {
    expect(schema.properties.intact.properties.use_default_ignores.default).toBe(false);
  });

  it("each product ignores the other products' sections without a warning", () => {
    allAccept(read("schema/example.mainfast.yml"));
    allAccept("intact:\n  main_branch: trunk\n");
    allAccept("evidence:\n  apply_to: all\n");
  });

  it("an unknown top-level key is rejected by the schema and by every product", () => {
    const text = "version: 1\nintakt:\n  ignore: [dist/]\n";
    expect(validate(parse(text))).toBe(false);
    for (const p of [intact, migrations, rollcall, owners]) expect(() => p(text)).toThrow(/unknown top-level key "intakt"/);
    expect(evidence(text).warnings.join("\n")).toMatch(/unknown top-level key "intakt"/);
  });

  it("an unknown key inside a section is rejected by the schema and by that product only", () => {
    const text = "migrations:\n  outoforder: warning\n";
    expect(validate(parse(text))).toBe(false);
    expect(() => migrations(text)).toThrow(/unknown key "outoforder"/);
    intact(text);
    rollcall(text);
    owners(text);
    expect(evidence(text).warnings).toEqual([]);
  });

  it("extends: accepted forms validate; bad forms fail in the schema and the loader", () => {
    for (const ok of ["acme/.github", "acme/.github:mainfast/base.yml", "acme/policies@v1", "acme/p:a/b.yml@main", "./shared/mainfast.yml"]) {
      expect(validate({ extends: ok }), ok).toBe(true);
      migrations(`extends: ${ok}\n`); // products that do not apply extends yet still accept the key
    }
    for (const bad of ["not a ref", "acme", "https://github.com/acme/x"]) {
      expect(validate({ extends: bad }), bad).toBe(false);
      expect(() => migrations(`extends: "${bad}"\n`), bad).toThrow(/extends/);
    }
  });

  it("migrations.outOfOrder: one severity or a per-framework map, in the schema and the parser", () => {
    for (const ok of ["warning", "off", { rails: "warning", prisma: "off" }, { drizzle: "error" }]) {
      expect(validate({ migrations: { outOfOrder: ok } }), JSON.stringify(ok)).toBe(true);
    }
    for (const bad of ["loud", { knex: "error" }, { rails: "notice" }, ["warning"]]) {
      expect(validate({ migrations: { outOfOrder: bad } }), JSON.stringify(bad)).toBe(false);
    }
    const ooo = schema.properties.migrations.properties.outOfOrder;
    expect(ooo.anyOf[1].propertyNames.enum).toEqual([...FRAMEWORKS]);
    expect(ooo.default).toEqual(DEFAULT_OUT_OF_ORDER);
    expect(migrations("migrations:\n  outOfOrder: { rails: error, prisma: off }\n").outOfOrder).toEqual({ ...DEFAULT_OUT_OF_ORDER, rails: "error", prisma: "off" });
    expect(() => migrations("migrations:\n  outOfOrder: { knex: error }\n")).toThrow(/unknown framework knex/);
  });

  it("version: only 1", () => {
    expect(validate({ version: 2 })).toBe(false);
    for (const p of [intact, migrations, rollcall, owners]) expect(() => p("version: 2\n")).toThrow(/unsupported version/);
  });
});
