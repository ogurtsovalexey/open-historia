// Behaviour tests for the AI relay guards (Option M). These exercise the real
// production helpers in server/security.js — readLimitedResponse and
// executeBoundedUpstreamFetch — against controlled Response/ReadableStream
// objects and a stubbed global fetch, so no network is ever touched.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executeBoundedUpstreamFetch,
  readLimitedResponse,
  RelayError,
  RELAY_ERROR_CODES,
} from "./security.js";

const encoder = new TextEncoder();

// A ReadableStream that yields the given chunks in order. String chunks are
// UTF-8 encoded; the callbacks let a test observe pull/cancel for proving the
// "rejected before read" and "cancelled on overflow" behaviours.
const chunksToStream = (chunks, { onPull, onCancel } = {}) => {
  const data = chunks.map((c) => (typeof c === "string" ? encoder.encode(c) : c));
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      onPull?.();
      if (i < data.length) {
        controller.enqueue(data[i]);
        i += 1;
      } else {
        controller.close();
      }
    },
    cancel(reason) {
      onCancel?.(reason);
    },
  });
};

// A stream whose read never resolves until the reader is cancelled — the shape
// of an upstream that accepts the connection and stalls.
const hangingStream = () =>
  new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  });

const jsonResponse = (bodyText, { status = 200, headers = {} } = {}) =>
  new Response(bodyText, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

// Run `run` with globalThis.fetch replaced by `impl`, restoring the original
// fetch in a finally so a failing assertion never leaks the stub.
const withStubbedFetch = async (impl, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const errorCode = async (promise) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof RelayError ? error.code : `non-relay:${error?.message}`;
  }
};

// --- readLimitedResponse ---------------------------------------------------

test("readLimitedResponse rejects an oversized Content-Length before reading", async () => {
  const stream = chunksToStream(["should never be read"]);
  const response = new Response(stream, { headers: { "content-length": "999999" } });

  const code = await errorCode(readLimitedResponse(response, 1024));
  assert.equal(code, RELAY_ERROR_CODES.RESPONSE_TOO_LARGE);
  // getReader() locks the stream; an unlocked stream proves the body was never
  // taken up for reading once the header alone already exceeded the cap.
  assert.equal(stream.locked, false, "body must not be read when Content-Length already exceeds the cap");
});

test("readLimitedResponse cancels on chunked overflow past the cap", async () => {
  let cancelled = false;
  const response = new Response(
    chunksToStream(["aaaa", "bbbb", "cccc"], { onCancel: () => { cancelled = true; } }),
    { status: 200 }, // no content-length: the cap must be enforced incrementally
  );

  const code = await errorCode(readLimitedResponse(response, 8));
  assert.equal(code, RELAY_ERROR_CODES.RESPONSE_TOO_LARGE);
  assert.equal(cancelled, true, "overflow must cancel the stream");
});

test("readLimitedResponse returns the decoded body under the cap", async () => {
  const response = jsonResponse('{"ok":true}', { headers: { "content-length": "11" } });
  const text = await readLimitedResponse(response, 1024);
  assert.equal(text, '{"ok":true}');
});

// --- executeBoundedUpstreamFetch ------------------------------------------

test("relay forwards a safe JSON response", async () => {
  await withStubbedFetch(async () => jsonResponse('{"message":"hi"}', { headers: { "content-length": "17" } }), async () => {
    const result = await executeBoundedUpstreamFetch({ url: "https://example.test/v1/chat" });
    assert.equal(result.status, 200);
    assert.equal(result.contentType, "application/json");
    assert.equal(result.body, '{"message":"hi"}');
  });
});

test("relay forwards a text/event-stream response", async () => {
  await withStubbedFetch(async () => new Response("data: hi\n\n", {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  }), async () => {
    const result = await executeBoundedUpstreamFetch({ url: "https://example.test/v1/chat", method: "POST" });
    assert.equal(result.contentType, "text/event-stream; charset=utf-8");
    assert.equal(result.body, "data: hi\n\n");
  });
});

test("relay rejects an unsafe content type", async () => {
  await withStubbedFetch(async () => new Response("<html></html>", {
    headers: { "content-type": "text/html" },
  }), async () => {
    const code = await errorCode(executeBoundedUpstreamFetch({ url: "https://example.test/x" }));
    assert.equal(code, RELAY_ERROR_CODES.UNSAFE_CONTENT_TYPE);
  });
});

test("relay rejects a missing content type", async () => {
  await withStubbedFetch(async () => new Response("{}"), async () => {
    const code = await errorCode(executeBoundedUpstreamFetch({ url: "https://example.test/x" }));
    assert.equal(code, RELAY_ERROR_CODES.UNSAFE_CONTENT_TYPE);
  });
});

test("relay rejects a non-http(s) target", async () => {
  let fetched = false;
  await withStubbedFetch(async () => { fetched = true; return jsonResponse("{}"); }, async () => {
    const code = await errorCode(executeBoundedUpstreamFetch({ url: "file:///etc/passwd" }));
    assert.equal(code, RELAY_ERROR_CODES.INVALID_TARGET);
    assert.equal(fetched, false, "invalid targets must never reach fetch");
  });
});

test("relay maps malformed and missing targets to the typed invalid-target error", async () => {
  for (const url of [undefined, "", "not a URL"]) {
    const code = await errorCode(executeBoundedUpstreamFetch({ url }));
    assert.equal(code, RELAY_ERROR_CODES.INVALID_TARGET, String(url));
  }
});

test("relay rejects an oversized Content-Length before reading", async () => {
  await withStubbedFetch(async () => jsonResponse("{}", { headers: { "content-length": "999999" } }), async () => {
    const code = await errorCode(executeBoundedUpstreamFetch({ url: "https://example.test/x", maxBytes: 1024 }));
    assert.equal(code, RELAY_ERROR_CODES.RESPONSE_TOO_LARGE);
  });
});

test("relay times out when the body stalls", async () => {
  await withStubbedFetch(async () => new Response(hangingStream(), {
    headers: { "content-type": "application/json" },
  }), async () => {
    const code = await errorCode(executeBoundedUpstreamFetch({
      url: "https://example.test/x",
      timeoutMs: 20,
    }));
    assert.equal(code, RELAY_ERROR_CODES.UPSTREAM_TIMEOUT);
  });
});

test("relay maps caller cancellation to a client disconnect", async () => {
  await withStubbedFetch(async () => new Response(hangingStream(), {
    headers: { "content-type": "application/json" },
  }), async () => {
    const caller = new AbortController();
    const pending = executeBoundedUpstreamFetch({ url: "https://example.test/x", callerSignal: caller.signal });
    setTimeout(() => caller.abort(), 10);
    const code = await errorCode(pending);
    assert.equal(code, RELAY_ERROR_CODES.CLIENT_DISCONNECT);
  });
});

test("relay reports an already-aborted caller without fetching", async () => {
  let fetched = false;
  await withStubbedFetch(async () => { fetched = true; return jsonResponse("{}"); }, async () => {
    const caller = new AbortController();
    caller.abort();
    const code = await errorCode(executeBoundedUpstreamFetch({ url: "https://example.test/x", callerSignal: caller.signal }));
    assert.equal(code, RELAY_ERROR_CODES.CLIENT_DISCONNECT);
    assert.equal(fetched, false);
  });
});

test("relay reports an upstream network failure", async () => {
  await withStubbedFetch(async () => { throw new Error("ECONNREFUSED"); }, async () => {
    const code = await errorCode(executeBoundedUpstreamFetch({ url: "https://example.test/x" }));
    assert.equal(code, RELAY_ERROR_CODES.UPSTREAM_ERROR);
  });
});
