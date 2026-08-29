# AI Relay Threat Model & Guard Options

Status: Draft — security audit; no code changes; nothing herein is accepted
architecture. Security decisions are GPT-owned (`decision:gpt-required`).

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

## 2. Deployment exposure matrix

The same `server/server.js` runs in four contexts (docs/server.md):

| Deployment | Server location | Listener | Relay reachable by | Evidence |
|---|---|---|---|---|
| Desktop (Electron) | in-process, player's machine | `app.listen(PORT)` → all interfaces (wildcard confirmed by comment) | loopback always; LAN if OS firewall allows inbound | `electron/main.cjs:161-179`; `server/server.js:906` |
| Android | embedded `nodejs-mobile`, in-process on the phone | all interfaces | phone itself + LAN (phone firewalls rarely block inbound Wi-Fi) | `docs/server.md:3,294`; `server/server.js:906` |
| Termux / manual local server | player's machine / LAN box | all interfaces | LAN by design (the Android connect screen probes it) | `server/server.js:61,906`; CORS block comment `server/server.js:68-72` |
| Web (hosted site) | **no game server** — static `dist-web` on static hosting | — | relay route does not exist | `vite build --mode web` (`package.json`), `scripts/assemble-site.mjs`; `PAGE_IS_LOCAL` is false on a hosted origin so the client never calls it either (`main.jsx:263-277`) |
| Self-hosted full stack | player may run `node server.js` on a VPS | all interfaces | **anyone on the internet** | `server/server.js:906` binds all interfaces with no host argument |

Net exposure: relay code ships in every non-web deployment and listens on all
interfaces. The web deployment is not affected.

## 3. Attacker model

| Attacker | Deployment | Can reach relay? | Constraint |
|---|---|---|---|
| Drive-by web page (visited by the player) | any server context | No, by default | Foreign `Origin` → 403 by the cross-origin-write guard (`server/server.js:112-128`, `security.js:35-54`) |
| Drive-by web page | server with `OH_ALLOW_CROSS_ORIGIN=1` | **Yes, unrestricted** | the 403 error message itself suggests setting this flag (`server/server.js:126`); CORS preflight already succeeds because of `Access-Control-Allow-Origin: *` + `Allow-Headers: Content-Type` (`server/server.js:73-89`) |
| Any LAN device (curl, script) | desktop / Android / Termux server | Yes, with one spoofed header | The guard compares `Origin` host to `Host` as strings (`security.js:51`); a non-browser client simply sends `Origin: http://<host>:<port>` and passes. The guard is browser-CSRF protection, not access control |
| Any LAN device, no header work | desktop / Android / Termux server | No | No-`Origin` writes from non-loopback are 403 (`security.js:39-42`) — but the same-origin spoof above defeats it |
| Malware / local user on the player's machine | all server contexts | Yes | Loopback no-Origin writes are explicitly trusted (`security.js:40-41`) |
| Anyone | self-hosted VPS | Yes, same Origin spoof | No additional auth exists anywhere on the API |
| Passive LAN sniffing (no relay access) | LAN deployments | n/a | Plaintext HTTP carries the provider API key in the relay body (see F9) |

Assumption tested: "the cross-origin-write guard protects the relay" — true
only for browsers, and only until `OH_ALLOW_CROSS_ORIGIN=1`.

## 4. Protected assets reachable through the relay

1. **Game saves and scenario data on the server's disk** — loopback SSRF reads
   them: `GET http://127.0.0.1:<port>/api/runtime/json/world` returns the full
   world state of the active game, and every `/api/runtime/*`, `/api/games`,
   `/api/scenarios` GET does the same for its asset (`server/server.js:520-570`,
   `:421-435`). The relay happily proxies a GET to its own server (F7).
2. **Other LAN services** — router admin panels, IoT devices, printers,
   NAS, anything HTTP(S) on the local network, including POSTs with
   attacker-chosen headers (F2, F4).
3. **Cloud metadata** — `http://169.254.169.254/…` if the server is ever run
   on a VPS (F2).
4. **The player's provider API keys** — via plaintext transit of relay
   bodies on cross-device LAN (F9). The XSS-adjacent content-type passthrough
   (F6) is a hardening gap, not a demonstrated key-exfiltration path.
5. **The player's local inference hardware** — the relay can drive the
   player's own llama.cpp / LM Studio / Ollama on loopback, burning their GPU
   (F2, F8).
6. **The player's IP** — the relay is an open GET/POST proxy for abusive or
   anonymizing traffic (F8).

## 5. Findings

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

Gemini and native Anthropic keys never transit the relay (their calls are
direct-only, `main.jsx:590`, `:971`), but they cross the LAN the same way
when a cross-device client sends them to the provider directly — a
deployment-wide plaintext question, not relay-specific.

## 6. Guard options (compared, not chosen — DECISION NEEDED)

All three below are designs, not recommendations. Selection is a security
decision owned by the GPT integration owner (AGENTS.md: Consensus or
Escalate).

### Option A — Harden the generic relay in place (MITIGATION-ONLY)

- Restrict targets to loopback/private ranges, resolved and checked at
  connect time and again on every redirect hop (`redirect: "manual"` loop,
  mirroring `server/server.js:682-695`).
- Whitelist upstream headers (`Content-Type`, `Authorization`, `x-api-key`,
  `anthropic-version` only).
- Restrict passthrough content-types to `application/json` /
  `text/event-stream`; cap response size; add an upstream timeout.
- Drop GET proxying (POST only).

Pros: smallest diff; keeps "any local model server" compatibility.
Cons: **incomplete as a guard** — with no authorization boundary, the
spoofed-Origin LAN attacker still drives the relay against every
private-range host on the network (router admin, IoT, NAS, the game server
itself via loopback). DNS-rebinding remains a residual risk for the
IP-check; relay to remote self-hosted endpoints breaks. Status: A reduces
blast radius (no internet targets, no arbitrary headers, no open GET) but
does **not** close the private-network SSRF hole — it must be combined with
B's endpoint binding or C's authorization boundary to be a real guard.

### Option B — Server-side endpoint profile instead of a free-form URL

Persist the configured `openai-compatible` / `anthropic-compatible` endpoint
on the server (e.g., a `POST /api/settings` the locally-served page already
talks to), and make the relay accept only a profile id; the server validates
`url` against the stored value before proxying.

Pros: the relay can no longer be pointed at arbitrary hosts by anyone —
including a spoofed-Origin LAN attacker; a redirect-hop allowlist becomes
enforceable per profile.
Cons: requires server-side storage of provider settings (today they exist
only in browser `localStorage`, `providerConfig.js:42-103`); every device
must re-configure or sync settings; Android-WebView and desktop share one
server so settings would become global; "any gateway" flexibility is lost
unless profiles support multiple endpoints.

### Option C — Remove the generic relay; CORS or a desktop-only token

- Published guidance already tells local servers to send CORS headers
  (`OLLAMA_ORIGINS=…`, `main.jsx:345-352`); make that the primary path and
  delete the generic relay.
- Keep a relay only inside the desktop app, gated on `OH_DESKTOP_BUILD`
  (set by Electron, `electron/main.cjs:37`), and require a per-process
  random token that the server injects into the locally served page and the
  client echoes on relay calls.

Pros: strongest reduction — the only relay that exists runs in a context
where the browser and server are the same player process.
Cons: the blanket `Access-Control-Allow-Origin: *` (`server/server.js:74`)
would expose any token endpoint to every origin, so Option C forces a CORS
scope change (or a token delivered outside HTTP) — a broader change than the
relay itself; Termux/Android LAN setups lose relay fallback for their local
model servers unless they also configure CORS (possible for Ollama/LM
Studio, not all backends).

Cross-cutting decision points for the owner: acceptable compatibility loss
(remote gateways via relay, exotic local backends), whether server-side
provider config is acceptable (B), whether the blanket CORS may be scoped
(C), and whether `OH_ALLOW_CROSS_ORIGIN` should exist at all (F1).

## 7. Assumptions tested and unknowns

Tested against code/config:
- Relay route exists in every non-web deployment and binds all interfaces
  (`server/server.js:906`; `electron/main.cjs:161-179`).
- Write guard precedes the relay in middleware order
  (`server/server.js:112-128` vs route registration `:605`).
- `Access-Control-Allow-Origin: *` + `Allow-Headers: Content-Type` permit
  cross-origin JSON POST preflight (`server/server.js:73-89`).
- Web deployment never serves the relay (`package.json` build targets;
  `PAGE_IS_LOCAL` gate `main.jsx:263-277`).

Unknowns (recorded, not inferred):
1. Whether any player actually self-hosts the full stack on a public IP —
   no telemetry exists; the VPS row in §2 is a configuration possibility,
   not an observed deployment.
2. OS firewall behavior on Windows/macOS/Android is platform-dependent and
   unmeasured; LAN reachability assumptions are conservative.
3. Node's `fetch` DNS resolution and connection pooling details (relevant to
   DNS-rebinding residuals in Option A) are runtime-level, not verified by
   test.

## 8. Verification

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
