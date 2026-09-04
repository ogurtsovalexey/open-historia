export * from './fixedPoint.js';
export * from './canonical.js';
export * from './scenario.js';
export * from './diplomacy.js';
export * from './diplomacyReducer.js';
export * from './statecraft.js';
export * from './statecraftReducer.js';
export * from './politics.js';
export * from './politicsReducer.js';
export * from './military.js';
export * from './militaryReducer.js';
export * from './society.js';
export * from './campaign.js';
export * from './campaignReducer.js';
export * from './identityReducer.js';
export * from './mapLink.js';
export * from './selectors.js';
export * from './state.js';
export * from './commands.js';
export * from './ledger.js';
export * from './tick.js';
export * from './report.js';
export * from './persist.js';
export * from './pipeline.js';
export * from './historicalScenario.js';

/**
 * The living-world contracts intentionally live behind a namespace while the
 * legacy engine remains supported. This avoids ambiguous legacy/V2 entity IDs
 * during the migration and gives callers an explicit version boundary.
 */
export * as worldV2 from './world/index.js';
