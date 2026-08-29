/*! Open Historia — server security helpers. Pure, dependency-light functions
 *  for path containment, the CSRF/origin guard, HTTP range parsing and the hub
 *  host allowlist. Kept separate so they can be unit-tested (security.test.js)
 *  without spinning up the server. */
import path from "path";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// A child id/name must resolve to a DIRECT child of baseDir. Rejects "../", a
// path separator (including the %2f Express decodes back into "/"), and absolute
// paths, so an unnormalized route param can't escape the data dir on
// read/update/delete. Throws on anything unsafe; returns the absolute path.
export const resolveChildPath = (baseDir, name, label = "id") => {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, String(name ?? ""));
  if (path.dirname(resolved) !== base) {
    throw new Error(`Invalid ${label}: ${name}`);
  }
  return resolved;
};

// True only for the local machine. IPv4-mapped IPv6 (::ffff:127.0.0.1) is
// unwrapped first.
export const isLoopbackAddress = (addr) => {
  if (!addr) return false;
  const a = String(addr).replace(/^::ffff:/i, "");
  return a === "::1" || a === "127.0.0.1" || /^127\./.test(a);
};

// Decide whether a state-changing request may proceed (CSRF / drive-by guard).
// Allowed: safe methods; same-origin app writes (Origin host === Host); and
// native clients with no Origin BUT only from loopback. A foreign Origin, or a
// no-Origin write from a non-loopback host (the hostile-LAN case the Origin
// check can't see), is rejected. Returns { allowed, reason }.
export const crossOriginWriteAllowed = ({ method, origin, host, remoteAddress, allowAll = false }) => {
  if (allowAll) return { allowed: true, reason: "override" };
  if (SAFE_METHODS.has(String(method || "").toUpperCase())) return { allowed: true, reason: "safe-method" };

  if (!origin) {
    return isLoopbackAddress(remoteAddress)
      ? { allowed: true, reason: "loopback" }
      : { allowed: false, reason: "no-origin-nonloopback" };
  }

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return { allowed: false, reason: "invalid-origin" };
  }
  return originHost === host
    ? { allowed: true, reason: "same-origin" }
    : { allowed: false, reason: "cross-origin" };
};

// Parse an HTTP Range header against a file of totalSize bytes. Returns
// { status: 416 } for an unsatisfiable/empty range, else inclusive { start,
// end }. Suffix ranges ("bytes=-N") correctly mean the FINAL N bytes.
export const parseByteRange = (rangeHeader, totalSize) => {
  const match = /bytes=(\d*)-(\d*)/i.exec(String(rangeHeader || ""));
  if (!match || (!match[1] && !match[2])) return { status: 416 };

  let start;
  let end;
  if (!match[1]) {
    const suffix = Number.parseInt(match[2], 10);
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    const s = Number.parseInt(match[1], 10);
    if (s >= totalSize) return { status: 416 }; // first-byte-pos past EOF
    const e = match[2] ? Number.parseInt(match[2], 10) : totalSize - 1;
    start = Math.max(0, Math.min(s, totalSize - 1));
    end = Math.max(start, Math.min(e, totalSize - 1));
  }

  if (start >= totalSize) return { status: 416 };
  return { start, end };
};

// A hub download URL must be https and either on the fixed GitHub host allowlist
// OR any *.githubusercontent.com CDN host — checked on the initial URL AND every
// redirect hop. GitHub serves release/attachment downloads off a rotating family
// of those hosts (objects., release-assets., …); release assets now redirect to
// release-assets.githubusercontent.com, which a fixed list missed and wrongly
// rejected as "redirected off GitHub". Every *.githubusercontent.com host is
// GitHub-controlled, so this stays safe against redirect-to-internal SSRF.
export const isAllowedHubUrl = (candidate, allowedHosts) =>
  candidate.protocol === "https:" &&
  (allowedHosts.has(candidate.hostname) || candidate.hostname.endsWith(".githubusercontent.com"));

// ---------------------------------------------------------------------------
// AI relay guards (Option M — minimal local-first hardening).
// ---------------------------------------------------------------------------

// The generic AI relay is only safe to run on a loopback-only server, where the
// sole drivers are the player's own browser (same-origin) or a process already
// running as the same user. In LAN mode any device on the network can drive the
// relay to private-range targets with a spoofed Origin, and provider API keys
// transit the LAN in plaintext — so the relay stays OFF in LAN mode unless the
// operator explicitly opts in with OH_AI_RELAY_IN_LAN=1.
export const isRelayAllowed = (lanMode, relayInLan) => !lanMode || relayInLan;

// Bind host for the non-web server. Loopback-only by default; LAN mode (an
// explicit operator opt-in) binds every interface. `undefined` is what
// Express/Node treat as "all interfaces" (0.0.0.0 / ::).
export const getBindHost = (lanMode) => (lanMode ? undefined : "127.0.0.1");

// Human message for the boot log. Kept alongside the bind decision so the two
// can never drift apart.
export const getServerRunningMessage = (port, lanMode) =>
  lanMode ? `Server running at http://localhost:${port}` : `Server running at http://127.0.0.1:${port}`;

// AI-shaped content types the relay will pass through. Anything else (including
// a missing Content-Type) is rejected rather than forwarded blind: a `text/html`
// or `application/javascript` body has no place coming back from a model
// endpoint, and an absent type is unsafe to pass through by default.
export const isSafeContentType = (contentType) => {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  return type === "application/json" || type === "text/event-stream";
};

// Cheap reliability bounds for the relay (Option M §2.5 / F5).
export const MAX_RELAY_RESPONSE_SIZE = 10 * 1024 * 1024; // 10 MiB
export const RELAY_TIMEOUT_MS = 60 * 1000; // 60 s

// Distinct, typed reasons a relay request can end with. The route maps each to a
// different downstream response; a client disconnect must send nothing.
export const RELAY_ERROR_CODES = {
  INVALID_TARGET: "invalid_target",
  UNSAFE_CONTENT_TYPE: "unsafe_content_type",
  RESPONSE_TOO_LARGE: "response_too_large",
  UPSTREAM_TIMEOUT: "upstream_timeout",
  CLIENT_DISCONNECT: "client_disconnect",
  UPSTREAM_ERROR: "upstream_error",
};

export class RelayError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "RelayError";
    this.code = code;
  }
}

// Read an upstream response body into a UTF-8 string, enforcing the byte cap in
// two places: the Content-Length header is rejected BEFORE the first read, and
// the running total is re-checked AFTER every chunk so a chunked/lying upstream
// cannot stream past the limit. The reader is always released; on overflow the
// stream is cancelled so the upstream is told to stop sending. When `signal`
// aborts, the reader is cancelled (which unblocks a pending read) and the call
// throws a plain Error — the caller re-maps that to UPSTREAM_TIMEOUT or
// CLIENT_DISCONNECT, which this function cannot distinguish.
export const readLimitedResponse = async (response, maxBytes, signal) => {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new RelayError(
        RELAY_ERROR_CODES.RESPONSE_TOO_LARGE,
        `Response too large (${contentLength} bytes, max ${maxBytes}).`,
      );
    }
  }

  // A signal that is already aborted fails before the reader is taken, so the
  // stream is never locked for nothing.
  if (signal?.aborted) {
    throw new Error("Upstream read aborted.");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new RelayError(RELAY_ERROR_CODES.UPSTREAM_ERROR, "Response has no readable body.");
  }

  let received = 0;
  const chunks = [];
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    reader.cancel().catch(() => {});
  };

  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkSize = typeof value?.byteLength === "number"
        ? value.byteLength
        : Buffer.byteLength(value);
      received += chunkSize;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RelayError(
          RELAY_ERROR_CODES.RESPONSE_TOO_LARGE,
          `Response too large (${received}+ bytes, max ${maxBytes}).`,
        );
      }
      chunks.push(value);
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  if (aborted) {
    throw new Error("Upstream read aborted.");
  }
  return Buffer.concat(chunks).toString("utf-8");
};

// One bounded upstream lifecycle for the AI relay. It validates the target
// scheme, applies a timeout, propagates the caller's cancellation, fetches,
// rejects unsafe/missing content types, and reads the body under the size cap —
// then reports success or one of the typed RELAY_ERROR_CODES. All timer and
// listener state is released in `finally` regardless of how the call exits.
export const executeBoundedUpstreamFetch = async ({
  url,
  method = "POST",
  headers = {},
  payload,
  timeoutMs = RELAY_TIMEOUT_MS,
  maxBytes = MAX_RELAY_RESPONSE_SIZE,
  callerSignal,
}) => {
  const target = new URL(String(url ?? ""));
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new RelayError(RELAY_ERROR_CODES.INVALID_TARGET, "Only http(s) AI endpoints can be relayed.");
  }

  const controller = new AbortController();
  let timeoutId = null;
  let timedOut = false;

  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      throw new RelayError(RELAY_ERROR_CODES.CLIENT_DISCONNECT, "Client disconnected before the request started.");
    }
    callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const upstream = await fetch(target, {
      method: method === "GET" ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: method === "GET" ? undefined : JSON.stringify(payload ?? {}),
      signal: controller.signal,
    });

    const contentType = upstream.headers.get("content-type") || "";
    if (!isSafeContentType(contentType)) {
      await upstream.body?.cancel?.().catch(() => {});
      throw new RelayError(
        RELAY_ERROR_CODES.UNSAFE_CONTENT_TYPE,
        `Unsafe or missing content type: ${contentType || "(none)"}.`,
      );
    }

    const body = await readLimitedResponse(upstream, maxBytes, controller.signal);
    return { status: upstream.status, contentType, body };
  } catch (error) {
    if (error instanceof RelayError) {
      throw error;
    }
    if (callerSignal?.aborted) {
      throw new RelayError(RELAY_ERROR_CODES.CLIENT_DISCONNECT, "Client disconnected.");
    }
    if (timedOut) {
      throw new RelayError(RELAY_ERROR_CODES.UPSTREAM_TIMEOUT, "Upstream request timed out.");
    }
    throw new RelayError(RELAY_ERROR_CODES.UPSTREAM_ERROR, error?.message || "Upstream request failed.");
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (callerSignal) {
      callerSignal.removeEventListener("abort", onCallerAbort);
    }
  }
};
