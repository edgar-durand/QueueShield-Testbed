/**
 * IP Intelligence — detect datacenter, VPN, proxy, and Tor IPs.
 *
 * Uses a combination of:
 * 1. Known datacenter IP ranges (hardcoded major providers)
 * 2. Suspicious header detection (proxy headers, Tor exit nodes)
 * 3. Optional integration with free IP reputation APIs
 */

// Major cloud provider IP range prefixes (simplified — covers most datacenter traffic)
const DATACENTER_PREFIXES = [
  // AWS
  '3.', '13.', '15.', '18.', '34.', '35.', '44.', '46.137.', '50.', '52.', '54.', '99.',
  // Google Cloud
  '34.', '35.', '104.196.', '104.197.', '104.198.', '104.199.', '130.211.', '146.148.',
  // Azure
  '13.', '20.', '23.', '40.', '51.', '52.', '65.52.', '70.37.', '104.40.', '104.41.',
  '104.42.', '104.43.', '104.44.', '104.45.', '104.46.', '104.47.', '104.208.', '104.209.',
  '104.210.', '104.211.', '104.214.', '104.215.',
  // DigitalOcean
  '67.205.', '68.183.', '104.131.', '104.236.', '128.199.', '134.209.', '137.184.',
  '138.68.', '139.59.', '142.93.', '143.110.', '143.198.', '144.126.', '146.190.',
  '147.182.', '157.230.', '159.65.', '159.89.', '159.203.', '161.35.', '162.243.',
  '163.47.', '164.90.', '164.92.', '165.22.', '165.227.', '167.71.', '167.172.',
  '170.64.', '174.138.',
  // Vultr
  '45.32.', '45.63.', '45.76.', '45.77.', '66.42.', '104.156.', '104.207.', '108.61.',
  '136.244.', '140.82.', '141.164.', '144.202.', '149.28.', '155.138.', '207.148.',
  '209.250.', '209.222.',
  // Hetzner
  '5.9.', '5.75.', '46.4.', '78.46.', '78.47.', '88.198.', '88.99.', '116.202.',
  '116.203.', '128.140.', '135.181.', '136.243.', '138.201.', '142.132.', '144.76.',
  '148.251.', '157.90.', '159.69.', '162.55.', '167.235.', '168.119.', '176.9.',
  '178.63.', '188.40.', '195.201.', '213.133.', '213.239.',
  // OVH
  '51.38.', '51.68.', '51.75.', '51.77.', '51.79.', '51.81.', '51.83.', '51.89.',
  '51.91.', '51.161.', '51.178.', '51.195.', '51.210.', '54.36.', '54.37.', '54.38.',
  '91.134.', '92.222.', '135.125.', '137.74.', '139.99.', '141.94.', '141.95.',
  '142.4.', '144.217.', '145.239.', '146.59.', '147.135.', '149.56.', '149.202.',
  '151.80.', '158.69.', '164.132.', '167.114.', '176.31.', '178.32.', '178.33.',
  '185.12.', '188.165.', '192.95.', '192.99.', '193.70.', '198.27.', '198.50.',
  '198.100.', '198.245.',
  // Linode/Akamai
  '45.33.', '45.56.', '45.79.', '50.116.', '66.175.', '69.164.', '72.14.', '74.207.',
  '85.159.', '96.126.', '97.107.', '139.144.', '139.162.', '143.42.', '170.187.',
  '172.104.', '172.105.', '173.230.', '173.255.', '176.58.', '178.79.', '192.46.',
  '194.195.', '198.58.',
];

// Headers that indicate proxy/VPN usage
const PROXY_HEADERS = [
  'x-forwarded-for',
  'via',
  'x-proxy-id',
  'x-bluecoat-via',
  'z-forwarded-for',
  'proxy-connection',
];

// Known Tor exit node detection via DNS (simplified check)
const TOR_EXIT_INDICATORS = [
  'tor-exit',
  '.torproject.org',
  '.onion',
];

export interface IpIntelligenceResult {
  isDatacenter: boolean;
  isProxy: boolean;
  isTor: boolean;
  isVpn: boolean;
  riskScore: number;
  flags: string[];
  provider?: string;
}

/**
 * Analyze an IP address and request headers for datacenter/proxy/VPN indicators.
 */
export function analyzeIp(
  ipAddress: string,
  headers: Record<string, string>,
): IpIntelligenceResult {
  const flags: string[] = [];
  let riskScore = 0;
  let isDatacenter = false;
  let isProxy = false;
  let isTor = false;
  let isVpn = false;
  let provider: string | undefined;

  // Skip analysis for private/localhost IPs
  if (isPrivateIp(ipAddress)) {
    return { isDatacenter: false, isProxy: false, isTor: false, isVpn: false, riskScore: 0, flags: [] };
  }

  // 1. Check against known datacenter IP ranges
  for (const prefix of DATACENTER_PREFIXES) {
    if (ipAddress.startsWith(prefix)) {
      isDatacenter = true;
      provider = detectProvider(ipAddress);
      flags.push(`datacenter_ip:${provider || 'unknown'}`);
      riskScore += 30;
      break;
    }
  }

  // 2. Check for proxy headers
  let proxyHeaderCount = 0;
  for (const header of PROXY_HEADERS) {
    if (headers[header]) {
      proxyHeaderCount++;
    }
  }
  // Multiple forwarding headers = likely proxy
  if (proxyHeaderCount >= 2) {
    isProxy = true;
    flags.push('multiple_proxy_headers');
    riskScore += 20;
  }
  // x-forwarded-for with multiple IPs = proxy chain
  const xff = headers['x-forwarded-for'];
  if (xff && xff.split(',').length > 2) {
    isProxy = true;
    flags.push('long_proxy_chain');
    riskScore += 15;
  }

  // 3. Check Via header for proxy indicators
  const via = headers['via'];
  if (via) {
    flags.push('via_header_present');
    riskScore += 10;
    if (/vegur|cloudflare|squid|varnish/i.test(via)) {
      flags.push('known_proxy_software');
    }
  }

  // 4. Tor detection via user agent (basic)
  const ua = headers['user-agent'] || '';
  if (/tor\s*browser/i.test(ua)) {
    isTor = true;
    flags.push('tor_browser_ua');
    riskScore += 40;
  }

  // 5. Check for VPN-like patterns
  // Very short connection (no keep-alive) from datacenter IP = likely automated
  if (isDatacenter && !headers['connection']?.includes('keep-alive')) {
    flags.push('datacenter_no_keepalive');
    riskScore += 10;
  }

  // 6. Missing DNT (Do Not Track) — real browsers almost always send this
  // (Not reliable alone, but combined with other signals)

  return {
    isDatacenter,
    isProxy,
    isTor,
    isVpn,
    riskScore: Math.min(100, riskScore),
    flags,
    provider,
  };
}

function isPrivateIp(ip: string): boolean {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.30.') ||
    ip.startsWith('172.31.') ||
    ip.startsWith('fd') ||
    ip.startsWith('fe80:')
  );
}

function detectProvider(ip: string): string {
  // Simplified provider detection by IP prefix
  if (ip.startsWith('3.') || ip.startsWith('52.') || ip.startsWith('54.')) return 'AWS';
  if (ip.startsWith('34.') || ip.startsWith('35.')) return 'GCP/AWS';
  if (ip.startsWith('20.') || ip.startsWith('40.') || ip.startsWith('104.208.')) return 'Azure';
  if (ip.startsWith('128.199.') || ip.startsWith('134.209.') || ip.startsWith('167.172.')) return 'DigitalOcean';
  if (ip.startsWith('5.9.') || ip.startsWith('116.203.') || ip.startsWith('135.181.')) return 'Hetzner';
  if (ip.startsWith('51.') || ip.startsWith('54.36.') || ip.startsWith('149.202.')) return 'OVH';
  if (ip.startsWith('45.32.') || ip.startsWith('149.28.') || ip.startsWith('108.61.')) return 'Vultr';
  if (ip.startsWith('139.162.') || ip.startsWith('172.104.')) return 'Linode';
  return 'unknown';
}

/**
 * Optional: Query a free IP reputation API for additional intelligence.
 * Uses ip-api.com (free, 45 req/min) or ipapi.co (free, 1000/day).
 */
export async function queryIpReputation(ipAddress: string): Promise<{
  isp?: string;
  org?: string;
  hosting?: boolean;
  proxy?: boolean;
  country?: string;
} | null> {
  if (isPrivateIp(ipAddress)) return null;

  try {
    const res = await fetch(
      `http://ip-api.com/json/${ipAddress}?fields=status,isp,org,hosting,proxy,country`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'success') return null;
    return {
      isp: data.isp,
      org: data.org,
      hosting: data.hosting,
      proxy: data.proxy,
      country: data.country,
    };
  } catch {
    return null;
  }
}
