-- On Track - Initial Database Migration
-- PostgreSQL Schema for Fintech Application

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ENUM TYPES
-- ============================================

CREATE TYPE "CreditorType" AS ENUM (
  'CREDIT_CARD',
  'STUDENT_LOAN',
  'AUTO_LOAN',
  'PERSONAL_LOAN',
  'MORTGAGE',
  'COLLECTIONS',
  'OTHER'
);

CREATE TYPE "LiabilityStatus" AS ENUM (
  'ACTIVE',
  'CAPTURED',
  'PAID_OFF',
  'ERROR'
);

CREATE TYPE "InterventionDecision" AS ENUM (
  'APPROVED',
  'DECLINED',
  'PENDING',
  'EXPIRED'
);

CREATE TYPE "PaymentSource" AS ENUM (
  'INTERVENTION_SWEEP',
  'SCHEDULED',
  'MANUAL',
  'ROUND_UP'
);

CREATE TYPE "PaymentStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "TransactionClassification" AS ENUM (
  'INCOME',
  'FUNDAMENTAL_EXPENSE',
  'AUTOMATED_SAVINGS',
  'FUN_SPENDING',
  'DEBT_PAYMENT',
  'INVESTMENT',
  'TRANSFER',
  'UNKNOWN'
);

CREATE TYPE "AuditEventType" AS ENUM (
  'USER_LOGIN',
  'USER_LOGOUT',
  'USER_REGISTERED',
  'MFA_ENABLED',
  'MFA_DISABLED',
  'PLAID_LINKED',
  'LITHIC_CARD_CREATED',
  'INTERVENTION_TRIGGERED',
  'INTERVENTION_DECISION',
  'PAYMENT_INITIATED',
  'PAYMENT_COMPLETED',
  'PAYMENT_FAILED',
  'LIABILITY_ADDED',
  'LIABILITY_UPDATED',
  'LIABILITY_CAPTURED',
  'SETTINGS_CHANGED',
  'DATA_EXPORTED',
  'ADMIN_ACCESS'
);

-- ============================================
-- USERS TABLE
-- ============================================

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "email" TEXT NOT NULL,
  "nickname" TEXT,
  "monthlyNetIncome" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "fundamentalExpenses" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "automatedSavings" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "disposableIncome" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "freedomDate" TIMESTAMP(3),
  "plaidAccessToken" TEXT,
  "plaidItemId" TEXT,
  "plaidAccountId" TEXT,
  "lithicCardToken" TEXT,
  "lithicAccountToken" TEXT,
  "vopayCustomerId" TEXT,
  "vopayFundingSourceId" TEXT,
  "passwordHash" TEXT NOT NULL,
  "mfaSecret" TEXT,
  "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastLoginAt" TIMESTAMP(3),

  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_email_key" UNIQUE ("email")
);

-- Create indexes for users
CREATE INDEX "users_email_idx" ON "users"("email");
CREATE INDEX "users_plaidItemId_idx" ON "users"("plaidItemId");
CREATE INDEX "users_lithicCardToken_idx" ON "users"("lithicCardToken");

-- ============================================
-- LIABILITIES TABLE
-- ============================================

CREATE TABLE "liabilities" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "userId" UUID NOT NULL,
  "creditorName" TEXT NOT NULL,
  "creditorType" "CreditorType" NOT NULL DEFAULT 'OTHER',
  "currentBalance" DECIMAL(12, 2) NOT NULL,
  "originalBalance" DECIMAL(12, 2) NOT NULL,
  "apr" DECIMAL(5, 2) NOT NULL,
  "minimumPayment" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  "isHighPriority" BOOLEAN NOT NULL DEFAULT false,
  "priorityRank" INTEGER,
  "estimatedPayoffDate" TIMESTAMP(3),
  "totalInterestPaid" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "status" "LiabilityStatus" NOT NULL DEFAULT 'ACTIVE',
  "capturedAt" TIMESTAMP(3),
  "plaidAccountId" TEXT,
  "plaidLiabilityId" TEXT,
  "nickname" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "liabilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "liabilities_plaidLiabilityId_key" UNIQUE ("plaidLiabilityId")
);

-- Create indexes for liabilities
CREATE INDEX "liabilities_userId_idx" ON "liabilities"("userId");
CREATE INDEX "liabilities_userId_status_idx" ON "liabilities"("userId", "status");
CREATE INDEX "liabilities_userId_isHighPriority_idx" ON "liabilities"("userId", "isHighPriority");
CREATE INDEX "liabilities_userId_priorityRank_idx" ON "liabilities"("userId", "priorityRank");

-- Add foreign key constraint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_userId_fkey" 
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- INTERVENTIONS TABLE
-- ============================================

CREATE TABLE "interventions" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "userId" UUID NOT NULL,
  "originalAmount" DECIMAL(10, 2) NOT NULL,
  "merchantName" TEXT NOT NULL,
  "merchantCategory" TEXT,
  "decision" "InterventionDecision" NOT NULL DEFAULT 'PENDING',
  "decisionReason" TEXT,
  "setbackDays" DECIMAL(8, 2) NOT NULL,
  "freedomDateImpact" DECIMAL(8, 2) NOT NULL,
  "targetLiabilityId" UUID,
  "lithicTransactionToken" TEXT,
  "lithicDeclinedAt" TIMESTAMP(3),
  "vopayTransactionId" TEXT,
  "sweptAmount" DECIMAL(10, 2),
  "sweptAt" TIMESTAMP(3),
  "userRespondedAt" TIMESTAMP(3),
  "userResponseTimeMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "interventions_pkey" PRIMARY KEY ("id")
);

-- Create indexes for interventions
CREATE INDEX "interventions_userId_idx" ON "interventions"("userId");
CREATE INDEX "interventions_userId_decision_idx" ON "interventions"("userId", "decision");
CREATE INDEX "interventions_userId_createdAt_idx" ON "interventions"("userId", "createdAt");

-- Add foreign key constraints
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_userId_fkey" 
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "interventions" ADD CONSTRAINT "interventions_targetLiabilityId_fkey" 
  FOREIGN KEY ("targetLiabilityId") REFERENCES "liabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- PAYMENTS TABLE
-- ============================================

CREATE TABLE "payments" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "liabilityId" UUID NOT NULL,
  "amount" DECIMAL(10, 2) NOT NULL,
  "principalAmount" DECIMAL(10, 2) NOT NULL,
  "interestAmount" DECIMAL(10, 2) NOT NULL,
  "source" "PaymentSource" NOT NULL,
  "sourceReference" TEXT,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "processedAt" TIMESTAMP(3),
  "failedReason" TEXT,
  "vopayTransactionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- Create indexes for payments
CREATE INDEX "payments_liabilityId_idx" ON "payments"("liabilityId");
CREATE INDEX "payments_liabilityId_status_idx" ON "payments"("liabilityId", "status");
CREATE INDEX "payments_createdAt_idx" ON "payments"("createdAt");

-- Add foreign key constraint
ALTER TABLE "payments" ADD CONSTRAINT "payments_liabilityId_fkey" 
  FOREIGN KEY ("liabilityId") REFERENCES "liabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- TRANSACTIONS TABLE
-- ============================================

CREATE TABLE "transactions" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "userId" UUID NOT NULL,
  "plaidTransactionId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "amount" DECIMAL(10, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "date" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  "merchantName" TEXT,
  "category" TEXT[],
  "classification" "TransactionClassification",
  "isRecurring" BOOLEAN NOT NULL DEFAULT false,
  "city" TEXT,
  "region" TEXT,
  "country" TEXT,
  "pending" BOOLEAN NOT NULL DEFAULT false,
  "paymentChannel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transactions_plaidTransactionId_key" UNIQUE ("plaidTransactionId")
);

-- Create indexes for transactions
CREATE INDEX "transactions_userId_idx" ON "transactions"("userId");
CREATE INDEX "transactions_userId_date_idx" ON "transactions"("userId", "date");
CREATE INDEX "transactions_userId_classification_idx" ON "transactions"("userId", "classification");
CREATE INDEX "transactions_plaidTransactionId_idx" ON "transactions"("plaidTransactionId");

-- Add foreign key constraint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" 
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- AUDIT LOGS TABLE
-- ============================================

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "userId" UUID NOT NULL,
  "eventType" "AuditEventType" NOT NULL,
  "eventDescription" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "oldValues" JSONB,
  "newValues" JSONB,
  "success" BOOLEAN NOT NULL,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Create indexes for audit logs
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX "audit_logs_userId_eventType_idx" ON "audit_logs"("userId", "eventType");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- Add foreign key constraint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" 
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "liabilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interventions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

-- Create policies (users can only access their own data)
CREATE POLICY "users_isolation" ON "users"
  FOR ALL USING ("id" = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY "liabilities_isolation" ON "liabilities"
  FOR ALL USING ("userId" = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY "interventions_isolation" ON "interventions"
  FOR ALL USING ("userId" = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY "payments_isolation" ON "payments"
  FOR ALL USING ("liabilityId" IN (
    SELECT "id" FROM "liabilities" WHERE "userId" = current_setting('app.current_user_id', true)::UUID
  ));

CREATE POLICY "transactions_isolation" ON "transactions"
  FOR ALL USING ("userId" = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY "audit_logs_isolation" ON "audit_logs"
  FOR ALL USING ("userId" = current_setting('app.current_user_id', true)::UUID);
