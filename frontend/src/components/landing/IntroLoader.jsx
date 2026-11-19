import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { MiniMascot } from './Mascot2D';

/**
 * Cinematic intro: wordmark letters rise, Fixie hops in, floating chips appear,
 * then the overlay lifts away. Short (~1.7s) and skippable.
 */
export default function IntroLoader({ onDone }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onDone();
    };

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ onComplete: finish });
      tl.from('.lp-intro__char', { yPercent: 120, opacity: 0, duration: 0.5, stagger: 0.05, ease: 'power3.out' })
        .from('.lp-intro__bot', { y: 60, scale: 0.4, opacity: 0, duration: 0.55, ease: 'back.out(2)' }, '-=0.25')
        .from('.lp-intro__chip', { scale: 0, opacity: 0, duration: 0.4, stagger: 0.06, ease: 'back.out(2.4)' }, '-=0.3')
        .to({}, { duration: 0.25 })
        .to(el, { yPercent: -100, duration: 0.7, ease: 'power4.inOut' });
    }, el);

    return () => ctx.revert();
  }, [onDone]);

  return (
    <div className="lp-intro" ref={rootRef} role="status" aria-label="Loading DataFix">
      <div className="lp-intro__stage">
        <span className="lp-intro__chip lp-intro__chip--a" />
        <span className="lp-intro__chip lp-intro__chip--b" />
        <span className="lp-intro__chip lp-intro__chip--c" />
        <span className="lp-intro__chip lp-intro__chip--d" />
        <div className="lp-intro__bot">
          <MiniMascot size={96} mood="working" />
        </div>
        <div className="lp-intro__word" aria-hidden="true">
          {'DATAFIX'.split('').map((ch, i) => (
            <span className="lp-intro__mask" key={i}>
              <span className="lp-intro__char">{ch}</span>
            </span>
          ))}
        </div>
      </div>
      <button type="button" className="lp-intro__skip" onClick={onDone}>
        Skip
      </button>
    </div>
  );
}
