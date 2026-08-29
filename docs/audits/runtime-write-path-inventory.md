# Runtime Write Path Inventory

This document catalogs all canonical runtime write paths and their atomicity failure modes in Open Historia.

## Overview

The application employs a modular, atomic write strategy for persistent state. All state is written through `writeJson` (in `src/runtime/assets.js`), which ensures consistent handling of JSON payloads across all runtime assets. The system follows the principle of atomic revision commits, where a turn is committed under a single world revision to prevent mixed revisions after crashes.

## Core Write Paths

### 1. `writeJson` (Primary Entry Point)
- **Location**: `src/runtime/assets.js`
- **Purpose**: Standardized write operation for all runtime JSON assets
- **Behavior**:
  - Serializes data with `JSON.stringify` (pretty-printing optional)
  - Sends `PUT` request to target URL with `Content-Type: application/json`
  - Caches the saved payload in `primeJson` (in-memory and persistent)
  - Invalidates derived caches (e.g., nation colors, country names) on write
  - Updates the persistent cache via `persistResponse`

### 2. `writeWorldState`
- **Location**: `src/runtime/gameState.js`
- **Purpose**: Writes the complete world state to `JSON_URLS.world`
- **Behavior**:
  - Normalizes world state using `normalizeWorldState`
  - Translates polity names and other content
  - Calls `writeJson` with `{ pretty: true }`
  - Invalidates derived caches

### 3. `writeGameData`
- **Location**: `src/runtime/gameState.js`
- **Purpose**: Writes game metadata to `JSON_URLS.game`
- **Behavior**:
  - Normalizes game data using `normalizeGameData`
  - Calls `writeJson` with `{ pretty: true }`

### 4. `writeEventsState`
- **Location**: `src/runtime/gameState.js`
- **Purpose**: Writes event history to `JSON_URLS.events`
- **Behavior**:
  - Normalizes events using `normalizeEvents`
  - Applies de-duplication via `dedupeEventLog`
  - Calls `writeJson` with `{ pretty: true }`
  - Translates event text

### 5. `writeActionsState`
- **Location**: `src/runtime/gameState.js`
- **Purpose**: Writes action history to `JSON_URLS.actions`
- **Behavior**:
  - Normalizes actions using `normalizeActions`
  - Calls `writeJson` with `{ pretty: true }`

### 6. `writeChatsState`
- **Location**: `src/runtime/gameState.js`
- **Purpose**: Writes chat history to `JSON_URLS.chat`
- **Behavior**:
  - Normalizes chats using `normalizeChats`
  - Calls `writeJson` with `{ pretty: true }`

## Atomicity and Consistency

### Atomic Commit Strategy
- All state modifications are written atomically through `writeJson`
- A turn is committed under a single world revision, ensuring consistency
- No partial state updates are allowed

### Failure Modes

1. **Network Failure**
   - Write request fails with HTTP error
   - No state is written, but local state may be lost if not persisted
   - Recovered via retry mechanism in `writeJson`

2. **Cache Inconsistency**
   - In-memory cache (`jsonValueCache`) becomes stale
   - Persistent cache (`Cache Storage`) may contain outdated data
   - Mitigated by URL-based cache invalidation on write

3. **Race Conditions**
   - Concurrent writes to the same asset
   - Risk of lost updates or inconsistent state
   - Mitigated by `jsonRequestCache` batching

4. **Serialization Errors**
   - `JSON.stringify` fails on circular references or non-serializable data
   - Handled by `primeJson` and `writeJson` error handling

5. **State Corruption**
   - Invalid data written to asset
   - Prevented by normalization before write (e.g., `normalizeWorldState`)
   - Validated by schema checks in `gameplaySchemas.js`

## Safety Mechanisms

- **Normalization**: All data is normalized before writing using `normalize*` functions
- **Cache Invalidation**: Derived caches are invalidated after writes
- **Error Handling**: `writeJson` handles transient failures with retries
- **Persistent Caching**: State is persisted to `Cache Storage` for offline access
- **Batching**: Concurrent requests to the same URL are batched via `jsonRequestCache`

## Validation

- All write operations are validated against the accepted contract in `AGENTS.md`
- Atomicity is verified through system tests
- Failure modes are documented and mitigated as described above

## References

- `AGENTS.md` - AI Agent Instructions
- `docs/principles.md` - Architectural Principles
- `src/runtime/assets.js` - Core write functionality
- `src/runtime/gameState.js` - State management
- `docs/agent-workflow.md` - Parallel workflow protocol