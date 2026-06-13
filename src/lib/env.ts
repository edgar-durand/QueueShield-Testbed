function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const env = {
  // Database
  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: optional('REDIS_URL', ''),

  // Security
  SESSION_SECRET: optional('SESSION_SECRET', 'change-me-in-production-please'),
  ADMIN_USERNAME: optional('ADMIN_USERNAME', 'admin'),
  ADMIN_PASSWORD: optional('ADMIN_PASSWORD', 'admin123'),

  // Queue
  QUEUE_PROCESS_INTERVAL_MS: parseInt(optional('QUEUE_PROCESS_INTERVAL_MS', '3000'), 10),
  QUEUE_BATCH_SIZE: parseInt(optional('QUEUE_BATCH_SIZE', '5'), 10),
  ACCESS_TOKEN_TTL_SECONDS: parseInt(optional('ACCESS_TOKEN_TTL_SECONDS', '120'), 10),

  // Risk thresholds
  RISK_THRESHOLD_LOW: parseInt(optional('RISK_THRESHOLD_LOW', '30'), 10),
  RISK_THRESHOLD_MEDIUM: parseInt(optional('RISK_THRESHOLD_MEDIUM', '60'), 10),
  RISK_THRESHOLD_HIGH: parseInt(optional('RISK_THRESHOLD_HIGH', '85'), 10),

  // reCAPTCHA v3 (free — https://www.google.com/recaptcha/admin)
  RECAPTCHA_SITE_KEY: optional('RECAPTCHA_SITE_KEY', ''),
  RECAPTCHA_SECRET_KEY: optional('RECAPTCHA_SECRET_KEY', ''),
  RECAPTCHA_SCORE_THRESHOLD: parseFloat(optional('RECAPTCHA_SCORE_THRESHOLD', '0.5')),

  // Proof of Work
  POW_DIFFICULTY: parseInt(optional('POW_DIFFICULTY', '18'), 10),
  POW_SECRET: optional('POW_SECRET', optional('SESSION_SECRET', 'change-me-in-production-please')),

  // Bot-detection enforcement: when true, /api/queue/join REQUIRES a valid
  // JS challenge and proof-of-work (defaults on in production).
  ENFORCE_CHALLENGES:
    optional('ENFORCE_CHALLENGES', optional('NODE_ENV', 'development') === 'production' ? 'true' : 'false') === 'true',

  // Number of additional trusted reverse proxies in front of the app.
  TRUSTED_PROXY_COUNT: Math.max(0, parseInt(optional('TRUSTED_PROXY_COUNT', '0'), 10)),

  // Node
  NODE_ENV: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
} as const;

const UNSAFE_SECRETS = new Set([
  '',
  'change-me',
  'change-me-in-production',
  'change-me-in-production-please',
  'pow-default-secret',
]);

/**
 * Resolve the session/signing secret, refusing to run with a default or weak
 * value in production. In development the legacy fallback is allowed.
 */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET || '';
  if (env.isProduction && (UNSAFE_SECRETS.has(secret) || secret.length < 32)) {
    throw new Error(
      'SESSION_SECRET must be set to a strong, non-default value (>= 32 chars) in production.',
    );
  }
  return secret || 'change-me-in-production-please';
}

/**
 * Fail fast on insecure configuration. Called at server startup.
 */
export function assertSecureConfig(): void {
  if (!env.isProduction) return;
  // Don't run at build time — only when actually serving requests.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  // Throws if the secret is unsafe.
  getSessionSecret();
  if ((process.env.ADMIN_PASSWORD || 'admin123') === 'admin123') {
    throw new Error('ADMIN_PASSWORD must be changed from its default in production.');
  }
}
