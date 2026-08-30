// Minimal test for world revision filesystem
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Simple test to verify basic functionality
test("filesystem adapter basic test", async (t) => {
  const TEST_DIR = path.join(__dirname, "test-temp");
  
  // Clean up
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
  
  // Set test environment
  process.env.OH_DATA_DIR = TEST_DIR;
  
  // Dynamic import to avoid top-level issues
  const { readGameStateBundle, commitWorldRevision } = await import("./worldRevisionFilesystem.js");
  
  // Test creating a game
  const gameId = "test-game";
  const projections = {
    actions: { list: [] },
    chat: { messages: [] },
    events: { timeline: [] },
    game: { turn: 1, date: "1914-01-01" },
    world: { regions: {}, polities: {} },
    colors: { palette: {} },
  };

  const result = await commitWorldRevision({
    gameId,
    expectedRevision: null,
    reason: "pregame",
    projections,
  });
  
  assert.equal(result.status, "committed");
  assert.equal(result.bundle.manifest.gameId, gameId);
  
  // Clean up
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
  
  delete process.env.OH_DATA_DIR;
});