/**
 * Google reCAPTCHA v3 server-side verification.
 * Free tier: 1M assessments/month.
 * Score: 1.0 = very likely human, 0.0 = very likely bot.
 */

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

export interface RecaptchaResult {
  success: boolean;
  score: number;
  action: string;
  hostname: string;
  errorCodes: string[];
}

/**
 * Verify a reCAPTCHA v3 token server-side.
 * Returns the score (0.0-1.0) and success status.
 */
export async function verifyRecaptcha(
  token: string,
  expectedAction?: string,
): Promise<RecaptchaResult> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;

  if (!secret) {
    console.warn('[reCAPTCHA] RECAPTCHA_SECRET_KEY not set — skipping verification');
    return { success: true, score: 0.5, action: '', hostname: '', errorCodes: [] };
  }

  try {
    const res = await fetch(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });

    const data = await res.json() as {
      success: boolean;
      score?: number;
      action?: string;
      hostname?: string;
      'error-codes'?: string[];
      challenge_ts?: string;
    };

    const result: RecaptchaResult = {
      success: data.success === true,
      score: data.score ?? 0,
      action: data.action ?? '',
      hostname: data.hostname ?? '',
      errorCodes: data['error-codes'] ?? [],
    };

    // Validate action matches expected
    if (expectedAction && result.action !== expectedAction) {
      result.success = false;
      result.errorCodes.push('action-mismatch');
    }

    return result;
  } catch (err) {
    console.error('[reCAPTCHA] Verification failed:', err);
    return { success: false, score: 0, action: '', hostname: '', errorCodes: ['network-error'] };
  }
}

/**
 * Convert reCAPTCHA score to a bot risk score (0-100).
 * reCAPTCHA: 1.0=human, 0.0=bot → invert and scale.
 */
export function recaptchaScoreToRisk(recaptchaScore: number): number {
  // 0.9+ = very human → risk 0-5
  // 0.7-0.9 = likely human → risk 5-20
  // 0.5-0.7 = ambiguous → risk 20-40
  // 0.3-0.5 = suspicious → risk 40-70
  // 0.0-0.3 = likely bot → risk 70-100
  return Math.round(Math.max(0, Math.min(100, (1 - recaptchaScore) * 100)));
}
