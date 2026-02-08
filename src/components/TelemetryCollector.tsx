'use client';

import { useEffect, useRef, useCallback } from 'react';

interface Props {
  sessionId: string;
}

interface MouseEvent2 {
  x: number;
  y: number;
  t: number;
}

interface KeyEvent2 {
  key: string;
  t: number;
  duration: number;
}

export function TelemetryCollector({ sessionId }: Props) {
  const mouseEvents = useRef<MouseEvent2[]>([]);
  const clickEvents = useRef<MouseEvent2[]>([]);
  const keyEvents = useRef<KeyEvent2[]>([]);
  const scrollEvents = useRef<Array<{ y: number; t: number }>>([]);
  const keyDownTimes = useRef<Map<string, number>>(new Map());

  const flush = useCallback(async () => {
    const mouse = mouseEvents.current.splice(0);
    const clicks = clickEvents.current.splice(0);
    const keys = keyEvents.current.splice(0);
    const scrolls = scrollEvents.current.splice(0);

    if (mouse.length === 0 && clicks.length === 0 && keys.length === 0 && scrolls.length === 0) {
      return;
    }

    try {
      await fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          mouseEvents: mouse,
          clickEvents: clicks,
          keyEvents: keys,
          scrollEvents: scrolls,
        }),
      });
    } catch {
      // Silent fail
    }
  }, [sessionId]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Sample at ~10Hz to avoid flooding
      const last = mouseEvents.current[mouseEvents.current.length - 1];
      if (last && Date.now() - last.t < 100) return;
      mouseEvents.current.push({ x: e.clientX, y: e.clientY, t: Date.now() });
    };

    const handleClick = (e: MouseEvent) => {
      clickEvents.current.push({ x: e.clientX, y: e.clientY, t: Date.now() });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!keyDownTimes.current.has(e.key)) {
        keyDownTimes.current.set(e.key, Date.now());
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const downTime = keyDownTimes.current.get(e.key);
      if (downTime) {
        keyEvents.current.push({
          key: e.key.length === 1 ? '*' : e.key, // Don't log actual characters
          t: downTime,
          duration: Date.now() - downTime,
        });
        keyDownTimes.current.delete(e.key);
      }
    };

    const handleScroll = () => {
      const last = scrollEvents.current[scrollEvents.current.length - 1];
      if (last && Date.now() - last.t < 200) return;
      scrollEvents.current.push({ y: window.scrollY, t: Date.now() });
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('click', handleClick, { passive: true });
    document.addEventListener('keydown', handleKeyDown, { passive: true });
    document.addEventListener('keyup', handleKeyUp, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true });

    // Flush every 5 seconds
    const flushInterval = setInterval(flush, 5000);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('scroll', handleScroll);
      clearInterval(flushInterval);
      flush();
    };
  }, [flush]);

  return null;
}
