import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  History,
  Pencil,
  Search,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import KineticText from './KineticText';
import { MiniMascot } from './Mascot2D';

const MascotScene = lazy(() => import('./MascotScene'));
const TransformScene = lazy(() => import('./TransformScene'));

const SceneFallback = () => (
  <div className="lp-scene lp-scene--fallback">
    <MiniMascot size={160} mood="working" />
  </div>
);

/* ───────────────────────── HERO ───────────────────────── */
const FIXIE_QUIPS = [
  "Hi! I'm Fixie — ready to tidy up.",
  'Safe fixes only. Zero guesses, ever.',
  'Drop a spreadsheet and watch me work!',
];

export function HeroSection({ onClean }) {
  const [quipIndex, setQuipIndex] = useState(-1);

  useEffect(() => {
    if (quipIndex < 0) return undefined;
    const timer = window.setTimeout(() => setQuipIndex(-1), 2800);
    return () => window.clearTimeout(timer);
  }, [quipIndex]);

  const handleWave = () => {
    window.dispatchEvent(new Event('datafix:celebrate'));
    setQuipIndex((prev) => (prev + 1) % FIXIE_QUIPS.length);
  };

  return (
    <section id="top" className="lp-hero">
      <div className="lp-hero__glow" aria-hidden="true" />
      <div
        className="lp-hero__scene lp-hero__scene--interactive"
        onClick={handleWave}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleWave();
          }
        }}
        aria-label="Click Fixie to say hi"
        title="Click Fixie to say hi"
      >
        <Suspense fallback={<SceneFallback />}>
          <MascotScene variant="hero" />
        </Suspense>
        {quipIndex >= 0 && (
          <div className="lp-fixie-bubble" role="status" aria-live="polite" key={quipIndex}>
            {FIXIE_QUIPS[quipIndex]}
          </div>
        )}
      </div>

      <div className="lp-wrap lp-hero__wrap">
        <div className="lp-hero__copy">
          <div className="lp-eyebrow lp-hero-reveal">
            <span className="lp-eyebrow__dot" /> Meet Fixie, your spreadsheet sidekick
          </div>

          <h1 className="lp-hero__title">
            <KineticText text="Your Data" kin="hero" />
            <br />
            <KineticText text="Deserves" kin="hero" className="lp-italic" />
            <br />
            <KineticText text="Better." kin="hero" className="lp-grad" />
          </h1>

          <p className="lp-hero__lead lp-hero-reveal">
            Turn messy spreadsheets into clean, reliable data with intelligent automation.
          </p>

          <div className="lp-hero__ctas lp-hero-reveal">
            <button type="button" className="lp-btn lp-btn--primary lp-btn--lg" onClick={onClean}>
              <span>Clean My Data</span>
              <ArrowRight size={18} />
            </button>
            <a href="#problem" className="lp-btn lp-btn--ghost lp-btn--lg">
              Explore DataFix
            </a>
          </div>

          <div className="lp-hero__hint lp-hero-reveal">
            Move your cursor or click Fixie — he’s listening.
          </div>
        </div>
      </div>

      <a href="#problem" className="lp-scroll-cue" aria-label="Scroll to next section">
        <span>Scroll</span>
        <i />
      </a>
    </section>
  );
}

/* ───────────────────────── PROBLEM ───────────────────────── */
const SPECIMENS = [
  {
    no: '01',
    title: 'Missing information',
    note: 'Some cells are simply empty.',
    speed: 40,
    rot: -3,
    body: (
      <div className="lp-mini-table">
        <div><b>Asha</b><span>asha@mail.com</span></div>
        <div><b>Kabir</b><span className="lp-gap">— empty —</span></div>
        <div><b>Meera</b><span>meera@mail.com</span></div>
      </div>
    ),
  },
  {
    no: '02',
    title: 'Duplicate entries',
    note: 'The same row shows up twice.',
    speed: 90,
    rot: 2.5,
    body: (
      <div className="lp-mini-table">
        <div><b>Order 1042</b><span>₹2,500</span></div>
        <div className="lp-dup"><b>Order 1042</b><span>₹2,500</span></div>
        <div><b>Order 1043</b><span>₹1,800</span></div>
      </div>
    ),
  },
  {
    no: '03',
    title: 'Incorrect formats',
    note: 'Dates and emails that don’t look right.',
    speed: 20,
    rot: -1.5,
    body: (
      <div className="lp-mini-table">
        <div><b>Date</b><span className="lp-bad">31/31/2026</span></div>
        <div><b>Email</b><span className="lp-bad">kabirrao.example.test</span></div>
        <div><b>Date</b><span>2026-03-15</span></div>
      </div>
    ),
  },
  {
    no: '04',
    title: 'Inconsistent names',
    note: 'One region, three spellings.',
    speed: 70,
    rot: 3,
    body: (
      <div className="lp-mini-table">
        <div><b>Region</b><span className="lp-warn">south</span></div>
        <div><b>Region</b><span className="lp-warn">SOUTH </span></div>
        <div><b>Region</b><span>South</span></div>
      </div>
    ),
  },
  {
    no: '05',
    title: 'Unusual values',
    note: 'Numbers that make you pause.',
    speed: 30,
    rot: -2.5,
    body: (
      <div className="lp-mini-table">
        <div><b>Amount</b><span className="lp-bad">-450</span></div>
        <div><b>Amount</b><span className="lp-bad">999,999</span></div>
        <div><b>Amount</b><span>2,100</span></div>
      </div>
    ),
  },
];

export function ProblemSection() {
  return (
    <section id="problem" className="lp-problem lp-paper">
      <div className="lp-paper__grain" aria-hidden="true" />
      <div className="lp-wrap">
        <div className="lp-problem__head">
          <div>
            <div className="lp-chapter">Chapter One</div>
            <h2 className="lp-h2 lp-h2--ink">
              <KineticText text="Messy Data Happens." />
            </h2>
            <p className="lp-lead lp-lead--ink lp-reveal">
              Every spreadsheet collects a few mistakes over time. Here are the five DataFix looks for.
            </p>
          </div>

          <aside className="lp-mascot-note lp-reveal" aria-label="Fixie note">
            <MiniMascot size={46} mood="working" />
            <p>
              <strong>Fixie’s checklist:</strong> I spot all five automatically — without changing your original file.
            </p>
          </aside>
        </div>

        <div className="lp-specimens">
          {SPECIMENS.map((s) => (
            <div
              className="lp-specimen-wrap lp-parallax"
              data-speed={s.speed}
              key={s.no}
            >
              <article
                className="lp-specimen"
                style={{ '--rot': `${s.rot}deg` }}
              >
                <header>
                  <span>Specimen {s.no}</span>
                  <i />
                </header>
                {s.body}
                <h3>{s.title}</h3>
                <p>{s.note}</p>
              </article>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── TRANSFORMATION ───────────────────────── */
export function TransformSection({ progressRef }) {
  return (
    <section id="transform" className="lp-transform">
      <div className="lp-transform__scene">
        <Suspense fallback={null}>
          <TransformScene progressRef={progressRef} />
        </Suspense>
      </div>

      <div className="lp-transform__ui">
        <div className="lp-chapter lp-chapter--light">Chapter Two</div>
        <h2 className="lp-h2">
          <KineticText text="Watch the Mess" />
          <br />
          <KineticText text="Become Meaningful." className="lp-grad" />
        </h2>
      </div>

      <div className="lp-transform__captions">
        <p className="lp-tcap" data-i="0">Scattered, mismatched, hard to trust.</p>
        <p className="lp-tcap" data-i="1">DataFix finds every problem and sorts what is safe to fix.</p>
        <p className="lp-tcap" data-i="2">Clean rows. Clear columns. Ready to use.</p>
      </div>

      <div className="lp-transform__bar" aria-hidden="true">
        <span className="lp-transform__fill" />
      </div>
    </section>
  );
}

/* ───────────────────────── HOW IT WORKS ───────────────────────── */
const STEPS = [
  {
    icon: UploadCloud,
    title: 'Upload your spreadsheet',
    text: 'Drop in a CSV or Excel file. Your original file is always kept safe and never changed.',
    sample: 'sales_orders.csv · 110 rows',
  },
  {
    icon: SearchCheck,
    title: 'Find problems',
    text: 'DataFix looks at every row and tells you what seems wrong, in plain English.',
    sample: '30 problems found',
  },
  {
    icon: Sparkles,
    title: 'Fix safe issues automatically',
    text: 'Extra spaces, capital letters and exact copies are cleaned up in one click.',
    sample: '“ south ” → “South”',
  },
  {
    icon: Pencil,
    title: 'Review uncertain values',
    text: 'Missing emails or odd amounts are never guessed. You type the right answer, or keep the original.',
    sample: 'Enter email address ▏',
  },
  {
    icon: Download,
    title: 'Download your clean file',
    text: 'Get a clean file, plus a simple list of every change that was made.',
    sample: 'sales_orders_cleaned.csv',
  },
];

export function StepsSection() {
  const [active, setActive] = useState(0);
  const Current = STEPS[active].icon;
  const fixieMood = active === 4 ? 'celebrate' : active === 0 ? 'idle' : 'working';

  return (
    <section id="how" className="lp-steps lp-paper lp-paper--warm">
      <div className="lp-paper__grain" aria-hidden="true" />
      <div className="lp-wrap lp-steps__grid">
        <div>
          <div className="lp-chapter">Chapter Three</div>
          <h2 className="lp-h2 lp-h2--ink">
            <KineticText text="Five simple steps." />
          </h2>
          <ol className="lp-steps__list">
            {STEPS.map((s, i) => (
              <li key={s.title} className="lp-step-item">
                <button
                  type="button"
                  className={`lp-step ${i === active ? 'lp-step--active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                >
                  <span className="lp-step__no">{String(i + 1).padStart(2, '0')}</span>
                  <span className="lp-step__title">{s.title}</span>
                  <ArrowRight size={18} className="lp-step__arrow" />
                </button>
              </li>
            ))}
          </ol>
        </div>

        <aside className="lp-archive lp-reveal" key={active}>
          <div className="lp-archive__tab">Step {active + 1} of 5</div>
          <div className="lp-archive__top">
            <div className="lp-archive__icon">
              <Current size={34} />
            </div>
            <MiniMascot size={46} mood={fixieMood} className="lp-archive__mascot" />
          </div>
          <h3>{STEPS[active].title}</h3>
          <p>{STEPS[active].text}</p>
          <div className="lp-archive__sample">{STEPS[active].sample}</div>
        </aside>
      </div>
    </section>
  );
}

/* ───────────────────────── FEATURES ───────────────────────── */
const FEATURES = [
  { icon: Search, title: 'Smart problem detection', text: 'Missing information, duplicates, wrong formats, mixed spellings and unusual numbers — found for you.', tag: 'Check' },
  { icon: Sparkles, title: 'Automatic safe cleaning', text: 'Only changes that are clearly safe are applied. Nothing is invented. Ever.', tag: 'Clean' },
  { icon: Pencil, title: 'Manual corrections', text: 'The right input for every column: email, phone, date, number, dropdown or yes/no.', tag: 'Review' },
  { icon: ShieldCheck, title: 'Data validation', text: 'A final quality check confirms your original file is safe and no rows went missing.', tag: 'Verify' },
  { icon: History, title: 'Change history', text: 'Every change is recorded with the original and new value. Undo whenever you like.', tag: 'Trust' },
  { icon: Download, title: 'Clean file export', text: 'Download exactly what you approved as a CSV or JSON file.', tag: 'Download' },
];

export function FeaturesSection() {
  return (
    <section id="features" className="lp-features">
      <div className="lp-wrap">
        <div className="lp-chapter lp-chapter--light">Chapter Four</div>
        <h2 className="lp-h2">
          <KineticText text="Everything you need." />
          <br />
          <KineticText text="Nothing you don’t." className="lp-italic" />
        </h2>

        <div className="lp-index">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <article className="lp-index__row" key={f.title}>
                <span className="lp-index__no">{String(i + 1).padStart(2, '0')}</span>
                <span className="lp-index__icon">
                  <Icon size={22} />
                </span>
                <div className="lp-index__body">
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
                <span className="lp-index__tag">{f.tag}</span>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── PRODUCT PREVIEW ───────────────────────── */
const PREVIEW_STEPS = ['Upload', 'Find problems', 'Auto-fix', 'Your correction', 'Saved', 'Download'];

function PreviewScreen({ step, demoEmail, setDemoEmail, onSaveDemo, onSkipDemo, demoError }) {
  switch (step) {
    case 0:
      return (
        <div className="lp-pv lp-pv--upload">
          <UploadCloud size={30} />
          <strong>Upload your spreadsheet</strong>
          <span>Choose a CSV or Excel file and DataFix will check it for problems.</span>
          <div className="lp-pv__file">
            <FileSpreadsheet size={16} /> sample_orders.csv
            <div className="lp-pv__bar"><i /></div>
          </div>
        </div>
      );
    case 1:
      return (
        <div className="lp-pv">
          <div className="lp-pv__chips">
            <span className="amber">Missing information · 2</span>
            <span className="rose">Unusual values · 1</span>
            <span className="violet">Different formatting · 3</span>
          </div>
          <div className="lp-pv__row"><b>Row 4</b><span>south</span><em>Different formatting</em></div>
          <div className="lp-pv__row"><b>Row 5</b><span>—</span><em>Missing information</em></div>
          <div className="lp-pv__row"><b>Row 9</b><span>-450</span><em>Unusual value</em></div>
        </div>
      );
    case 2:
      return (
        <div className="lp-pv">
          <div className="lp-pv__title"><Sparkles size={16} /> Region name cleaned</div>
          <div className="lp-pv__diff">
            <div><small>Before</small><b>south</b></div>
            <ArrowRight size={16} />
            <div className="ok"><small>After</small><b>South</b></div>
          </div>
          <span className="lp-pill lp-pill--ok">Fixed Automatically</span>
        </div>
      );
    case 3:
      return (
        <div className="lp-pv">
          <div className="lp-pv__title"><Pencil size={16} /> Email address is missing</div>
          <p className="lp-pv__hint">Try typing an email below to see how manual review works.</p>
          <input
            type="email"
            className="lp-pv__field"
            value={demoEmail}
            onChange={(e) => setDemoEmail(e.target.value)}
            placeholder="name@example.com"
            aria-label="Sample email correction"
          />
          {demoError && <span className="lp-pv__err">{demoError}</span>}
          <div className="lp-pv__btns">
            <button type="button" className="primary" onClick={onSaveDemo}>
              Save email
            </button>
            <button type="button" onClick={onSkipDemo}>
              Keep Original Value
            </button>
          </div>
          <span className="lp-pill lp-pill--warn">Needs Your Attention</span>
        </div>
      );
    case 4:
      return (
        <div className="lp-pv">
          <div className="lp-pv__title"><Check size={16} /> Correction saved</div>
          <div className="lp-pv__diff">
            <div><small>Original</small><b>Empty</b></div>
            <ArrowRight size={16} />
            <div className="ok"><small>Saved</small><b>{demoEmail || 'name@example.com'}</b></div>
          </div>
          <span className="lp-pill lp-pill--ok">Fixed Manually</span>
        </div>
      );
    default:
      return (
        <div className="lp-pv lp-pv--download">
          <strong>Your file has been checked!</strong>
          <span>Some problems were fixed automatically. A few still need your attention.</span>
          <div className="lp-pv__dl"><Download size={16} /> Download Cleaned File</div>
          <ul>
            <li><Check size={14} /> Original file kept safe</li>
            <li><Check size={14} /> No rows lost</li>
            <li><Check size={14} /> Every change recorded</li>
          </ul>
        </div>
      );
  }
}

export function PreviewSection({ onClean }) {
  const [step, setStep] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [manualLock, setManualLock] = useState(false);
  const [demoEmail, setDemoEmail] = useState('kabir@example.com');
  const [demoError, setDemoError] = useState('');
  const tabsRef = useRef(null);

  const isPaused = hovered || manualLock;

  useEffect(() => {
    if (isPaused) return undefined;
    const id = window.setInterval(() => setStep((s) => (s + 1) % PREVIEW_STEPS.length), 3600);
    return () => window.clearInterval(id);
  }, [isPaused]);

  // Keep active tab pill smoothly centered inside the horizontal strip (without vertical page scroll)
  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const activeBtn = strip.children[step];
    if (!activeBtn) return;
    const targetLeft = activeBtn.offsetLeft - strip.clientWidth / 2 + activeBtn.clientWidth / 2;
    strip.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  }, [step]);

  const handleSelectStep = (nextStep) => {
    setManualLock(true);
    setDemoError('');
    setStep(nextStep);
  };

  const handleSaveDemo = () => {
    setManualLock(true);
    const trimmed = demoEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setDemoError("That doesn't look like a valid email address.");
      return;
    }
    setDemoError('');
    setStep(4);
  };

  return (
    <section id="preview" className="lp-preview">
      <div className="lp-wrap">
        <div className="lp-chapter lp-chapter--light">Chapter Five</div>
        <h2 className="lp-h2">
          <KineticText text="See it in action." />
        </h2>
        <p className="lp-lead lp-reveal">
          This walkthrough shows the real workflow using sample rows. The actual app works on your own file.
        </p>

        <div
          className="lp-window lp-reveal"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocusCapture={() => setManualLock(true)}
        >
          <div className="lp-window__bar">
            <i /><i /><i />
            <span>DataFix · {PREVIEW_STEPS[step]}</span>
            {manualLock && (
              <button
                type="button"
                className="lp-window__resume"
                onClick={() => setManualLock(false)}
              >
                Paused · Resume
              </button>
            )}
          </div>
          <div className="lp-window__tabs" role="tablist" ref={tabsRef}>
            {PREVIEW_STEPS.map((label, i) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={i === step}
                className={i === step ? 'is-active' : ''}
                onClick={() => handleSelectStep(i)}
              >
                <b>{i + 1}</b> {label}
              </button>
            ))}
          </div>
          <div className="lp-window__body" key={step}>
            <PreviewScreen
              step={step}
              demoEmail={demoEmail}
              setDemoEmail={(v) => {
                setManualLock(true);
                setDemoEmail(v);
                if (demoError) setDemoError('');
              }}
              onSaveDemo={handleSaveDemo}
              onSkipDemo={() => handleSelectStep(5)}
              demoError={demoError}
            />
          </div>
        </div>

        <div className="lp-center">
          <button type="button" className="lp-btn lp-btn--primary lp-btn--lg" onClick={onClean}>
            <span>Try it with your own file</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── FINAL CTA + FOOTER ───────────────────────── */
export function FinalCTA({ onStart }) {
  const [cheered, setCheered] = useState(false);

  useEffect(() => {
    if (!cheered) return undefined;
    const t = window.setTimeout(() => setCheered(false), 2600);
    return () => window.clearTimeout(t);
  }, [cheered]);

  const handleCelebrate = () => {
    window.dispatchEvent(new Event('datafix:celebrate'));
    setCheered(true);
  };

  return (
    <section id="cta" className="lp-cta">
      <div className="lp-wrap lp-cta__grid">
        <div className="lp-cta__copy lp-reveal">
          <div className="lp-chapter lp-chapter--light">The Last Chapter</div>
          <h2 className="lp-h2 lp-h2--xl">
            <KineticText text="Ready to Make" />
            <br />
            <KineticText text="Your Data Better?" className="lp-grad" />
          </h2>
          <p className="lp-cta__note">
            Upload your spreadsheet, fix safe problems in one click, and keep full control over every edit.
          </p>
          <button type="button" className="lp-btn lp-btn--primary lp-btn--lg" onClick={onStart}>
            <span>Start Cleaning</span>
            <ArrowRight size={18} />
          </button>
        </div>

        <div
          className="lp-cta__stage lp-reveal"
          onClick={handleCelebrate}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCelebrate();
            }
          }}
          aria-label="Click Fixie to celebrate"
          title="Click Fixie to celebrate"
        >
          <Suspense fallback={<SceneFallback />}>
            <MascotScene variant="cta" />
          </Suspense>
          {cheered && (
            <div className="lp-fixie-bubble" role="status" aria-live="polite">
              Let’s make those rows sparkle!
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function LandingFooter({ onOpenWorkspace }) {
  return (
    <footer className="lp-footer">
      <span className="lp-wordmark"><span className="lp-wordmark__dot" /> DataFix</span>
      <span>Simple, safe spreadsheet cleaning.</span>
      <button type="button" className="lp-footer__link" onClick={onOpenWorkspace}>
        Open workspace
      </button>
    </footer>
  );
}
