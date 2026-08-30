import { createHash } from 'crypto';
import { ScenarioV2Validator } from './validator.js';
import type { ScenarioBundle } from './schemas.js';

export class ScenarioV2Builder {
  private validator = new ScenarioV2Validator();

  build(bundle: any): BuildResult {
    // Validate the bundle
    const validation = this.validator.validateBundle(bundle);
    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors,
        inputChecksum: null
      };
    }

    // Calculate canonical input checksum
    const inputChecksum = this.calculateCanonicalChecksum(bundle);

    return {
      success: true,
      bundle: bundle as ScenarioBundle,
      inputChecksum,
      errors: []
    };
  }

  verifyDeterministicBuild(bundle: any): DeterministicBuildVerification {
    const checksums: string[] = [];

    for (let i = 0; i < 3; i++) {
      const result = this.build(bundle);
      if (!result.success) {
        return {
          deterministic: false,
          checksums: [],
          error: `Build ${i + 1} failed: ${result.errors[0]?.message || 'Unknown error'}`,
          mismatchIndex: i
        };
      }
      checksums.push(result.inputChecksum!);
    }

    // Verify all checksums are equal
    const firstChecksum = checksums[0];
    const allEqual = checksums.every(cs => cs === firstChecksum);

    if (!allEqual) {
      return {
        deterministic: false,
        checksums,
        error: 'Checksums do not match across three builds',
        mismatchIndex: 1
      };
    }

    return {
      deterministic: true,
      checksums,
      error: null,
      mismatchIndex: null
    };
  }

  private calculateCanonicalChecksum(bundle: any): string {
    // Simple canonicalization: sort object keys
    const canonicalData = {
      manifest: this.canonicalize(bundle.manifest),
      scenario: this.canonicalize(bundle.scenario),
      sources: this.canonicalize(bundle.sources),
      builderVersion: '1.0.0'
    };

    const canonicalJson = JSON.stringify(canonicalData, this.canonicalReplacer);
    const hash = createHash('sha256');
    hash.update(canonicalJson);
    return `sha256:${hash.digest('hex')}`;
  }

  private canonicalize(data: any): any {
    return JSON.parse(JSON.stringify(data, this.canonicalReplacer));
  }

  private canonicalReplacer(_key: string, value: any): any {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Sort object keys for deterministic output
      return Object.keys(value).sort().reduce((acc: any, k) => {
        acc[k] = value[k];
        return acc;
      }, {});
    }
    return value;
  }
}

export interface BuildResult {
  success: boolean;
  bundle?: ScenarioBundle;
  inputChecksum: string | null;
  errors: ValidationError[];
}

export interface ValidationError {
  code: string;
  path: string;
  message: string;
  refs?: string[];
}

export interface DeterministicBuildVerification {
  deterministic: boolean;
  checksums: string[];
  error: string | null;
  mismatchIndex: number | null;
}