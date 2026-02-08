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
  REDIS_URL: optional('REDIS_URL', 'redis://localhost:6380'),

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

  // Node
  NODE_ENV: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
} as const;
