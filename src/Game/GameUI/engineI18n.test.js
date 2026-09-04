import test from "node:test";
import assert from "node:assert/strict";
import { engineLocalized, engineName, engineText } from "./engineI18n.js";

test("engine UI localises fixed terms, historical names and copied Russian fallbacks", () => {
  assert.equal(engineText("Politics", "ru"), "Политика");
  assert.equal(engineText("Kurt Schuschnigg", "ru"), "Курт Шушниг");
  assert.equal(engineText("unknown-id", "ru"), "unknown-id");
  assert.equal(engineName({ displayName: { en: "Austria home theatre", ru: "Austria home theatre" } }, "ru"), "Австрийская армия метрополии");
  assert.equal(engineName({ displayName: { en: "Wien", ru: "Вена" } }, "ru"), "Вена");
  assert.equal(engineLocalized({ en: "Administrative reform", ru: "Administrative reform" }, "ru"), "Административная реформа");
  assert.equal(
    engineLocalized({ en: "Austria public institutions and declared policy at the scenario snapshot.", ru: "Austria public institutions and declared policy at the scenario snapshot." }, "ru"),
    "Государственные институты и официальная политика страны «Австрия» на дату начала сценария.",
  );
});
