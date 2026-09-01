import { z } from 'zod';
import { gameDateSchema, polityIdSchema, regionIdSchema } from '@open-historia/domain';

const nonNeg = z.number().int().nonnegative();
const positive = z.number().int().positive();
const bp = z.number().int().min(0).max(10000);
const displayName = z.object({ en: z.string().min(1).max(120), ru: z.string().min(1).max(120) }).strict();

export const formationIdSchema = z.string().regex(/^formation:[a-z0-9][a-z0-9._-]{0,99}$/);
export const commanderIdSchema = z.string().regex(/^commander:[a-z0-9][a-z0-9._-]{0,99}$/);
export const warIdSchema = z.string().regex(/^war:[a-z0-9][a-z0-9._-]{0,99}$/);
export const frontIdSchema = z.string().regex(/^front:[a-z0-9][a-z0-9._-]{0,99}$/);
export const peaceOfferIdSchema = z.string().regex(/^peace:[a-z0-9][a-z0-9._-]{0,99}$/);
export const callToArmsIdSchema = z.string().regex(/^call:[a-z0-9][a-z0-9._-]{0,119}$/);
export const warReasonSchema = z.enum(['claim', 'defense', 'guarantee', 'rivalry', 'none']);
export const militaryPostureSchema = z.enum(['hold', 'defend', 'advance', 'withdraw']);

export const commanderSchema = z.object({
  commanderId: commanderIdSchema,
  polityId: polityIdSchema,
  displayName,
  skill: z.number().int().min(1).max(5),
  traits: z.array(z.enum(['offensive', 'defensive', 'logistician', 'organizer'])).max(3),
  experience: nonNeg,
}).strict();

export const formationSchema = z.object({
  formationId: formationIdSchema,
  polityId: polityIdSchema,
  displayName,
  manpower: nonNeg,
  equipment: nonNeg,
  homeRegionId: regionIdSchema,
  locationRegionId: regionIdSchema,
  commanderId: commanderIdSchema.nullable(),
  status: z.enum(['mobilizing', 'active', 'demobilized', 'destroyed']),
  readyMonth: gameDateSchema.nullable(),
  posture: militaryPostureSchema,
  targetRegionId: regionIdSchema.nullable(),
  moraleBp: bp,
  familiarityBp: bp,
}).strict();
export type Formation = z.infer<typeof formationSchema>;

export const militaryPolitySchema = z.object({
  polityId: polityIdSchema,
  maxMobilizationBp: z.number().int().min(100).max(5000),
  manpowerCeiling: nonNeg,
  manpowerPool: nonNeg,
  mobilized: nonNeg,
  casualties: nonNeg,
  equipmentTotal: nonNeg,
  equipmentReserve: nonNeg,
  equipmentLost: nonNeg,
}).strict();

export const supplyLinkSchema = z.object({
  regions: z.tuple([regionIdSchema, regionIdSchema]),
  capacity: positive,
}).strict();

export const frontSchema = z.object({
  frontId: frontIdSchema,
  warId: warIdSchema,
  fromRegionId: regionIdSchema,
  targetRegionId: regionIdSchema,
  attackerPolityId: polityIdSchema,
  defenderPolityId: polityIdSchema,
  lastResolvedMonth: gameDateSchema.nullable(),
}).strict();

export const occupationSchema = z.object({
  warId: warIdSchema,
  regionId: regionIdSchema,
  legalControllerId: polityIdSchema,
  actualControllerId: polityIdSchema,
  occupiedMonth: gameDateSchema,
}).strict();

export const peaceRegionTransferSchema = z.object({
  regionId: regionIdSchema,
  toPolityId: polityIdSchema,
}).strict();
export const reparationSchema = z.object({
  fromPolityId: polityIdSchema,
  toPolityId: polityIdSchema,
  amount: positive,
}).strict();
export const peaceOfferSchema = z.object({
  offerId: peaceOfferIdSchema,
  warId: warIdSchema,
  proposerPolityId: polityIdSchema,
  recipientPolityId: polityIdSchema,
  regionTransfers: z.array(peaceRegionTransferSchema).max(12),
  reparation: reparationSchema.nullable(),
  status: z.enum(['pending', 'accepted', 'rejected', 'superseded']),
  createdMonth: gameDateSchema,
  resolvedMonth: gameDateSchema.nullable(),
}).strict();

export const warSchema = z.object({
  warId: warIdSchema,
  attackers: z.array(polityIdSchema).min(1).max(12),
  defenders: z.array(polityIdSchema).min(1).max(12),
  reason: warReasonSchema,
  declaredByPolityId: polityIdSchema,
  startedMonth: gameDateSchema,
  endedMonth: gameDateSchema.nullable(),
  status: z.enum(['active', 'ended']),
}).strict();

export const callToArmsSchema = z.object({
  callId: callToArmsIdSchema,
  warId: warIdSchema,
  beneficiaryPolityId: polityIdSchema,
  calledPolityId: polityIdSchema,
  sourceAgreementIds: z.array(z.string().regex(/^agreement:[a-z0-9][a-z0-9._-]{0,99}$/)).min(1),
  status: z.enum(['pending', 'accepted', 'refused', 'expired']),
  createdMonth: gameDateSchema,
  resolvedMonth: gameDateSchema.nullable(),
}).strict();

export const militaryStateSchema = z.object({
  combatSeed: z.number().int().nonnegative(),
  polities: z.array(militaryPolitySchema),
  commanders: z.array(commanderSchema),
  formations: z.array(formationSchema),
  supplyLinks: z.array(supplyLinkSchema),
  wars: z.array(warSchema),
  fronts: z.array(frontSchema),
  occupations: z.array(occupationSchema),
  peaceOffers: z.array(peaceOfferSchema),
  callsToArms: z.array(callToArmsSchema).optional(),
}).strict();
export type MilitaryState = z.infer<typeof militaryStateSchema>;

export const authoredMilitaryPolitySchema = z.object({
  polityId: polityIdSchema,
  maxMobilizationBp: z.number().int().min(100).max(5000),
  equipmentReserve: nonNeg,
}).strict();
export const authoredFormationSchema = formationSchema.omit({
  status: true, readyMonth: true, posture: true, targetRegionId: true, familiarityBp: true,
});
export const authoredCommanderSchema = commanderSchema.omit({ experience: true });
export const authoredMilitarySchema = z.object({
  combatSeed: z.number().int().nonnegative(),
  polities: z.array(authoredMilitaryPolitySchema),
  commanders: z.array(authoredCommanderSchema),
  formations: z.array(authoredFormationSchema),
  supplyLinks: z.array(supplyLinkSchema),
}).strict();
export type AuthoredMilitary = z.infer<typeof authoredMilitarySchema>;

export const actualController = (state: MilitaryState | undefined, regionId: string, legalControllerId: string): string =>
  state?.occupations.filter((entry) => entry.regionId === regionId)
    .sort((a, b) => b.occupiedMonth.localeCompare(a.occupiedMonth) || b.warId.localeCompare(a.warId))[0]?.actualControllerId
  ?? legalControllerId;
