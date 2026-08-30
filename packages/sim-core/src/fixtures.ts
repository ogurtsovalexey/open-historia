import {
  EconomyMvpRegion,
  PolityStocks,
  EconomyScenarioConstants
} from './types.js';
export function createTenRegionFixture(): {
  regions: EconomyMvpRegion[];
  polityStocks: PolityStocks[];
  constants: EconomyScenarioConstants;
} {
  // Two fictional polities
  const polityA = 'polity:test-a';
  const polityB = 'polity:test-b';

  // Scenario constants
  const constants: EconomyScenarioConstants = {
    infrastructureBpPerMoney: 10, // 0.1% per money unit
    foodNeedPerPerson: 1000000, // 1 unit per person per month
    accountingValue: {
      food: 5000000,      // 5 units per food
      energy: 8000000,    // 8 units per energy  
      materials: 12000000, // 12 units per materials
      manufactures: 20000000 // 20 units per manufactures
    },
    taxRateBp: 1000, // 10%
    maxInfrastructureBp: 10000 // 100%
  };

  // Create regions with unequal populations, infrastructure, and specializations
  const regions: EconomyMvpRegion[] = [
    // Polity A regions - deliberately unequal
    {
      regionId: 'region:test:r1',
      controllerId: polityA,
      population: 1000000,
      annualBirthRateBp: 120, // 1.2%
      annualDeathRateBp: 80,  // 0.8%
      birthRemainder: BigInt(0),
      deathRemainder: BigInt(0),
      workforceRateBp: 6000, // 60%
      infrastructureBp: 8000, // 80%
      primaryCommodity: 'food',
      baseMonthlyCapacity: 5000000,
      outputPerWorker: 100000,
      damageBp: 0
    },
    {
      regionId: 'region:test:r2',
      controllerId: polityA,
      population: 750000,
      annualBirthRateBp: 100, // 1.0%
      annualDeathRateBp: 90,  // 0.9%
      birthRemainder: BigInt(0),
      deathRemainder: BigInt(0),
      workforceRateBp: 5500, // 55%
      infrastructureBp: 7000, // 70%
      primaryCommodity: 'energy',
      baseMonthlyCapacity: 3000000,
      outputPerWorker: 150000,
      damageBp: 500 // 5% damage
    },
    {
      regionId: 'region:test:r3',
      controllerId: polityA,
      population: 1500000,
      annualBirthRateBp: 140, // 1.4%
      annualDeathRateBp: 70,  // 0.7%
      birthRemainder: BigInt(0),
      deathRemainder: BigInt(0),
      workforceRateBp: 6500, // 65%
      infrastructureBp: 9000, // 90%
      primaryCommodity: 'materials',
      baseMonthlyCapacity: 8000000,
      outputPerWorker: 120000,
      damageBp: 0
    },
    {
      regionId: 'region:test:r4',
      controllerId: polityA,
      population: 500000,
      annualBirthRateBp: 90,  // 0.9%
      annualDeathRateBp: 100, // 1.0%
      birthRemainder: BigInt(0),
      deathRemainder: BigInt(0),
      workforceRateBp: 5000, // 50%
      infrastructureBp: 6000, // 60%
      primaryCommodity: 'manufactures',
      baseMonthlyCapacity: 2000000,
      outputPerWorker: 200000,
      damageBp: 1000 // 10% damage
    },
    {
      regionId: 'region:test:r5',
      controllerId: polityA,
      population: 1250000,
      annualBirthRateBp: 110, // 1.1%
      annualDeathRateBp: 85,  // 0.85%
      birthRemainder: BigInt(0),
      deathRemainder: BigInt(0),
      workforceRateBp: 5800, // 58%
      infrastructureBp: 8500, // 85%
      primaryCommodity: 'food',
      baseMonthlyCapacity: 6000000,
      outputPerWorker: 90000,
      damageBp: 200 // 2% damage
    },
    // Polity B regions - also unequal but different patterns
    {
      regionId: 'region:test:r6',
      controllerId: polityB,
      population: 800000,
      annualBirthRateBp: 130, // 1.3%
      annualDeathRateBp: 75,  // 0.75%
      birthRemainder: BigInt(0),
      deathRemainder: BigInt(0),
      workforceRateBp: 6200, // 62%
      infrastructureBp: 7500, // 75%
      primaryCommodity: 'energy',
      baseMonthlyCapacity: 4000000,
      outputPerWorker: 130000,
      damageBp: 300 // 3% damage
    },
    {
      regionId: 'region:test:r7',
      controllerId: polityB,
      population: 950000,
      annualBirthRateBp: 95,  // 0.95%
      annualDeathRateBp: 95,  // 0.95%
      birthRemainder: BigInt(0),
      deathRemainder: BigInt(0),
      workforceRateBp: 5400, // 54%
      infrastructureBp: 6800, // 68%
      primaryCommodity: 'materials',
      baseMonthlyCapacity: 3500000,
      outputPerWorker: 110000,
      damageBp: 800 // 8% damage
    },
    {
      regionId: 'region:test:r8',
      controllerId: polityB,
      population: 1100000,
      annualBirthRateBp: 150, // 1.5%
      annualDeathRateBp: 65,  // 0.65%
      birthRemainder: BigInt(0),
      deathRemainder: BigInt(0),
      workforceRateBp: 6700, // 67%
      infrastructureBp: 9200, // 92%
      primaryCommodity: 'manufactures',
      baseMonthlyCapacity: 7000000,
      outputPerWorker: 180000,
      damageBp: 0
    },
    {
      regionId: 'region:test:r9',
      controllerId: polityB,
      population: 650000,
      annualBirthRateBp: 85,  // 0.85%
      annualDeathRateBp: 110, // 1.1%
      birthRemainder: BigInt(0),
      deathRemainder: BigInt(0),
      workforceRateBp: 4900, // 49%
      infrastructureBp: 5800, // 58%
      primaryCommodity: 'food',
      baseMonthlyCapacity: 2500000,
      outputPerWorker: 80000,
      damageBp: 1200 // 12% damage
    },
    {
      regionId: 'region:test:r10',
      controllerId: polityB,
      population: 1400000,
      annualBirthRateBp: 125, // 1.25%
      annualDeathRateBp: 72,  // 0.72%
      birthRemainder: BigInt(0),
      deathRemainder: BigInt(0),
      workforceRateBp: 6300, // 63%
      infrastructureBp: 8800, // 88%
      primaryCommodity: 'energy',
      baseMonthlyCapacity: 7500000,
      outputPerWorker: 140000,
      damageBp: 400 // 4% damage
    }
  ];

  // Polity stocks
  const polityStocks: PolityStocks[] = [
    {
      polityId: polityA,
      treasuryMicros: 1000000000, // 1000 units
      inventory: {
        food: 50000000,    // 50 units
        energy: 30000000,  // 30 units
        materials: 20000000, // 20 units
        manufactures: 10000000 // 10 units
      },
      acceptedInvestment: null
    },
    {
      polityId: polityB,
      treasuryMicros: 800000000, // 800 units
      inventory: {
        food: 40000000,    // 40 units
        energy: 25000000,  // 25 units
        materials: 15000000, // 15 units
        manufactures: 8000000 // 8 units
      },
      acceptedInvestment: null
    }
  ];

  return { regions, polityStocks, constants };
}

/**
 * Calculate manual sums for verification
 */
export function calculateManualSums(
  regions: EconomyMvpRegion[],
  polityId: string
): {
  totalPopulation: number;
  totalFoodProduction: number;
  totalEnergyProduction: number;
  totalMaterialsProduction: number;
  totalManufacturesProduction: number;
} {
  let totalPopulation = 0;
  let totalFoodProduction = 0;
  let totalEnergyProduction = 0;
  let totalMaterialsProduction = 0;
  let totalManufacturesProduction = 0;

  for (const region of regions) {
    if (region.controllerId === polityId) {
      totalPopulation += region.population;
      
      // Calculate gross output
      const workforce = Math.floor((region.population * region.workforceRateBp) / 10000);
      const labourOutput = workforce * region.outputPerWorker;
      const usableCapacity = Math.min(region.baseMonthlyCapacity, labourOutput);
      let grossOutput = Math.floor((usableCapacity * region.infrastructureBp) / 10000);
      grossOutput = Math.floor((grossOutput * (10000 - region.damageBp)) / 10000);
      grossOutput = Math.max(0, grossOutput);

      switch (region.primaryCommodity) {
        case 'food':
          totalFoodProduction += grossOutput;
          break;
        case 'energy':
          totalEnergyProduction += grossOutput;
          break;
        case 'materials':
          totalMaterialsProduction += grossOutput;
          break;
        case 'manufactures':
          totalManufacturesProduction += grossOutput;
          break;
      }
    }
  }

  return {
    totalPopulation,
    totalFoodProduction,
    totalEnergyProduction,
    totalMaterialsProduction,
    totalManufacturesProduction
  };
}