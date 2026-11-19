import { useId } from 'react';

/**
 * "Fixie" — the original DataFix companion, as a lightweight SVG.
 * Used in the intro loader, WebGL fallback, and small helpful moments in the workspace.
 * mood: 'idle' | 'working' | 'celebrate'
 */
export function MiniMascot({ size = 56, mood = 'idle', className = '' }) {
  const uid = useId().replace(/:/g, '');
  const bodyGradId = `mmBody-${uid}`;
  const visorGradId = `mmVisor-${uid}`;

  return (
    <svg
      className={`mm mm--${mood} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Fixie, the DataFix assistant"
    >
      <defs>
        <radialGradient id={bodyGradId} cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#d9ecff" />
          <stop offset="100%" stopColor="#9db8ee" />
        </radialGradient>
        <linearGradient id={visorGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14224a" />
          <stop offset="100%" stopColor="#060d24" />
        </linearGradient>
      </defs>

      <ellipse className="mm-halo" cx="50" cy="93" rx="26" ry="4" fill="#22d3ee" opacity="0.55" />

      <g className="mm-body">
        <line x1="50" y1="10" x2="50" y2="21" stroke="#a78bfa" strokeWidth="2.4" strokeLinecap="round" />
        <circle className="mm-bulb" cx="50" cy="8" r="4.2" fill="#8b5cf6" />
        <circle cx="16" cy="56" r="5.2" fill="#22d3ee" />
        <circle cx="84" cy="56" r="5.2" fill="#22d3ee" />
        <ellipse cx="50" cy="56" rx="34" ry="35" fill={`url(#${bodyGradId})`} />
        <rect x="23" y="41" width="54" height="28" rx="14" fill={`url(#${visorGradId})`} />
        <g className="mm-eyes">
          {mood === 'celebrate' ? (
            <>
              <path d="M35 54 Q40 47 45 54" stroke="#67e8f9" strokeWidth="3.2" fill="none" strokeLinecap="round" />
              <path d="M55 54 Q60 47 65 54" stroke="#67e8f9" strokeWidth="3.2" fill="none" strokeLinecap="round" />
            </>
          ) : (
            <>
              <ellipse cx="40" cy="53" rx="4" ry="6" fill="#67e8f9" />
              <ellipse cx="60" cy="53" rx="4" ry="6" fill="#67e8f9" />
            </>
          )}
        </g>
        <path
          d={mood === 'celebrate' ? 'M42 60 Q50 68 58 60' : 'M44 61 Q50 66 56 61'}
          stroke="#67e8f9"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export default MiniMascot;
