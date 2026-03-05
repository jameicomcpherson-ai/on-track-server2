# On Track - Backend API

A production-ready fintech backend built with **Node.js**, **TypeScript**, **Prisma**, and **PostgreSQL**. Features real-time transaction intervention via Lithic integration (the "Quick Draw" system).

## 🚀 Features

- **🔐 Authentication**: JWT-based auth with MFA support
- **💳 Plaid Integration**: Link bank accounts, fetch transactions & liabilities
- **⚡ Lithic Integration**: Real-time transaction authorization & intervention
- **📊 The "8% Engine"**: Automatic high-priority debt detection
- **🎯 Setback Calculator**: Calculate the true cost of purchases
- **📝 SOC2 Compliant**: Audit logging, encryption, tokenization
- **🧪 Sandbox Testing**: Test endpoints for development

## 📁 Project Structure

```
ontrack-backend/
├── prisma/
│   └── schema.prisma       # Database schema
├── src/
│   ├── config/             # Configuration files
│   ├── middleware/         # Express middleware
│   ├── routes/             # API routes
│   ├── services/           # Business logic
│   ├── types/              # TypeScript types
│   └── server.ts           # Entry point
├── .env.example            # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## 🛠️ Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Set Up Database

```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# (Optional) Open Prisma Studio
npm run db:studio
```

### 4. Start Development Server

```bash
npm run dev
```

## 📊 Database Schema

### Core Tables

| Table | Description |
|-------|-------------|
| `users` | User accounts with Plaid/Lithic tokens |
| `liabilities` | Debts with APR, balance, priority ranking |
| `interventions` | Quick Draw transaction interventions |
| `payments` | Debt payments (sweeps, scheduled, manual) |
| `transactions` | Plaid-synced transactions |
| `audit_logs` | SOC2-compliant audit trail |

## 🔌 API Endpoints

### Authentication
```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/mfa/setup
POST /api/auth/mfa/verify
```

### Users
```
GET    /api/users/me
PUT    /api/users/me
GET    /api/users/me/financial-profile
```

### Liabilities (Debts)
```
GET    /api/liabilities
POST   /api/liabilities
GET    /api/liabilities/:id
PUT    /api/liabilities/:id
DELETE /api/liabilities/:id
POST   /api/liabilities/:id/capture
GET    /api/liabilities/analysis
```

### Lithic (Quick Draw)
```
POST   /api/lithic/cards
GET    /api/lithic/cards/:token
PATCH  /api/lithic/cards/:token/state
GET    /api/lithic/interventions
GET    /api/lithic/interventions/pending
POST   /api/lithic/interventions/:id/decision
POST   /api/lithic/webhooks/authorization
```

### Sandbox (Development Only)
```
POST   /api/lithic/sandbox/simulate
POST   /api/lithic/sandbox/test-setback
```

### Plaid
```
POST   /api/plaid/link-token
POST   /api/plaid/exchange-token
GET    /api/plaid/accounts
GET    /api/plaid/transactions
GET    /api/plaid/liabilities
POST   /api/plaid/sync
```

## 🧮 The Setback Days Formula

```
Setback Days = Purchase Amount / (Disposable Income / 30.44)

Where:
- Disposable Income = Net Income - Fundamental Expenses - Automated Savings
- 30.44 = Average days per month

Additional calculations:
- Interest Accrued = (Target Balance × APR) × (Setback Days / 365)
- Opportunity Cost = Purchase Amount × 7% × (Setback Days / 365)
- Freedom Date Impact = Setback Days + Interest Recovery Days
```

## 🔐 Security

- **Encryption**: AES-256 for PII at rest
- **Transport**: TLS 1.2+ for all data in transit
- **Tokenization**: Plaid/Lithic tokens only - never store raw credentials
- **Rate Limiting**: 100 requests/15min per IP
- **Audit Logging**: All sensitive operations logged
- **MFA**: Optional TOTP-based multi-factor authentication

## 🧪 Testing

### Run Tests
```bash
npm test
```

### Test Setback Calculation (Sandbox)
```bash
curl -X POST http://localhost:3001/api/lithic/sandbox/test-setback \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"purchaseAmount": 150}'
```

### Simulate Lithic Authorization (Sandbox)
```bash
curl -X POST http://localhost:3001/api/lithic/sandbox/simulate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "merchantName": "Coffee Shop",
    "merchantCategory": "5812"
  }'
```

## 🚀 Deployment

### AWS Elastic Beanstalk

1. Create an Elastic Beanstalk environment
2. Set environment variables in EB console
3. Deploy:
```bash
eb init
eb create
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

## 📚 Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for JWT signing |
| `PLAID_CLIENT_ID` | Plaid API client ID |
| `PLAID_SECRET` | Plaid API secret |
| `LITHIC_API_KEY` | Lithic API key |
| `VOPAY_API_KEY` | VoPay API key |
| `ENCRYPTION_KEY` | 32-char key for PII encryption |

## 📝 License

MIT License - See LICENSE file

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

Built with 💙 by the On Track Team
