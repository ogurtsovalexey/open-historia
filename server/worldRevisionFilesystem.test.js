// Unit tests for the world revision filesystem adapter
// Run with: node --test server/worldRevisionFilesystem.test.js

import assert from "node:assert/strict";
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  readGameStateBundle,
  commitWorldRevision,
  listGameRevisions,
  pruneOldRevisions,
  recoverCurrentRevision,
  WorldRevisionError,
  WORLD_PROJECTION_KEYS,
} from "./worldRevisionFilesystem.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test directory
const TEST_DATA_DIR = path.join(__dirname, "test-data-revisions");
const TEST_GAME_ID = "test-game-atomic";

// Helper to create valid projections
function createValidProjections() {
  return {
    actions: { list: [] },
    chat: { messages: [] },
    events: { timeline: [] },
    game: { turn: 1, date: "1914-01-01" },
    world: { regions: {}, polities: {} },
    colors: { palette: {} },
  };
}

// Clean up test directory
function cleanupTestDirectory() {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

describe("World Revision Filesystem Adapter", () => {
  before(() => {
    cleanupTestDirectory();
    // Override DATA_DIR for tests
    process.env.OH_DATA_DIR = TEST_DATA_DIR;
  });

  after(() => {
    cleanupTestDirectory();
    delete process.env.OH_DATA_DIR;
  });

  beforeEach(() => {
    cleanupTestDirectory();
  });

  afterEach(() => {
    cleanupTestDirectory();
  });

  describe("readGameStateBundle", () => {
    test("returns legacy baseline for manifest-less game", async () => {
      // Create legacy game structure
      const gameDir = path.join(TEST_DATA_DIR, "games", TEST_GAME_ID, "storage");
      fs.mkdirSync(gameDir, { recursive: true });
      
      // Write legacy projection files
      const projections = createValidProjections();
      for (const [key, value] of Object.entries(projections)) {
        fs.writeFileSync(
          path.join(gameDir, `${key}.json`),
          JSON.stringify(value),
          "utf-8"
        );
      }
      
      const result = await readGameStateBundle(TEST_GAME_ID);
      
      assert.equal(result.manifest.schema, "open-historia-world-revision/1");
      assert.equal(result.manifest.gameId, TEST_GAME_ID);
      assert(result.manifest.revision.startsWith("legacy-"));
      assert.equal(result.manifest.parentRevision, null);
      assert.equal(result.manifest.reason, "compat-write");
      
      // Projections should match
      assert.deepEqual(Object.keys(result.projections).sort(), WORLD_PROJECTION_KEYS.slice().sort());
    });

    test("throws for non-existent game", async () => {
      await assert.rejects(
        () => readGameStateBundle("non-existent-game"),
        (error) => error.code === "NO_CURRENT_REVISION"
      );
    });
  });

  describe("commitWorldRevision", () => {
    test("commits first revision for new game", async () => {
      const projections = createValidProjections();
      
      const result = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: null,
        reason: "pregame",
        projections,
      });
      
      assert.equal(result.status, "committed");
      assert.equal(result.bundle.manifest.gameId, TEST_GAME_ID);
      assert.equal(result.bundle.manifest.parentRevision, null);
      assert.equal(result.bundle.manifest.reason, "pregame");
      
      // Verify files were created
      const revision = result.bundle.manifest.revision;
      const revisionDir = path.join(TEST_DATA_DIR, "games", TEST_GAME_ID, "revisions", revision);
      assert(fs.existsSync(revisionDir));
      assert(fs.existsSync(path.join(revisionDir, "manifest.json")));
      
      for (const key of WORLD_PROJECTION_KEYS) {
        assert(fs.existsSync(path.join(revisionDir, `${key}.json`)));
      }
      
      // Verify current pointer
      const pointerPath = path.join(TEST_DATA_DIR, "games", TEST_GAME_ID, "current-revision.json");
      assert(fs.existsSync(pointerPath));
      const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf-8"));
      assert.equal(pointer.revision, revision);
    });

    test("returns conflict when expectedRevision mismatches", async () => {
      // Create first revision
      const projections = createValidProjections();
      const result1 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: null,
        reason: "pregame",
        projections,
      });
      
      assert.equal(result1.status, "committed");
      const firstRevision = result1.bundle.manifest.revision;
      
      // Try to commit with wrong expectedRevision
      const result2 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: "wrong-revision",
        reason: "turn",
        projections,
      });
      
      assert.equal(result2.status, "conflict");
      assert.equal(result2.currentRevision, firstRevision);
    });

    test("commits chain of revisions", async () => {
      const baseProjections = createValidProjections();
      
      // First revision
      const result1 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: null,
        reason: "pregame",
        projections: baseProjections,
      });
      assert.equal(result1.status, "committed");
      const rev1 = result1.bundle.manifest.revision;
      
      // Second revision with modified projections
      const modifiedProjections = {
        ...baseProjections,
        game: { ...baseProjections.game, turn: 2 },
      };
      
      const result2 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: rev1,
        reason: "turn",
        projections: modifiedProjections,
      });
      assert.equal(result2.status, "committed");
      const rev2 = result2.bundle.manifest.revision;
      
      assert.equal(result2.bundle.manifest.parentRevision, rev1);
      
      // Verify we can read both revisions
      const bundle1 = await readGameStateBundle(TEST_GAME_ID);
      assert.equal(bundle1.manifest.revision, rev2);
      
      // Third revision for rollback
      const result3 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: rev2,
        reason: "rollback",
        rollbackOf: rev1,
        projections: baseProjections,
      });
      assert.equal(result3.status, "committed");
      assert.equal(result3.bundle.manifest.rollbackOf, rev1);
    });

    test("handles concurrent commits with conflict", async () => {
      const projections = createValidProjections();
      
      // Initial commit
      const result1 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: null,
        reason: "pregame",
        projections,
      });
      assert.equal(result1.status, "committed");
      const currentRevision = result1.bundle.manifest.revision;
      
      // Simulate concurrent commits by both using the same expectedRevision
      const commitPromises = [];
      for (let i = 0; i < 3; i++) {
        const modifiedProjections = {
          ...projections,
          game: { ...projections.game, turn: i + 2 },
        };
        
        commitPromises.push(
          commitWorldRevision({
            gameId: TEST_GAME_ID,
            expectedRevision: currentRevision,
            reason: "turn",
            projections: modifiedProjections,
          })
        );
      }
      
      const results = await Promise.all(commitPromises);
      
      // Exactly one should succeed, others should conflict
      const succeeded = results.filter(r => r.status === "committed");
      const conflicted = results.filter(r => r.status === "conflict");
      
      assert.equal(succeeded.length, 1);
      assert.equal(conflicted.length, 2);
      
      // All conflicts should report the same (now updated) current revision
      const winningRevision = succeeded[0].bundle.manifest.revision;
      for (const conflict of conflicted) {
        assert.equal(conflict.currentRevision, winningRevision);
      }
    });

    test("atomicity: incomplete staged revision doesn't become current", async () => {
      // This test simulates a crash during staging
      // We'll manually create a partial staged revision and verify it's not readable
      
      const projections = createValidProjections();
      
      // Create a staged but incomplete revision
      const fakeRevision = "test-partial-rev";
      const revisionDir = path.join(TEST_DATA_DIR, "games", TEST_GAME_ID, "revisions", `${fakeRevision}.tmp`);
      fs.mkdirSync(revisionDir, { recursive: true });
      
      // Write only manifest, missing projections
      const manifest = {
        schema: "open-historia-world-revision/1",
        gameId: TEST_GAME_ID,
        revision: fakeRevision,
        parentRevision: null,
        committedAt: new Date().toISOString(),
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
      };
      
      fs.writeFileSync(
        path.join(revisionDir, "manifest.json"),
        JSON.stringify(manifest),
        "utf-8"
      );
      
      // Set as current (simulating partial update)
      const pointerPath = path.join(TEST_DATA_DIR, "games", TEST_GAME_ID, "current-revision.json");
      fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
      fs.writeFileSync(pointerPath, JSON.stringify({ revision: fakeRevision }), "utf-8");
      
      // Should not be readable as valid bundle
      await assert.rejects(
        () => readGameStateBundle(TEST_GAME_ID),
        (error) => error instanceof WorldRevisionError
      );
    });
  });

  describe("listGameRevisions", () => {
    test("returns empty array for game with no revisions", async () => {
      const revisions = await listGameRevisions(TEST_GAME_ID);
      assert.deepEqual(revisions, []);
    });

    test("returns revisions in chronological order", async () => {
      // Create multiple revisions
      const projections = createValidProjections();
      const revisions = [];
      
      for (let i = 0; i < 3; i++) {
        const result = await commitWorldRevision({
          gameId: TEST_GAME_ID,
          expectedRevision: i === 0 ? null : revisions[i - 1],
          reason: i === 0 ? "pregame" : "turn",
          projections: {
            ...projections,
            game: { ...projections.game, turn: i + 1 },
          },
        });
        assert.equal(result.status, "committed");
        revisions.push(result.bundle.manifest.revision);
      }
      
      const listed = await listGameRevisions(TEST_GAME_ID);
      assert.equal(listed.length, 3);
      
      // Should be newest first
      assert.equal(listed[0].revision, revisions[2]);
      assert.equal(listed[1].revision, revisions[1]);
      assert.equal(listed[2].revision, revisions[0]);
    });

    test("ignores temporary directories and invalid manifests", async () => {
      // Create valid revision
      const projections = createValidProjections();
      const result = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: null,
        reason: "pregame",
        projections,
      });
      const validRevision = result.bundle.manifest.revision;
      
      // Create temp directory
      const storePath = path.join(TEST_DATA_DIR, "games", TEST_GAME_ID, "revisions");
      fs.mkdirSync(path.join(storePath, "temp-rev.tmp"), { recursive: true });
      
      // Create directory with invalid manifest
      const invalidDir = path.join(storePath, "invalid-rev");
      fs.mkdirSync(invalidDir, { recursive: true });
      fs.writeFileSync(
        path.join(invalidDir, "manifest.json"),
        '{"invalid": "manifest"}',
        "utf-8"
      );
      
      const listed = await listGameRevisions(TEST_GAME_ID);
      assert.equal(listed.length, 1);
      assert.equal(listed[0].revision, validRevision);
    });
  });

  describe("pruneOldRevisions", () => {
    test("does nothing when revision count <= keepCount", async () => {
      // Create 5 revisions
      const projections = createValidProjections();
      for (let i = 0; i < 5; i++) {
        const result = await commitWorldRevision({
          gameId: TEST_GAME_ID,
          expectedRevision: i === 0 ? null : (await readGameStateBundle(TEST_GAME_ID)).manifest.revision,
          reason: i === 0 ? "pregame" : "turn",
          projections: {
            ...projections,
            game: { ...projections.game, turn: i + 1 },
          },
        });
        assert.equal(result.status, "committed");
      }
      
      const initialList = await listGameRevisions(TEST_GAME_ID);
      assert.equal(initialList.length, 5);
      
      const pruned = await pruneOldRevisions(TEST_GAME_ID, 10); // keep more than we have
      assert.equal(pruned, 0);
      
      const finalList = await listGameRevisions(TEST_GAME_ID);
      assert.equal(finalList.length, 5);
    });

    test("prunes old revisions while protecting current and parent", async () => {
      // Create 15 revisions
      const projections = createValidProjections();
      let currentRevision = null;
      
      for (let i = 0; i < 15; i++) {
        const result = await commitWorldRevision({
          gameId: TEST_GAME_ID,
          expectedRevision: currentRevision,
          reason: i === 0 ? "pregame" : "turn",
          projections: {
            ...projections,
            game: { ...projections.game, turn: i + 1 },
          },
        });
        assert.equal(result.status, "committed");
        currentRevision = result.bundle.manifest.revision;
      }
      
      const initialList = await listGameRevisions(TEST_GAME_ID);
      assert.equal(initialList.length, 15);
      
      // Prune to keep 12
      const pruned = await pruneOldRevisions(TEST_GAME_ID, 12);
      assert(pruned > 0);
      
      const finalList = await listGameRevisions(TEST_GAME_ID);
      
      // Should have at least 12 revisions (current + up to 11 older)
      assert(finalList.length >= 12);
      assert(finalList.length <= 12 + 2); // Allow some extra for protection
      
      // Verify current revision still exists
      const currentPointer = JSON.parse(
        fs.readFileSync(
          path.join(TEST_DATA_DIR, "games", TEST_GAME_ID, "current-revision.json"),
          "utf-8"
        )
      );
      const currentRevExists = finalList.some(r => r.revision === currentPointer.revision);
      assert(currentRevExists, "Current revision should be protected");
    });

    test("protects rollback targets", async () => {
      // Create revisions including rollback
      const projections = createValidProjections();
      
      // Revision 1
      const result1 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: null,
        reason: "pregame",
        projections,
      });
      const rev1 = result1.bundle.manifest.revision;
      
      // Revision 2
      const result2 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: rev1,
        reason: "turn",
        projections: { ...projections, game: { ...projections.game, turn: 2 } },
      });
      const rev2 = result2.bundle.manifest.revision;
      
      // Revision 3 (rollback to rev1)
      const result3 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: rev2,
        reason: "rollback",
        rollbackOf: rev1,
        projections,
      });
      
      // Now rev1 is a rollback target and should be protected
      const pruned = await pruneOldRevisions(TEST_GAME_ID, 1); // Try to keep only 1
      
      // Should not prune rev1 because it's a rollback target
      const remaining = await listGameRevisions(TEST_GAME_ID);
      const remainingRevisions = remaining.map(r => r.revision);
      
      assert(remainingRevisions.includes(rev1), "Rollback target should be protected");
    });
  });

  describe("recoverCurrentRevision", () => {
    test("recovers from missing current revision", async () => {
      // Create a valid revision
      const projections = createValidProjections();
      const result = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: null,
        reason: "pregame",
        projections,
      });
      const validRevision = result.bundle.manifest.revision;
      
      // Delete current pointer
      const pointerPath = path.join(TEST_DATA_DIR, "games", TEST_GAME_ID, "current-revision.json");
      fs.unlinkSync(pointerPath);
      
      const recovery = await recoverCurrentRevision(TEST_GAME_ID);
      assert(recovery.recovered);
      assert.equal(recovery.revision, validRevision);
      
      // Pointer should be restored
      const restoredPointer = JSON.parse(fs.readFileSync(pointerPath, "utf-8"));
      assert.equal(restoredPointer.revision, validRevision);
    });

    test("recovers from corrupt current revision", async () => {
      // Create two revisions
      const projections = createValidProjections();
      
      // Revision 1
      const result1 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: null,
        reason: "pregame",
        projections,
      });
      const rev1 = result1.bundle.manifest.revision;
      
      // Revision 2
      const result2 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: rev1,
        reason: "turn",
        projections: { ...projections, game: { ...projections.game, turn: 2 } },
      });
      const rev2 = result2.bundle.manifest.revision;
      
      // Corrupt rev2 by deleting a projection file
      const projectionPath = path.join(
        TEST_DATA_DIR,
        "games",
        TEST_GAME_ID,
        "revisions",
        rev2,
        "actions.json"
      );
      fs.unlinkSync(projectionPath);
      
      const recovery = await recoverCurrentRevision(TEST_GAME_ID);
      assert(recovery.recovered);
      assert.equal(recovery.revision, rev1); // Should fall back to parent
    });

    test("recovers to latest valid revision when parent missing", async () => {
      // Create three revisions
      const projections = createValidProjections();
      let currentRevision = null;
      const revisions = [];
      
      for (let i = 0; i < 3; i++) {
        const result = await commitWorldRevision({
          gameId: TEST_GAME_ID,
          expectedRevision: currentRevision,
          reason: i === 0 ? "pregame" : "turn",
          projections: { ...projections, game: { ...projections.game, turn: i + 1 } },
        });
        currentRevision = result.bundle.manifest.revision;
        revisions.push(currentRevision);
      }
      
      // Corrupt the latest two revisions
      for (let i = 1; i < 3; i++) {
        const rev = revisions[i];
        const manifestPath = path.join(
          TEST_DATA_DIR,
          "games",
          TEST_GAME_ID,
          "revisions",
          rev,
          "manifest.json"
        );
        fs.writeFileSync(manifestPath, '{"corrupt": true}', "utf-8");
      }
      
      const recovery = await recoverCurrentRevision(TEST_GAME_ID);
      assert(recovery.recovered);
      assert.equal(recovery.revision, revisions[0]); // Should recover to first valid revision
    });

    test("clears pointer when no valid revisions found", async () => {
      // Create and then completely corrupt a revision
      const projections = createValidProjections();
      const result = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: null,
        reason: "pregame",
        projections,
      });
      const revision = result.bundle.manifest.revision;
      
      // Delete the entire revision directory
      const revisionDir = path.join(TEST_DATA_DIR, "games", TEST_GAME_ID, "revisions", revision);
      fs.rmSync(revisionDir, { recursive: true, force: true });
      
      const recovery = await recoverCurrentRevision(TEST_GAME_ID);
      assert(recovery.recovered);
      assert.equal(recovery.revision, null);
      
      // Pointer should be cleared
      const pointerPath = path.join(TEST_DATA_DIR, "games", TEST_GAME_ID, "current-revision.json");
      const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf-8"));
      assert.equal(pointer.revision, null);
    });
  });

  describe("atomic contract compliance", () => {
    test("read while commit in progress returns old revision", async () => {
      // This test simulates reading during a staged but uncommitted revision
      const projections = createValidProjections();
      
      // Initial revision
      const result1 = await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: null,
        reason: "pregame",
        projections,
      });
      const rev1 = result1.bundle.manifest.revision;
      
      // Start a second commit but manually intervene
      const modifiedProjections = {
        ...projections,
        game: { ...projections.game, turn: 2 },
      };
      
      // We'll simulate a commit that has staged files but hasn't updated pointer yet
      const tempRevision = "test-staged-rev";
      const tempRevisionDir = path.join(TEST_DATA_DIR, "games", TEST_GAME_ID, "revisions", `${tempRevision}.tmp`);
      fs.mkdirSync(tempRevisionDir, { recursive: true });
      
      // Write staged files
      const stagedManifest = {
        schema: "open-historia-world-revision/1",
        gameId: TEST_GAME_ID,
        revision: tempRevision,
        parentRevision: rev1,
        committedAt: new Date().toISOString(),
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
      };
      
      fs.writeFileSync(
        path.join(tempRevisionDir, "manifest.json"),
        JSON.stringify(stagedManifest),
        "utf-8"
      );
      
      // Reader should still see old revision
      const readResult = await readGameStateBundle(TEST_GAME_ID);
      assert.equal(readResult.manifest.revision, rev1);
      
      // Clean up temp directory
      fs.rmSync(tempRevisionDir, { recursive: true, force: true });
    });

    test("corrupt staged projection prevents publication", async () => {
      const projections = createValidProjections();
      
      // Initial revision
      await commitWorldRevision({
        gameId: TEST_GAME_ID,
        expectedRevision: null,
        reason: "pregame",
        projections,
      });
      
      // Try to commit with invalid projections (undefined value)
      const invalidProjections = {
        ...projections,
        actions: undefined, // Invalid!
      };
      
      // Get current revision first
      const currentBundle = await readGameStateBundle(TEST_GAME_ID);
      
      await assert.rejects(
        () => commitWorldRevision({
          gameId: TEST_GAME_ID,
          expectedRevision: currentBundle.manifest.revision,
          reason: "turn",
          projections: invalidProjections,
        }),
        (error) => error instanceof WorldRevisionError && error.code === "UNDEFINED_PROJECTION"
      );
      
      // Original revision should still be readable
      const current = await readGameStateBundle(TEST_GAME_ID);
      assert.deepEqual(current.projections.actions, projections.actions);
    });
  });
});