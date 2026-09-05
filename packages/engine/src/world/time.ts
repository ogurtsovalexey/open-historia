import { createHash } from 'node:crypto';
import {
  evidenceRecordSchema,
  worldEventSchema,
  type WorldStateV2,
  type WorldStateV2Input,
} from './schema.js';
import {
  assertExpectedWorldRevision,
  nextRevisionLineage,
  stampWorldStateRevision,
} from './revision.js';

export interface AdvanceWorldMonthCommand {
  expectedRevision: string;
}

export interface WorldClockTransition {
  state: WorldStateV2;
  revisionBefore: WorldStateV2['revision'];
  revisionAfter: WorldStateV2['revision'];
  monthBefore: WorldStateV2['month'];
  monthAfter: WorldStateV2['month'];
  turnBefore: number;
  turnAfter: number;
  eventId: string;
  evidenceId: string;
}

function addOneMonth(month: string): WorldStateV2['month'] {
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/u.exec(month);
  if (!match) throw new Error(`invalid world month ${month}`);
  const year = Number(match[1]);
  const currentMonth = Number(match[2]);
  const day = Number(match[3]);
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const nextYear = currentMonth === 12 ? year + 1 : year;
  const finalDay = Math.min(day, new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate());
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}` as WorldStateV2['month'];
}

function derivedId(prefix: 'event' | 'evidence', values: readonly string[]): string {
  const digest = createHash('sha256').update(values.join('\u001f'), 'utf8').digest('hex').slice(0, 32);
  return `${prefix}:clock-${digest}`;
}

/**
 * Advance only the canonical clock. Material quantities are deliberately left
 * untouched: births, production, upkeep and processes need their own authored
 * rules and causal transitions rather than being invented by elapsed time.
 */
export function advanceWorldMonth(
  state: WorldStateV2,
  command: AdvanceWorldMonthCommand,
): WorldClockTransition {
  assertExpectedWorldRevision(state, command.expectedRevision);
  if (state.turn >= Number.MAX_SAFE_INTEGER) throw new Error('world turn exceeds the safe integer range');

  const monthAfter = addOneMonth(state.month);
  const turnAfter = state.turn + 1;
  const eventId = derivedId('event', [state.revision, monthAfter, String(turnAfter)]);
  const evidenceId = derivedId('evidence', [eventId]);
  const event = worldEventSchema.parse({
    eventId,
    revision: state.revision,
    kind: 'time-advanced',
    entityRefs: [],
    evidenceIds: [evidenceId],
  });
  const evidence = evidenceRecordSchema.parse({
    evidenceId,
    revision: state.revision,
    kind: 'clock-transition',
    entityRefs: [],
    eventRefs: [eventId],
    canonicalPointers: ['/month', '/turn'],
    visibility: 'public',
  });
  const { revision: _revision, ...content } = state;
  void _revision;
  const input: WorldStateV2Input = {
    ...content,
    month: monthAfter,
    turn: turnAfter,
    revisionLineage: nextRevisionLineage(state),
    events: [...state.events, event],
    evidence: [...state.evidence, evidence],
  };
  const next = stampWorldStateRevision(input);
  return {
    state: next,
    revisionBefore: state.revision,
    revisionAfter: next.revision,
    monthBefore: state.month,
    monthAfter,
    turnBefore: state.turn,
    turnAfter,
    eventId,
    evidenceId,
  };
}
