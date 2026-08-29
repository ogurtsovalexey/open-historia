// Unit tests for the server security helpers. Run with `npm test`
// (node --test). No framework needed — these are pure functions.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  crossOriginWriteAllowed,
  isAllowedHubUrl,
  isLoopbackAddress,
  parseByteRange,
  resolveChildPath,
  isRelayAllowed,
  isSafeContentType,
  getBindHost,
  getServerRunningMessage,
  MAX_RELAY_RESPONSE_SIZE,
  RELAY_TIMEOUT_MS,
  RELAY_ERROR_CODES,
} from "./security.js";

const BASE = path.resolve("/srv/data/scenarios");

test("resolveChildPath accepts a plain child id", () => {
  assert.equal(resolveChildPath(BASE, "modern-day"), path.join(BASE, "modern-day"));
  assert.equal(resolveChildPath(BASE, "default.json"), path.join(BASE, "default.json"));
});

test("resolveChildPath rejects traversal, separators, empty and absolute paths", () => {
  // Express decodes %2f to "/" before this runs, so the real attack arrives as "../".
  for (const bad of ["../../manifest", "../sibling", "sub/child", "", ".", "/etc/passwd"]) {
    assert.throws(() => resolveChildPath(BASE, bad), /Invalid/, `should reject ${JSON.stringify(bad)}`);
  }
});

test("isLoopbackAddress recognises local addresses only", () => {
  for (const ok of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackAddress(ok), true, ok);
  }
  for (const no of ["192.168.1.5", "10.0.0.2", "::ffff:192.168.1.5", "", undefined, null]) {
    assert.equal(isLoopbackAddress(no), false, String(no));
  }
});

test("crossOriginWriteAllowed: safe methods always pass", () => {
  assert.equal(crossOriginWriteAllowed({ method: "GET" }).allowed, true);
  assert.equal(crossOriginWriteAllowed({ method: "OPTIONS" }).allowed, true);
});

test("crossOriginWriteAllowed: same-origin write allowed, foreign Origin blocked", () => {
  assert.equal(
    crossOriginWriteAllowed({ method: "POST", origin: "http://localhost:3000", host: "localhost:3000" }).allowed,
    true,
  );
  assert.equal(
    crossOriginWriteAllowed({ method: "DELETE", origin: "https://evil.com", host: "localhost:3000" }).allowed,
    false,
  );
});

test("crossOriginWriteAllowed: no-Origin allowed from loopback, blocked from LAN", () => {
  assert.equal(
    crossOriginWriteAllowed({ method: "POST", host: "localhost:3000", remoteAddress: "127.0.0.1" }).allowed,
    true,
  );
  // A curl from another host on the LAN with no Origin — the hostile-LAN case.
  const lan = crossOriginWriteAllowed({ method: "POST", host: "192.168.1.9:3000", remoteAddress: "192.168.1.50" });
  assert.equal(lan.allowed, false);
  assert.equal(lan.reason, "no-origin-nonloopback");
});

test("crossOriginWriteAllowed: override flag opens everything", () => {
  assert.equal(
    crossOriginWriteAllowed({ method: "POST", origin: "https://evil.com", host: "x", allowAll: true }).allowed,
    true,
  );
});

test("parseByteRange: suffix range returns the FINAL N bytes", () => {
  assert.deepEqual(parseByteRange("bytes=-500", 10000), { start: 9500, end: 9999 });
});

test("parseByteRange: explicit and open-ended ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-499", 10000), { start: 0, end: 499 });
  assert.deepEqual(parseByteRange("bytes=500-", 10000), { start: 500, end: 9999 });
});

test("parseByteRange: empty / unsatisfiable ranges are 416", () => {
  assert.equal(parseByteRange("bytes=-", 10000).status, 416);
  assert.equal(parseByteRange("nonsense", 10000).status, 416);
  assert.equal(parseByteRange("bytes=99999-", 10000).status, 416);
});

test("isAllowedHubUrl: https GitHub hosts only", () => {
  const hosts = new Set(["github.com", "objects.githubusercontent.com"]);
  assert.equal(isAllowedHubUrl(new URL("https://github.com/a/b"), hosts), true);
  assert.equal(isAllowedHubUrl(new URL("https://objects.githubusercontent.com/x"), hosts), true);
  assert.equal(isAllowedHubUrl(new URL("https://evil.com/x"), hosts), false);
  assert.equal(isAllowedHubUrl(new URL("http://github.com/a/b"), hosts), false);
});

test("isAllowedHubUrl: any *.githubusercontent.com CDN host is allowed on redirect", () => {
  const hosts = new Set(["github.com"]); // release-assets host deliberately NOT listed
  // GitHub redirects release-asset downloads here — must be accepted.
  assert.equal(isAllowedHubUrl(new URL("https://release-assets.githubusercontent.com/x"), hosts), true);
  assert.equal(isAllowedHubUrl(new URL("https://objects.githubusercontent.com/y"), hosts), true);
  // Lookalike hosts must NOT slip through.
  assert.equal(isAllowedHubUrl(new URL("https://githubusercontent.com.evil.com/x"), hosts), false);
  assert.equal(isAllowedHubUrl(new URL("https://notgithubusercontent.com/x"), hosts), false);
});

test("isRelayAllowed: enabled off LAN, disabled in LAN unless opted in", () => {
  // Loopback-only server: relay is always available.
  assert.equal(isRelayAllowed(false, false), true);
  assert.equal(isRelayAllowed(false, true), true);
  // LAN mode: disabled by default, enabled only with the explicit opt-in.
  assert.equal(isRelayAllowed(true, false), false);
  assert.equal(isRelayAllowed(true, true), true);
});

test("getBindHost: loopback by default, all interfaces only in LAN mode", () => {
  assert.equal(getBindHost(false), "127.0.0.1");
  assert.equal(getBindHost(true), undefined); // undefined === Express "all interfaces"
});

test("getServerRunningMessage matches the bind decision", () => {
  assert.equal(getServerRunningMessage(3000, false), "Server running at http://127.0.0.1:3000");
  assert.equal(getServerRunningMessage(3000, true), "Server running at http://localhost:3000");
});

test("isSafeContentType: only JSON and SSE are forwarded", () => {
  for (const ok of ["application/json", "application/json; charset=utf-8", "text/event-stream", "text/event-stream; charset=utf-8"]) {
    assert.equal(isSafeContentType(ok), true, ok);
  }
  for (const no of ["text/html", "application/javascript", "image/png", "", null, undefined]) {
    assert.equal(isSafeContentType(no), false, String(no));
  }
});

test("relay bounds and typed error codes are exported", () => {
  assert.equal(MAX_RELAY_RESPONSE_SIZE, 10 * 1024 * 1024);
  assert.equal(RELAY_TIMEOUT_MS, 60000);
  assert.deepEqual(RELAY_ERROR_CODES, {
    INVALID_TARGET: "invalid_target",
    UNSAFE_CONTENT_TYPE: "unsafe_content_type",
    RESPONSE_TOO_LARGE: "response_too_large",
    UPSTREAM_TIMEOUT: "upstream_timeout",
    CLIENT_DISCONNECT: "client_disconnect",
    UPSTREAM_ERROR: "upstream_error",
  });
});
