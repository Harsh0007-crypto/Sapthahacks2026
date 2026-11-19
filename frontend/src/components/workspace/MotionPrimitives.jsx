import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Sparkles, X } from 'lucide-react';
import { MiniMascot } from '../landing/Mascot2D';

/**
 * Smooth GSAP number count-up that respects prefers-reduced-motion.
 */
export function AnimatedNumber({ value, decimals = 0, suffix = '', prefix = '' }) {
  const [display, setDisplay] = useState(value ?? 0);
  const prevRef = useRef(value ?? 0);

  useEffect(() => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return undefined;
    }
    const target = Number(value);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      prevRef.current = target;
      const frame = window.requestAnimationFrame(() => setDisplay(target));
      return () => window.cancelAnimationFrame(frame);
    }

    const obj = { val: prevRef.current };
    const tween = gsap.to(obj, {
      val: target,
      duration: 0.75,
      ease: 'power2.out',
      onUpdate: () => setDisplay(obj.val),
      onComplete: () => {
        prevRef.current = target;
        setDisplay(target);
      },
    });

    return () => tween.kill();
  }, [value]);

  if (value === null || value === undefined) return <span>—</span>;

  const formatted =
    decimals > 0
      ? Number(display).toFixed(decimals)
      : Math.round(Number(display)).toLocaleString();

  return (
    <span>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

/**
 * Smooth shimmer loading skeleton for workspace views.
 */
export function WorkspaceSkeleton({ cards = 4 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="df-kpi-grid">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="df-skeleton-card">
            <div className="df-skeleton-line" style={{ width: '48%', height: '12px' }} />
            <div className="df-skeleton-line" style={{ width: '36%', height: '32px', marginTop: '12px' }} />
            <div className="df-skeleton-line" style={{ width: '72%', height: '12px', marginTop: '10px' }} />
          </div>
        ))}
      </div>
      <div className="df-skeleton-card" style={{ height: '220px' }}>
        <div className="df-skeleton-line" style={{ width: '30%', height: '16px' }} />
        <div className="df-skeleton-line" style={{ width: '100%', height: '140px', marginTop: '16px' }} />
      </div>
    </div>
  );
}

/**
 * Celebratory banner displayed after Automatic Cleaning finishes.
 */
export function CleaningSuccessBanner({ summary, onDismiss, onViewReports }) {
  if (!summary) return null;

  return (
    <div className="df-success-hero" role="status" aria-live="polite">
      <div className="df-success-hero__left">
        <div className="df-success-hero__mascot">
          <MiniMascot size={58} mood="celebrate" />
        </div>
        <div>
          <div className="df-success-hero__title">
            Your data has been cleaned!
          </div>
          <p className="df-success-hero__desc">
            We safely fixed <strong>{summary.safeApplied}</strong> problem
            {summary.safeApplied === 1 ? '' : 's'} automatically.
            {summary.manualReview > 0
              ? ` ${summary.manualReview} item${summary.manualReview === 1 ? '' : 's'} still need${summary.manualReview === 1 ? 's' : ''} your attention.`
              : ' Everything looks clean and ready to download!'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        {onViewReports && (
          <button
            type="button"
            className="df-btn df-btn--secondary df-btn--sm"
            onClick={onViewReports}
          >
            <Sparkles size={14} />
            <span>See Summary &amp; Download</span>
          </button>
        )}
        <button
          type="button"
          className="df-icon-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss cleaning summary"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
