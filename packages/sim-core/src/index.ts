export * from './types.js';
export * from './arithmetic.js';
export * from './investment.js';
export * from './resolution.js';
export * from './transfer.js';

/**
 * Core simulation kernel for Open Historia economy MVP
 *
 * This package implements the pure strict-TypeScript kernel for the ten-region
 * economy MVP as defined in docs/spec/first-economy-mvp.md
 *
 * Key principles:
 * - Deterministic fixed-point calculations
 * - Same pure investment calculation for preview and resolution
 * - Region-first accounting with exact re-aggregation
 * - No state mutation - all functions return new objects
 * - Validation of stale/foreign/insufficient/invalid/overflow cases
 */
