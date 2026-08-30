import { describe, it } from 'node:test';
import assert from 'node:assert';
import { canonicalState } from '../src/canonical.js';
import { directoryCommandsProvider, runCampaign } from '../src/pipeline.js';
import { COMMANDS_DIR, loadScenarioRaw, readGolden } from './helpers.js';

/**
 * Golden fixtures: scenario + command fixtures → byte-exact expected outputs.
 * Regenerate ONLY deliberately, by a human, via:
 *   node dist/cli.js run --scenario fixtures/scenario-dev-2x5/scenario.json \
 *     --commands fixtures/commands --turns 12 --write-golden test/golden
 * Never regenerate in CI. A diff here means the engine's observable behavior
 * changed — that is either a bug or a consciously accepted contract change.
 */
describe('golden campaign', () => {
  it('turn 1 canonical state matches the golden byte-for-byte', () => {
    const campaign = runCampaign({
      scenarioRaw: loadScenarioRaw(),
      turns: 1,
      commandsFor: directoryCommandsProvider(COMMANDS_DIR),
    });
    assert.strictEqual(`${canonicalState(campaign.turns[0].result.state)}\n`, readGolden('turn-001.state.canonical.json'));
  });

  it('turn 1 report matches the golden byte-for-byte', () => {
    const campaign = runCampaign({
      scenarioRaw: loadScenarioRaw(),
      turns: 1,
      commandsFor: directoryCommandsProvider(COMMANDS_DIR),
    });
    assert.strictEqual(`${campaign.turns[0].report}\n`, readGolden('turn-001.report.md'));
  });

  it('12-month revision chain matches the golden', () => {
    const campaign = runCampaign({
      scenarioRaw: loadScenarioRaw(),
      turns: 12,
      commandsFor: directoryCommandsProvider(COMMANDS_DIR),
    });
    const expected = JSON.parse(readGolden('campaign-012.checksums.json')) as Array<{ turn: number; revision: string }>;
    const actual = campaign.revisions.map((revision, index) => ({ turn: index, revision }));
    assert.deepStrictEqual(actual, expected);
  });
});
