import { NextRequest, NextResponse } from 'next/server';

const isDev = process.env.NODE_ENV !== 'production';

const SECURE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  ...(isDev ? {} : {
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com",
      "style-src 'self' 'unsafe-inline'",
      "frame-src https://www.google.com https://www.gstatic.com",
      "connect-src 'self' https://www.google.com",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
    ].join('; '),
  }),
};

// Simple in-memory rate limit for middleware (Redis-based limiter is used in API routes)
const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();
const MIDDLEWARE_RATE_LIMIT = 100; // requests per window
const MIDDLEWARE_WINDOW_MS = 60_000; // 1 minute

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    req.ip ||
    '127.0.0.1'
  );
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    ipRequestCounts.set(ip, { count: 1, resetAt: now + MIDDLEWARE_WINDOW_MS });
    return true;
  }

  entry.count++;
  if (entry.count > MIDDLEWARE_RATE_LIMIT) {
    return false;
  }
  return true;
}

// Periodic cleanup of stale entries (every 5 min)
if (typeof globalThis !== 'undefined') {
  const cleanup = () => {
    const now = Date.now();
    ipRequestCounts.forEach((entry, ip) => {
      if (now > entry.resetAt) ipRequestCounts.delete(ip);
    });
  };
  setInterval(cleanup, 300_000);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ip = getClientIp(req);

  // Skip static assets and internal Next.js routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg')
  ) {
    return NextResponse.next();
  }

  // Global rate limit
  if (!checkRateLimit(ip)) {
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests. Please slow down.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
          ...SECURE_HEADERS,
        },
      },
    );
  }

  // Admin routes: auth is handled by each API route via JWT/Basic validation.
  // Do NOT send WWW-Authenticate here — it triggers the browser's native dialog.

  // Apply secure headers to all responses
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(SECURE_HEADERS)) {
    response.headers.set(key, value);
  }

  // Add request ID for tracing
  const requestId = crypto.randomUUID();
  response.headers.set('X-Request-ID', requestId);

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
