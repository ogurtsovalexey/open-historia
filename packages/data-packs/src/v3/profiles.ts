import type { ScenarioProfile } from './schemas.js';

export const PROFILE_EVIDENCE_KIND: Readonly<Record<ScenarioProfile, ScenarioProfile>> = {
  historical: 'historical',
  fictional: 'fictional',
  development: 'development',
};
