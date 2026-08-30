import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from './helpers.js';

/**
 * Tripwire: no nondeterminism may enter the engine sources. The wall clock is
 * allowed only in persist.ts (manifest committedAt) and cli.ts; randomness is
 * allowed nowhere. If a legitimate need appears, it must go through a seeded
 * RNG module reviewed against docs/canon/03-simulation-core.md first.
 */
const ALLOWED_WALL_CLOCK = new Set(['persist.ts', 'cli.ts']);
const FORBIDDEN = [/Math\.random/, /Date\.now/, /new Date\(/, /crypto\.randomBytes/, /randomUUID/];

describe('determinism guard', () => {
  const srcDir = join(PACKAGE_ROOT, 'src');
  for (const file of readdirSync(srcDir).filter((name) => name.endsWith('.ts')).sort()) {
    it(`${file} contains no nondeterministic calls`, () => {
      const text = readFileSync(join(srcDir, file), 'utf8');
      for (const pattern of FORBIDDEN) {
        if (pattern.source.includes('Date') && ALLOWED_WALL_CLOCK.has(file)) continue;
        assert.ok(!pattern.test(text), `${file} matches forbidden pattern ${pattern}`);
      }
    });
  }
});
