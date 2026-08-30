import { z } from 'zod';
import type {
  Command,
  Event,
  CommandValidationResult,
  CommandProcessingResult
} from './commands.js';
import { deepClone } from './utils.js';
import {
  commandSchema,
  eventSchema,
  commandProcessingResultSchema
} from './commands.js';
import {
  commandIdSchema,
  eventIdSchema,
  gameDateSchema,
  polityIdSchema,
  regionIdSchema,
  worldRevisionIdSchema,
  type CommandId,
  type EventId
} from './ids.js';

/**
 * Derive one stable event UUID from a globally unique command UUID. The
 * command schemas in this scaffold emit at most one event per command.
 */
function eventIdForCommand(commandId: CommandId): EventId {
  const hex = commandId.replaceAll('-', '').toLowerCase().split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const uuid = [
    hex.slice(0, 8).join(''),
    hex.slice(8, 12).join(''),
    hex.slice(12, 16).join(''),
    hex.slice(16, 20).join(''),
    hex.slice(20, 32).join('')
  ].join('-');
  return eventIdSchema.parse(uuid);
}

/**
 * Simplified world state for demonstration
 */
export const worldStateSchema = z.object({
  revision: worldRevisionIdSchema,
  date: gameDateSchema,
  polities: z.record(
    z.string(), // Use string instead of polityIdSchema for record keys
    z.object({
      id: polityIdSchema,
      name: z.string(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      aliases: z.string().array(),
      regionIds: regionIdSchema.array()
    }).strict()
  ),
  regions: z.record(
    z.string(), // Use string instead of regionIdSchema for record keys
    z.object({
      id: regionIdSchema,
      polityId: polityIdSchema.nullable(),
      name: z.string()
    }).strict()
  ),
  events: eventSchema.array(),
  commands: z.object({
    processed: z.record(commandIdSchema, z.object({
      command: commandSchema,
      result: commandProcessingResultSchema
    }).strict()),
    pending: commandSchema.array()
  }).strict()
}).strict();

export type WorldState = z.infer<typeof worldStateSchema>;

/**
 * Create initial world state
 */
export function createInitialWorldState(params: {
  revision: string;
  date: string;
  polities: Array<{
    id: string;
    name: string;
    color: string;
    aliases?: string[];
  }>;
  regions: Array<{
    id: string;
    polityId: string | null;
    name: string;
  }>;
}): WorldState {
  const polityMap = {} as WorldState['polities'];
  const regionMap = {} as WorldState['regions'];

  // Initialize polities
  for (const polity of params.polities) {
    const polityId = polityIdSchema.parse(polity.id);
    if (polityMap[polityId]) {
      throw new Error(`Duplicate polity ID: ${polityId}`);
    }
    polityMap[polityId] = {
      id: polityId,
      name: polity.name,
      color: polity.color,
      aliases: polity.aliases || [],
      regionIds: []
    };
  }

  // Initialize regions and assign to polities
  for (const region of params.regions) {
    const regionId = regionIdSchema.parse(region.id);
    if (regionMap[regionId]) {
      throw new Error(`Duplicate region ID: ${regionId}`);
    }
    const regionPolityId = region.polityId ? polityIdSchema.parse(region.polityId) : null;

    if (regionPolityId && !polityMap[regionPolityId]) {
      throw new Error(`Unknown polity ${regionPolityId} for region ${regionId}`);
    }

    regionMap[regionId] = {
      id: regionId,
      polityId: regionPolityId,
      name: region.name
    };

    if (regionPolityId && polityMap[regionPolityId]) {
      polityMap[regionPolityId].regionIds.push(regionId);
    }
  }

  return {
    revision: worldRevisionIdSchema.parse(params.revision),
    date: params.date,
    polities: polityMap,
    regions: regionMap,
    events: [],
    commands: {
      processed: {},
      pending: []
    }
  };
}

/**
 * Validate a command against current world state
 */
export function validateCommand(
  command: Command,
  state: WorldState
): CommandValidationResult {
  const errors: CommandValidationResult['errors'] = [];
  const warnings: CommandValidationResult['warnings'] = [];

  if (!state.polities[command.issuedBy]) {
    errors.push({
      path: '/issuedBy',
      code: 'reference.unknown-issuer',
      message: `Issuing polity ${command.issuedBy} does not exist`
    });
  }

  // Basic validation: command ID uniqueness
  if (state.commands.processed[command.id]) {
    errors.push({
      path: '/id',
      code: 'command.duplicate-id',
      message: `Command with ID ${command.id} already processed`
    });
  }

  // Validate target revision if specified
  if (command.targetRevision !== null && command.targetRevision !== state.revision) {
    errors.push({
      path: '/targetRevision',
      code: 'command.revision-mismatch',
      message: `Command targets revision ${command.targetRevision}, but current revision is ${state.revision}`
    });
  }

  // Command-specific validation
  if (command.type === 'request-region-transfer') {
    // Check if region exists
    if (!state.regions[command.regionId]) {
      errors.push({
        path: '/regionId',
        code: 'reference.unknown-region',
        message: `Region ${command.regionId} does not exist`
      });
    } else {
      // Check if from polity owns the region
      const region = state.regions[command.regionId];
      if (region.polityId !== command.fromPolityId) {
        errors.push({
          path: '/fromPolityId',
          code: 'command.invalid-transfer-source',
          message: `Region ${command.regionId} is not owned by ${command.fromPolityId}`
        });
      }
    }

    // Check if polities exist
    if (!state.polities[command.fromPolityId]) {
      errors.push({
        path: '/fromPolityId',
        code: 'reference.unknown-polity',
        message: `Polity ${command.fromPolityId} does not exist`
      });
    }

    if (!state.polities[command.toPolityId]) {
      errors.push({
        path: '/toPolityId',
        code: 'reference.unknown-polity',
        message: `Polity ${command.toPolityId} does not exist`
      });
    }

    // Check if transfer would be to same polity
    if (command.fromPolityId === command.toPolityId) {
      warnings.push({
        path: '/toPolityId',
        code: 'command.redundant-transfer',
        message: 'Transfer would be to the same polity'
      });
    }
  }

  if (command.type === 'request-polity-rename') {
    // Check if polity exists
    if (!state.polities[command.polityId]) {
      errors.push({
        path: '/polityId',
        code: 'reference.unknown-polity',
        message: `Polity ${command.polityId} does not exist`
      });
    } else {
      // Check if name is actually changing
      const polity = state.polities[command.polityId];
      if (polity.name === command.newName) {
        warnings.push({
          path: '/newName',
          code: 'command.redundant-rename',
          message: 'New name is the same as current name'
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Process a command and generate events
 */
export function processCommand(
  command: Command,
  state: WorldState
): CommandProcessingResult {
  const validation = validateCommand(command, state);

  if (!validation.valid) {
    return {
      status: 'rejected',
      commandId: command.id,
      events: [],
      validation,
      appliedRevision: null
    };
  }

  const eventId = eventIdForCommand(command.id);
  const newRevision = worldRevisionIdSchema.parse(`rev-${command.id}`);

  const events: Event[] = [];

  if (command.type === 'request-region-transfer') {
    // Create region transfer event
    const event: Event = {
      id: eventId,
      type: 'region-transferred',
      commandId: command.id,
      occurredAt: command.issuedAt,
      appliedToRevision: newRevision,
      regionId: command.regionId,
      fromPolityId: command.fromPolityId,
      toPolityId: command.toPolityId,
      effectiveDate: command.issuedAt,
      transferId: eventId
    };
    events.push(eventSchema.parse(event));
  }

  if (command.type === 'request-polity-rename') {
    const polity = state.polities[command.polityId];
    // Create polity rename event
    const event: Event = {
      id: eventId,
      type: 'polity-renamed',
      commandId: command.id,
      occurredAt: command.issuedAt,
      appliedToRevision: newRevision,
      polityId: command.polityId,
      previousName: polity.name,
      newName: command.newName,
      previousColor: polity.color,
      newColor: command.newColor || polity.color,
      previousAliases: polity.aliases,
      newAliases: command.newAliases || polity.aliases,
      effectiveDate: command.issuedAt
    };
    events.push(eventSchema.parse(event));
  }

  return {
    status: 'accepted',
    commandId: command.id,
    events,
    validation,
    appliedRevision: newRevision
  };
}

/**
 * Apply events to world state (pure reducer)
 */
export function applyEvents(
  state: WorldState,
  events: Event[]
): WorldState {
  // Create deep clone to ensure immutability
  const newState = deepClone(state);
  let appliedRevision: WorldState['revision'] | null = null;

  for (const event of events) {
    if (appliedRevision !== null && appliedRevision !== event.appliedToRevision) {
      throw new Error('Cannot apply events from multiple target revisions');
    }
    appliedRevision = event.appliedToRevision;

    if (event.type === 'region-transferred') {
      // Update region ownership
      const region = newState.regions[event.regionId];
      const fromPolity = newState.polities[event.fromPolityId];
      const toPolity = newState.polities[event.toPolityId];
      if (!region || !fromPolity || !toPolity || region.polityId !== event.fromPolityId) {
        throw new Error(`Region transfer event ${event.id} conflicts with world state`);
      }

      fromPolity.regionIds = fromPolity.regionIds.filter(id => id !== event.regionId);
      if (!toPolity.regionIds.includes(event.regionId)) {
        toPolity.regionIds.push(event.regionId);
      }
      region.polityId = event.toPolityId;
    }

    if (event.type === 'polity-renamed') {
      // Update polity name and metadata
      const polity = newState.polities[event.polityId];
      if (!polity || polity.name !== event.previousName) {
        throw new Error(`Polity rename event ${event.id} conflicts with world state`);
      }
      polity.name = event.newName;
      if (event.newColor) polity.color = event.newColor;
      if (event.newAliases) polity.aliases = event.newAliases;
    }

    // Add event to history
    newState.events.push(event);
  }

  if (appliedRevision !== null) {
    newState.revision = appliedRevision;
  }

  return newState;
}

/**
 * Process and apply a command atomically
 */
export function processAndApplyCommand(
  command: Command,
  state: WorldState
): { state: WorldState; result: CommandProcessingResult } {
  const result = processCommand(command, state);

  if (result.status !== 'accepted') {
    // Command rejected, state unchanged
    return { state, result };
  }

  // Apply events to create new state
  const newState = applyEvents(state, result.events);

  // Record command as processed
  newState.commands.processed[command.id] = {
    command,
    result
  };

  return { state: newState, result };
}

/**
 * Verify reducer determinism: same input → same output
 */
export function verifyDeterminism(
  initialState: WorldState,
  command: Command
): boolean {
  // First run
  const result1 = processAndApplyCommand(command, initialState);

  // Second run from same initial state
  const result2 = processAndApplyCommand(command, initialState);

  // Compare serialized outputs
  const serialized1 = JSON.stringify(result1.state);
  const serialized2 = JSON.stringify(result2.state);

  return serialized1 === serialized2;
}
