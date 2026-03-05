// On Track - Lithic API Routes
// Quick Draw intervention system endpoints

import { Router, Request, Response } from 'express';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../server';
import {
  createInterventionCard,
  getCard,
  updateCardState,
  handleAuthorizationWebhook,
  handleUserDecision,
  simulateAuthorizationEvent,
  verifyWebhookSignature,
} from '../services/lithicService';
import { calculateInterventionSetback } from '../services/setbackCalculator';

const router = Router();

// ============================================
// CARD MANAGEMENT
// ============================================

/**
 * POST /api/lithic/cards
 * Create a new intervention card for the authenticated user
 */
router.post('/cards', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User not authenticated' },
      });
    }

    const { type, memo, spendLimit, spendLimitDuration } = req.body;

    const card = await createInterventionCard(userId, {
      type: type || 'MERCHANT_LOCKED',
      memo,
      spendLimit,
      spendLimitDuration: spendLimitDuration || 'MONTHLY',
    });

    res.status(201).json({
      success: true,
      data: card,
    });
  } catch (error) {
    console.error('Error creating card:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create card' },
    });
  }
});

/**
 * GET /api/lithic/cards/:token
 * Get card details
 */
router.get('/cards/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const card = await getCard(token);

    res.json({
      success: true,
      data: card,
    });
  } catch (error) {
    console.error('Error getting card:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get card details' },
    });
  }
});

/**
 * PATCH /api/lithic/cards/:token/state
 * Update card state (pause/unpause/close)
 */
router.patch('/cards/:token/state', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { state } = req.body;

    if (!['OPEN', 'PAUSED', 'CLOSED'].includes(state)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message: 'State must be OPEN, PAUSED, or CLOSED' },
      });
    }

    await updateCardState(token, state);

    res.json({
      success: true,
      message: `Card state updated to ${state}`,
    });
  } catch (error) {
    console.error('Error updating card state:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update card state' },
    });
  }
});

// ============================================
// WEBHOOK ENDPOINTS
// ============================================

/**
 * POST /api/lithic/webhooks/authorization
 * Lithic authorization webhook - CORE of Quick Draw system
 * This endpoint receives real-time transaction authorization requests
 */
router.post('/webhooks/authorization', async (req: Request, res: Response) => {
  try {
    // Verify webhook signature (production only)
    const signature = req.headers['x-lithic-signature'] as string;
    const payload = JSON.stringify(req.body);
    
    if (!verifyWebhookSignature(payload, signature, process.env.LITHIC_WEBHOOK_SECRET || '')) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' },
      });
    }

    const event = req.body;
    
    // Process the authorization
    const result = await handleAuthorizationWebhook(event);

    // Return decision to Lithic
    res.json({
      decision: result.decision,
      decline_reason: result.declineReason,
    });
  } catch (error) {
    console.error('Error processing authorization webhook:', error);
    // Fail open - approve if there's an error
    res.json({ decision: 'APPROVE' });
  }
});

// ============================================
// INTERVENTION MANAGEMENT
// ============================================

/**
 * GET /api/lithic/interventions
 * Get all interventions for the authenticated user
 */
router.get('/interventions', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User not authenticated' },
      });
    }

    const interventions = await prisma.intervention.findMany({
      where: { userId },
      include: {
        targetLiability: {
          select: {
            creditorName: true,
            apr: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: interventions,
    });
  } catch (error) {
    console.error('Error getting interventions:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get interventions' },
    });
  }
});

/**
 * POST /api/lithic/interventions/:id/decision
 * User makes a decision on a pending intervention
 */
router.post('/interventions/:id/decision', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User not authenticated' },
      });
    }

    const { id } = req.params;
    const { decision } = req.body;

    if (!['APPROVE', 'DECLINE'].includes(decision)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DECISION', message: 'Decision must be APPROVE or DECLINE' },
      });
    }

    await handleUserDecision(id, userId, decision);

    res.json({
      success: true,
      message: `Intervention ${decision.toLowerCase()}d successfully`,
    });
  } catch (error) {
    console.error('Error processing decision:', error);
    res.status(500).json({
      success: false,
      error: { 
        code: 'INTERNAL_ERROR', 
        message: error instanceof Error ? error.message : 'Failed to process decision' 
      },
    });
  }
});

/**
 * GET /api/lithic/interventions/pending
 * Get pending interventions that need user action
 */
router.get('/interventions/pending', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User not authenticated' },
      });
    }

    const interventions = await prisma.intervention.findMany({
      where: {
        userId,
        decision: 'PENDING',
      },
      include: {
        targetLiability: {
          select: {
            creditorName: true,
            apr: true,
            currentBalance: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: interventions,
    });
  } catch (error) {
    console.error('Error getting pending interventions:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get pending interventions' },
    });
  }
});

// ============================================
// SANDBOX TESTING ENDPOINTS
// ============================================

/**
 * POST /api/lithic/sandbox/simulate
 * Simulate a Lithic authorization event for testing
 * Only available in development/sandbox environments
 */
router.post('/sandbox/simulate', async (req: Request, res: Response) => {
  // Only allow in non-production environments
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Sandbox endpoints not available in production' },
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User not authenticated' },
      });
    }

    // Get user's Lithic card
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.lithicCardToken) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_CARD', message: 'User has no Lithic card linked' },
      });
    }

    const { amount, merchantName, merchantCategory } = req.body;

    // Create simulated event
    const event = simulateAuthorizationEvent(
      user.lithicCardToken,
      amount || 100,
      merchantName || 'Test Merchant',
      merchantCategory || '5812' // Restaurant
    );

    // Process the event
    const result = await handleAuthorizationWebhook(event);

    res.json({
      success: true,
      data: {
        simulatedEvent: event,
        decision: result.decision,
        declineReason: result.declineReason,
      },
    });
  } catch (error) {
    console.error('Error simulating authorization:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to simulate authorization' },
    });
  }
});

/**
 * POST /api/lithic/sandbox/test-setback
 * Test the setback calculation without triggering a real intervention
 */
router.post('/sandbox/test-setback', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Sandbox endpoints not available in production' },
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User not authenticated' },
      });
    }

    const { purchaseAmount } = req.body;

    // Get user with liabilities
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        liabilities: {
          where: {
            status: 'ACTIVE',
            isHighPriority: true,
          },
          orderBy: { apr: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    // Calculate setback
    const highestPriorityLiability = user.liabilities[0] || null;
    
    const setbackResult = calculateInterventionSetback({
      purchaseAmount: new Decimal(purchaseAmount),
      user: {
        disposableIncome: user.disposableIncome,
        freedomDate: user.freedomDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
      highestPriorityLiability,
    });

    res.json({
      success: true,
      data: {
        purchaseAmount,
        userDisposableIncome: user.disposableIncome,
        highestPriorityDebt: highestPriorityLiability ? {
          name: highestPriorityLiability.creditorName,
          apr: highestPriorityLiability.apr,
          balance: highestPriorityLiability.currentBalance,
        } : null,
        setbackAnalysis: setbackResult,
      },
    });
  } catch (error) {
    console.error('Error testing setback calculation:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to test setback calculation' },
    });
  }
});

export default router;
