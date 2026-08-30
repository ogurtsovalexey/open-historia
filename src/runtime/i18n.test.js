import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LOCALES,
  getLanguageOptions,
  getStoredChatLanguage,
  getStoredLanguage,
  normalizeLocale,
  setStoredChatLanguage,
  setStoredLanguage,
  syncLanguageFromServer,
} from "./i18n.js";

const UI_KEY = "ui_language";
const CHAT_KEY = "ai_chat_language";
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");

const restoreGlobal = (name, descriptor) => {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
};

const installGlobal = (name, value) => {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
};

const createStorage = (entries = []) => {
  const values = new Map(entries);
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
};

let storage;
let fetchCalls;

beforeEach(() => {
  storage = createStorage();
  fetchCalls = [];
  installGlobal("localStorage", storage);
  installGlobal("fetch", async (url, init) => {
    fetchCalls.push({ url, init });
    return { ok: true, json: async () => ({ language: "en" }) };
  });
});

afterEach(() => {
  restoreGlobal("localStorage", originalLocalStorage);
  restoreGlobal("fetch", originalFetch);
});

after(() => {
  assert.deepStrictEqual(
    Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    originalLocalStorage,
  );
  assert.deepStrictEqual(Object.getOwnPropertyDescriptor(globalThis, "fetch"), originalFetch);
});

test("the production selector exposes exactly English and Russian", () => {
  assert.deepStrictEqual(SUPPORTED_LOCALES, ["en", "ru"]);
  assert.deepStrictEqual(getLanguageOptions().map(({ code }) => code), ["en", "ru"]);
});

test("locale normalization is pure, strict and falls back to authored English", () => {
  delete globalThis.localStorage;
  delete globalThis.fetch;

  for (const [input, expected] of [
    ["en", "en"],
    ["ru", "ru"],
    ["  ru  ", "ru"],
    ["RU", "en"],
    ["de", "en"],
    ["", "en"],
    ["   ", "en"],
    [null, "en"],
    [undefined, "en"],
    [42, "en"],
  ]) {
    assert.strictEqual(normalizeLocale(input), expected);
  }
  assert.strictEqual(DEFAULT_LANGUAGE, "en");
});

test("local UI reads canonicalize legacy, empty and padded values", () => {
  assert.strictEqual(getStoredLanguage(), "en");
  assert.strictEqual(storage.values.has(UI_KEY), false);

  storage.values.set(UI_KEY, "  ru  ");
  assert.strictEqual(getStoredLanguage(), "ru");
  assert.strictEqual(storage.values.get(UI_KEY), "ru");

  for (const legacy of ["de", "", "EN", "   ", "en"]) {
    storage.values.set(UI_KEY, legacy);
    assert.strictEqual(getStoredLanguage(), "en");
    assert.strictEqual(storage.values.has(UI_KEY), false);
  }
});

test("UI writes persist and send only canonical en or ru", async () => {
  await setStoredLanguage("  ru  ");
  assert.strictEqual(storage.values.get(UI_KEY), "ru");
  assert.deepStrictEqual(JSON.parse(fetchCalls[0].init.body), { language: "ru" });

  await setStoredLanguage("de");
  assert.strictEqual(storage.values.has(UI_KEY), false);
  assert.deepStrictEqual(JSON.parse(fetchCalls[1].init.body), { language: "en" });

  installGlobal("fetch", async () => {
    throw new Error("offline");
  });
  await assert.doesNotReject(() => setStoredLanguage("ru"));
  assert.strictEqual(storage.values.get(UI_KEY), "ru");
});

test("server reconciliation normalizes supported and unsupported settings locally", async () => {
  storage.values.set(UI_KEY, "ru");
  installGlobal("fetch", async (url) => {
    fetchCalls.push({ url });
    return { ok: true, json: async () => ({ language: "de" }) };
  });
  assert.strictEqual(await syncLanguageFromServer(), true);
  assert.strictEqual(getStoredLanguage(), "en");
  assert.strictEqual(storage.values.has(UI_KEY), false);

  installGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ language: "  ru  " }),
  }));
  assert.strictEqual(await syncLanguageFromServer(), true);
  assert.strictEqual(storage.values.get(UI_KEY), "ru");

  installGlobal("fetch", async () => ({ ok: false, json: async () => ({ language: "en" }) }));
  assert.strictEqual(await syncLanguageFromServer(), false);
  assert.strictEqual(storage.values.get(UI_KEY), "ru");
  assert.deepStrictEqual(fetchCalls.map(({ url }) => url), ["/api/ui-settings"]);
});

test("chat locale accepts only en and ru and otherwise follows the UI locale", () => {
  storage.values.set(UI_KEY, "ru");
  assert.strictEqual(getStoredChatLanguage(), "ru");

  setStoredChatLanguage("en");
  assert.strictEqual(storage.values.get(CHAT_KEY), "en");
  assert.strictEqual(getStoredChatLanguage(), "en");

  setStoredChatLanguage("  ru  ");
  assert.strictEqual(storage.values.get(CHAT_KEY), "ru");

  storage.values.set(CHAT_KEY, "de");
  assert.strictEqual(getStoredChatLanguage(), "ru");
  assert.strictEqual(storage.values.has(CHAT_KEY), false);

  for (const invalid of ["", "   ", "de", null]) {
    setStoredChatLanguage(invalid);
    assert.strictEqual(storage.values.has(CHAT_KEY), false);
  }
});

test("storage failures fail safely without widening the locale boundary", async () => {
  installGlobal("localStorage", {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  });

  assert.strictEqual(getStoredLanguage(), "en");
  assert.strictEqual(getStoredChatLanguage(), "en");
  assert.doesNotThrow(() => setStoredChatLanguage("ru"));
  await assert.doesNotReject(() => setStoredLanguage("ru"));
});

test("locale persistence never reaches translation or provider endpoints", async () => {
  installGlobal("fetch", async (url, init) => {
    assert.strictEqual(url, "/api/ui-settings");
    fetchCalls.push({ url, init });
    return { ok: true, json: async () => ({ language: "ru" }) };
  });

  await setStoredLanguage("ru");
  await syncLanguageFromServer();
  setStoredChatLanguage("en");
  getStoredChatLanguage();

  assert.deepStrictEqual(fetchCalls.map(({ url }) => url), [
    "/api/ui-settings",
    "/api/ui-settings",
  ]);
});
