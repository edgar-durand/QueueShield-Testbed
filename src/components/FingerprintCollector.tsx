'use client';

import { useEffect, useRef } from 'react';

interface Props {
  sessionId: string;
}

export function FingerprintCollector({ sessionId }: Props) {
  const hasSent = useRef(false);

  useEffect(() => {
    if (hasSent.current) return;
    hasSent.current = true;

    const collectAndSend = async () => {
      try {
        const fp = await collectFingerprint();
        await fetch('/api/fingerprint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, ...fp }),
        });
      } catch {
        // Silent fail — fingerprint collection is best-effort
      }
    };

    // Delay slightly to not block initial render
    const timer = setTimeout(collectAndSend, 500);
    return () => clearTimeout(timer);
  }, [sessionId]);

  return null;
}

async function collectFingerprint() {
  const automationFlags: string[] = [];

  // WebDriver detection
  const webdriver = !!(navigator as any).webdriver;
  if (webdriver) automationFlags.push('navigator.webdriver');

  // Chrome-specific automation flags
  if ((window as any).chrome?.runtime === undefined && (window as any).chrome) {
    // Normal Chrome has chrome.runtime; headless may not
  }
  if ((document as any).__selenium_unwrapped) automationFlags.push('selenium_unwrapped');
  if ((document as any).__webdriver_evaluate) automationFlags.push('webdriver_evaluate');
  if ((document as any).__driver_evaluate) automationFlags.push('driver_evaluate');
  if ((window as any)._phantom) automationFlags.push('phantomjs');
  if ((window as any).__nightmare) automationFlags.push('nightmare');
  if ((window as any).callPhantom) automationFlags.push('callPhantom');
  if ((window as any).domAutomation) automationFlags.push('domAutomation');
  if ((window as any).domAutomationController) automationFlags.push('domAutomationController');

  // Permissions API check (headless often returns inconsistent results)
  // Notification permission in headless Chrome is often "denied" instantly
  let permissionInconsistency = false;
  try {
    const perm = await navigator.permissions.query({ name: 'notifications' as PermissionName });
    if (perm.state === 'denied' && Notification.permission === 'default') {
      permissionInconsistency = true;
      automationFlags.push('permission_inconsistency');
    }
  } catch {
    // Some browsers don't support this
  }

  // Canvas fingerprint
  let canvasHash = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('QueueShield fp', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('QueueShield fp', 4, 17);
      canvasHash = canvas.toDataURL().slice(-50);
    }
  } catch {
    canvasHash = 'error';
  }

  // WebGL fingerprint
  let webglVendor = '';
  let webglRenderer = '';
  try {
    const glCanvas = document.createElement('canvas');
    const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        webglVendor = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';
        webglRenderer = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
      }
    }
  } catch {
    // WebGL not available
  }

  // Browser attributes
  const plugins = navigator.plugins?.length || 0;
  const mimeTypes = navigator.mimeTypes?.length || 0;
  const hardwareConcurrency = navigator.hardwareConcurrency || 0;
  const deviceMemory = (navigator as any).deviceMemory || 0;
  const languages = Array.from(navigator.languages || []);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const screenResolution = `${screen.width}x${screen.height}`;
  const colorDepth = screen.colorDepth;
  const touchSupport = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Compute device hash for deduplication (client-side)
  const hashComponents = [
    canvasHash, webglVendor, webglRenderer, screenResolution,
    timezone, languages.join(','), String(hardwareConcurrency), String(colorDepth),
  ].join('|');
  let deviceHash = '';
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(hashComponents);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    deviceHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    deviceHash = '';
  }

  return {
    canvasHash,
    webglVendor,
    webglRenderer,
    plugins,
    mimeTypes,
    hardwareConcurrency,
    deviceMemory,
    languages,
    timezone,
    screenResolution,
    colorDepth,
    touchSupport,
    webdriver,
    automationFlags,
    permissionInconsistency,
    deviceHash,
  };
}
