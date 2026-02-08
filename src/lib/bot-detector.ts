import { SessionManager } from './session-manager';

interface HeaderAnalysis {
  score: number;
  flags: string[];
}

interface PassiveFingerprintResult {
  totalScore: number;
  details: Record<string, unknown>;
}

const KNOWN_BOT_UA_PATTERNS = [
  /headlesschrome/i,
  /phantomjs/i,
  /slimerjs/i,
  /selenium/i,
  /webdriver/i,
  /puppeteer/i,
  /playwright/i,
  /crawl/i,
  /bot\b/i,
  /spider/i,
];

const DATACENTER_ASN_KEYWORDS = [
  'amazon', 'aws', 'google cloud', 'microsoft azure', 'digitalocean',
  'linode', 'vultr', 'hetzner', 'ovh', 'cloudflare',
];

export class BotDetector {
  /**
   * Level 1: Passive fingerprinting — analyze request headers on the server side.
   */
  static analyzeHeaders(headers: Record<string, string>): HeaderAnalysis {
    const flags: string[] = [];
    let score = 0;

    const ua = headers['user-agent'] || '';

    // Check for known bot user agents
    for (const pattern of KNOWN_BOT_UA_PATTERNS) {
      if (pattern.test(ua)) {
        flags.push(`bot_ua_match: ${pattern.source}`);
        score += 40;
        break;
      }
    }

    // Missing common headers
    if (!headers['accept-language']) {
      flags.push('missing_accept_language');
      score += 15;
    }
    if (!headers['accept-encoding']) {
      flags.push('missing_accept_encoding');
      score += 10;
    }
    if (!headers['accept']) {
      flags.push('missing_accept');
      score += 10;
    }

    // Suspicious header order (automation tools often have different ordering)
    const headerKeys = Object.keys(headers).map(k => k.toLowerCase());
    const hostIndex = headerKeys.indexOf('host');
    const uaIndex = headerKeys.indexOf('user-agent');
    if (uaIndex >= 0 && hostIndex >= 0 && uaIndex < hostIndex) {
      flags.push('unusual_header_order');
      score += 8;
    }

    // Check for automation-related headers
    if (headers['sec-ch-ua'] && headers['sec-ch-ua'].includes('HeadlessChrome')) {
      flags.push('headless_chrome_hint');
      score += 35;
    }

    // Missing sec-fetch headers (modern browsers always send these)
    if (!headers['sec-fetch-mode'] && !headers['sec-fetch-site']) {
      flags.push('missing_sec_fetch_headers');
      score += 12;
    }

    // Check for empty or minimal user agent
    if (ua.length < 30) {
      flags.push('short_user_agent');
      score += 20;
    }

    return { score: Math.min(score, 100), flags };
  }

  /**
   * Perform full passive fingerprint analysis and record scores.
   */
  static async performPassiveAnalysis(
    sessionId: string,
    headers: Record<string, string>,
    ipAddress: string,
  ): Promise<PassiveFingerprintResult> {
    const headerAnalysis = this.analyzeHeaders(headers);

    // Record header analysis score
    await SessionManager.addBotScore(
      sessionId,
      'passive',
      'header_analysis',
      headerAnalysis.score,
      { flags: headerAnalysis.flags },
    );

    // IP analysis (basic — check for localhost/private ranges)
    const ipScore = this.analyzeIp(ipAddress);
    if (ipScore > 0) {
      await SessionManager.addBotScore(
        sessionId,
        'passive',
        'ip_analysis',
        ipScore,
        { ipAddress, reason: 'suspicious_ip_range' },
      );
    }

    const totalScore = Math.min(100, headerAnalysis.score + ipScore);

    return {
      totalScore,
      details: {
        headers: headerAnalysis,
        ip: { score: ipScore, address: ipAddress },
      },
    };
  }

  /**
   * Basic IP analysis — in production, integrate MaxMind/IPinfo.
   */
  static analyzeIp(ipAddress: string): number {
    // Private/localhost — not suspicious for testing
    if (
      ipAddress === '127.0.0.1' ||
      ipAddress === '::1' ||
      ipAddress.startsWith('192.168.') ||
      ipAddress.startsWith('10.') ||
      ipAddress.startsWith('172.')
    ) {
      return 0;
    }

    // In production, would check against datacenter IP ranges
    return 0;
  }

  /**
   * Level 2: Analyze active fingerprint data sent from client JavaScript.
   */
  static async analyzeActiveFingerprint(
    sessionId: string,
    data: {
      canvasHash?: string;
      webglVendor?: string;
      webglRenderer?: string;
      plugins?: number;
      mimeTypes?: number;
      hardwareConcurrency?: number;
      deviceMemory?: number;
      languages?: string[];
      timezone?: string;
      screenResolution?: string;
      colorDepth?: number;
      touchSupport?: boolean;
      webdriver?: boolean;
      automationFlags?: string[];
    },
  ): Promise<number> {
    let score = 0;
    const flags: string[] = [];

    // WebDriver flag — definitive bot signal
    if (data.webdriver) {
      flags.push('webdriver_detected');
      score += 50;
    }

    // Automation-specific flags
    if (data.automationFlags && data.automationFlags.length > 0) {
      flags.push(`automation_flags: ${data.automationFlags.join(', ')}`);
      score += Math.min(40, data.automationFlags.length * 15);
    }

    // Missing plugins (headless browsers typically have 0)
    if (data.plugins === 0) {
      flags.push('no_plugins');
      score += 15;
    }

    // Suspicious hardware values
    if (data.hardwareConcurrency && data.hardwareConcurrency > 32) {
      flags.push('unusual_cpu_count');
      score += 10;
    }

    // Missing device memory (not supported in all browsers, but suspicious if 0)
    if (data.deviceMemory === 0) {
      flags.push('no_device_memory');
      score += 10;
    }

    // No languages
    if (!data.languages || data.languages.length === 0) {
      flags.push('no_languages');
      score += 15;
    }

    // No touch support on mobile UA
    // (simplified check)

    score = Math.min(100, score);

    await SessionManager.addBotScore(sessionId, 'active', 'fingerprint', score, {
      flags,
      raw: data,
    });

    // Store fingerprint data
    await import('./db').then(({ prisma }) =>
      prisma.session.update({
        where: { id: sessionId },
        data: { activeFingerprint: data as any },
      }),
    );

    return score;
  }

  /**
   * Level 3: Analyze behavioral telemetry.
   */
  static async analyzeBehavior(
    sessionId: string,
    data: {
      mouseEvents?: Array<{ x: number; y: number; t: number }>;
      clickEvents?: Array<{ x: number; y: number; t: number }>;
      keyEvents?: Array<{ key: string; t: number; duration: number }>;
      scrollEvents?: Array<{ y: number; t: number }>;
    },
  ): Promise<number> {
    let score = 0;
    const flags: string[] = [];

    // Mouse movement analysis
    if (data.mouseEvents && data.mouseEvents.length > 5) {
      const mouseScore = this.analyzeMouseMovement(data.mouseEvents);
      if (mouseScore > 0) {
        flags.push('suspicious_mouse_patterns');
        score += mouseScore;
      }
    } else if (!data.mouseEvents || data.mouseEvents.length === 0) {
      // No mouse movement at all — very suspicious for a waiting page
      flags.push('no_mouse_movement');
      score += 25;
    }

    // Click analysis — rage clicks
    if (data.clickEvents && data.clickEvents.length > 3) {
      const clickScore = this.analyzeClicks(data.clickEvents);
      if (clickScore > 0) {
        flags.push('suspicious_click_patterns');
        score += clickScore;
      }
    }

    // Keyboard analysis
    if (data.keyEvents && data.keyEvents.length > 0) {
      const keyScore = this.analyzeKeystrokes(data.keyEvents);
      if (keyScore > 0) {
        flags.push('suspicious_keystroke_patterns');
        score += keyScore;
      }
    }

    score = Math.min(100, score);

    await SessionManager.addBotScore(sessionId, 'behavior', 'telemetry', score, {
      flags,
      eventCounts: {
        mouse: data.mouseEvents?.length || 0,
        clicks: data.clickEvents?.length || 0,
        keys: data.keyEvents?.length || 0,
        scrolls: data.scrollEvents?.length || 0,
      },
    });

    return score;
  }

  private static analyzeMouseMovement(events: Array<{ x: number; y: number; t: number }>): number {
    if (events.length < 3) return 0;

    // Calculate angles between consecutive movements
    const angles: number[] = [];
    for (let i = 2; i < events.length; i++) {
      const dx1 = events[i - 1].x - events[i - 2].x;
      const dy1 = events[i - 1].y - events[i - 2].y;
      const dx2 = events[i].x - events[i - 1].x;
      const dy2 = events[i].y - events[i - 1].y;
      const angle = Math.atan2(dy2, dx2) - Math.atan2(dy1, dx1);
      angles.push(angle);
    }

    // Check for too-straight movements (bots often move in perfect lines)
    const straightAngles = angles.filter(a => Math.abs(a) < 0.05).length;
    const straightRatio = straightAngles / angles.length;
    if (straightRatio > 0.8) return 30;

    // Check for uniform speed (bots often move at constant speed)
    const speeds: number[] = [];
    for (let i = 1; i < events.length; i++) {
      const dx = events[i].x - events[i - 1].x;
      const dy = events[i].y - events[i - 1].y;
      const dt = events[i].t - events[i - 1].t;
      if (dt > 0) speeds.push(Math.sqrt(dx * dx + dy * dy) / dt);
    }

    if (speeds.length > 2) {
      const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      const speedVariance = speeds.reduce((sum, s) => sum + Math.pow(s - avgSpeed, 2), 0) / speeds.length;
      // Very low variance = robotic movement
      if (speedVariance < 0.001 && avgSpeed > 0) return 25;
    }

    return 0;
  }

  private static analyzeClicks(events: Array<{ x: number; y: number; t: number }>): number {
    // Detect rage clicks (rapid clicks in same area)
    for (let i = 1; i < events.length; i++) {
      const dt = events[i].t - events[i - 1].t;
      const dx = Math.abs(events[i].x - events[i - 1].x);
      const dy = Math.abs(events[i].y - events[i - 1].y);

      // Rapid clicks within 5px radius
      if (dt < 100 && dx < 5 && dy < 5) {
        return 20;
      }
    }
    return 0;
  }

  private static analyzeKeystrokes(events: Array<{ key: string; t: number; duration: number }>): number {
    if (events.length < 3) return 0;

    // Check for uniform inter-key timing (bots type at constant speed)
    const intervals: number[] = [];
    for (let i = 1; i < events.length; i++) {
      intervals.push(events[i].t - events[i - 1].t);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;

    // Very uniform typing speed
    if (variance < 100 && avgInterval > 0) return 20;

    // Impossibly fast typing
    if (avgInterval < 20) return 30;

    return 0;
  }
}
