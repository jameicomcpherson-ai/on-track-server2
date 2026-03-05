// On Track - Authentication Routes
// JWT-based auth with MFA support

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { prisma } from '../server';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';

const router = Router();
const SALT_ROUNDS = 12;

// ============================================
// REGISTRATION
// ============================================

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, nickname, monthlyNetIncome, fundamentalExpenses } = req.body;

    // Validate required fields
    if (!email || !password) {
      throw new ApiError(400, 'MISSING_FIELDS', 'Email and password are required');
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ApiError(409, 'EMAIL_EXISTS', 'An account with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Calculate disposable income
    const disposableIncome = monthlyNetIncome && fundamentalExpenses
      ? new (require('@prisma/client/runtime/library').Decimal)(monthlyNetIncome)
          .minus(new (require('@prisma/client/runtime/library').Decimal)(fundamentalExpenses))
      : new (require('@prisma/client/runtime/library').Decimal)(0);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        nickname,
        monthlyNetIncome: monthlyNetIncome ? new (require('@prisma/client/runtime/library').Decimal)(monthlyNetIncome) : new (require('@prisma/client/runtime/library').Decimal)(0),
        fundamentalExpenses: fundamentalExpenses ? new (require('@prisma/client/runtime/library').Decimal)(fundamentalExpenses) : new (require('@prisma/client/runtime/library').Decimal)(0),
        disposableIncome,
      },
      select: {
        id: true,
        email: true,
        nickname: true,
        createdAt: true,
      },
    });

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
    });
    const refreshToken = generateRefreshToken(user.id);

    // Log registration
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        eventType: 'USER_REGISTERED',
        eventDescription: 'User registered successfully',
        success: true,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      data: {
        user,
        accessToken,
        refreshToken,
        mfaRequired: false,
      },
    });
  } catch (error) {
    throw error;
  }
});

// ============================================
// LOGIN
// ============================================

/**
 * POST /api/auth/login
 * Authenticate user and return tokens
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, mfaCode } = req.body;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Check if MFA is required
    if (user.mfaEnabled) {
      if (!mfaCode) {
        return res.json({
          success: true,
          mfaRequired: true,
          message: 'MFA code required',
        });
      }

      // Verify MFA code
      const isMfaValid = speakeasy.totp.verify({
        secret: user.mfaSecret || '',
        encoding: 'base32',
        token: mfaCode,
        window: 1,
      });

      if (!isMfaValid) {
        throw new ApiError(401, 'INVALID_MFA', 'Invalid MFA code');
      }
    }

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
    });
    const refreshToken = generateRefreshToken(user.id);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Log login
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        eventType: 'USER_LOGIN',
        eventDescription: 'User logged in successfully',
        success: true,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          nickname: user.nickname,
          mfaEnabled: user.mfaEnabled,
        },
        accessToken,
        refreshToken,
        mfaRequired: false,
      },
    });
  } catch (error) {
    throw error;
  }
});

// ============================================
// TOKEN REFRESH
// ============================================

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new ApiError(401, 'MISSING_TOKEN', 'Refresh token is required');
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      throw new ApiError(401, 'INVALID_TOKEN', 'Invalid refresh token');
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
    });
    const newRefreshToken = generateRefreshToken(user.id);

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    throw new ApiError(401, 'INVALID_TOKEN', 'Invalid or expired refresh token');
  }
});

// ============================================
// MFA SETUP
// ============================================

/**
 * POST /api/auth/mfa/setup
 * Setup MFA for the authenticated user
 */
router.post('/mfa/setup', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'UNAUTHORIZED', 'User not authenticated');
    }

    // Generate MFA secret
    const secret = speakeasy.generateSecret({
      name: `On Track:${req.user?.email}`,
      length: 32,
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url || '');

    // Temporarily store secret (will be confirmed in verify step)
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: secret.base32 },
    });

    res.json({
      success: true,
      data: {
        secret: secret.base32,
        qrCode: qrCodeUrl,
      },
    });
  } catch (error) {
    throw error;
  }
});

/**
 * POST /api/auth/mfa/verify
 * Verify MFA code and enable MFA
 */
router.post('/mfa/verify', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'UNAUTHORIZED', 'User not authenticated');
    }

    const { code } = req.body;

    if (!code) {
      throw new ApiError(400, 'MISSING_CODE', 'MFA code is required');
    }

    // Get user's MFA secret
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true },
    });

    if (!user?.mfaSecret) {
      throw new ApiError(400, 'MFA_NOT_SETUP', 'MFA not set up');
    }

    // Verify code
    const isValid = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!isValid) {
      throw new ApiError(400, 'INVALID_CODE', 'Invalid MFA code');
    }

    // Enable MFA
    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    // Log MFA enable
    await prisma.auditLog.create({
      data: {
        userId,
        eventType: 'MFA_ENABLED',
        eventDescription: 'MFA enabled successfully',
        success: true,
      },
    });

    res.json({
      success: true,
      message: 'MFA enabled successfully',
    });
  } catch (error) {
    throw error;
  }
});

/**
 * POST /api/auth/mfa/disable
 * Disable MFA for the authenticated user
 */
router.post('/mfa/disable', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'UNAUTHORIZED', 'User not authenticated');
    }

    const { code } = req.body;

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true },
    });

    if (!user?.mfaEnabled) {
      throw new ApiError(400, 'MFA_NOT_ENABLED', 'MFA is not enabled');
    }

    // Verify code before disabling
    const isValid = speakeasy.totp.verify({
      secret: user.mfaSecret || '',
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!isValid) {
      throw new ApiError(400, 'INVALID_CODE', 'Invalid MFA code');
    }

    // Disable MFA
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
      },
    });

    // Log MFA disable
    await prisma.auditLog.create({
      data: {
        userId,
        eventType: 'MFA_DISABLED',
        eventDescription: 'MFA disabled',
        success: true,
      },
    });

    res.json({
      success: true,
      message: 'MFA disabled successfully',
    });
  } catch (error) {
    throw error;
  }
});

export default router;
