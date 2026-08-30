/**
 * Trusted client-IP resolution.
 *
 * `x-forwarded-for` is fully attacker-controlled: a client can send any value,
 * and that value becomes a LEFT entry in the list. Only the right-most entries
 * are appended by proxies we actually control, so taking `xff[0]` (as the old
 * code did) lets an attacker spoof their IP to bypass rate limits and IP bans.
 *
 * We instead read the list from the right, skipping `TRUSTED_PROXY_COUNT`
 * additional trusted hops. Default 0 → use the right-most entry (set by the
 * edge proxy and not spoofable by the client).
 */

const TRUSTED_PROXY_COUNT = Math.max(0, parseInt(process.env.TRUSTED_PROXY_COUNT || '0', 10));

/**
 * Resolve the client IP from request headers, honoring the trusted-proxy count.
 * Accepts any Headers-like object (NextRequest.headers or next/headers result).
 */
export function getClientIp(
  headers: { get(name: string): string | null },
  fallbackIp?: string,
): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const ips = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (ips.length > 0) {
      const idx = ips.length - 1 - TRUSTED_PROXY_COUNT;
      return ips[Math.max(0, idx)];
    }
  }
  return headers.get('x-real-ip') || fallbackIp || '127.0.0.1';
}
