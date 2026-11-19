import { useEffect } from 'react';
import gsap from 'gsap';

/**
 * Staggered entrance animation for .df-stagger children inside a container.
 */
export function useStaggerEntrance(containerRef, triggerKey) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const ctx = gsap.context(() => {
      const targets = el.querySelectorAll('.df-stagger');
      if (!targets.length) return;
      gsap.fromTo(
        targets,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: 0.48,
          stagger: 0.06,
          ease: 'power2.out',
          clearProps: 'transform,opacity',
        }
      );
    }, el);

    return () => ctx.revert();
  }, [containerRef, triggerKey]);
}
