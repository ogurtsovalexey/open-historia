import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScenarioV2Builder, calculateInputChecksum, canonicalStringify } from '../src/builder.js';
import { makeBundle } from './fixtures.js';

describe('ScenarioV2Builder — determinism and checksums', () => {
  const builder = new ScenarioV2Builder();

  it('computes an identical canonical checksum across three builds', () => {
    const bundle = makeBundle();
    const checksums = [
      builder.build(bundle),
      builder.build(bundle),
      builder.build(bundle),
    ].map((r) => r.inputChecksum);

    assert(checksums.every((c): c is string => typeof c === 'string'));
    assert.strictEqual(checksums[0], checksums[1]);
    assert.strictEqual(checksums[1], checksums[2]);
    assert(checksums[0].startsWith('sha256:'));
  });

  it('canonicalizes object key order away', () => {
    const a = { z: 1, a: { y: 2, b: 3 } };
    const b = { a: { b: 3, y: 2 }, z: 1 };
    assert.strictEqual(canonicalStringify(a), canonicalStringify(b));
  });

  it('produces a different checksum when input changes', () => {
    const before = calculateInputChecksum(parse(builder, makeBundle()));
    const changed = makeBundle({ scenario: { meta: { title: 'Changed title' } } });
    const after = calculateInputChecksum(parse(builder, changed));
    assert.notStrictEqual(before, after);
  });

  it('builds the same checksum with network and LLM credentials unavailable', () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    // Network is unavailable: any fetch attempt must throw, proving the build
    // path performs no I/O. Restored in `finally` so no global state leaks.
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new Error('network unavailable during offline build');
    }) as unknown as typeof fetch;

    try {
      const bundle = makeBundle();
      const first = builder.build(bundle).inputChecksum;
      const second = builder.build(bundle).inputChecksum;
      assert.strictEqual(first, second);
      assert.strictEqual(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('exposes deterministic projections', () => {
    const bundle = parse(builder, makeBundle());
    const projections = builder.projections(bundle);
    assert.strictEqual(projections.scenarioId, 'scenario:world-1916');
    assert.strictEqual(projections.startDate, '1916-01-01');
    assert.strictEqual(projections.polities.length, 2);
  });

  it('rejects a required asset absent from the local package/store', () => {
    const bytes = 'fixture-regions';
    const contentAddress = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const bundle = makeBundle({
      manifest: {
        assets: [{
          id: 'asset:world-1916:regions',
          kind: 'regions',
          path: 'assets/regions.json',
          contentAddress,
          mediaType: 'application/json',
          required: true,
        }],
      },
    });
    const result = builder.build(bundle);
    assert.strictEqual(result.success, false);
    assert(result.errors.some((error) => error.code === 'build.missing-local-asset'));
  });

  it('verifies required asset bytes before producing a checksum', () => {
    const bytes = 'fixture-regions';
    const contentAddress = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const bundle = makeBundle({
      manifest: {
        assets: [{
          id: 'asset:world-1916:regions',
          kind: 'regions',
          contentAddress,
          mediaType: 'application/json',
          required: true,
        }],
      },
    });

    const mismatch = builder.build(bundle, { assets: { 'asset:world-1916:regions': 'wrong' } });
    assert(mismatch.errors.some((error) => error.code === 'build.asset-checksum-mismatch'));
    const valid = builder.build(bundle, { assets: { 'asset:world-1916:regions': bytes } });
    assert.strictEqual(valid.success, true, JSON.stringify(valid.errors));
  });

  it('normalizes set-like arrays before checksumming', () => {
    const first = makeBundle({
      scenario: { regions: [
        { id: 'region:gadm-4-1:RUS.33_1', dataset: 'gadm', datasetVersion: '4.1', nativeId: 'RUS.33_1' },
        { id: 'region:gadm-4-1:DEU.1_1', dataset: 'gadm', datasetVersion: '4.1', nativeId: 'DEU.1_1' },
      ] },
    });
    const second = makeBundle({
      scenario: { regions: [
        { id: 'region:gadm-4-1:DEU.1_1', dataset: 'gadm', datasetVersion: '4.1', nativeId: 'DEU.1_1' },
        { id: 'region:gadm-4-1:RUS.33_1', dataset: 'gadm', datasetVersion: '4.1', nativeId: 'RUS.33_1' },
      ] },
    });
    const firstResult = builder.build(first);
    const secondResult = builder.build(second);
    assert.strictEqual(firstResult.success, true, JSON.stringify(firstResult.errors));
    assert.strictEqual(secondResult.success, true, JSON.stringify(secondResult.errors));
    assert.strictEqual(firstResult.inputChecksum, secondResult.inputChecksum);
  });

  it('loads manifest-driven JSON and assets offline from a package directory', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'open-historia-v2-build-'));
    const bytes = 'fixture-regions';
    const contentAddress = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const bundle = makeBundle({ manifest: { assets: [{
      id: 'asset:world-1916:regions', kind: 'regions', path: 'assets/regions.bin',
      contentAddress, mediaType: 'application/octet-stream', required: true,
    }] } }) as { manifest: unknown; scenario: unknown; sources: unknown };
    try {
      mkdirSync(path.join(tempRoot, 'assets'));
      writeFileSync(path.join(tempRoot, 'manifest.json'), JSON.stringify(bundle.manifest));
      writeFileSync(path.join(tempRoot, 'scenario.json'), JSON.stringify(bundle.scenario));
      writeFileSync(path.join(tempRoot, 'sources.json'), JSON.stringify(bundle.sources));
      writeFileSync(path.join(tempRoot, 'assets', 'regions.bin'), bytes);

      const result = builder.buildFromDirectory(tempRoot);
      assert.strictEqual(result.success, true, JSON.stringify(result.errors));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects a package asset symlink that escapes the package root', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'open-historia-v2-escape-'));
    const packageRoot = path.join(tempRoot, 'package');
    const outside = path.join(tempRoot, 'outside.bin');
    const bytes = 'outside';
    const contentAddress = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const bundle = makeBundle({ manifest: { assets: [{
      id: 'asset:world-1916:regions', kind: 'regions', path: 'assets/regions.bin',
      contentAddress, mediaType: 'application/octet-stream', required: true,
    }] } }) as { manifest: unknown; scenario: unknown; sources: unknown };
    try {
      mkdirSync(path.join(packageRoot, 'assets'), { recursive: true });
      writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify(bundle.manifest));
      writeFileSync(path.join(packageRoot, 'scenario.json'), JSON.stringify(bundle.scenario));
      writeFileSync(path.join(packageRoot, 'sources.json'), JSON.stringify(bundle.sources));
      writeFileSync(outside, bytes);
      symlinkSync(outside, path.join(packageRoot, 'assets', 'regions.bin'));

      const result = builder.buildFromDirectory(packageRoot);
      assert(result.errors.some((error) => error.code === 'build.path-escape'));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

function parse(builder: ScenarioV2Builder, input: unknown) {
  const result = builder.build(input);
  assert.strictEqual(result.success, true, JSON.stringify(result.errors));
  return result.bundle!;
}
