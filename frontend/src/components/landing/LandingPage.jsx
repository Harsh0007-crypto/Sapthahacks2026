import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Navbar from '../Navbar';
import IntroLoader from './IntroLoader';
import {
  FeaturesSection,
  FinalCTA,
  HeroSection,
  LandingFooter,
  PreviewSection,
  ProblemSection,
  StepsSection,
  TransformSection,
} from './LandingSections';

gsap.registerPlugin(ScrollTrigger);

const INTRO_KEY = 'datafix_intro_seen';

const CHAPTERS = [
  { id: 'top', label: 'Intro' },
  { id: 'problem', label: 'The Problem' },
  { id: 'transform', label: 'Transformation' },
  { id: 'how', label: 'How It Works' },
  { id: 'features', label: 'Features' },
  { id: 'preview', label: 'Preview' },
  { id: 'cta', label: 'Start' },
];

function shouldSkipIntro() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    return window.sessionStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return true;
  }
}

export default function LandingPage({ onAnalyzeClick, onExploreClick }) {
  const rootRef = useRef(null);
  const progressRef = useRef(0);
  const [introDone, setIntroDone] = useState(shouldSkipIntro);
  const [activeChapter, setActiveChapter] = useState('top');

  const handleIntroDone = useCallback(() => {
    try {
      window.sessionStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* storage unavailable — ignore */
    }
    setIntroDone(true);
  }, []);

  // Lock scrolling only while the (short) intro plays
  useEffect(() => {
    if (introDone) return undefined;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [introDone]);

  useEffect(() => {
    if (!introDone) return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobile = window.innerWidth < 720;

    if (reduced) {
      progressRef.current = 1;
      return undefined;
    }

    const ctx = gsap.context(() => {
      // Hero entrance (kinetic title + supporting copy)
      const heroChars = gsap.utils.toArray('.lp-kinetic[data-kin="hero"] .lp-kchar');
      gsap.fromTo(
        heroChars,
        { yPercent: 110, rotate: 8, opacity: 0 },
        { yPercent: 0, rotate: 0, opacity: 1, duration: 0.9, stagger: 0.035, ease: 'power4.out', delay: 0.1, clearProps: 'transform,opacity' }
      );
      gsap.from('.lp-hero-reveal', {
        y: 24, opacity: 0, duration: 0.8, stagger: 0.12, ease: 'power3.out', delay: 0.35, clearProps: 'transform,opacity',
      });
      gsap.from('.lp-hero__scene', { scale: 0.88, opacity: 0, duration: 1.2, ease: 'power3.out', clearProps: 'transform,opacity' });

      // Kinetic headlines on scroll
      gsap.utils.toArray('.lp-kinetic[data-kin="scroll"]').forEach((el) => {
        gsap.fromTo(
          el.querySelectorAll('.lp-kchar'),
          { yPercent: 110, rotate: 6, opacity: 0 },
          {
            yPercent: 0, rotate: 0, opacity: 1, duration: 0.8, stagger: 0.025, ease: 'power4.out', clearProps: 'transform,opacity',
            scrollTrigger: { trigger: el, start: 'top 88%', once: true },
          }
        );
      });

      // Generic reveals
      gsap.utils.toArray('.lp-reveal').forEach((el) => {
        gsap.from(el, {
          y: 34, opacity: 0, duration: 0.8, ease: 'power3.out', clearProps: 'transform,opacity',
          scrollTrigger: { trigger: el, start: 'top 90%', once: true },
        });
      });

      // Specimen cards: entrance on inner card (clears transform so CSS tilt + hover stay intact), parallax on wrapper
      gsap.from('.lp-specimen', {
        y: 52, opacity: 0, duration: 0.85, stagger: 0.1, ease: 'power3.out', clearProps: 'transform,opacity',
        scrollTrigger: { trigger: '.lp-specimens', start: 'top 84%', once: true },
      });
      if (!isMobile) {
        gsap.utils.toArray('.lp-parallax').forEach((el) => {
          const speed = Number(el.dataset.speed || 30);
          gsap.to(el, {
            y: -speed,
            ease: 'none',
            scrollTrigger: { trigger: '.lp-problem', start: 'top bottom', end: 'bottom top', scrub: true },
          });
        });
      }

      // Steps list staggered entrance
      gsap.from('.lp-step-item', {
        y: 26, opacity: 0, duration: 0.65, stagger: 0.08, ease: 'power3.out', clearProps: 'transform,opacity',
        scrollTrigger: { trigger: '.lp-steps__list', start: 'top 84%', once: true },
      });

      // Pinned scroll-driven transformation
      const fill = document.querySelector('.lp-transform__fill');
      const caps = gsap.utils.toArray('.lp-tcap');
      const windows = [[0, 0.31], [0.34, 0.65], [0.68, 1.02]];
      ScrollTrigger.create({
        trigger: '#transform',
        start: 'top top',
        end: `+=${isMobile ? 1400 : 2600}`,
        pin: true,
        scrub: true,
        onUpdate: (self) => {
          const p = self.progress;
          progressRef.current = p;
          if (fill) fill.style.transform = `scaleX(${p})`;
          caps.forEach((cap, i) => {
            const [a, b] = windows[i];
            const mid = (a + b) / 2;
            const half = (b - a) / 2;
            const o = Math.min(1, Math.max(0, 1 - Math.abs(p - mid) / half) * 1.6);
            cap.style.opacity = String(o);
            cap.style.transform = `translateY(${(1 - o) * 18}px)`;
          });
        },
      });

      // Feature rows slide in
      gsap.from('.lp-index__row', {
        x: -30, opacity: 0, duration: 0.7, stagger: 0.09, ease: 'power3.out', clearProps: 'transform,opacity',
        scrollTrigger: { trigger: '.lp-index', start: 'top 82%', once: true },
      });

      // Final scene: Fixie celebrates when the closing chapter arrives
      ScrollTrigger.create({
        trigger: '#cta',
        start: 'top 60%',
        once: true,
        onEnter: () => window.dispatchEvent(new Event('datafix:celebrate')),
      });

      // Track active chapter for the right-edge chapter rail
      CHAPTERS.forEach(({ id }) => {
        const el = document.getElementById(id);
        if (!el) return;
        ScrollTrigger.create({
          trigger: el,
          start: 'top 50%',
          end: 'bottom 50%',
          onEnter: () => setActiveChapter(id),
          onEnterBack: () => setActiveChapter(id),
        });
      });
    }, rootRef);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => ScrollTrigger.refresh());
    }

    return () => ctx.revert();
  }, [introDone]);

  return (
    <div ref={rootRef} className="lp-root">
      {!introDone && <IntroLoader onDone={handleIntroDone} />}
      <Navbar onLaunchPlatform={onAnalyzeClick} />
      <nav className="lp-rail" aria-label="Page chapters">
        {CHAPTERS.map((ch) => (
          <a
            key={ch.id}
            href={`#${ch.id}`}
            className={`lp-rail__dot ${activeChapter === ch.id ? 'is-active' : ''}`}
            aria-label={ch.label}
            title={ch.label}
          >
            <span className="lp-rail__tip">{ch.label}</span>
          </a>
        ))}
      </nav>
      <main>
        <HeroSection onClean={onAnalyzeClick} />
        <ProblemSection />
        <TransformSection progressRef={progressRef} />
        <StepsSection />
        <FeaturesSection />
        <PreviewSection onClean={onAnalyzeClick} />
        <FinalCTA onStart={onAnalyzeClick} />
      </main>
      <LandingFooter onOpenWorkspace={onExploreClick} />
    </div>
  );
}
