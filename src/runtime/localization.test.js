/*! Open Historia — localisation guarantees for the two supported locales. */
import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LANG_DIR = join(REPO_ROOT, "public", "lang");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * The interface ships English and Russian, both from checked-in packs. A missing
 * Russian entry must show English so the gap stays visible — it must NEVER be
 * repaired at runtime by calling a model. See docs/canon/07-ai-boundary.md.
 */
describe("localisation: static packs only, no model in the loop", () => {
  it("the translator never reaches a model", () => {
    const source = readFileSync(join(REPO_ROOT, "src", "runtime", "translator.js"), "utf8");
    for (const forbidden of ["callAI", "Game/AI"]) {
      assert.ok(
        !source.includes(forbidden),
        `translator.js must not reference ${forbidden}: a missing pack entry falls back to English, it is never translated at runtime`
      );
    }
  });

  it("no module reachable from the translator pulls in the AI layer", () => {
    const source = readFileSync(join(REPO_ROOT, "src", "runtime", "translator.js"), "utf8");
    const dynamicImports = [...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
    for (const specifier of dynamicImports) {
      assert.ok(
        !specifier.includes("Game/AI"),
        `translator.js dynamically imports ${specifier}, which reaches the AI layer`
      );
    }
  });
});

describe("localisation: pack completeness", () => {
  it("every catalogued English string has a Russian entry", () => {
    const catalog = readJson(join(LANG_DIR, "catalog-en.json"));
    const russian = readJson(join(LANG_DIR, "ru.json"));
    assert.ok(Array.isArray(catalog), "catalog-en.json is the list of authored strings");
    const missing = catalog.filter((entry) => !Object.prototype.hasOwnProperty.call(russian, entry));
    assert.deepStrictEqual(
      missing.slice(0, 10),
      [],
      `${missing.length} catalogued strings have no Russian entry; run the catalog/pack build before shipping`
    );
  });

  it("the Russian pack carries no entry the catalog does not know", () => {
    const catalog = new Set(readJson(join(LANG_DIR, "catalog-en.json")));
    const russian = readJson(join(LANG_DIR, "ru.json"));
    const stale = Object.keys(russian).filter((key) => !catalog.has(key));
    assert.deepStrictEqual(
      stale.slice(0, 10),
      [],
      `${stale.length} Russian entries are stale: the English string they translate no longer exists`
    );
  });
});

describe("localisation: only the supported locales ship", () => {
  it("public/lang holds no pack outside the supported set", () => {
    // catalog-en.json is the authored source list, not a locale pack.
    const allowed = new Set(["ru.json", "catalog-en.json"]);
    const shipped = readdirSync(LANG_DIR).filter((name) => name.endsWith(".json"));
    const extra = shipped.filter((name) => !allowed.has(name));
    assert.deepStrictEqual(
      extra,
      [],
      `these packs cannot be selected in the UI and must not ship: ${extra.join(", ")}`
    );
  });
});
