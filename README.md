# QueueShield Testbed

A production-ready security testing platform that simulates a web queue and ticket purchase system with multi-layered bot detection, rate limiting, JWT admin auth, and containerized deployment.

> **Disclaimer**: This platform is designed exclusively as a controlled testing environment for cybersecurity research and automation tool validation. Do not use it for malicious purposes or to attack third-party systems without authorization.

## Features

- **FIFO Queue** with Redis-backed real-time position tracking via SSE
- **SSR Waiting Room** rendered server-side with session tokens
- **Multi-layer Bot Detection**:
  - Level 1: Passive fingerprinting (headers, IP analysis, User-Agent patterns)
  - Level 2: Active fingerprinting (Canvas, WebGL, headless detection, automation flags)
  - Level 3: Behavioral analysis (mouse trajectory, keystroke timing, rage clicks)
  - Level 4: CAPTCHA challenges (custom shape/drag challenges + hCaptcha integration)
- **Admin Dashboard** with JWT authentication, real-time session monitoring, risk scores, ban/unban controls
- **Purchase Flow** with one-time access tokens and expiry validation
- **Security Hardening**:
  - Rate limiting (sliding window via Redis)
  - Secure headers (CSP, HSTS, X-Frame-Options, etc.)
  - Background queue processor with token expiry cleanup and session GC
  - Automatic ban for high-risk sessions, challenge enforcement for medium-risk
  - JWT admin auth (8h expiry)

## Quick Start (Development)

```bash
# 1. Copy env file
cp .env.example .env

# 2. Start infrastructure (PostgreSQL + Redis)
docker-compose up -d

# 3. Install dependencies
npm install

# 4. Generate Prisma client and push schema
npx prisma generate
npx prisma db push

# 5. Seed database with default event and detector configs
npm run db:seed

# 6. Start dev server
npm run dev
```

## Production Deployment (Docker)

```bash
# Build and run everything (app + PostgreSQL + Redis)
docker-compose -f docker-compose.prod.yml up -d --build

# Run migrations inside the app container
docker exec queueshield-app npx prisma db push
docker exec queueshield-app npx prisma db seed
```

## URLs

| Page | URL |
|---|---|
| Event Page | http://localhost:3000 |
| Waiting Room | http://localhost:3000/queue/[sessionId] |
| CAPTCHA Challenge | http://localhost:3000/challenge/[sessionId] |
| Purchase Page | http://localhost:3000/purchase/[token] |
| Admin Dashboard | http://localhost:3000/admin |

## Architecture

```
Client ──► Middleware (rate limit, headers) ──► API Routes
                                                  │
                ┌─────────────────────────────────┤
                │                                 │
          SSE Endpoint                     Queue Join API
           (position updates)           (passive fingerprint)
                │                                 │
                │                    ┌────────────┤
                │                    │            │
          QueueProcessor         BotDetector   SessionManager
         (background loop)      (4 layers)    (Prisma + Redis)
                │                    │            │
                └────────────────────┴────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
                PostgreSQL           Redis
              (persistence)     (queue + rate limit)
```

## Stack

- **Next.js 14** (App Router, SSR, Middleware)
- **PostgreSQL 16** (sessions, bot scores, telemetry, events)
- **Redis 7** (queue sorted sets, rate limiting, real-time state)
- **Prisma 5** (ORM + migrations)
- **Tailwind CSS** (UI styling)
- **Lucide Icons** (iconography)
- **jose** (JWT for admin auth)
- **Docker** (multi-stage build, standalone output)

## Environment Variables

Copy `.env.example` to `.env` and adjust:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://...` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6380` | Redis connection string |
| `SESSION_SECRET` | `change-me` | Secret for JWT signing (min 32 chars) |
| `ADMIN_USERNAME` | `admin` | Admin dashboard username |
| `ADMIN_PASSWORD` | `admin123` | Admin dashboard password |
| `QUEUE_BATCH_SIZE` | `5` | Users admitted per processing cycle |
| `QUEUE_PROCESS_INTERVAL_MS` | `3000` | Queue processing interval (ms) |
| `ACCESS_TOKEN_TTL_SECONDS` | `120` | Purchase token validity (seconds) |
| `RISK_THRESHOLD_LOW` | `30` | Score below this = low risk |
| `RISK_THRESHOLD_MEDIUM` | `60` | Score above this = challenge required |
| `RISK_THRESHOLD_HIGH` | `85` | Score above this = auto-ban |
| `HCAPTCHA_SITE_KEY` | — | hCaptcha site key (optional) |
| `HCAPTCHA_SECRET_KEY` | — | hCaptcha secret key (optional) |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/queue/join` | Join queue (rate limited: 5/min per IP) |
| `GET` | `/api/queue/sse?sessionId=` | SSE stream for queue position |
| `POST` | `/api/fingerprint` | Submit client fingerprint |
| `POST` | `/api/telemetry` | Submit behavioral telemetry |
| `POST` | `/api/purchase` | Complete purchase with access token |
| `POST` | `/api/captcha/verify` | Verify CAPTCHA response |
| `POST` | `/api/admin/login` | Get JWT token |
| `GET` | `/api/admin/sessions` | List sessions (JWT required) |
| `POST` | `/api/admin/sessions` | Ban/unban/remove session (JWT required) |

## npm Scripts

```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema to database
npm run db:studio    # Open Prisma Studio
npm run db:seed      # Seed database with defaults
```
