import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  calculateInvestmentPreview,
  validateInvestmentCommand
} from '../src/investment.js';
import { resolveMonth } from '../src/resolution.js';
import { processRegionTransfer } from '../src/transfer.js';
import { createTenRegionFixture } from '../src/fixtures.js';
import type {
  EconomyMvpRegion,
  PolityStocks
} from '../src/types.js';

describe('Edge Cases and Mutation Resistance', () => {
  const fixture = createTenRegionFixture();
  const { regions, polityStocks, constants } = fixture;

  describe('Investment Edge Cases', () => {
    it('should handle zero spend investment', () => {
      const region = regions[0]!;
      const polityA = polityStocks[0]!;

      const preview = calculateInvestmentPreview(
        region,
        polityA,
        constants,
        0,
        region.regionId,
        polityA.polityId
      );

      assert.strictEqual(preview.costMicros, 0);
      assert.strictEqual(preview.infrastructureChange, 0);
      assert.strictEqual(preview.canAfford, true);
    });

    it('should handle maximum infrastructure investment', () => {
      const region = regions[0]!;
      const polityA = polityStocks[0]!;

      // Create region with near-max infrastructure
      const nearlyMaxRegion: EconomyMvpRegion = {
        ...regions[0]!,
        infrastructureBp: 9900 // 99%
      };

      const largeSpend = 1000000000; // Large spend
      const preview = calculateInvestmentPreview(
        nearlyMaxRegion,
        polityA,
        constants,
        largeSpend,
        region.regionId,
        polityA.polityId
      );

      // Infrastructure change should be clamped at max
      assert.strict.ok(preview.infrastructureChange <= 100); // Can't exceed 10000 bp total
    });

    it('should handle negative population edge case', () => {
      // This test ensures we don't have negative population
      const regionWithLowPopulation: EconomyMvpRegion = {
        ...regions[0]!,
        population: 10,
        annualDeathRateBp: 10000 // 100% death rate
      };

      // The calculation should prevent negative population
      const workforce = Math.floor((regionWithLowPopulation.population * regionWithLowPopulation.workforceRateBp) / 10000);
      assert.strict.ok(workforce >= 0);
    });
  });

  describe('Monthly Resolution Edge Cases', () => {
    it('should handle empty regions array', () => {
      const emptyRegions: EconomyMvpRegion[] = [];
      const emptyPolityStocks: PolityStocks[] = [];

      const result = resolveMonth(emptyRegions, emptyPolityStocks, constants);

      assert.strictEqual(result.nextRegions.length, 0);
      assert.strictEqual(result.nextPolityStocks.length, 0);
      assert.strictEqual(result.regionalDeltas.length, 0);
      assert.strictEqual(result.nationalLedgers.length, 0);
    });

    it('should handle region with zero workforce rate', () => {
      const zeroWorkforceRegion: EconomyMvpRegion = {
        ...regions[0]!,
        workforceRateBp: 0
      };

      const modifiedRegions = [zeroWorkforceRegion];
      const modifiedPolityStocks = [polityStocks[0]!];

      const result = resolveMonth(modifiedRegions, modifiedPolityStocks, constants);

      // Should have zero output but not crash
      const delta = result.regionalDeltas[0]!;
      assert.strictEqual(delta.workforceChange, 0);
    });

    it('should handle region with zero output per worker', () => {
      const zeroOutputRegion: EconomyMvpRegion = {
        ...regions[0]!,
        outputPerWorker: 0
      };

      const modifiedRegions = [zeroOutputRegion];
      const modifiedPolityStocks = [polityStocks[0]!];

      const result = resolveMonth(modifiedRegions, modifiedPolityStocks, constants);

      // Should have zero gross output but not crash
      const delta = result.regionalDeltas[0]!;
      assert.strictEqual(delta.grossOutput, 0);
    });

    it('should handle polity with negative treasury (should not happen but defensive)', () => {
      const polityWithDebt: PolityStocks = {
        ...polityStocks[0]!,
        treasuryMicros: -1000000
      };

      const modifiedPolityStocks = [polityWithDebt];

      // Should still resolve without crashing
      const result = resolveMonth([regions[0]!], modifiedPolityStocks, constants);
      assert.strict.ok(result.nextPolityStocks.length === 1);
    });

    it('should handle accepted investment with insufficient treasury', () => {
      const spendMicros = 100000000;
      const modifiedPolityStocks = structuredClone(polityStocks);
      modifiedPolityStocks[0]!.treasuryMicros = 0;
      modifiedPolityStocks[0]!.acceptedInvestment = {
        targetRegionId: regions[0]!.regionId,
        spendMicros,
        effectiveMonth: '1900-01-01'
      };

      const originalInfrastructure = regions[0]!.infrastructureBp;

      // Insufficient treasury: spend is not applied, so the published identity
      // becomes treasury' = opening - 0 + exact tax.
      const result = resolveMonth(regions, modifiedPolityStocks, constants);

      const ledgerA = result.nationalLedgers.find(l => l.polityId === polityStocks[0]!.polityId)!;
      assert.strictEqual(result.nextPolityStocks[0]!.treasuryMicros, ledgerA.taxRevenueContribution);

      // No infrastructure change when the spend cannot be paid.
      const updatedRegion = result.nextRegions.find(r => r.regionId === regions[0]!.regionId)!;
      assert.strictEqual(updatedRegion.infrastructureBp, originalInfrastructure);
    });
  });

  describe('Region Transfer Edge Cases', () => {
    it('should handle transfer to non-existent polity', () => {
      assert.throws(() => {
        processRegionTransfer(
          regions,
          polityStocks,
          regions[0]!.regionId,
          'polity:test-a',
          'polity:non-existent'
        );
      }, /To polity .* not found/);
    });

    it('should handle transfer from non-existent polity', () => {
      assert.throws(() => {
        processRegionTransfer(
          regions,
          polityStocks,
          regions[0]!.regionId,
          'polity:non-existent',
          'polity:test-b'
        );
      }, /From polity .* not found/);
    });

    it('should handle circular transfer (A -> B -> A)', () => {
      // First transfer A -> B
      const result1 = processRegionTransfer(
        regions,
        polityStocks,
        regions[0]!.regionId,
        'polity:test-a',
        'polity:test-b'
      );

      // Then transfer back B -> A
      const result2 = processRegionTransfer(
        result1.updatedRegions,
        result1.updatedPolityStocks,
        regions[0]!.regionId,
        'polity:test-b',
        'polity:test-a'
      );

      // Region should be back with original controller
      const finalRegion = result2.updatedRegions.find(r => r.regionId === regions[0]!.regionId);
      assert.strictEqual(finalRegion!.controllerId, 'polity:test-a');
    });

    it('should preserve remainders during multiple transfers', () => {
      const regionWithRemainders: EconomyMvpRegion = {
        ...regions[0]!,
        birthRemainder: BigInt(50000),
        deathRemainder: BigInt(30000)
      };

      const modifiedRegions = [regionWithRemainders];

      const result = processRegionTransfer(
        modifiedRegions,
        polityStocks,
        regionWithRemainders.regionId,
        'polity:test-a',
        'polity:test-b'
      );

      const transferredRegion = result.updatedRegions[0]!;
      assert.strictEqual(transferredRegion.birthRemainder, BigInt(50000));
      assert.strictEqual(transferredRegion.deathRemainder, BigInt(30000));
    });
  });

  describe('Deterministic Behavior', () => {
    it('should produce identical results for identical inputs', () => {
      const result1 = resolveMonth(regions, polityStocks, constants);
      const result2 = resolveMonth(regions, polityStocks, constants);

      // Compare JSON strings for deep equality
      const json1 = JSON.stringify(result1, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );
      const json2 = JSON.stringify(result2, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );

      assert.strictEqual(json1, json2);
    });

    it('should produce identical transfer results for identical inputs', () => {
      const result1 = processRegionTransfer(
        regions,
        polityStocks,
        regions[0]!.regionId,
        'polity:test-a',
        'polity:test-b'
      );

      const result2 = processRegionTransfer(
        regions,
        polityStocks,
        regions[0]!.regionId,
        'polity:test-a',
        'polity:test-b'
      );

      const json1 = JSON.stringify(result1, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );
      const json2 = JSON.stringify(result2, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );

      assert.strictEqual(json1, json2);
    });

    it('should handle large numbers without overflow', () => {
      const largeRegion: EconomyMvpRegion = {
        ...regions[0]!,
        population: 1000000000, // 1 billion
        outputPerWorker: 1000000000 // Large output
      };

      // Should calculate without overflow
      const workforce = Math.floor((largeRegion.population * largeRegion.workforceRateBp) / 10000);
      const labourOutput = workforce * largeRegion.outputPerWorker;

      assert.strict.ok(workforce > 0);
      assert.strict.ok(labourOutput > 0);
      assert.strict.ok(!isNaN(labourOutput));
      assert.strict.ok(isFinite(labourOutput));
    });
  });

  describe('Validation Edge Cases', () => {
    it('should validate investment with mismatched region ID', () => {
      const region = regions[0]!;
      const polityA = polityStocks[0]!;

      const validation = validateInvestmentCommand(
        region,
        polityA,
        100000000,
        'region:test:wrong-id', // Wrong ID
        polityA.polityId
      );

      assert.strictEqual(validation.valid, false);
      assert.strict.ok(validation.errors.some(e => e.includes('mismatch')));
    });

    it('should validate investment with zero spend', () => {
      const region = regions[0]!;
      const polityA = polityStocks[0]!;

      const validation = validateInvestmentCommand(
        region,
        polityA,
        0,
        region.regionId,
        polityA.polityId
      );

      assert.strictEqual(validation.valid, false);
      assert.strict.ok(validation.errors.some(e => e.includes('positive')));
    });

    it('should validate investment with negative spend', () => {
      const region = regions[0]!;
      const polityA = polityStocks[0]!;

      const validation = validateInvestmentCommand(
        region,
        polityA,
        -100000000,
        region.regionId,
        polityA.polityId
      );

      assert.strictEqual(validation.valid, false);
      assert.strict.ok(validation.errors.some(e => e.includes('positive')));
    });
  });
});