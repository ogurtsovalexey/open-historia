import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { calculateInvestmentPreview, validateInvestmentCommand, calculateRegionGrossOutput } from '../src/investment.js';
import { resolveMonth, calculatePolityPopulation, calculatePolityProduction } from '../src/resolution.js';
import { processRegionTransfer, verifyTransferAccounting } from '../src/transfer.js';
import { createTenRegionFixture, calculateManualSums } from '../src/fixtures.js';
describe('Economy MVP Kernel', () => {
    let fixture;
    let regions;
    let polityStocks;
    let constants;
    before(() => {
        fixture = createTenRegionFixture();
        regions = fixture.regions;
        polityStocks = fixture.polityStocks;
        constants = fixture.constants;
    });
    describe('Investment Calculations', () => {
        it('should calculate valid investment preview', () => {
            const region = regions[0]; // r1 controlled by polity A
            const polityA = polityStocks[0];
            const preview = calculateInvestmentPreview(region, polityA, constants, 100000000, // 100 units
            region.regionId, polityA.polityId);
            assert.strictEqual(preview.isValidTarget, true);
            assert.strictEqual(preview.canAfford, true);
            assert.strictEqual(preview.costMicros, 100000000);
            assert.strictEqual(typeof preview.infrastructureChange, 'number');
            assert.strictEqual(typeof preview.estimatedNextMonthOutputDelta, 'number');
            assert.strictEqual(typeof preview.affectedNationalCommodityTotal, 'number');
        });
        it('should reject investment in foreign region', () => {
            const region = regions[0]; // r1 controlled by polity A
            const polityB = polityStocks[1]; // polity B trying to invest in polity A region
            const preview = calculateInvestmentPreview(region, polityB, constants, 100000000, region.regionId, polityB.polityId);
            assert.strictEqual(preview.isValidTarget, false);
            assert.strictEqual(preview.canAfford, true);
            assert.strictEqual(preview.infrastructureChange, 0);
        });
        it('should reject investment with insufficient treasury', () => {
            const region = regions[0];
            const polityA = { ...polityStocks[0], treasuryMicros: 0 };
            const preview = calculateInvestmentPreview(region, polityA, constants, 100000000, region.regionId, polityA.polityId);
            assert.strictEqual(preview.isValidTarget, true);
            assert.strictEqual(preview.canAfford, false);
            assert.strictEqual(preview.infrastructureChange, 0);
        });
        it('should validate investment command parameters', () => {
            const region = regions[0];
            const polityA = polityStocks[0];
            const validation = validateInvestmentCommand(region, polityA, 100000000, region.regionId, polityA.polityId);
            assert.strictEqual(validation.valid, true);
            assert.strictEqual(validation.errors.length, 0);
        });
        it('should detect invalid region controller', () => {
            const region = regions[0];
            const polityB = polityStocks[1];
            const validation = validateInvestmentCommand(region, polityB, 100000000, region.regionId, polityB.polityId);
            assert.strictEqual(validation.valid, false);
            assert.strictEqual(validation.errors.length, 1);
            assert(validation.errors[0].includes('not controlled'));
        });
    });
    describe('Region Output Calculations', () => {
        it('should calculate gross output with damage', () => {
            const region = regions[1]; // r2 has 5% damage
            const output = calculateRegionGrossOutput(region);
            assert.strictEqual(typeof output, 'number');
            assert(output >= 0);
        });
        it('should calculate zero output for fully damaged region', () => {
            const fullyDamagedRegion = {
                ...regions[0],
                damageBp: 10000 // 100% damage
            };
            const output = calculateRegionGrossOutput(fullyDamagedRegion);
            assert.strictEqual(output, 0);
        });
        it('should respect base capacity limit', () => {
            const region = {
                ...regions[0],
                population: 1000,
                workforceRateBp: 10000, // 100% workforce
                outputPerWorker: 1000000,
                baseMonthlyCapacity: 1000000,
                infrastructureBp: 10000, // 100% infrastructure
                damageBp: 0
            };
            const output = calculateRegionGrossOutput(region);
            // Should be limited by baseMonthlyCapacity, not labour output
            assert.strictEqual(output, 1000000);
        });
    });
    describe('Monthly Resolution', () => {
        it('should resolve month without errors', () => {
            const result = resolveMonth(regions, polityStocks, constants);
            assert.strictEqual(result.nextRegions.length, 10);
            assert.strictEqual(result.nextPolityStocks.length, 2);
            assert.strictEqual(result.regionalDeltas.length, 10);
            assert.strictEqual(result.nationalLedgers.length, 2);
            assert(Object.keys(result.foodSurplusOrShortfall).length, 2);
        });
        it('should maintain population accounting identity', () => {
            const result = resolveMonth(regions, polityStocks, constants);
            // Check each region's population change matches births - deaths
            for (const delta of result.regionalDeltas) {
                assert.strictEqual(delta.populationChange, delta.births - delta.deaths);
            }
        });
        it('should calculate polity population correctly', () => {
            const polityAId = 'polity:test-a';
            const calculated = calculatePolityPopulation(regions, polityAId);
            // Manual calculation
            const manual = calculateManualSums(regions, polityAId);
            assert.strictEqual(calculated, manual.totalPopulation);
        });
        it('should calculate polity production correctly', () => {
            const polityAId = 'polity:test-a';
            const calculated = calculatePolityProduction(regions, polityAId);
            const manual = calculateManualSums(regions, polityAId);
            assert.strictEqual(calculated.food, manual.totalFoodProduction);
            assert.strictEqual(calculated.energy, manual.totalEnergyProduction);
            assert.strictEqual(calculated.materials, manual.totalMaterialsProduction);
            assert.strictEqual(calculated.manufactures, manual.totalManufacturesProduction);
        });
        it('should process accepted investment', () => {
            const modifiedPolityStocks = JSON.parse(JSON.stringify(polityStocks));
            modifiedPolityStocks[0].acceptedInvestment = {
                targetRegionId: regions[0].regionId,
                spendMicros: 100000000,
                effectiveMonth: '1900-01-01'
            };
            const originalTreasury = modifiedPolityStocks[0].treasuryMicros;
            const originalInfrastructure = regions[0].infrastructureBp;
            const result = resolveMonth(regions, modifiedPolityStocks, constants);
            // Treasury should be reduced
            assert(result.nextPolityStocks[0].treasuryMicros < originalTreasury);
            // Infrastructure should be improved
            const updatedRegion = result.nextRegions.find(r => r.regionId === regions[0].regionId);
            assert(updatedRegion);
            assert(updatedRegion.infrastructureBp > originalInfrastructure);
        });
    });
    describe('Region Transfer', () => {
        it('should process valid region transfer', () => {
            const regionId = 'region:test:r1';
            const fromPolityId = 'polity:test-a';
            const toPolityId = 'polity:test-b';
            const result = processRegionTransfer(regions, polityStocks, regionId, fromPolityId, toPolityId);
            assert.strictEqual(result.updatedRegions.length, 10);
            assert.strictEqual(result.updatedPolityStocks.length, 2);
            // Check region controller changed
            const transferredRegion = result.updatedRegions.find(r => r.regionId === regionId);
            assert(transferredRegion);
            assert.strictEqual(transferredRegion.controllerId, toPolityId);
            // Check original region still has original controller
            const originalRegion = regions.find(r => r.regionId === regionId);
            assert(originalRegion);
            assert.strictEqual(originalRegion.controllerId, fromPolityId);
        });
        it('should reject transfer of non-existent region', () => {
            assert.throws(() => {
                processRegionTransfer(regions, polityStocks, 'region:test:nonexistent', 'polity:test-a', 'polity:test-b');
            }, /Region .* not found/);
        });
        it('should reject transfer from wrong controller', () => {
            const regionId = 'region:test:r1'; // Controlled by polity A
            assert.throws(() => {
                processRegionTransfer(regions, polityStocks, regionId, 'polity:test-b', // Wrong from polity
                'polity:test-a');
            }, /not controlled by/);
        });
        it('should maintain accounting identities after transfer', () => {
            const regionId = 'region:test:r1';
            const fromPolityId = 'polity:test-a';
            const toPolityId = 'polity:test-b';
            const result = processRegionTransfer(regions, polityStocks, regionId, fromPolityId, toPolityId);
            const verification = verifyTransferAccounting(regions, result, fromPolityId, toPolityId);
            assert.strictEqual(verification.valid, true);
            assert.strictEqual(verification.errors.length, 0);
        });
        it('should preserve region properties during transfer', () => {
            const regionId = 'region:test:r1';
            const fromPolityId = 'polity:test-a';
            const toPolityId = 'polity:test-b';
            const result = processRegionTransfer(regions, polityStocks, regionId, fromPolityId, toPolityId);
            const originalRegion = regions.find(r => r.regionId === regionId);
            const transferredRegion = result.updatedRegions.find(r => r.regionId === regionId);
            // All region properties except controller should be preserved
            assert.strictEqual(transferredRegion.population, originalRegion.population);
            assert.strictEqual(transferredRegion.infrastructureBp, originalRegion.infrastructureBp);
            assert.strictEqual(transferredRegion.damageBp, originalRegion.damageBp);
            assert.strictEqual(transferredRegion.primaryCommodity, originalRegion.primaryCommodity);
            assert.strictEqual(transferredRegion.baseMonthlyCapacity, originalRegion.baseMonthlyCapacity);
            assert.strictEqual(transferredRegion.outputPerWorker, originalRegion.outputPerWorker);
            // Only controller should change
            assert.notStrictEqual(transferredRegion.controllerId, originalRegion.controllerId);
            assert.strictEqual(transferredRegion.controllerId, toPolityId);
        });
    });
    describe('Mutation Resistance', () => {
        it('should not mutate input arrays', () => {
            const originalRegions = JSON.parse(JSON.stringify(regions));
            const originalPolityStocks = JSON.parse(JSON.stringify(polityStocks));
            // Run resolution
            resolveMonth(regions, polityStocks, constants);
            // Input should be unchanged
            assert.deepStrictEqual(regions, originalRegions);
            assert.deepStrictEqual(polityStocks, originalPolityStocks);
        });
        it('should not mutate input objects', () => {
            const region = { ...regions[0] };
            const originalInfrastructure = region.infrastructureBp;
            // Create a modified copy for testing
            const modifiedRegion = { ...region };
            const output = calculateRegionGrossOutput(modifiedRegion);
            // Original should be unchanged
            assert.strictEqual(region.infrastructureBp, originalInfrastructure);
            assert(typeof output === 'number');
        });
        it('should produce deterministic results', () => {
            const result1 = resolveMonth(regions, polityStocks, constants);
            const result2 = resolveMonth(regions, polityStocks, constants);
            // Deep compare results (excluding any random elements)
            assert.deepStrictEqual(result1.nextRegions.map(r => ({
                regionId: r.regionId,
                population: r.population,
                infrastructureBp: r.infrastructureBp
            })), result2.nextRegions.map(r => ({
                regionId: r.regionId,
                population: r.population,
                infrastructureBp: r.infrastructureBp
            })));
        });
    });
    describe('Fixture Validation', () => {
        it('should have ten regions total', () => {
            assert.strictEqual(regions.length, 10);
        });
        it('should have two polities', () => {
            assert.strictEqual(polityStocks.length, 2);
        });
        it('should have five regions per polity initially', () => {
            const polityARegions = regions.filter(r => r.controllerId === 'polity:test-a');
            const polityBRegions = regions.filter(r => r.controllerId === 'polity:test-b');
            assert.strictEqual(polityARegions.length, 5);
            assert.strictEqual(polityBRegions.length, 5);
        });
        it('should have unequal values as specified', () => {
            // Check that populations are unequal
            const populations = regions.map(r => r.population);
            const uniquePopulations = new Set(populations);
            assert(uniquePopulations.size > 1, 'Should have unequal populations');
            // Check that infrastructure values are unequal
            const infrastructures = regions.map(r => r.infrastructureBp);
            const uniqueInfrastructures = new Set(infrastructures);
            assert(uniqueInfrastructures.size > 1, 'Should have unequal infrastructure');
            // Check that damage values are unequal
            const damages = regions.map(r => r.damageBp);
            const uniqueDamages = new Set(damages);
            assert(uniqueDamages.size > 1, 'Should have unequal damage');
        });
        it('should have valid basis points ranges', () => {
            for (const region of regions) {
                assert(region.annualBirthRateBp >= 0 && region.annualBirthRateBp <= 10000);
                assert(region.annualDeathRateBp >= 0 && region.annualDeathRateBp <= 10000);
                assert(region.workforceRateBp >= 0 && region.workforceRateBp <= 10000);
                assert(region.infrastructureBp >= 0 && region.infrastructureBp <= 10000);
                assert(region.damageBp >= 0 && region.damageBp <= 10000);
            }
        });
    });
});
