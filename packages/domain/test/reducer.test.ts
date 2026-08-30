import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  commandSchema,
  requestRegionTransferCommandSchema,
  requestPolityRenameCommandSchema,
  regionTransferredEventSchema
} from '../src/commands.js';
import {
  createInitialWorldState,
  validateCommand,
  processCommand,
  applyEvents,
  processAndApplyCommand,
  verifyDeterminism
} from '../src/reducer.js';
import {
  commandIdSchema,
  eventIdSchema,
  worldRevisionIdSchema,
  polityIdSchema,
  regionIdSchema
} from '../src/ids.js';

describe('Command and Event Schemas', () => {
  const validCommandId = commandIdSchema.parse(crypto.randomUUID());
  const validEventId = eventIdSchema.parse(crypto.randomUUID());
  const validRevision = worldRevisionIdSchema.parse('rev-abc123');
  const validPolityId = polityIdSchema.parse('polity:russian-empire');
  const validRegionId = regionIdSchema.parse('region:gadm-4-1:RUS.33_1');

  describe('requestRegionTransferCommandSchema', () => {
    it('accepts valid region transfer command', () => {
      const command = {
        id: validCommandId,
        type: 'request-region-transfer',
        issuedAt: '1916-01-01',
        issuedBy: validPolityId,
        targetRevision: validRevision,
        regionId: validRegionId,
        fromPolityId: polityIdSchema.parse('polity:german-empire'),
        toPolityId: validPolityId,
        reason: 'Treaty of Brest-Litovsk',
        wholeCountry: false
      };

      assert.doesNotThrow(() => requestRegionTransferCommandSchema.parse(command));
    });

    it('rejects command with missing required fields', () => {
      const invalidCommand = {
        id: validCommandId,
        type: 'request-region-transfer',
        issuedAt: '1916-01-01',
        // missing issuedBy
        regionId: validRegionId,
        fromPolityId: polityIdSchema.parse('polity:german-empire'),
        toPolityId: validPolityId,
        reason: 'Test'
      };

      assert.throws(() => requestRegionTransferCommandSchema.parse(invalidCommand));
    });

    it('rejects unknown fields', () => {
      const commandWithExtra = {
        id: validCommandId,
        type: 'request-region-transfer',
        issuedAt: '1916-01-01',
        issuedBy: validPolityId,
        targetRevision: validRevision,
        regionId: validRegionId,
        fromPolityId: polityIdSchema.parse('polity:german-empire'),
        toPolityId: validPolityId,
        reason: 'Test',
        extraField: 'not allowed'
      };

      assert.throws(() => requestRegionTransferCommandSchema.parse(commandWithExtra));
    });
  });

  describe('regionTransferredEventSchema', () => {
    it('accepts valid region transferred event', () => {
      const event = {
        id: validEventId,
        type: 'region-transferred',
        commandId: validCommandId,
        occurredAt: '1916-03-03',
        appliedToRevision: validRevision,
        regionId: validRegionId,
        fromPolityId: polityIdSchema.parse('polity:german-empire'),
        toPolityId: validPolityId,
        effectiveDate: '1916-03-03',
        transferId: crypto.randomUUID()
      };

      assert.doesNotThrow(() => regionTransferredEventSchema.parse(event));
    });
  });

  describe('commandSchema discriminated union', () => {
    it('accepts either command type', () => {
      const transferCommand = requestRegionTransferCommandSchema.parse({
        id: validCommandId,
        type: 'request-region-transfer',
        issuedAt: '1916-01-01',
        issuedBy: validPolityId,
        targetRevision: validRevision,
        regionId: validRegionId,
        fromPolityId: polityIdSchema.parse('polity:german-empire'),
        toPolityId: validPolityId,
        reason: 'Test'
      });

      const renameCommand = requestPolityRenameCommandSchema.parse({
        id: commandIdSchema.parse(crypto.randomUUID()),
        type: 'request-polity-rename',
        issuedAt: '1916-01-01',
        issuedBy: validPolityId,
        targetRevision: validRevision,
        polityId: validPolityId,
        newName: 'Russian Soviet Republic',
        reason: 'Revolution'
      });

      assert.doesNotThrow(() => commandSchema.parse(transferCommand));
      assert.doesNotThrow(() => commandSchema.parse(renameCommand));
    });
  });
});

describe('Reducer', () => {
  let initialState: ReturnType<typeof createInitialWorldState>;

  beforeEach(() => {
    initialState = createInitialWorldState({
      revision: 'rev-initial',
      date: '1916-01-01',
      polities: [
        {
          id: 'polity:russian-empire',
          name: 'Russian Empire',
          color: '#ff0000',
          aliases: ['Russia']
        },
        {
          id: 'polity:german-empire',
          name: 'German Empire',
          color: '#0000ff',
          aliases: ['Germany']
        }
      ],
      regions: [
        {
          id: 'region:gadm-4-1:RUS.33_1',
          polityId: 'polity:russian-empire',
          name: 'Moscow Region'
        },
        {
          id: 'region:gadm-4-1:DEU.1_1',
          polityId: 'polity:german-empire',
          name: 'Berlin Region'
        }
      ]
    });
  });

  describe('createInitialWorldState', () => {
    it('rejects duplicate IDs and unknown controller references', () => {
      assert.throws(() => createInitialWorldState({
        revision: 'rev-initial',
        date: '1916-01-01',
        polities: [{ id: 'polity:test', name: 'Test', color: '#000000' }],
        regions: [{
          id: 'region:test-1:one',
          polityId: 'polity:missing',
          name: 'One'
        }]
      }), /Unknown polity/);

      assert.throws(() => createInitialWorldState({
        revision: 'rev-initial',
        date: '1916-01-01',
        polities: [
          { id: 'polity:test', name: 'Test', color: '#000000' },
          { id: 'polity:test', name: 'Duplicate', color: '#ffffff' }
        ],
        regions: []
      }), /Duplicate polity/);
    });
  });

  describe('validateCommand', () => {
    it('validates correct region transfer command', () => {
      const command = {
        id: commandIdSchema.parse(crypto.randomUUID()),
        type: 'request-region-transfer',
        issuedAt: '1916-03-03',
        issuedBy: 'polity:russian-empire',
        targetRevision: 'rev-initial',
        regionId: 'region:gadm-4-1:DEU.1_1',
        fromPolityId: 'polity:german-empire',
        toPolityId: 'polity:russian-empire',
        reason: 'Peace treaty'
      };

      const validation = validateCommand(commandSchema.parse(command), initialState);
      assert.strictEqual(validation.valid, true);
      assert.strictEqual(validation.errors.length, 0);
    });

    it('rejects transfer of non-existent region', () => {
      const command = {
        id: commandIdSchema.parse(crypto.randomUUID()),
        type: 'request-region-transfer',
        issuedAt: '1916-03-03',
        issuedBy: 'polity:russian-empire',
        targetRevision: 'rev-initial',
        regionId: 'region:gadm-4-1:NONEXISTENT',
        fromPolityId: 'polity:german-empire',
        toPolityId: 'polity:russian-empire',
        reason: 'Test'
      };

      const validation = validateCommand(commandSchema.parse(command), initialState);
      assert.strictEqual(validation.valid, false);
      assert.strictEqual(validation.errors.length, 1);
      assert.match(validation.errors[0].message, /does not exist/);
    });

    it('rejects transfer from wrong owner', () => {
      const command = {
        id: commandIdSchema.parse(crypto.randomUUID()),
        type: 'request-region-transfer',
        issuedAt: '1916-03-03',
        issuedBy: 'polity:russian-empire',
        targetRevision: 'rev-initial',
        regionId: 'region:gadm-4-1:RUS.33_1', // Owned by Russia
        fromPolityId: 'polity:german-empire', // Claiming Germany owns it
        toPolityId: 'polity:german-empire',
        reason: 'Test'
      };

      const validation = validateCommand(commandSchema.parse(command), initialState);
      assert.strictEqual(validation.valid, false);
      assert.match(validation.errors[0].message, /not owned by/);
    });
  });

  describe('processCommand', () => {
    it('processes valid region transfer command', () => {
      const command = {
        id: commandIdSchema.parse(crypto.randomUUID()),
        type: 'request-region-transfer',
        issuedAt: '1916-03-03',
        issuedBy: 'polity:russian-empire',
        targetRevision: 'rev-initial',
        regionId: 'region:gadm-4-1:DEU.1_1',
        fromPolityId: 'polity:german-empire',
        toPolityId: 'polity:russian-empire',
        reason: 'Peace treaty'
      };

      const result = processCommand(commandSchema.parse(command), initialState);
      assert.strictEqual(result.status, 'accepted');
      assert.strictEqual(result.events.length, 1);
      assert.strictEqual(result.events[0].type, 'region-transferred');
    });

    it('rejects invalid command', () => {
      const command = {
        id: commandIdSchema.parse(crypto.randomUUID()),
        type: 'request-region-transfer',
        issuedAt: '1916-03-03',
        issuedBy: 'polity:russian-empire',
        targetRevision: 'rev-initial',
        regionId: 'region:gadm-4-1:NONEXISTENT',
        fromPolityId: 'polity:german-empire',
        toPolityId: 'polity:russian-empire',
        reason: 'Test'
      };

      const result = processCommand(commandSchema.parse(command), initialState);
      assert.strictEqual(result.status, 'rejected');
      assert.strictEqual(result.events.length, 0);
    });
  });

  describe('applyEvents', () => {
    it('applies region transfer event immutably', () => {
      const event = {
        id: eventIdSchema.parse(crypto.randomUUID()),
        type: 'region-transferred',
        commandId: commandIdSchema.parse(crypto.randomUUID()),
        occurredAt: '1916-03-03',
        appliedToRevision: 'rev-new',
        regionId: 'region:gadm-4-1:DEU.1_1',
        fromPolityId: 'polity:german-empire',
        toPolityId: 'polity:russian-empire',
        effectiveDate: '1916-03-03',
        transferId: crypto.randomUUID()
      };

      const parsedEvent = regionTransferredEventSchema.parse(event);
      const newState = applyEvents(initialState, [parsedEvent]);

      // Original state unchanged
      assert.strictEqual(initialState.regions['region:gadm-4-1:DEU.1_1'].polityId, 'polity:german-empire');
      assert.strictEqual(initialState.polities['polity:german-empire'].regionIds.length, 1);
      assert.strictEqual(initialState.polities['polity:russian-empire'].regionIds.length, 1);

      // New state updated
      assert.strictEqual(newState.regions['region:gadm-4-1:DEU.1_1'].polityId, 'polity:russian-empire');
      assert.strictEqual(newState.polities['polity:german-empire'].regionIds.length, 0);
      assert.strictEqual(newState.polities['polity:russian-empire'].regionIds.length, 2);
      assert.strictEqual(newState.revision, 'rev-new');
      assert.strictEqual(newState.events.length, 1);
    });
  });

  describe('processAndApplyCommand', () => {
    it('processes and applies valid command atomically', () => {
      const command = {
        id: commandIdSchema.parse(crypto.randomUUID()),
        type: 'request-region-transfer',
        issuedAt: '1916-03-03',
        issuedBy: 'polity:russian-empire',
        targetRevision: 'rev-initial',
        regionId: 'region:gadm-4-1:DEU.1_1',
        fromPolityId: 'polity:german-empire',
        toPolityId: 'polity:russian-empire',
        reason: 'Peace treaty'
      };

      const { state: newState, result } = processAndApplyCommand(commandSchema.parse(command), initialState);

      assert.strictEqual(result.status, 'accepted');
      assert.strictEqual(newState.revision, result.appliedRevision);
      assert.strictEqual(newState.commands.processed[command.id].command.id, command.id);
    });
  });

  describe('verifyDeterminism', () => {
    it('ensures same input produces same output', () => {
      const command = {
        id: commandIdSchema.parse(crypto.randomUUID()),
        type: 'request-region-transfer',
        issuedAt: '1916-03-03',
        issuedBy: 'polity:russian-empire',
        targetRevision: 'rev-initial',
        regionId: 'region:gadm-4-1:DEU.1_1',
        fromPolityId: 'polity:german-empire',
        toPolityId: 'polity:russian-empire',
        reason: 'Peace treaty'
      };

      const isDeterministic = verifyDeterminism(initialState, commandSchema.parse(command));
      assert.strictEqual(isDeterministic, true);

      const first = processAndApplyCommand(commandSchema.parse(command), initialState);
      const second = processAndApplyCommand(commandSchema.parse(command), initialState);
      assert.deepStrictEqual(first, second);
      assert.strictEqual(first.state.revision, first.result.appliedRevision);
      assert.strictEqual(first.result.events[0].appliedToRevision, first.result.appliedRevision);
    });
  });
});
