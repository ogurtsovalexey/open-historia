import test from "node:test";
import assert from "node:assert/strict";
import { extractErrorMessage, readErrorPayload } from "./errorPayload.js";

test("extractErrorMessage preserves the server's string error envelope", () => {
  assert.equal(
    extractErrorMessage({ error: "Run the local model/contract schema preflight before this turn." }, "fallback"),
    "Run the local model/contract schema preflight before this turn.",
  );
});

test("readErrorPayload retains non-JSON error bodies for display", async () => {
  const payload = await readErrorPayload({ text: async () => "upstream unavailable" });
  assert.equal(extractErrorMessage(payload, "fallback"), "upstream unavailable");
});
