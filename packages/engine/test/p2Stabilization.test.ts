import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { canonicalState } from '../src/canonical.js';
import { parseTurnCommands } from '../src/commands.js';
import type { TurnCommandsFile } from '../src/commands.js';
import { replayRun, runCampaign } from '../src/pipeline.js';
import type { CampaignResult } from '../src/pipeline.js';
import type { EconWorldState } from '../src/state.js';
import { FIXTURES_DIR, readGolden } from './helpers.js';

const FIXTURE_DIR = join(FIXTURES_DIR, 'scenario-dev-map-4c');
const scenarioRaw = JSON.parse(readFileSync(join(FIXTURE_DIR, 'scenario.json'), 'utf8')) as Record<string, unknown>;

const commandPlan: Record<number, unknown[]> = {
  2: [{
    kind: 'economy.invest-region', commandId: '00000000-0000-4000-8000-000000000002',
    actorPolityId: 'polity:austria', targetRegionId: 'region:gadm:AUT.9_1',
    effectiveMonth: '1938-02-01', spend: 100,
  }],
  3: [{
    kind: 'economy.invest-region', commandId: '00000000-0000-4000-8000-000000000003',
    actorPolityId: 'polity:austria', targetRegionId: 'region:gadm:AUT.7_1',
    effectiveMonth: '1938-03-01', spend: 100,
  }],
  4: [{
    kind: 'economy.invest-region', commandId: '00000000-0000-4000-8000-000000000004',
    actorPolityId: 'polity:austria', targetRegionId: 'region:gadm:AUT.6_1',
    effectiveMonth: '1938-04-01', spend: 100,
  }],
  5: [{
    kind: 'economy.invest-region', commandId: '00000000-0000-4000-8000-000000000005',
    actorPolityId: 'polity:austria', targetRegionId: 'region:gadm:AUT.3_1',
    effectiveMonth: '1938-05-01', spend: 100,
  }],
  6: [{
    kind: 'territory.transfer-region', commandId: '00000000-0000-4000-8000-000000000006',
    actorPolityId: 'polity:austria', targetRegionId: 'region:gadm:AUT.4_1',
    newControllerId: 'polity:germany', effectiveMonth: '1938-06-01',
  }],
  7: [{
    kind: 'economy.invest-region', commandId: '00000000-0000-4000-8000-000000000007',
    actorPolityId: 'polity:austria', targetRegionId: 'region:gadm:AUT.9_1',
    effectiveMonth: '1938-07-01', spend: 100,
  }],
  8: [{
    kind: 'economy.invest-region', commandId: '00000000-0000-4000-8000-000000000008',
    actorPolityId: 'polity:austria', targetRegionId: 'region:gadm:AUT.2_1',
    effectiveMonth: '1938-08-01', spend: 100,
  }],
  9: [{
    kind: 'economy.invest-region', commandId: '00000000-0000-4000-8000-000000000009',
    actorPolityId: 'polity:austria', targetRegionId: 'region:gadm:AUT.5_1',
    effectiveMonth: '1938-09-01', spend: 100,
  }],
};

const commandsFor = (turn: number): TurnCommandsFile => parseTurnCommands({ commands: commandPlan[turn] ?? [] });
export const runSoak = (outDir?: string): CampaignResult =>
  runCampaign({ scenarioRaw, turns: 10, commandsFor, ...(outDir ? { outDir } : {}) });

const countRegions = (state: EconWorldState, polityId: string): number =>
  state.regions.filter((region) => region.controllerId === polityId).length;

export const reportRows = (campaign: CampaignResult) => campaign.turns.map((completed, index) => {
  const state = completed.result.state;
  const command = commandPlan[index + 1]?.[0] as { kind?: string } | undefined;
  return {
    turn: index + 1,
    date: state.month,
    round: index + 2,
    monthlyTicks: 1,
    engineRevision: state.revision,
    command: command?.kind ?? 'none',
    polities: state.polities.map((polity) => {
      const regions = state.regions.filter((region) => region.controllerId === polity.id);
      const ledger = completed.result.ledger.polities.find((entry) => entry.polityId === polity.id);
      return {
        polityId: polity.id,
        treasury: polity.treasury,
        population: regions.reduce((sum, region) => sum + region.population, 0),
        stockpile: Object.fromEntries(polity.stockpile.map((entry) => [entry.resource, entry.amount])),
        infrastructureBp: regions.reduce((sum, region) => sum + region.infrastructureBp, 0),
        regionCount: regions.length,
        production: Object.fromEntries((ledger?.production ?? []).map((entry) => [entry.resource, entry.total])),
        tax: ledger?.taxTotal ?? 0,
      };
    }),
  };
});

describe('P2 stabilization: ten-month Central Europe soak', () => {
  it('keeps the 47 authored regions, economy coefficients, resources and map link unchanged', () => {
    const regions = scenarioRaw.regions;
    const economy = scenarioRaw.economy;
    const polities = scenarioRaw.polities as Array<{ id: string; stockpile: unknown }>;
    const resources = { activeResources: scenarioRaw.activeResources, stockpiles: polities.map((p) => [p.id, p.stockpile]) };
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    assert.strictEqual(hash(regions), '4f66cdaab1d7472bdd24fba594238b78df308fa87551af1f4c8b10c922bd0433');
    assert.strictEqual(hash(economy), '724c4898cee6366b5a72f56cdbb471ffee603c0b687fbf239c59fe9dfc850662');
    assert.strictEqual(hash(resources), 'b39230d58e03d777f4008eb7f4538b3a068c10c996efd30b786beb6c5a071598');
    assert.strictEqual(
      createHash('sha256').update(readFileSync(join(FIXTURE_DIR, 'map-link.json'))).digest('hex'),
      '19745ecf20bc3cdc88a965c39d0c581bc4ced089f54fdfd24b3e2909004c9c6a',
    );
  });

  it('matches the accepted ten-turn revision chain and per-turn aggregate report', () => {
    const campaign = runSoak();
    assert.strictEqual(campaign.finalState.month, '1938-11-01');
    assert.strictEqual(campaign.finalState.turn, 10);
    assert.deepStrictEqual(
      campaign.revisions.map((revision, turn) => ({ turn, revision })),
      JSON.parse(readGolden('p2-stabilization-010.checksums.json')),
    );
    assert.deepStrictEqual(reportRows(campaign), JSON.parse(readGolden('p2-stabilization-010.report.json')));
  });

  it('transfers Upper Austria once, re-aggregates immediately and replays byte-for-byte', () => {
    const first = runSoak();
    const second = runSoak();
    const afterTransfer = first.turns[5];
    const transferred = afterTransfer.result.state.regions.find((region) => region.regionId === 'region:gadm:AUT.4_1');
    assert.strictEqual(transferred?.controllerId, 'polity:germany');
    assert.strictEqual(countRegions(afterTransfer.result.state, 'polity:austria'), 8);
    assert.strictEqual(countRegions(afterTransfer.result.state, 'polity:germany'), 17);
    assert.strictEqual(afterTransfer.result.ledger.transfers.length, 1);
    assert.ok(afterTransfer.result.invariantsChecked.includes('transfer-conservation'));
    assert.deepStrictEqual(first.revisions, second.revisions);
    assert.strictEqual(canonicalState(first.finalState), canonicalState(second.finalState));
  });

  it('persists the complete run and replays every recorded revision', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'oh-p2-stabilization-'));
    try {
      const campaign = runSoak(outDir);
      const replay = replayRun(outDir);
      assert.deepStrictEqual(replay, { ok: true, turnsReplayed: 10, mismatches: [] });
      assert.strictEqual(campaign.finalState.revision, campaign.revisions[10]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('applies each investment to the intended Austrian region', () => {
    const campaign = runSoak();
    const initialInfra = new Map<string, number>(
      campaign.initialState.regions.map((region) => [region.regionId, region.infrastructureBp]),
    );
    const expectedGains = new Map([
      ['region:gadm:AUT.9_1', 200],
      ['region:gadm:AUT.7_1', 100],
      ['region:gadm:AUT.6_1', 100],
      ['region:gadm:AUT.3_1', 100],
      ['region:gadm:AUT.2_1', 100],
      ['region:gadm:AUT.5_1', 100],
    ]);
    for (const [regionId, gain] of expectedGains) {
      const final = campaign.finalState.regions.find((region) => region.regionId === regionId);
      assert.strictEqual(final?.infrastructureBp, (initialInfra.get(regionId) ?? 0) + gain);
    }
  });
});
