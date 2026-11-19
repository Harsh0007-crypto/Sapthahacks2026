import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  FileCheck2,
  FolderOpen,
  Home,
  Info,
  Loader2,
  Menu,
  SearchCheck,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import { CleaningSuccessBanner } from './MotionPrimitives';
import { MiniMascot } from '../landing/Mascot2D';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Home', icon: Home },
  { id: 'upload', label: 'My Files', icon: FolderOpen },
  { id: 'analysis', label: 'Check Data', icon: SearchCheck },
  { id: 'repair', label: 'Clean Data', icon: Sparkles },
  { id: 'reports', label: 'Reports', icon: FileCheck2 },
];

const VIEW_TITLES = {
  dashboard: 'Home',
  upload: 'My Files',
  analysis: 'Check Data',
  repair: 'Clean Data',
  reports: 'Reports & Download',
};

const JOURNEY_STEPS = [
  { id: 'upload', label: 'Upload', targetView: 'upload' },
  { id: 'check', label: 'Check', targetView: 'analysis' },
  { id: 'clean', label: 'Clean', targetView: 'repair' },
  { id: 'review', label: 'Review', targetView: 'repair' },
  { id: 'download', label: 'Download', targetView: 'reports' },
];

export default function WorkspaceLayout({
  activeView,
  onSelectView,
  onBackToLanding,
  activeDataset,
  hasAnalysis,
  approvedRepairsCount = 0,
  pendingRepairsCount = 0,
  backendStatus,
  onRetryConnection,
  autoCleanState,
  autoCleanStages = [],
  cleanSummary,
  onDismissCleanSummary,
  notification,
  onDismissNotification,
  children,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const contentRef = useRef(null);
  const stepperRef = useRef(null);

  // Always start at the top when switching workspace views or active datasets
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeView, activeDataset?.dataset_id]);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    if (prefersReducedMotion || !contentRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 12 },
        {
          opacity: 1,
          y: 0,
          duration: 0.36,
          ease: 'power2.out',
          clearProps: 'transform,opacity',
        }
      );
    }, contentRef);

    return () => ctx.revert();
  }, [activeView]);

  const handleNavClick = (id) => {
    onSelectView(id);
    setSidebarOpen(false);
  };

  const progressPct =
    autoCleanState?.running && autoCleanStages.length > 0
      ? Math.round(((autoCleanState.stageIndex + 1) / autoCleanStages.length) * 100)
      : 0;

  // Determine which step of Upload -> Check -> Clean -> Review -> Download is active / complete
  const stepStates = {
    upload: Boolean(activeDataset),
    check: Boolean(hasAnalysis),
    clean: approvedRepairsCount > 0,
    review: Boolean(hasAnalysis) && pendingRepairsCount === 0,
    download: false,
  };

  const currentJourneyStep =
    activeView === 'upload'
      ? 'upload'
      : activeView === 'analysis'
        ? 'check'
        : activeView === 'repair'
          ? approvedRepairsCount > 0 && pendingRepairsCount > 0
            ? 'review'
            : 'clean'
          : activeView === 'reports'
            ? 'download'
            : !activeDataset
              ? 'upload'
              : !hasAnalysis
                ? 'check'
                : approvedRepairsCount === 0
                  ? 'clean'
                  : pendingRepairsCount > 0
                    ? 'review'
                    : 'download';

  // Keep active journey step smoothly visible inside the horizontal stepper on mobile
  useEffect(() => {
    const strip = stepperRef.current;
    if (!strip) return;
    const activeEl = strip.querySelector('.df-step-btn--active');
    if (!activeEl) return;
    const left = activeEl.offsetLeft - strip.clientWidth / 2 + activeEl.clientWidth / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [currentJourneyStep]);

  return (
    <div className="df-app">
      {sidebarOpen && (
        <div
          className="df-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`df-sidebar ${sidebarOpen ? 'df-sidebar--open' : ''}`}>
        <div className="df-sidebar__top">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              type="button"
              className="lp-wordmark"
              onClick={onBackToLanding}
              aria-label="Back to welcome page"
            >
              <span className="lp-wordmark__dot" aria-hidden="true" />
              <span>DataFix</span>
            </button>

            <button
              type="button"
              className="df-mobile-nav-btn"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
            >
              <X size={17} />
            </button>
          </div>

          <nav className="df-sidebar__nav" aria-label="Main Menu">
            <div className="df-sidebar__section-label">Workspace</div>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`df-side-link ${isActive ? 'df-side-link--active' : ''}`}
                  onClick={() => handleNavClick(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="df-side-link__left">
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </span>
                  {item.id === 'repair' && pendingRepairsCount > 0 && (
                    <span className="df-side-badge">{pendingRepairsCount}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="df-sidebar__bottom">
          <div className="df-dataset-chip">
            <div className="df-dataset-chip__label">CURRENT FILE</div>
            {activeDataset ? (
              <>
                <div
                  className="df-dataset-chip__name"
                  title={activeDataset.original_filename}
                >
                  {activeDataset.original_filename}
                </div>
                <div className="df-dataset-chip__meta">
                  {activeDataset.row_count.toLocaleString()} rows · {activeDataset.column_count} columns
                </div>
              </>
            ) : (
              <div className="df-dataset-chip__meta" style={{ color: 'var(--text-secondary)' }}>
                No file chosen yet
              </div>
            )}
          </div>

          <div className="df-status-row">
            <span
              className={`df-status-dot ${
                backendStatus === 'offline'
                  ? 'df-status-dot--offline'
                  : backendStatus === 'checking'
                    ? 'df-status-dot--checking'
                    : ''
              }`}
            />
            <span>
              {backendStatus === 'connected'
                ? 'Ready to help'
                : backendStatus === 'offline'
                  ? 'Service offline'
                  : 'Connecting...'}
            </span>
          </div>

          <button
            type="button"
            className="df-side-link"
            onClick={onBackToLanding}
          >
            <span className="df-side-link__left">
              <ArrowLeft size={16} />
              <span>Welcome Page</span>
            </span>
          </button>
        </div>
      </aside>

      <div className="df-workspace">
        <header className="df-topbar">
          <div className="df-topbar__left">
            <button
              type="button"
              className="df-mobile-nav-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
            <h1 className="df-topbar__title">{VIEW_TITLES[activeView]}</h1>
          </div>

          <div className="df-topbar__right">
            {activeView !== 'upload' && (
              <button
                type="button"
                className="df-btn df-btn--primary df-btn--sm df-topbar__cta"
                onClick={() => onSelectView('upload')}
              >
                <UploadCloud size={15} />
                <span className="df-topbar__cta-full">Upload Spreadsheet</span>
                <span className="df-topbar__cta-short">Upload</span>
              </button>
            )}
          </div>
        </header>

        <main className="df-workspace__body">
          {/* Clear 5-Step Journey Bar */}
          <nav className="df-stepper" ref={stepperRef} aria-label="Cleaning Steps">
            {JOURNEY_STEPS.map((step, idx) => {
              const isActive = currentJourneyStep === step.id;
              const isDone = stepStates[step.id] && !isActive;
              return (
                <div key={step.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                  <button
                    type="button"
                    className={`df-step-btn ${
                      isActive
                        ? 'df-step-btn--active'
                        : isDone
                          ? 'df-step-btn--done'
                          : ''
                    }`}
                    onClick={() => onSelectView(step.targetView)}
                  >
                    <span className="df-step-num">
                      {isDone ? <Check size={13} /> : idx + 1}
                    </span>
                    <span>{step.label}</span>
                  </button>
                  {idx < JOURNEY_STEPS.length - 1 && (
                    <ChevronRight size={15} className="df-step-arrow" aria-hidden="true" />
                  )}
                </div>
              );
            })}
          </nav>

          {backendStatus === 'offline' && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.75rem',
                padding: '0.9rem 1.15rem',
                borderRadius: '14px',
                border: '1px solid rgba(251, 113, 133, 0.4)',
                background: 'rgba(251, 113, 133, 0.1)',
                color: '#fecdd3',
                fontSize: '0.92rem',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.65rem' }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>
                  We couldn&apos;t connect to the DataFix service. Make sure the backend server is running.
                </span>
              </span>
              {onRetryConnection && (
                <button
                  type="button"
                  className="df-btn df-btn--secondary df-btn--sm"
                  onClick={onRetryConnection}
                >
                  Retry Connection
                </button>
              )}
            </div>
          )}

          {autoCleanState?.running && (
            <div
              className="df-panel"
              role="status"
              aria-live="polite"
              style={{
                borderColor: 'rgba(34, 211, 238, 0.4)',
                background: 'linear-gradient(135deg, rgba(12, 26, 52, 0.94), rgba(8, 16, 34, 0.96))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.85rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.7rem', fontWeight: 600, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
                  <MiniMascot size={40} mood="working" />
                  <span>Fixie is cleaning your spreadsheet...</span>
                </span>
                <span style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--accent-cyan-bright)' }}>
                  {progressPct}%
                </span>
              </div>

              <div className="df-progress-track" style={{ marginBottom: '1rem' }}>
                <div className="df-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.55rem' }}>
                {autoCleanStages.map((stageLabel, idx) => {
                  const done = idx < autoCleanState.stageIndex;
                  const active = idx === autoCleanState.stageIndex;
                  return (
                    <div
                      key={stageLabel}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.55rem 0.75rem',
                        borderRadius: '10px',
                        fontSize: '0.85rem',
                        border: active
                          ? '1px solid rgba(34, 211, 238, 0.55)'
                          : done
                            ? '1px solid rgba(52, 211, 153, 0.35)'
                            : '1px solid rgba(148, 179, 255, 0.1)',
                        background: active
                          ? 'rgba(34, 211, 238, 0.12)'
                          : done
                            ? 'rgba(52, 211, 153, 0.08)'
                            : 'rgba(15, 23, 42, 0.45)',
                        color: active
                          ? 'var(--accent-cyan-bright)'
                          : done
                            ? '#6ee7b7'
                            : 'var(--text-muted)',
                      }}
                    >
                      {done ? (
                        <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
                      ) : active ? (
                        <Loader2 size={15} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                      ) : (
                        <span style={{ width: '15px', textAlign: 'center', flexShrink: 0 }}>·</span>
                      )}
                      <span>{stageLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!autoCleanState?.running && cleanSummary && (
            <CleaningSuccessBanner
              summary={cleanSummary}
              onDismiss={onDismissCleanSummary}
              onViewReports={
                activeView !== 'reports'
                  ? () => {
                      onDismissCleanSummary?.();
                      onSelectView('reports');
                    }
                  : undefined
              }
            />
          )}

          {notification && !(backendStatus === 'offline' && notification.type === 'error') && (
            <div
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.85rem',
                padding: '0.85rem 1.1rem',
                borderRadius: '14px',
                fontSize: '0.92rem',
                border:
                  notification.type === 'error'
                    ? '1px solid rgba(251, 113, 133, 0.42)'
                    : notification.type === 'success'
                      ? '1px solid rgba(52, 211, 153, 0.4)'
                      : '1px solid rgba(34, 211, 238, 0.32)',
                background:
                  notification.type === 'error'
                    ? 'rgba(251, 113, 133, 0.12)'
                    : notification.type === 'success'
                      ? 'rgba(52, 211, 153, 0.1)'
                      : 'rgba(34, 211, 238, 0.09)',
                color: 'var(--text-primary)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem' }}>
                {notification.type === 'error' ? (
                  <AlertCircle size={17} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} />
                ) : notification.type === 'success' ? (
                  <CheckCircle2 size={17} style={{ color: 'var(--accent-emerald)', flexShrink: 0 }} />
                ) : (
                  <Info size={17} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
                )}
                <span>{notification.message}</span>
              </span>
              <button
                type="button"
                className="df-icon-dismiss"
                onClick={onDismissNotification}
                aria-label="Close message"
              >
                <X size={15} />
              </button>
            </div>
          )}

          <div ref={contentRef}>{children}</div>
        </main>
      </div>
    </div>
  );
}
