import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';

const NAV_LINKS = [
  { label: 'The Problem', href: '#problem' },
  { label: 'Transformation', href: '#transform' },
  { label: 'How It Works', href: '#how' },
  { label: 'Features', href: '#features' },
  { label: 'Preview', href: '#preview' },
];

export default function Navbar({ onLaunchPlatform }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header className={`lp-nav ${scrolled ? 'lp-nav--scrolled' : ''}`}>
        <div className="lp-nav__inner">
          <a href="#top" className="lp-wordmark" aria-label="DataFix home">
            <span className="lp-wordmark__dot" />
            DataFix
          </a>

          <nav className="lp-nav__links" aria-label="Primary">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="lp-nav__link">
                {l.label}
              </a>
            ))}
          </nav>

          <div className="lp-nav__actions">
            <button type="button" className="lp-btn lp-btn--primary lp-btn--sm" onClick={onLaunchPlatform}>
              <span>Clean My Data</span>
              <ArrowUpRight size={15} />
            </button>
            <button
              type="button"
              className="lp-nav__menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="lp-drawer" role="dialog" aria-label="Menu">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <button
            type="button"
            className="lp-btn lp-btn--primary"
            onClick={() => {
              setOpen(false);
              onLaunchPlatform();
            }}
          >
            Clean My Data
          </button>
        </div>
      )}
    </>
  );
}
