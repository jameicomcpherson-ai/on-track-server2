// On Track - Setback Days Calculator
// The "Impact Formula" - Calculates the true cost of a purchase
// Formula: Setback Days = Purchase Amount / (Disposable Income / 30)

import { Decimal } from '@prisma/client/runtime/library';
import {
  SetbackCalculationInput,
  SetbackCalculationResult,
  Liability,
} from '../types';

// ============================================
// CONSTANTS
// ============================================

// The 8% threshold for high-priority debt classification
const HIGH_PRIORITY_APR_THRESHOLD = new Decimal(8.0);

// Days in a month (using 30.44 for average)
const DAYS_PER_MONTH = new Decimal(30.44);

// Opportunity cost rate (what money could earn if invested - 7% annual)
const OPPORTUNITY_COST_RATE = new Decimal(0.07);

// Daily opportunity cost rate
const DAILY_OPPORTUNITY_RATE = OPPORTUNITY_COST_RATE.dividedBy(365);

// Warning thresholds
const WARNING_SETBACK_DAYS = new Decimal(7);    // 1 week
const CRITICAL_SETBACK_DAYS = new Decimal(30);  // 1 month

// ============================================
// MAIN SETBACK CALCULATION FUNCTION
// ============================================

/**
 * Calculate the "Setback Days" for a potential purchase
 * This answers: "How many days does this purchase push back my freedom date?"
 * 
 * Formula breakdown:
 * 1. Setback Days = Purchase Amount / Daily Disposable Income
 * 2. Interest Accrued = (Target Balance × APR) × (Setback Days / 365)
 * 3. Opportunity Cost = Purchase Amount × Daily Opportunity Rate × Setback Days
 * 
 * @param input - The calculation parameters
 * @returns Complete setback analysis with recommendation
 */
export function calculateSetbackDays(
  input: SetbackCalculationInput
): SetbackCalculationResult {
  const {
    purchaseAmount,
    userDisposableIncome,
    targetLiabilityApr,
    targetLiabilityBalance,
    currentFreedomDate,
  } = input;

  // Validate inputs
  if (purchaseAmount.lessThanOrEqualTo(0)) {
    throw new Error('Purchase amount must be greater than 0');
  }

  if (userDisposableIncome.lessThanOrEqualTo(0)) {
    throw new Error('User has no disposable income to calculate setback');
  }

  // ============================================
  // STEP 1: Calculate Daily Disposable Income
  // ============================================
  const dailyDisposableIncome = userDisposableIncome.dividedBy(DAYS_PER_MONTH);

  // ============================================
  // STEP 2: Calculate Base Setback Days
  // ============================================
  // If you spend $300 and have $30/day disposable income, that's 10 days setback
  const setbackDays = purchaseAmount.dividedBy(dailyDisposableIncome);

  // ============================================
  // STEP 3: Calculate Interest Accrued During Setback
  // ============================================
  // The debt keeps growing while you're "set back"
  const dailyInterestRate = targetLiabilityApr.dividedBy(100).dividedBy(365);
  const dailyInterestAccrual = targetLiabilityBalance.times(dailyInterestRate);
  const interestAccruedDuringSetback = dailyInterestAccrual.times(setbackDays);

  // ============================================
  // STEP 4: Calculate Opportunity Cost
  // ============================================
  // What could that money have earned if invested instead?
  const opportunityCost = purchaseAmount
    .times(DAILY_OPPORTUNITY_RATE)
    .times(setbackDays);

  // ============================================
  // STEP 5: Calculate Freedom Date Impact
  // ============================================
  // The total impact includes the setback days PLUS the time to recover
  // the interest that accrued during the setback
  const interestRecoveryDays = interestAccruedDuringSetback
    .dividedBy(dailyDisposableIncome);
  
  const freedomDateImpact = setbackDays.plus(interestRecoveryDays);

  // ============================================
  // STEP 6: Generate Recommendation
  // ============================================
  const recommendedAction = generateRecommendation(
    setbackDays,
    targetLiabilityApr,
    purchaseAmount,
    userDisposableIncome
  );

  const warningMessage = generateWarningMessage(
    setbackDays,
    freedomDateImpact,
    targetLiabilityApr,
    recommendedAction
  );

  return {
    setbackDays: roundToTwoDecimals(setbackDays),
    freedomDateImpact: roundToTwoDecimals(freedomDateImpact),
    interestAccruedDuringSetback: roundToTwoDecimals(interestAccruedDuringSetback),
    opportunityCost: roundToTwoDecimals(opportunityCost),
    recommendedAction,
    warningMessage,
  };
}

// ============================================
// RECOMMENDATION ENGINE
// ============================================

/**
 * Generate a recommendation based on the setback analysis
 */
function generateRecommendation(
  setbackDays: Decimal,
  targetApr: Decimal,
  purchaseAmount: Decimal,
  disposableIncome: Decimal
): 'DECLINE' | 'APPROVE_WITH_WARNING' | 'APPROVE' {
  // Critical: High APR debt + significant setback = DECLINE
  if (targetApr.greaterThanOrEqualTo(HIGH_PRIORITY_APR_THRESHOLD)) {
    if (setbackDays.greaterThanOrEqualTo(CRITICAL_SETBACK_DAYS)) {
      return 'DECLINE';
    }
    if (setbackDays.greaterThanOrEqualTo(WARNING_SETBACK_DAYS)) {
      return 'APPROVE_WITH_WARNING';
    }
  }

  // Large purchase relative to income = WARNING
  const purchaseRatio = purchaseAmount.dividedBy(disposableIncome);
  if (purchaseRatio.greaterThanOrEqualTo(0.5)) { // More than 50% of monthly disposable
    return 'APPROVE_WITH_WARNING';
  }

  // Small setback on low APR debt = APPROVE
  if (setbackDays.lessThan(WARNING_SETBACK_DAYS) && targetApr.lessThan(15)) {
    return 'APPROVE';
  }

  // Default: Warning for anything else
  return 'APPROVE_WITH_WARNING';
}

// ============================================
// WARNING MESSAGE GENERATOR
// ============================================

/**
 * Generate a contextual warning message for the user
 */
function generateWarningMessage(
  setbackDays: Decimal,
  freedomDateImpact: Decimal,
  targetApr: Decimal,
  action: 'DECLINE' | 'APPROVE_WITH_WARNING' | 'APPROVE'
): string | undefined {
  if (action === 'APPROVE') {
    return undefined; // No warning needed
  }

  const daysNum = setbackDays.toNumber();
  const impactNum = freedomDateImpact.toNumber();
  const aprNum = targetApr.toNumber();

  if (action === 'DECLINE') {
    if (aprNum >= 20) {
      return `This purchase sets you back ${Math.round(impactNum)} days while your debt grows at ${aprNum}% APR. That's expensive money!`;
    }
    return `This purchase delays your freedom by ${Math.round(impactNum)} days. Is it worth it?`;
  }

  // APPROVE_WITH_WARNING
  if (daysNum >= 14) {
    return `This pushes your freedom date back by ${Math.round(impactNum)} days. Consider waiting 48 hours.`;
  }
  if (aprNum >= HIGH_PRIORITY_APR_THRESHOLD.toNumber()) {
    return `You have high-interest debt at ${aprNum}% APR. Every dollar counts!`;
  }
  return `This purchase sets you back ${Math.round(daysNum)} days of progress.`;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Round a Decimal to 2 decimal places
 */
function roundToTwoDecimals(value: Decimal): Decimal {
  return new Decimal(value.toFixed(2));
}

// ============================================
// BATCH CALCULATION FOR INTERVENTIONS
// ============================================

/**
 * Calculate setback for an intervention trigger
 * This is the main entry point for the Quick Draw system
 */
export interface InterventionSetbackInput {
  purchaseAmount: Decimal;
  user: {
    disposableIncome: Decimal;
    freedomDate: Date;
  };
  highestPriorityLiability: Liability | null;
}

export function calculateInterventionSetback(
  input: InterventionSetbackInput
): SetbackCalculationResult {
  const { purchaseAmount, user, highestPriorityLiability } = input;

  // If no high-priority liability, use default values
  const targetLiability = highestPriorityLiability || {
    apr: new Decimal(19.99),
    currentBalance: new Decimal(5000),
  } as Liability;

  return calculateSetbackDays({
    purchaseAmount,
    userDisposableIncome: user.disposableIncome,
    targetLiabilityApr: targetLiability.apr,
    targetLiabilityBalance: targetLiability.currentBalance,
    currentFreedomDate: user.freedomDate,
  });
}

// ============================================
// SIMULATION FUNCTION
// ============================================

/**
 * Simulate multiple purchase scenarios
 * Useful for "what if" analysis in the UI
 */
export interface PurchaseScenario {
  name: string;
  amount: Decimal;
}

export interface ScenarioResult extends SetbackCalculationResult {
  scenarioName: string;
  amount: Decimal;
}

export function simulatePurchaseScenarios(
  scenarios: PurchaseScenario[],
  input: Omit<SetbackCalculationInput, 'purchaseAmount'>
): ScenarioResult[] {
  return scenarios.map((scenario) => ({
    scenarioName: scenario.name,
    amount: scenario.amount,
    ...calculateSetbackDays({
      ...input,
      purchaseAmount: scenario.amount,
    }),
  }));
}

// ============================================
// EXAMPLE USAGE & TEST CASES
// ============================================

/**
 * Example test cases for the setback calculator
 */
export const TEST_CASES = {
  // User with $100/day disposable income, buying a $300 item
  // With 24.99% APR credit card debt
  coffeeShop: {
    purchaseAmount: new Decimal(6.50),
    userDisposableIncome: new Decimal(3000), // $100/day
    targetLiabilityApr: new Decimal(24.99),
    targetLiabilityBalance: new Decimal(5000),
    currentFreedomDate: new Date('2026-06-01'),
  },

  // Large purchase: $500 shoes
  luxuryPurchase: {
    purchaseAmount: new Decimal(500),
    userDisposableIncome: new Decimal(3000),
    targetLiabilityApr: new Decimal(24.99),
    targetLiabilityBalance: new Decimal(5000),
    currentFreedomDate: new Date('2026-06-01'),
  },

  // User with low APR debt (student loan)
  lowAprScenario: {
    purchaseAmount: new Decimal(100),
    userDisposableIncome: new Decimal(3000),
    targetLiabilityApr: new Decimal(5.5),
    targetLiabilityBalance: new Decimal(20000),
    currentFreedomDate: new Date('2028-01-01'),
  },
};

// Run tests if this file is executed directly
if (require.main === module) {
  console.log('=== On Track Setback Calculator Test ===\n');

  Object.entries(TEST_CASES).forEach(([name, testCase]) => {
    console.log(`\n--- Test Case: ${name} ---`);
    console.log(`Purchase: $${testCase.purchaseAmount}`);
    console.log(`Disposable Income: $${testCase.userDisposableIncome}/month`);
    console.log(`Target APR: ${testCase.targetLiabilityApr}%`);

    const result = calculateSetbackDays(testCase);

    console.log(`\nResults:`);
    console.log(`  Setback Days: ${result.setbackDays}`);
    console.log(`  Freedom Date Impact: ${result.freedomDateImpact} days`);
    console.log(`  Interest Accrued: $${result.interestAccruedDuringSetback}`);
    console.log(`  Opportunity Cost: $${result.opportunityCost}`);
    console.log(`  Recommendation: ${result.recommendedAction}`);
    console.log(`  Message: ${result.warningMessage}`);
  });
}
