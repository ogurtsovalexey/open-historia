// Run: node --test src/runtime/worldRevisionCore.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  WORLD_PROJECTION_KEYS,
  WorldRevisionError,
  sha256Hex,
  validateCanonicalValue,
  canonicalizeProjection,
  validateProjectionKeys,
  computeProjectionDescriptors,
  validateManifest,
  verifyProjectionDescriptors,
  buildWorldBundle,
  planWorldRevisionCommit,
} from "./worldRevisionCore.js";

// --- Test helpers ---

const createValidProjections = () => ({
  actions: { list: [] },
  chat: { messages: [] },
  events: { timeline: [] },
  game: { turn: 1, date: "1914-01-01" },
  world: { regions: {}, polities: {} },
  colors: { palette: {} },
});

const createValidManifest = (overrides = {}) => ({
  schema: "open-historia-world-revision/1",
  gameId: "game-123",
  revision: "rev-abc",
  parentRevision: null,
  committedAt: "2026-01-01T12:00:00Z",
  reason: "turn",
  rollbackOf: null,
  projections: {
    actions: { checksum: "a".repeat(64), byteLength: 10 },
    chat: { checksum: "b".repeat(64), byteLength: 10 },
    events: { checksum: "c".repeat(64), byteLength: 10 },
    game: { checksum: "d".repeat(64), byteLength: 10 },
    world: { checksum: "e".repeat(64), byteLength: 10 },
    colors: { checksum: "f".repeat(64), byteLength: 10 },
  },
  ...overrides,
});

// --- Group A: Constants and basic types ---

test("A1 WORLD_PROJECTION_KEYS contains exactly six keys", () => {
  assert.deepEqual(WORLD_PROJECTION_KEYS, ["actions", "chat", "events", "game", "world", "colors"]);
  assert.equal(WORLD_PROJECTION_KEYS.length, 6);
  assert(Object.isFrozen(WORLD_PROJECTION_KEYS));
});

test("A2 WorldRevisionError has code and path properties", () => {
  const err = new WorldRevisionError("TEST_CODE", "test message", "test.path");
  assert.equal(err.name, "WorldRevisionError");
  assert.equal(err.code, "TEST_CODE");
  assert.equal(err.path, "test.path");
  assert.equal(err.message, "test message");
  assert(err instanceof Error);
});

// --- Group B: SHA‑256 utility ---

test("B1 sha256Hex produces correct hash for empty string", async () => {
  const hash = await sha256Hex("");
  assert.equal(hash.length, 64);
  assert.equal(hash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("B2 sha256Hex produces correct hash for non‑empty string", async () => {
  const hash = await sha256Hex("hello world");
  assert.equal(hash.length, 64);
  assert.equal(hash, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
});

test("B3 sha256Hex handles Unicode", async () => {
  const hash = await sha256Hex("café 🎉");
  assert.equal(hash.length, 64);
  // Just verify it produces a consistent hash
  const hash2 = await sha256Hex("café 🎉");
  assert.equal(hash, hash2);
});

// --- Group C: Canonical JSON validation ---

test("C1 validateCanonicalValue accepts valid JSON types", () => {
  assert.deepEqual(validateCanonicalValue(null), []);
  assert.deepEqual(validateCanonicalValue(true), []);
  assert.deepEqual(validateCanonicalValue(false), []);
  assert.deepEqual(validateCanonicalValue(42), []);
  assert.deepEqual(validateCanonicalValue(3.14), []);
  assert.deepEqual(validateCanonicalValue("string"), []);
  assert.deepEqual(validateCanonicalValue([]), []);
  assert.deepEqual(validateCanonicalValue({}), []);
  assert.deepEqual(validateCanonicalValue({ a: 1, b: [2, 3] }), []);
});

test("C2 validateCanonicalValue rejects undefined", () => {
  const errors = validateCanonicalValue(undefined);
  assert.equal(errors.length, 1);
  assert(errors[0].includes("undefined"));
});

test("C3 validateCanonicalValue rejects functions and symbols", () => {
  assert(validateCanonicalValue(() => {}).some(e => e.includes("function")));
  assert(validateCanonicalValue(Symbol()).some(e => e.includes("symbol")));
});

test("C4 validateCanonicalValue rejects non‑finite numbers", () => {
  assert(validateCanonicalValue(NaN).some(e => e.includes("non-finite")));
  assert(validateCanonicalValue(Infinity).some(e => e.includes("non-finite")));
  assert(validateCanonicalValue(-Infinity).some(e => e.includes("non-finite")));
});

test("C5 validateCanonicalValue rejects sparse arrays", () => {
  const sparse = [];
  sparse[2] = "value"; // index 0 and 1 are missing (undefined)
  const errors = validateCanonicalValue(sparse);
  // Should have 3 errors: 1 for sparse array + 2 for undefined at [0] and [1]
  assert.equal(errors.length, 3);
  assert(errors.some(e => e.includes("sparse array")));
  assert(errors.some(e => e.includes("[0]") && e.includes("undefined")));
  assert(errors.some(e => e.includes("[1]") && e.includes("undefined")));

  // Also test with undefined in the middle
  const sparse2 = ["a", , "c"]; // index 1 is missing
  const errors2 = validateCanonicalValue(sparse2);
  // Should have 2 errors: 1 for sparse array + 1 for undefined at [1]
  assert.equal(errors2.length, 2);
  assert(errors2.some(e => e.includes("sparse array")));
  assert(errors2.some(e => e.includes("[1]") && e.includes("undefined")));
});

test("C6 validateCanonicalValue validates nested structures", () => {
  const value = {
    a: [1, 2, { b: undefined }],
    c: { d: NaN },
  };
  const errors = validateCanonicalValue(value);
  assert.equal(errors.length, 2);
  assert(errors.some(e => e.includes("undefined") && e.includes("a[2].b")));
  assert(errors.some(e => e.includes("non-finite") && e.includes("c.d")));
});

test("C7 validateCanonicalValue includes path in error messages", () => {
  const errors = validateCanonicalValue({ a: { b: undefined } }, "root");
  assert.equal(errors.length, 1);
  assert(errors[0].includes("root.a.b"));
});

test("C8 validateCanonicalValue rejects non-JSON objects, bigint, accessors and symbols", () => {
  assert(validateCanonicalValue(1n).some(error => error.includes("bigint")));
  assert(validateCanonicalValue(new Date()).some(error => error.includes("non-plain")));
  assert(validateCanonicalValue(new Map()).some(error => error.includes("non-plain")));
  const accessor = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
  assert(validateCanonicalValue(accessor).some(error => error.includes("accessor")));
  const hidden = {};
  Object.defineProperty(hidden, "value", { enumerable: false, value: 1 });
  assert(validateCanonicalValue(hidden).some(error => error.includes("non-enumerable")));
  assert(validateCanonicalValue({ [Symbol("secret")]: true }).some(error => error.includes("symbol-keyed")));
});

test("C9 validateCanonicalValue rejects cycles but permits shared subtrees", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert(validateCanonicalValue(cyclic).some(error => error.includes("cyclic")));
  const shared = { value: 1 };
  assert.deepEqual(validateCanonicalValue({ left: shared, right: shared }), []);
});

// --- Group D: Canonicalization ---

test("D1 canonicalizeProjection rejects undefined", async () => {
  await assert.rejects(
    () => canonicalizeProjection(undefined),
    (err) => err.code === "INVALID_JSON_VALUE" && err.message.includes("undefined")
  );
});

test("D2 canonicalizeProjection rejects non‑finite numbers", async () => {
  await assert.rejects(
    () => canonicalizeProjection({ value: Infinity }),
    (err) => err.code === "INVALID_JSON_VALUE" && err.message.includes("non-finite")
  );
});

test("D3 canonicalizeProjection canonicalizes with sorted keys", async () => {
  const input = { z: 1, a: 2, m: 3 };
  const { canonical } = await canonicalizeProjection(input);
  const parsed = JSON.parse(canonical);
  assert.deepEqual(Object.keys(parsed), ["a", "m", "z"]);
});

test("D4 canonicalizeProjection produces deterministic bytes for same content", async () => {
  const obj1 = { b: 2, a: 1 };
  const obj2 = { a: 1, b: 2 };

  const result1 = await canonicalizeProjection(obj1);
  const result2 = await canonicalizeProjection(obj2);

  assert.equal(result1.canonical, result2.canonical);
  assert.deepEqual(result1.bytes, result2.bytes);
});

test("D5 canonicalizeProjection handles nested object sorting", async () => {
  const input = {
    z: { y: 1, x: 2 },
    a: [3, 1, 2],
  };
  const { canonical } = await canonicalizeProjection(input);
  const parsed = JSON.parse(canonical);
  assert.deepEqual(Object.keys(parsed), ["a", "z"]);
  assert.deepEqual(parsed.a, [3, 1, 2]); // arrays maintain order
  assert.deepEqual(Object.keys(parsed.z), ["x", "y"]);
});

// --- Group E: Projection key validation ---

test("E1 validateProjectionKeys accepts exact six keys", () => {
  assert.doesNotThrow(() => validateProjectionKeys(createValidProjections()));
});

test("E2 validateProjectionKeys rejects non‑object", () => {
  assert.throws(
    () => validateProjectionKeys(null),
    (err) => err.code === "INVALID_PROJECTIONS"
  );
  assert.throws(
    () => validateProjectionKeys("not an object"),
    (err) => err.code === "INVALID_PROJECTIONS"
  );
});

test("E3 validateProjectionKeys rejects missing keys", () => {
  const missing = { ...createValidProjections() };
  delete missing.actions;
  assert.throws(
    () => validateProjectionKeys(missing),
    (err) => err.code === "MISSING_PROJECTION" && err.message.includes("actions")
  );
});

test("E4 validateProjectionKeys rejects extra keys", () => {
  const extra = { ...createValidProjections(), extra: {} };
  assert.throws(
    () => validateProjectionKeys(extra),
    (err) => err.code === "EXTRA_PROJECTION" && err.message.includes("extra")
  );
});

test("E5 validateProjectionKeys rejects undefined values", () => {
  const withUndefined = { ...createValidProjections() };
  withUndefined.actions = undefined;
  assert.throws(
    () => validateProjectionKeys(withUndefined),
    (err) => err.code === "UNDEFINED_PROJECTION" && err.message.includes("actions")
  );
});

// --- Group F: Descriptor computation ---

test("F1 computeProjectionDescriptors computes for valid projections", async () => {
  const projections = createValidProjections();
  const descriptors = await computeProjectionDescriptors(projections);

  assert.deepEqual(Object.keys(descriptors).sort(), WORLD_PROJECTION_KEYS.slice().sort());
  for (const key of WORLD_PROJECTION_KEYS) {
    assert.equal(typeof descriptors[key].checksum, "string");
    assert.equal(descriptors[key].checksum.length, 64);
    assert(Number.isInteger(descriptors[key].byteLength));
    assert(descriptors[key].byteLength >= 0);
  }
});

test("F2 computeProjectionDescriptors rejects invalid projections", async () => {
  const invalid = { ...createValidProjections() };
  invalid.actions = undefined;
  await assert.rejects(
    () => computeProjectionDescriptors(invalid),
    (err) => err.code === "UNDEFINED_PROJECTION"
  );
});

test("F3 computeProjectionDescriptors produces deterministic checksums", async () => {
  const projections = createValidProjections();
  const desc1 = await computeProjectionDescriptors(projections);
  const desc2 = await computeProjectionDescriptors(projections);
  assert.deepEqual(desc1, desc2);
});

test("F4 computeProjectionDescriptors byteLength matches UTF‑8 bytes", async () => {
  const projections = { ...createValidProjections(), chat: { message: "hello" } };
  const descriptors = await computeProjectionDescriptors(projections);

  // Manually compute expected bytes
  const encoder = new TextEncoder();
  const canonical = JSON.stringify({ message: "hello" }); // keys already sorted
  const expectedBytes = encoder.encode(canonical);

  assert.equal(descriptors.chat.byteLength, expectedBytes.byteLength);
});

// --- Group G: Manifest validation ---

test("G1 validateManifest accepts valid manifest", () => {
  const manifest = createValidManifest();
  const validated = validateManifest(manifest);
  assert.deepEqual(validated, manifest);
});

test("G2 validateManifest rejects non‑object", () => {
  assert.throws(
    () => validateManifest(null),
    (err) => err.code === "INVALID_MANIFEST"
  );
  assert.throws(
    () => validateManifest("string"),
    (err) => err.code === "INVALID_MANIFEST"
  );
});

test("G3 validateManifest requires correct schema", () => {
  const invalid = createValidManifest({ schema: "wrong" });
  assert.throws(
    () => validateManifest(invalid),
    (err) => err.code === "INVALID_SCHEMA"
  );
});

test("G4 validateManifest requires non‑blank gameId", () => {
  assert.throws(
    () => validateManifest(createValidManifest({ gameId: "" })),
    (err) => err.code === "INVALID_GAME_ID"
  );
  assert.throws(
    () => validateManifest(createValidManifest({ gameId: "  " })),
    (err) => err.code === "INVALID_GAME_ID"
  );
});

test("G5 validateManifest requires non‑blank revision", () => {
  assert.throws(
    () => validateManifest(createValidManifest({ revision: "" })),
    (err) => err.code === "INVALID_REVISION"
  );
});

test("G6 validateManifest accepts null parentRevision", () => {
  assert.doesNotThrow(() => validateManifest(createValidManifest({ parentRevision: null })));
});

test("G7 validateManifest rejects invalid parentRevision", () => {
  assert.throws(
    () => validateManifest(createValidManifest({ parentRevision: "" })),
    (err) => err.code === "INVALID_PARENT_REVISION"
  );
});

test("G8 validateManifest requires ISO‑8601 committedAt", () => {
  assert.throws(
    () => validateManifest(createValidManifest({ committedAt: "not-a-date" })),
    (err) => err.code === "INVALID_COMMITTED_AT"
  );
  // Accepts with timezone offset
  assert.doesNotThrow(() => validateManifest(createValidManifest({ committedAt: "2026-01-01T12:00:00+02:00" })));
});

test("G9 validateManifest validates reason enum", () => {
  for (const reason of ["turn", "pregame", "rollback", "compat-write"]) {
    const rollbackOf = reason === "rollback" ? "some-rev" : null;
    assert.doesNotThrow(() => validateManifest(createValidManifest({ reason, rollbackOf })));
  }
  assert.throws(
    () => validateManifest(createValidManifest({ reason: "invalid" })),
    (err) => err.code === "INVALID_REASON"
  );
});

test("G10 validateManifest validates rollbackOf semantics", () => {
  // rollback reason requires non‑null rollbackOf
  assert.throws(
    () => validateManifest(createValidManifest({ reason: "rollback", rollbackOf: null })),
    (err) => err.code === "INVALID_ROLLBACK_OF"
  );

  // non‑rollback reason requires null rollbackOf
  assert.throws(
    () => validateManifest(createValidManifest({ reason: "turn", rollbackOf: "some-rev" })),
    (err) => err.code === "INVALID_ROLLBACK_OF"
  );

  // Valid rollback
  assert.doesNotThrow(() =>
    validateManifest(createValidManifest({ reason: "rollback", rollbackOf: "rev-123" }))
  );
});

test("G11 validateManifest validates projection descriptors structure", () => {
  // Missing descriptor
  const missing = createValidManifest();
  delete missing.projections.actions;
  assert.throws(
    () => validateManifest(missing),
    (err) => err.code === "MISSING_PROJECTION_DESCRIPTOR"
  );

  // Invalid checksum format
  const badChecksum = createValidManifest();
  badChecksum.projections.actions.checksum = "not-hex";
  assert.throws(
    () => validateManifest(badChecksum),
    (err) => err.code === "INVALID_CHECKSUM"
  );

  // Invalid byteLength
  const badLength = createValidManifest();
  badLength.projections.actions.byteLength = -1;
  assert.throws(
    () => validateManifest(badLength),
    (err) => err.code === "INVALID_BYTE_LENGTH"
  );

  // Extra descriptor
  const extra = createValidManifest();
  extra.projections.extra = { checksum: "a".repeat(64), byteLength: 0 };
  assert.throws(
    () => validateManifest(extra),
    (err) => err.code === "EXTRA_PROJECTION_DESCRIPTOR"
  );
});

test("G12 validateManifest rejects extra manifest and descriptor fields", () => {
  assert.throws(
    () => validateManifest({ ...createValidManifest(), extra: true }),
    error => error.code === "INVALID_MANIFEST_KEYS"
  );
  const extraDescriptor = createValidManifest();
  extraDescriptor.projections.actions.extra = true;
  assert.throws(
    () => validateManifest(extraDescriptor),
    error => error.code === "INVALID_DESCRIPTOR_KEYS"
  );
});

test("G13 validateManifest rejects impossible diagnostic timestamps", () => {
  assert.throws(
    () => validateManifest(createValidManifest({ committedAt: "2026-02-30T12:00:00Z" })),
    error => error.code === "INVALID_COMMITTED_AT"
  );
  assert.throws(
    () => validateManifest(createValidManifest({ committedAt: "2026-01-01T25:00:00Z" })),
    error => error.code === "INVALID_COMMITTED_AT"
  );
});

// --- Group H: Descriptor verification ---

test("H1 verifyProjectionDescriptors passes for matching descriptors", async () => {
  const projections = createValidProjections();
  const descriptors = await computeProjectionDescriptors(projections);
  await assert.doesNotReject(() => verifyProjectionDescriptors(projections, descriptors));
});

test("H2 verifyProjectionDescriptors rejects checksum mismatch", async () => {
  const projections = createValidProjections();
  const descriptors = await computeProjectionDescriptors(projections);

  // Tamper with checksum
  descriptors.actions.checksum = "f".repeat(64);

  await assert.rejects(
    () => verifyProjectionDescriptors(projections, descriptors),
    (err) => err.code === "CHECKSUM_MISMATCH" && err.message.includes("actions")
  );
});

test("H3 verifyProjectionDescriptors rejects byteLength mismatch", async () => {
  const projections = createValidProjections();
  const descriptors = await computeProjectionDescriptors(projections);

  // Tamper with byteLength
  descriptors.actions.byteLength = 9999;

  await assert.rejects(
    () => verifyProjectionDescriptors(projections, descriptors),
    (err) => err.code === "BYTE_LENGTH_MISMATCH" && err.message.includes("actions")
  );
});

// --- Group I: Bundle construction ---

test("I1 buildWorldBundle creates valid frozen bundle", async () => {
  const params = {
    gameId: "game-123",
    revision: "rev-abc",
    parentRevision: null,
    committedAt: "2026-01-01T12:00:00Z",
    reason: "turn",
    projections: createValidProjections(),
  };

  const bundle = await buildWorldBundle(params);

  assert.equal(bundle.manifest.schema, "open-historia-world-revision/1");
  assert.equal(bundle.manifest.gameId, "game-123");
  assert.equal(bundle.manifest.revision, "rev-abc");
  assert.equal(bundle.manifest.parentRevision, null);
  assert.equal(bundle.manifest.reason, "turn");
  assert.equal(bundle.manifest.rollbackOf, null);
  assert.deepEqual(Object.keys(bundle.manifest.projections).sort(), WORLD_PROJECTION_KEYS.slice().sort());

  // Verify frozen
  assert(Object.isFrozen(bundle));
  assert(Object.isFrozen(bundle.manifest));
  assert(Object.isFrozen(bundle.projections));

  // Verify descriptors match projections
  await verifyProjectionDescriptors(bundle.projections, bundle.manifest.projections);
});

test("I2 buildWorldBundle validates input parameters", async () => {
  const baseParams = {
    gameId: "game-123",
    revision: "rev-abc",
    parentRevision: null,
    committedAt: "2026-01-01T12:00:00Z",
    reason: "turn",
    projections: createValidProjections(),
  };

  // Blank gameId
  await assert.rejects(
    () => buildWorldBundle({ ...baseParams, gameId: "" }),
    (err) => err.code === "INVALID_GAME_ID"
  );

  // Blank revision
  await assert.rejects(
    () => buildWorldBundle({ ...baseParams, revision: "" }),
    (err) => err.code === "INVALID_REVISION"
  );

  // Invalid parentRevision
  await assert.rejects(
    () => buildWorldBundle({ ...baseParams, parentRevision: "" }),
    (err) => err.code === "INVALID_PARENT_REVISION"
  );

  // Invalid committedAt
  await assert.rejects(
    () => buildWorldBundle({ ...baseParams, committedAt: "not-a-date" }),
    (err) => err.code === "INVALID_COMMITTED_AT"
  );

  // Invalid reason
  await assert.rejects(
    () => buildWorldBundle({ ...baseParams, reason: "invalid" }),
    (err) => err.code === "INVALID_REASON"
  );

  // Invalid rollbackOf for non‑rollback
  await assert.rejects(
    () => buildWorldBundle({ ...baseParams, reason: "turn", rollbackOf: "some-rev" }),
    (err) => err.code === "INVALID_ROLLBACK_OF"
  );

  // Missing rollbackOf for rollback
  await assert.rejects(
    () => buildWorldBundle({ ...baseParams, reason: "rollback", rollbackOf: null }),
    (err) => err.code === "INVALID_ROLLBACK_OF"
  );
});

test("I3 buildWorldBundle rejects non-canonical whitespace in opaque IDs", async () => {
  const params = {
    gameId: "game-123",
    revision: "rev-abc",
    parentRevision: null,
    committedAt: "2026-01-01T12:00:00Z",
    reason: "turn",
    projections: createValidProjections(),
  };
  await assert.rejects(() => buildWorldBundle({ ...params, gameId: " game-123" }), error => error.code === "INVALID_GAME_ID");
  await assert.rejects(() => buildWorldBundle({ ...params, revision: "rev-abc " }), error => error.code === "INVALID_REVISION");
  await assert.rejects(() => buildWorldBundle({ ...params, parentRevision: " parent" }), error => error.code === "INVALID_PARENT_REVISION");
});

test("I4 buildWorldBundle handles rollback revision correctly", async () => {
  const bundle = await buildWorldBundle({
    gameId: "game-123",
    revision: "rollback-rev",
    parentRevision: "current-rev",
    committedAt: "2026-01-01T12:00:00Z",
    reason: "rollback",
    rollbackOf: "target-rev",
    projections: createValidProjections(),
  });

  assert.equal(bundle.manifest.reason, "rollback");
  assert.equal(bundle.manifest.rollbackOf, "target-rev");
  assert.equal(bundle.manifest.parentRevision, "current-rev");
});

// --- Group J: Compare‑and‑swap planning ---

test("J1 planWorldRevisionCommit returns conflict when currentRevision differs", async () => {
  const request = {
    gameId: "game-123",
    expectedRevision: "old-rev",
    reason: "turn",
    projections: createValidProjections(),
  };

  const result = await planWorldRevisionCommit({
    gameId: "game-123",
    expectedRevision: "old-rev",
    currentRevision: "new-rev", // Different!
    committedAt: "2026-01-01T12:00:00Z",
    request,
  });

  assert.equal(result.status, "conflict");
  assert.equal(result.currentRevision, "new-rev");
});

test("J2 planWorldRevisionCommit returns committed bundle when no conflict", async () => {
  const request = {
    gameId: "game-123",
    expectedRevision: "old-rev",
    reason: "turn",
    projections: createValidProjections(),
  };

  const result = await planWorldRevisionCommit({
    gameId: "game-123",
    expectedRevision: "old-rev",
    newRevision: "new-rev", // Different from old revision
    currentRevision: "old-rev", // Same as expected
    committedAt: "2026-01-01T12:00:00Z",
    request,
  });

  assert.equal(result.status, "committed");
  assert.equal(result.bundle.manifest.gameId, "game-123");
  assert.equal(result.bundle.manifest.revision, "new-rev"); // Uses newRevision parameter
  assert.equal(result.bundle.manifest.parentRevision, "old-rev"); // Parent is current revision
  assert.equal(result.bundle.manifest.reason, "turn");
  assert.deepEqual(Object.keys(result.bundle.projections), WORLD_PROJECTION_KEYS);
});

test("J3 planWorldRevisionCommit rejects gameId mismatch", async () => {
  const request = {
    gameId: "different-game",
    expectedRevision: "old-rev",
    reason: "turn",
    projections: createValidProjections(),
  };

  await assert.rejects(
    () => planWorldRevisionCommit({
      gameId: "game-123",
      expectedRevision: "old-rev",
      currentRevision: "old-rev",
      committedAt: "2026-01-01T12:00:00Z",
      request,
    }),
    (err) => err.code === "GAME_ID_MISMATCH"
  );
});

test("J4 planWorldRevisionCommit rejects revision collision with parent", async () => {
  const request = {
    gameId: "game-123",
    expectedRevision: "current-rev",
    reason: "turn",
    projections: createValidProjections(),
  };

  await assert.rejects(
    () => planWorldRevisionCommit({
      gameId: "game-123",
      expectedRevision: "current-rev",
      newRevision: "current-rev", // Same as current!
      currentRevision: "current-rev",
      committedAt: "2026-01-01T12:00:00Z",
      request,
    }),
    (err) => err.code === "REVISION_COLLISION"
  );
});

test("J5 planWorldRevisionCommit allows root revision (null parent)", async () => {
  const request = {
    gameId: "game-123",
    expectedRevision: null, // No existing revision
    reason: "pregame",
    projections: createValidProjections(),
  };

  const result = await planWorldRevisionCommit({
    gameId: "game-123",
    expectedRevision: null,
    newRevision: "first-rev",
    currentRevision: null, // Root has no parent
    committedAt: "2026-01-01T12:00:00Z",
    request,
  });

  assert.equal(result.status, "committed");
  assert.equal(result.bundle.manifest.parentRevision, null);
  assert.equal(result.bundle.manifest.revision, "first-rev");
});

test("J6 planWorldRevisionCommit returns conflict before candidate validation", async () => {
  const request = {
    gameId: "game-123",
    expectedRevision: "old-rev",
    reason: "turn",
    projections: { ...createValidProjections(), actions: undefined }, // Invalid!
  };

  // According to spec line 116: "If step 2 fails, no bytes become current"
  // This suggests conflict check happens first. But our implementation does
  // gameId check before conflict. Let's test actual behavior.
  const result = await planWorldRevisionCommit({
    gameId: "game-123",
    expectedRevision: "old-rev",
    newRevision: "new-rev",
    currentRevision: "different-rev", // Would be conflict
    committedAt: "2026-01-01T12:00:00Z",
    request,
  });

  // Should return conflict, not validation error
  assert.equal(result.status, "conflict");
  assert.equal(result.currentRevision, "different-rev");
});

test("J7 planWorldRevisionCommit rejects disagreement with request expected revision", async () => {
  const request = {
    gameId: "game-123",
    expectedRevision: "request-rev",
    reason: "turn",
    projections: createValidProjections(),
  };
  await assert.rejects(
    () => planWorldRevisionCommit({
      gameId: "game-123",
      expectedRevision: "argument-rev",
      newRevision: "next-rev",
      currentRevision: "argument-rev",
      committedAt: "2026-01-01T12:00:00Z",
      request,
    }),
    error => error.code === "EXPECTED_REVISION_MISMATCH"
  );
});

// --- Group K: Revision opacity ---

test("K1 revision strings are treated as opaque equality tokens", async () => {
  // Revision strings that look like dates/numbers should still work
  const dateLike = "2026-01-01T12:00:00Z";
  const newRevision = "opaque-next-revision";

  const request = {
    gameId: "game-123",
    expectedRevision: dateLike,
    reason: "turn",
    projections: createValidProjections(),
  };

  const result = await planWorldRevisionCommit({
    gameId: "game-123",
    expectedRevision: dateLike,
    newRevision,
    currentRevision: dateLike,
    committedAt: "2026-01-01T12:00:00Z",
    request,
  });

  assert.equal(result.status, "committed");
  assert.equal(result.bundle.manifest.revision, newRevision);
  assert.equal(result.bundle.manifest.parentRevision, dateLike);
});

// --- Group L: UTF‑8 byte length verification ---

test("L1 byteLength counts UTF‑8 bytes not JavaScript string length", async () => {
  const emoji = "🎉"; // 4 UTF‑8 bytes
  const projections = { ...createValidProjections(), chat: { message: emoji } };

  const descriptors = await computeProjectionDescriptors(projections);
  const expectedBytes = new TextEncoder().encode(JSON.stringify({ message: "🎉" }));

  assert.equal(descriptors.chat.byteLength, expectedBytes.byteLength);
  assert.notEqual(descriptors.chat.byteLength, emoji.length); // JS length is 2
});

test("L2 non‑ASCII characters affect byte length", async () => {
  const ascii = "hello"; // 5 bytes
  const nonAscii = "café🎉"; // "café" (4 bytes) + "🎉" (4 bytes) = 8 bytes

  const projAscii = { ...createValidProjections(), chat: { text: ascii } };
  const projNonAscii = { ...createValidProjections(), chat: { text: nonAscii } };

  const descAscii = await computeProjectionDescriptors(projAscii);
  const descNonAscii = await computeProjectionDescriptors(projNonAscii);

  // "café🎉" has more bytes than "hello" due to UTF-8 encoding
  assert(descNonAscii.chat.byteLength > descAscii.chat.byteLength);
});

// --- Group M: Deterministic canonicalization evidence ---

test("M1 object key order does not affect checksum", async () => {
  const obj1 = { z: 3, a: 1, m: 2 };
  const obj2 = { a: 1, m: 2, z: 3 };

  const { bytes: bytes1 } = await canonicalizeProjection(obj1);
  const { bytes: bytes2 } = await canonicalizeProjection(obj2);

  assert.deepEqual(bytes1, bytes2);

  const hash1 = await sha256Hex(bytes1);
  const hash2 = await sha256Hex(bytes2);
  assert.equal(hash1, hash2);
});

test("M2 known SHA‑256 test vectors", async () => {
  const simple = { name: "test", value: 42 };
  const { bytes: bytes1 } = await canonicalizeProjection(simple);
  const { bytes: bytes2 } = await canonicalizeProjection({ value: 42, name: "test" }); // Different order

  const hash1 = await sha256Hex(bytes1);
  const hash2 = await sha256Hex(bytes2);

  assert.equal(hash1, hash2); // Same hash regardless of key order
  assert.equal(hash1, "9a304be829134dbe6b6ccc54e7e78e6e0b477c48a75b8e3042389dbd61617569");
});

// --- Group N: Path‑aware error diagnostics ---

test("N1 validation errors include path information", async () => {
  // Invalid value deep in structure
  const projections = {
    ...createValidProjections(),
    world: {
      regions: {
        "region-1": {
          owner: "country-1",
          value: Infinity, // Invalid!
        },
      },
    },
  };

  await assert.rejects(
    () => buildWorldBundle({
      gameId: "game-123",
      revision: "rev-abc",
      parentRevision: null,
      committedAt: "2026-01-01T12:00:00Z",
      reason: "turn",
      projections,
    }),
    (err) => {
      assert(err instanceof WorldRevisionError);
      assert(err.code === "INVALID_JSON_VALUE");
      assert(err.message.includes("non-finite"));
      assert(err.path); // Should have some path
      return true;
    }
  );
});

test("N2 manifest validation errors include field paths", () => {
  const manifest = createValidManifest({ gameId: "" });
  assert.throws(
    () => validateManifest(manifest),
    (err) => err.code === "INVALID_GAME_ID" && err.path === "gameId"
  );
});

// --- Group O: Immutability and defensive copies ---

test("O1 bundle is frozen and projections are not mutated", async () => {
  const originalProjections = createValidProjections();
  const originalActions = originalProjections.actions;

  const bundle = await buildWorldBundle({
    gameId: "game-123",
    revision: "rev-abc",
    parentRevision: null,
    committedAt: "2026-01-01T12:00:00Z",
    reason: "turn",
    projections: originalProjections,
  });

  // Bundle is frozen
  assert(Object.isFrozen(bundle));
  assert(Object.isFrozen(bundle.manifest));
  assert(Object.isFrozen(bundle.projections));
  assert(Object.isFrozen(bundle.projections.actions));
  assert(Object.isFrozen(bundle.projections.actions.list));
  assert(Object.isFrozen(bundle.manifest.projections.actions));

  // Original projections are unchanged
  assert.strictEqual(originalProjections.actions, originalActions);
  assert.notStrictEqual(bundle.projections.actions, originalActions);

  // Cannot mutate through bundle
  assert.throws(() => { bundle.manifest.gameId = "changed"; });
  assert.throws(() => { bundle.projections.actions = {}; });
  assert.throws(() => { bundle.projections.actions.list.push("changed"); });

  originalProjections.actions.list.push("outside mutation");
  assert.deepEqual(bundle.projections.actions.list, []);
  await verifyProjectionDescriptors(bundle.projections, bundle.manifest.projections);
});

test("O2 canonicalization does not mutate input", async () => {
  const input = { a: 1, b: 2 };
  const original = { ...input };

  await canonicalizeProjection(input);
  assert.deepEqual(input, original);
});
