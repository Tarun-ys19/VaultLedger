# Production Deployment Guide

This guide details the deployment procedures, environment configuration, database management, and third-party provider setup for running NeoBank in production environments.

---

## Deployment Options

NeoBank is built with Next.js 16 and standard PostgreSQL. It can be deployed to:

1. **Vercel** (Recommended for serverless hosting)
2. **Node.js Containers / Docker** (AWS ECS, Google Cloud Run, Fly.io, Railway)
3. **Self-Hosted Linux Servers** (PM2, systemd, or custom reverse proxies)

---

## 1. Environment Configuration

Configure the following environment variables in your hosting environment:

### Core Database Settings

| Variable | Description | Example / Notes |
|---|---|---|
| `DATABASE_URL` | Transaction connection string for the application | `postgresql://user:pass@host:6543/postgres?pgbouncer=true` (Port 6543 with PgBouncer) |
| `DIRECT_URL` | Direct session connection string for migrations and DDL | `postgresql://user:pass@host:5432/postgres` (Port 5432 session pooler or direct host) |

> **Important**: When using Supabase or PgBouncer, `DATABASE_URL` must connect through the transaction pooler with `?pgbouncer=true`. `DIRECT_URL` must point to the session pooler or direct host on port 5432 so Prisma Migrate can execute DDL and advisory locks.

### Authentication & API (Supabase)

| Variable | Description | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | Client-side and server-side Supabase client initialization |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anonymous API key | Public auth sessions and token refresh in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Secret | Administrative account operations (server-side only) |

### Application URL

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_APP_URL` | The canonical public URL of the deployed application (e.g. `https://bank.example.com`). Used for OAuth redirects and webhook callback URLs. |

### Scheduled Maintenance

| Variable | Description |
|---|---|
| `CRON_SECRET` | Secret token used to authorize requests to `/api/cron/keepalive`. Generate with `openssl rand -hex 32`. |

### Stripe Configuration (KYC & Virtual Cards)

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API Secret Key (`sk_live_...` or `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Fallback webhook signing secret |
| `STRIPE_IDENTITY_WEBHOOK_SECRET` | Dedicated signing secret for Stripe Identity verification webhooks |
| `STRIPE_ISSUING_WEBHOOK_SECRET` | Dedicated signing secret for Stripe Issuing card webhooks |

### Plaid Configuration (Bank Linking & ACH)

| Variable | Description |
|---|---|
| `PLAID_CLIENT_ID` | Plaid Client ID from the Plaid dashboard |
| `PLAID_SECRET` | Plaid Secret corresponding to the active environment |
| `PLAID_ENV` | `sandbox`, `development`, or `production` |

### Transfer Risk Limits (Optional Overrides)

| Variable | Default | Description |
|---|---|---|
| `MAX_TRANSFER_AMOUNT` | `10000` | Maximum transfer limit per transaction (whole USD) |
| `DAILY_TRANSFER_LIMIT` | `25000` | Rolling 24-hour transfer volume cap per user |
| `PENDING_REVIEW_THRESHOLD` | `5000` | Amount at or above which transfers require admin review |

---

## 2. Database Migration & Initialization

### Run Database Migrations

Apply committed Prisma migrations to the production database:

```bash
pnpm exec prisma migrate deploy
```

This applies:
1. `0_init`: Primary tables and PostgreSQL `CHECK` constraints (enforcing non-negative balances and dual-ownership rules).
2. `..._row_level_security`: Revokes anonymous access to application tables and enables Row-Level Security.
3. `..._demo_accounts`: Schema enhancements for system and house accounts.

### Initialize System House Accounts

Ensure essential system counterparty accounts (`ACH_SETTLEMENT`, `CARD_SETTLEMENT`) are created in the database:

```bash
pnpm seed
```

The seed script creates the required house settlement accounts and verifies that total ledger balances sum to zero.

---

## 3. Webhook Configuration

### Stripe Webhooks

Create two separate webhook endpoints in the Stripe Dashboard (**Developers > Webhooks**):

1. **Identity Webhook**:
   - URL: `https://[YOUR_DOMAIN]/api/webhooks/stripe-identity`
   - Events to listen for:
     - `identity.verification_session.verified`
     - `identity.verification_session.requires_input`
   - Save the signing secret into `STRIPE_IDENTITY_WEBHOOK_SECRET`.

2. **Issuing Webhook**:
   - URL: `https://[YOUR_DOMAIN]/api/webhooks/stripe-issuing`
   - Events to listen for:
     - `issuing_authorization.request`
     - `issuing_authorization.created`
     - `issuing_authorization.updated`
     - `issuing_transaction.created`
   - Save the signing secret into `STRIPE_ISSUING_WEBHOOK_SECRET`.

### Plaid Webhooks

Plaid webhooks are configured dynamically when link tokens are generated via `NEXT_PUBLIC_APP_URL/api/webhooks/plaid`.

- Plaid signs webhooks using an ES256 JSON Web Token in the `Plaid-Verification` header.
- The application automatically verifies webhook authenticity against Plaid's public key store (JWKS). No manual webhook secret is required.

---

## 4. Scheduled Database Keep-Alive

If running against a Supabase free-tier project or using pause-enabled database hosting, configure a daily HTTP trigger to prevent database pausing:

- **Endpoint**: `GET /api/cron/keepalive`
- **Header**: `Authorization: Bearer <CRON_SECRET>`

For Vercel deployments, this is pre-configured via `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/keepalive",
      "schedule": "0 4 * * *"
    }
  ]
}
```

---

## 5. Security & Production Checklist

- [ ] **Enforce HTTPS**: Ensure all traffic is encrypted with TLS/SSL.
- [ ] **Configure CORS & Headers**: Restrict API access to trusted origins.
- [ ] **Verify Database RLS**: Confirm `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated` was applied.
- [ ] **Keep Service Keys Secret**: Never expose `SUPABASE_SERVICE_ROLE_KEY` or `STRIPE_SECRET_KEY` on the client.
- [ ] **Set Proper Transfer Limits**: Calibrate `MAX_TRANSFER_AMOUNT` and `PENDING_REVIEW_THRESHOLD` according to institutional risk tolerance.
- [ ] **Admin Account Designation**: Designate admin accounts using direct database SQL (`UPDATE "User" SET "isAdmin" = true WHERE email = 'admin@example.com';`).

