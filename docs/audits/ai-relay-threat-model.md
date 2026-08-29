# AI Relay Threat Model & Guard Options

Status: Accepted audit. The integration decision is Option M (§7); no runtime
code changes are part of this document.

Scope: the generic browser-side AI relay `POST /api/ai/relay`
(`server/server.js:605-636`) and its client counterpart `providerFetch` /
`relayFetch` (`src/Game/AI/main.jsx:308-356`). Only `docs/audits/` is
writable; `server/**`, `src/runtime/web/**`, `src/Game/AI/**` and deployment
docs were read-only evidence.

Base SHA: `9d684f5a0f61b365d4aa1aef8c1ee34416fe6d27` (`private/main`).

---

## 1. What the relay is

The browser cannot call self-hosted OpenAI-compatible endpoints directly
because those servers rarely send CORS headers. When the page is served from
a machine the player controls (`PAGE_IS_LOCAL`, `main.jsx:263-277`),
`providerFetch` falls back to the same-origin relay on a CORS `TypeError`
(`main.jsx:327-356`). The relay body is
`{ url, method, headers, payload }` (`main.jsx:308-314`); the server fetches
`url` with those headers, forwarding status, content-type and body
(`server/server.js:614-630`).

Relay coverage (verified callers of `providerFetch`, the only route into the
relay):
- **Native OpenAI** — `callOpenAI` → `callOpenAIStyleChatCompletions`
  (`main.jsx:840-871`) which fetches through `providerFetch`
  (`main.jsx:692`). On a local page it *can* fall back to the relay, even
  though `api.openai.com` normally sends CORS headers.
- **OpenAI-compatible** — same function, user endpoint
  (`main.jsx:874-905`, `:692`).
- **Anthropic-compatible** — `callAnthropicCompatible` → `providerFetch`
  (`main.jsx:1081`).
- **Model discovery** — `resolveModel`'s `GET /models` through
  `providerFetch` (`main.jsx:512`), applies to the two OpenAI-style
  providers only (`providerConfig.js:141-144`).

Never relayed: **Gemini** and **native Anthropic** use plain `fetch` with no
relay fallback (`main.jsx:566`, `:590`, `:971`).

The relay is a *general outbound HTTP proxy*: `method` may be `GET`, in which
case no body is sent (`server/server.js:621-623`), and the target is any
`http:`/`https:` URL (`server/server.js:616-619`).

## 2. Security scope — owner boundary (80/20 local-first)

Project-owner decision (2026-08-29) that constrains every conclusion below:

1. The product is **local-first**; hostile public multi-tenant hosting and
   zero-trust platform design are **out of scope** this phase.
2. Default non-web server binding should be **loopback-only**.
3. LAN binding is an explicit **operator opt-in**, not the default.
4. In LAN mode the generic AI relay is **disabled** unless separately and
   explicitly enabled; the trust tradeoff must be shown/documented.
5. Only **cheap reliability guards** are added to relay operation: upstream
   timeout/abort, bounded response size, safe error/content handling.
6. Out of scope this phase: accounts, persistent server-side provider
   profiles, OAuth, elaborate per-process token delivery, DNS-rebinding
   infrastructure, public-hosting hardening.
7. A malicious process already running as the same local user is **outside
   the Phase 1 threat boundary**.

Consequences for this document: the threat model still records the current
behavior factually (including the all-interfaces bind and the open relay),
but severity is scoped to the boundary above, and the guard comparison in
§7 identifies a minimal local-first option as the recommendation — it does
not treat every theoretical deployment equally.

## 3. Deployment exposure matrix

The same `server/server.js` runs in four contexts (docs/server.md):

| Deployment | Server location | Listener | Relay reachable by | Evidence |
|---|---|---|---|---|
| Desktop (Electron) | in-process, player's machine | `app.listen(PORT)` → all interfaces (wildcard confirmed by comment) | loopback always; LAN if OS firewall allows inbound | `electron/main.cjs:161-179`; `server/server.js:906` |
| Android | embedded `nodejs-mobile`, in-process on the phone | all interfaces | phone itself + LAN (phone firewalls rarely block inbound Wi-Fi) | `docs/server.md:3,294`; `server/server.js:906` |
| Termux / manual local server | player's machine / LAN box | all interfaces | LAN by design (the Android connect screen probes it) | `server/server.js:61,906`; CORS block comment `server/server.js:68-72` |
| Web (hosted site) | **no game server** — static `dist-web` on static hosting | — | relay route does not exist | `vite build --mode web` (`package.json`), `scripts/assemble-site.mjs`; `PAGE_IS_LOCAL` is false on a hosted origin so the client never calls it either (`main.jsx:263-277`) |
| Self-hosted full stack | player may run `node server.js` on a VPS | all interfaces | **anyone on the internet** | `server/server.js:906` binds all interfaces with no host argument. **Outside Phase 1 scope** per owner boundary (§2) — recorded for completeness only |

Net exposure: relay code ships in every non-web deployment and listens on all
interfaces today. Per the owner scope (§2), the intended shape is different:
**loopback-only binding by default, LAN as explicit opt-in, and the relay
disabled in LAN mode unless separately enabled** — the current all-interfaces
bind (`server/server.js:906`) does not yet implement that scope. The web
deployment is not affected.

## 4. Attacker model

Rows are kept factual; "in scope" marks whether the owner boundary (§2)
includes the attacker this phase.

| Attacker | Deployment | Can reach relay? | Constraint | In Phase 1 scope? |
|---|---|---|---|---|
| Drive-by web page (visited by the player) | any server context | No, by default | Foreign `Origin` → 403 by the cross-origin-write guard (`server/server.js:112-128`, `security.js:35-54`) | yes — must stay blocked |
| Drive-by web page | server with `OH_ALLOW_CROSS_ORIGIN=1` | **Yes, unrestricted** | the 403 error message itself suggests setting this flag (`server/server.js:126`); CORS preflight already succeeds because of `Access-Control-Allow-Origin: *` + `Allow-Headers: Content-Type` (`server/server.js:73-89`) | yes |
| Any LAN device (curl, script) | LAN-opted-in desktop / Android / Termux server | Yes, with one spoofed header | The guard compares `Origin` host to `Host` as strings (`security.js:51`); a non-browser client simply sends `Origin: http://<host>:<port>` and passes. The guard is browser-CSRF protection, not access control | yes — **if** the operator opts into LAN mode with the relay enabled; the opt-in must document this |
| Any LAN device, no header work | LAN-opted-in server | No | No-`Origin` writes from non-loopback are 403 (`security.js:39-42`) — but the same-origin spoof above defeats it | — |
| Malware / malicious process as the same local user | all server contexts | Yes | Loopback no-Origin writes are explicitly trusted (`security.js:40-41`) | **No — outside the Phase 1 boundary** (§2.7) |
| Anyone | self-hosted VPS | Yes, same Origin spoof | No additional auth exists anywhere on the API | **No — public hosting out of scope** (§2.1) |
| Passive LAN sniffing (no relay access) | LAN deployments | n/a | Plaintext HTTP carries the provider API key in the relay body (see F9) | yes — tradeoff to document when LAN mode is opted into |

Assumption tested: "the cross-origin-write guard protects the relay" — true
only for browsers, and only until `OH_ALLOW_CROSS_ORIGIN=1`.

## 5. Protected assets reachable through the relay

1. **Game saves and scenario data on the server's disk** — loopback SSRF reads
   them: `GET http://127.0.0.1:<port>/api/runtime/json/world` returns the full
   world state of the active game, and every `/api/runtime/*`, `/api/games`,
   `/api/scenarios` GET does the same for its asset (`server/server.js:520-570`,
   `:421-435`). The relay happily proxies a GET to its own server (F7). In the
   scoped threat model (§2) the only capable driver is a same-origin or
   same-user process, which is accepted for Phase 1 (Option M, §7).
2. **Other LAN services** — router admin panels, IoT devices, printers,
   NAS, anything HTTP(S) on the local network, including POSTs with
   attacker-chosen headers (F2, F4). Reachable only when the operator opts
   into LAN mode with the relay enabled (§2.3-2.4).
3. **Cloud metadata** — `http://169.254.169.254/…` if the server is ever run
   on a VPS (F2). Outside Phase 1 scope (§2.1); recorded for completeness.
4. **The player's provider API keys** — via plaintext transit of relay
   bodies on cross-device LAN (F9). The XSS-adjacent content-type passthrough
   (F6) is a hardening gap, not a demonstrated key-exfiltration path.
5. **The player's local inference hardware** — the relay can drive the
   player's own llama.cpp / LM Studio / Ollama on loopback, burning their GPU
   (F2, F8). Same-user driver is outside the boundary (§2.7).
6. **The player's IP** — the relay is an open GET/POST proxy for abusive or
   anonymizing traffic (F8). Reachable only under the LAN opt-in (§2.3-2.4).

## 6. Findings

### F1 — The only gate is a spoofable, opt-outable CSRF guard

The relay sits behind `crossOriginWriteAllowed` (`server/server.js:112-128`)
which is string-based Origin-vs-Host comparison (`security.js:45-54`). It
stops browsers, nothing else. `OH_ALLOW_CROSS_ORIGIN=1` disables it entirely
(`server/server.js:111`), and the 403 response tells the operator to set that
flag (`server/server.js:126`). There is no authentication anywhere on the
API.

### F2 — Unrestricted target URL (SSRF)

`const target = new URL(String(targetUrl ?? ""))` with a check for
`http:`/`https:` only (`server/server.js:616-619`). No host allowlist, no
private-range/loopback block, no metadata-IP block. Contrast the hub proxy,
which allowlists GitHub hosts and re-checks every hop
(`server/server.js:576-582,682-695`).

### F3 — Redirects are followed with no hop checks

`fetch(target, …)` uses the default `redirect: "follow"` (`server/server.js:620-625`).
A "model endpoint" can redirect anywhere — internal IPs included. The hub
proxy deliberately uses `redirect: "manual"` with per-hop allowlist
re-validation for exactly this reason (`server/server.js:682-695`).

### F4 — Arbitrary upstream header injection

The client-supplied `headers` object is spread into the upstream request
with only `Content-Type` forced (`server/server.js:622`). What actually
reaches the target was verified empirically against the runtime's `fetch`
(Undici; Node engines `^20.19.0 || >=22.12.0`, `package.json`):

- **Pass through verbatim** (tested): `Authorization`, `Cookie`,
  `x-api-key`, `X-Forwarded-For`, and arbitrary custom headers. These are
  the credential-shaped headers that matter for internal admin APIs and
  proxies that trust `X-Forwarded-*`.
- **Ignored / derived from the URL**: `Host` — Undici sets it from the
  target URL and the supplied value is not forwarded (tested). The
  virtual-host-routing variant of the attack is therefore not available;
  host selection still is (F2).
- **Validated**: a supplied `Content-Length` is honored and checked against
  the actual body — a mismatch aborts the upstream request
  (`RequestContentLengthMismatchError`, tested). A relay driver can break
  requests this way, but only ones it already controls.

### F5 — No timeout, no response-size cap, full buffering

The upstream `fetch` has no timeout (only the client's abort propagates,
`server/server.js:611-624`), so a target that accepts the connection and
stalls holds the route open indefinitely. `await upstream.text()` buffers the
entire response before `res.send` (`server/server.js:626-630`), and the
route's body parser is `largeJsonParser` (2048 MB, `server/server.js:65`) —
memory-exhaustion pressure on the server process is attacker-controllable
in proportion to response size.

### F6 — Untrusted response content-type and body passthrough (hardening gap)

The upstream status, content-type and body are passed through untouched
(`server/server.js:628-630`). The relay is a `fetch()`-only, POST route with
no navigation sink — a `text/html` body is consumed by `response.text()` /
`response.json()` in the provider callers, so **no executable XSS path is
demonstrated**. The risks are instead: (a) a target may return arbitrarily
large or arbitrarily typed bodies (size cap and content-type allowlist are
absent — see F5); (b) any future consumer that renders or embeds relay
output inherits the risk; (c) consumers keyed on content-type can be
confused by mismatched types. The hub-file route's `nosniff` + attachment +
CSP guards (`server/server.js:585-597`) are not directly transferable: that
route is *navigable* (a crafted link opens it top-level), the relay is not.
Hardening recommendation: cap response size, time out upstream, and
restrict passthrough content-types to the AI-shaped set
(`application/json`, `text/event-stream`).

### F7 — Loopback SSRF reads the game server's own data

A relay request to `http://127.0.0.1:<port>/api/runtime/json/<assetKey>` is a
normal GET handled by the same process (`server/server.js:520-529`) — game
world/events/actions/chats are returned through the relay as JSON. No guard
in the relay distinguishes "its own server" from a model endpoint.

### F8 — GET proxying makes it an open proxy

`method === "GET" ? "GET" : "POST"` (`server/server.js:621`) — with no
target restriction, anyone who can drive the relay can browse the web through
the player's IP and POST attacker payloads to arbitrary hosts.

### F9 — Provider keys transit unencrypted HTTP whenever relayed

Every relayed mode carries its key inside the relay request body: native
**OpenAI** and **OpenAI-compatible** put `Authorization: Bearer …` into the
headers passed to `providerFetch` (`main.jsx:848-851`, `:882-885`,
`:308-314`), **Anthropic-compatible** sends `x-api-key` (`main.jsx:1053-1057`).
Two transport contexts:

- **Same device** (browser and server on one machine — the desktop app, or a
  phone talking to its own embedded server): the request is plaintext HTTP
  but confined to loopback; a passive LAN listener cannot see it.
- **Cross-device LAN** (a desktop browser or WebView connecting to a server
  on another machine — the Android/home-server topology,
  `docs/server.md:3`, `main.jsx:263-277` LAN ranges): the relay body,
  key included, crosses the network unencrypted and is visible to any
  passive listener on that network. The server has no TLS at all
  (`server/server.js:906`).

Gemini and native Anthropic keys never transit the relay. Their native callers
connect directly from the browser to fixed HTTPS provider endpoints
(`main.jsx:590`, `:971`), so there is no plaintext browser-to-game-server hop;
normal LAN observers see encrypted TLS traffic, not the key.

## 7. Guard options and integration decision

The GPT integration owner accepts Option M under the owner scope (§2). The
heavier alternatives remain documented for any future public-hosting or
untrusted-LAN requirement.

### Option M — Minimal local-first hardening (accepted for Phase 1)

- **Loopback-only default bind** for the non-web server (all interfaces only
  when a LAN opt-in is set) — today the server always binds all interfaces
  (`server/server.js:906`; wildcard confirmed in `electron/main.cjs:161-164`).
- **LAN mode = explicit operator opt-in**, and in LAN mode the generic relay
  is **disabled unless separately enabled**; the enabling docs/flags must
  state the trust tradeoff (spoofed-Origin LAN clients can drive the relay
  to private-range targets; keys transit plaintext, §4/F9).
- **Cheap relay reliability guards only** (§2.5): upstream timeout with
  abort propagation, bounded response size, and content-type passthrough
  limited to `application/json` / `text/event-stream` with safe error
  handling (F5, F6). No allowlists, no profiles, no auth.
- **Preserve compatibility**: local/self-hosted model endpoints and model
  discovery keep working unchanged (`providerFetch`, `main.jsx:327-356`;
  `resolveModel`, `main.jsx:489-534`).

Rationale: in loopback-only mode the only relay drivers are the player's own
browser (same-origin) and processes on the machine, and a malicious
same-user process is outside the Phase 1 boundary (§2.7); the CSRF guard
already blocks drive-by pages (F1). LAN mode keeps its residual risks, but
they are operator-acknowledged opt-ins, not silent defaults. F7 (loopback
reads of the server's own data) remains available to a same-origin driver
by design of the generic proxy — an accepted tradeoff of keeping the relay
generic — and is documented here rather than engineered away.

What M does **not** do (out of scope per §2.6): endpoint allowlists or
private-range checks (DNS-rebinding infrastructure excluded), server-side
provider profiles, per-process tokens, auth, public-hosting hardening.
Consequence: M is *not* a fix for F2/F3/F8 against LAN attackers — it
removes LAN attackers from the default threat surface instead, and keeps
the findings on record for any future hosting decision.

### Option A — Harden the generic relay in place (heavier than M; not needed for Phase 1)

- Restrict targets to loopback/private ranges, resolved and checked at
  connect time and again on every redirect hop (`redirect: "manual"` loop,
  mirroring `server/server.js:682-695`).
- Whitelist upstream headers (`Content-Type`, `Authorization`, `x-api-key`,
  `anthropic-version` only); drop GET proxying.

Pros: keeps "any local model server" compatibility while shrinking F2/F3/F8
for LAN mode.
Cons: **incomplete as a guard** — with no authorization boundary, the
spoofed-Origin LAN attacker still drives the relay against every
private-range host on the network; DNS-rebinding remains a residual risk;
relay to remote self-hosted endpoints breaks. It adds redirect-hop and
IP-check machinery the owner explicitly deferred (§2.6). Status: useful
later if LAN-mode hardening is ever wanted; not required this phase.

### Option B — Server-side endpoint profile instead of a free-form URL

Persist the configured endpoint on the server and validate the relay target
against it.

Pros: removes arbitrary target choice.
Cons: requires server-side provider-settings storage (excluded by §2.6:
"persistent server-side provider profiles"), makes settings global across
devices, and loses "any gateway" flexibility. Status: **excluded this phase**
by owner scope.

### Option C — Remove the generic relay; CORS or a desktop-only token

- Make CORS-configured local servers the primary path (`OLLAMA_ORIGINS=…`,
  `main.jsx:345-352`) and delete the generic relay; optionally keep a
  desktop-only relay behind `OH_DESKTOP_BUILD` (`electron/main.cjs:37`) with
  a per-process token.

Pros: strongest reduction.
Cons: requires scoping the blanket CORS (`server/server.js:74`) to protect
any token endpoint and breaks relay fallback for LAN/Android setups —
elaborate token delivery is explicitly deferred (§2.6). Status: **excluded
this phase** by owner scope.

Integration decisions: exact flag names remain an implementation detail;
`OH_ALLOW_CROSS_ORIGIN` stays as a legacy explicit escape hatch in Phase 1 and
must not be enabled implicitly by LAN mode; timeout, bounded response size and
safe content-type/error handling are required Phase 1 reliability guards.

## 8. Assumptions tested and unknowns

Tested against code/config:
- Relay route exists in every non-web deployment and binds all interfaces
  (`server/server.js:906`; `electron/main.cjs:161-179`) — the loopback-only /
  LAN-opt-in shape of §2 is a **directive to implement**, not current
  behavior.
- Write guard precedes the relay in middleware order
  (`server/server.js:112-128` vs route registration `:605`).
- `Access-Control-Allow-Origin: *` + `Allow-Headers: Content-Type` permit
  cross-origin JSON POST preflight (`server/server.js:73-89`).
- Web deployment never serves the relay (`package.json` build targets;
  `PAGE_IS_LOCAL` gate `main.jsx:263-277`).

Unknowns (recorded, not inferred):
1. Whether any player actually self-hosts the full stack on a public IP —
   no telemetry exists; the VPS row in §3 is a configuration possibility,
   not an observed deployment — and is outside the Phase 1 scope (§2).
2. OS firewall behavior on Windows/macOS/Android is platform-dependent and
   unmeasured; LAN reachability assumptions are conservative.
3. Node's `fetch` DNS resolution and connection pooling details (relevant to
   DNS-rebinding residuals in Option A) are runtime-level, not verified by
   test.

## 9. Verification

- `git diff --check` clean.
- Evidence re-checked: relay handler `server/server.js:605-636`; middleware
  order `:73-89, :112-128`; hub-file guards `:585-597, :682-695`; client
  relay path `main.jsx:263-356, :692, :840-905, :1053-1057`; guard logic
  `security.js:35-54`; bind `server/server.js:906`; Electron
  `electron/main.cjs:161-179, :37`.
- F4 header behavior verified empirically against the project's runtime
  (`node` v25.9.0, Undici `fetch`; engines `^20.19.0 || >=22.12.0`): a local
  HTTP sink observed `Authorization`, `Cookie`, `x-api-key`,
  `X-Forwarded-For` and custom headers arriving verbatim, `Host` replaced by
  the URL-derived value, and a mismatched `Content-Length` aborting the
  request.
