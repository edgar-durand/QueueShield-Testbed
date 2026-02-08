'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle, XCircle, MousePointer } from 'lucide-react';

interface Props {
  sessionId: string;
}

type ChallengeType = 'recaptcha' | 'custom_drag' | 'custom_click';

export function CaptchaChallenge({ sessionId }: Props) {
  const [status, setStatus] = useState<'pending' | 'verifying' | 'passed' | 'failed'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [challengeType] = useState<ChallengeType>('custom_click');
  const router = useRouter();

  const verify = async (response: string, type: ChallengeType) => {
    setStatus('verifying');
    setError(null);

    try {
      const res = await fetch('/api/captcha/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, response, type }),
      });

      const data = await res.json();

      if (data.passed) {
        setStatus('passed');
        setTimeout(() => {
          router.push(`/queue/${sessionId}`);
        }, 1500);
      } else {
        setStatus('failed');
        setError(data.error || 'Verification failed. Try again.');
        setTimeout(() => setStatus('pending'), 2000);
      }
    } catch {
      setStatus('failed');
      setError('Network error. Please try again.');
      setTimeout(() => setStatus('pending'), 2000);
    }
  };

  if (status === 'passed') {
    return (
      <div className="text-center py-8 animate-fade-in">
        <CheckCircle className="w-16 h-16 text-success-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Verified!</h2>
        <p className="text-slate-500">Returning to queue...</p>
      </div>
    );
  }

  if (status === 'verifying') {
    return (
      <div className="text-center py-8 animate-fade-in">
        <Loader2 className="w-10 h-10 text-brand-500 animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Verifying...</p>
      </div>
    );
  }

  return (
    <div>
      {challengeType === 'custom_click' && (
        <ClickChallenge onComplete={(response) => verify(response, 'custom_click')} />
      )}
      {challengeType === 'custom_drag' && (
        <DragChallenge onComplete={(response) => verify(response, 'custom_drag')} />
      )}

      {status === 'failed' && error && (
        <div className="mt-4 flex items-center gap-2 text-danger-600 text-sm justify-center animate-fade-in">
          <XCircle className="w-4 h-4" />
          {error}
        </div>
      )}
    </div>
  );
}

// Custom challenge: click the element that is NOT a square
function ClickChallenge({ onComplete }: { onComplete: (response: string) => void }) {
  const [shapes, setShapes] = useState<Array<{ id: number; type: string; color: string }>>([]);
  const [targetId, setTargetId] = useState<number>(-1);
  const startTime = useRef(Date.now());

  useEffect(() => {
    const colors = ['#4c6ef5', '#f03e3e', '#37b24d', '#fab005', '#7950f2', '#e64980'];
    const allShapes = [];
    // Generate 5 squares and 1 non-square
    const targetIndex = Math.floor(Math.random() * 6);
    const nonSquareTypes = ['circle', 'triangle', 'diamond', 'hexagon'];
    const chosenNonSquare = nonSquareTypes[Math.floor(Math.random() * nonSquareTypes.length)];

    for (let i = 0; i < 6; i++) {
      allShapes.push({
        id: i,
        type: i === targetIndex ? chosenNonSquare : 'square',
        color: colors[i % colors.length],
      });
    }
    setShapes(allShapes);
    setTargetId(targetIndex);
    startTime.current = Date.now();
  }, []);

  const handleClick = (id: number) => {
    const elapsed = Date.now() - startTime.current;
    const response = JSON.stringify({
      clickedId: id,
      correctId: targetId,
      correct: id === targetId,
      elapsed,
      timestamp: Date.now(),
    });
    onComplete(response);
  };

  const renderShape = (shape: { id: number; type: string; color: string }) => {
    const base = 'w-16 h-16 cursor-pointer transition-transform hover:scale-110 active:scale-95';
    switch (shape.type) {
      case 'circle':
        return (
          <div
            key={shape.id}
            onClick={() => handleClick(shape.id)}
            className={base}
            style={{ backgroundColor: shape.color, borderRadius: '50%' }}
          />
        );
      case 'triangle':
        return (
          <div
            key={shape.id}
            onClick={() => handleClick(shape.id)}
            className={`${base} flex items-center justify-center`}
          >
            <div
              style={{
                width: 0, height: 0,
                borderLeft: '32px solid transparent',
                borderRight: '32px solid transparent',
                borderBottom: `56px solid ${shape.color}`,
              }}
            />
          </div>
        );
      case 'diamond':
        return (
          <div
            key={shape.id}
            onClick={() => handleClick(shape.id)}
            className={base}
            style={{ backgroundColor: shape.color, transform: 'rotate(45deg)', width: '44px', height: '44px', margin: '10px' }}
          />
        );
      case 'hexagon':
        return (
          <div
            key={shape.id}
            onClick={() => handleClick(shape.id)}
            className={`${base} flex items-center justify-center`}
          >
            <svg viewBox="0 0 100 100" width="64" height="64">
              <polygon
                points="50,2 95,25 95,75 50,98 5,75 5,25"
                fill={shape.color}
              />
            </svg>
          </div>
        );
      default: // square
        return (
          <div
            key={shape.id}
            onClick={() => handleClick(shape.id)}
            className={`${base} rounded-sm`}
            style={{ backgroundColor: shape.color }}
          />
        );
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6 justify-center">
        <MousePointer className="w-5 h-5 text-brand-500" />
        <p className="text-slate-700 font-medium">Click the shape that is NOT a square</p>
      </div>
      <div className="grid grid-cols-3 gap-4 justify-items-center">
        {shapes.map(renderShape)}
      </div>
    </div>
  );
}

// Custom challenge: drag element to target
function DragChallenge({ onComplete }: { onComplete: (response: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [completed, setCompleted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startTime = useRef(Date.now());
  const moveEvents = useRef<Array<{ x: number; y: number; t: number }>>([]);

  const targetPos = { x: 260, y: 140 };
  const threshold = 30;

  useEffect(() => {
    startTime.current = Date.now();
  }, []);

  const handleMouseDown = () => setDragging(true);
  const handleMouseUp = () => {
    setDragging(false);
    const dx = position.x - targetPos.x;
    const dy = position.y - targetPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < threshold) {
      setCompleted(true);
      const response = JSON.stringify({
        correct: true,
        elapsed: Date.now() - startTime.current,
        moveCount: moveEvents.current.length,
        timestamp: Date.now(),
      });
      onComplete(response);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(300, e.clientX - rect.left - 20));
    const y = Math.max(0, Math.min(180, e.clientY - rect.top - 20));
    setPosition({ x, y });
    moveEvents.current.push({ x, y, t: Date.now() });
  };

  return (
    <div>
      <p className="text-slate-700 font-medium text-center mb-4">
        Drag the blue circle to the target zone
      </p>
      <div
        ref={containerRef}
        className="relative w-[340px] h-[220px] bg-slate-100 rounded-xl border-2 border-dashed border-slate-300 mx-auto select-none"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Target zone */}
        <div
          className="absolute w-12 h-12 rounded-xl border-2 border-dashed border-success-400 bg-success-50 flex items-center justify-center"
          style={{ left: targetPos.x, top: targetPos.y }}
        >
          <span className="text-success-500 text-xs font-bold">HERE</span>
        </div>

        {/* Draggable element */}
        {!completed && (
          <div
            className="absolute w-10 h-10 rounded-full bg-brand-500 cursor-grab active:cursor-grabbing shadow-lg border-2 border-brand-300 transition-shadow hover:shadow-xl"
            style={{ left: position.x, top: position.y }}
            onMouseDown={handleMouseDown}
          />
        )}

        {completed && (
          <div className="absolute inset-0 flex items-center justify-center">
            <CheckCircle className="w-12 h-12 text-success-500" />
          </div>
        )}
      </div>
    </div>
  );
}
