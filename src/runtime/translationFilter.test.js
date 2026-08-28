import assert from "node:assert/strict";
import test from "node:test";

import { looksLikeTargetLanguage, shouldTranslateUiText } from "./translationFilter.js";

test("Russian UI containing an English brand is already in the target language", () => {
  const text = "Оставьте пустым для локального Ollama";
  assert.equal(looksLikeTargetLanguage(text, "ru"), true);
  assert.equal(shouldTranslateUiText(text, "ru"), false);
});

test("English source UI is still translated into Russian", () => {
  assert.equal(shouldTranslateUiText("Leave blank for local Ollama", "ru"), true);
});

test("known translated values are never re-queued on a React rerender", () => {
  assert.equal(shouldTranslateUiText("Configuración de OpenAI", "es", new Set(["Configuración de OpenAI"])), false);
});

test("numbers, glyphs and dates do not need translation", () => {
  assert.equal(shouldTranslateUiText("2016-01-02", "ru"), false);
  assert.equal(shouldTranslateUiText("⚙", "ru"), false);
});
