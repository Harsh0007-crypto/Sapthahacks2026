import { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Loader2,
  SearchCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import { AnimatedNumber, WorkspaceSkeleton } from './MotionPrimitives';
import { useStaggerEntrance } from './useStaggerEntrance';
import ManualCorrectionCard from './ManualCorrectionCard';
import { MiniMascot } from '../landing/Mascot2D';

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs Your Attention' },
  { id: 'safe', label: 'Safe Automatic Fixes' },
  { id: 'applied', label: 'Fixed' },
  { id: 'not_fixed', label: 'Not Fixed Yet' },
  { id: 'rejected', label: 'Rejected' },
];

export default function RepairCenterView({
  activeDataset,
  analysis,
  repairs,
  loading,
  busyRepairId,
  autoCleaning,
  onApproveRepair,
  onRejectRepair,
  onUndoRepair,
  onRunAutoClean,
  onGoToUpload,
  onGoToAnalysis,
  onGoToReports,
}) {
  const containerRef = useRef(null);
  const [tab, setTab] = useState('all');

  useStaggerEntrance(containerRef, activeDataset?.dataset_id || 'clean');

  const columnProfilesByName = useMemo(() => {
    const map = {};
    const cols = activeDataset?.profile?.columns || analysis?.profile?.columns || [];
    for (const c of cols) {
      map[c.name] = c;
    }
    return map;
  }, [activeDataset, analysis]);

  const safePendingCount = useMemo(
    () =>
      repairs.filter(
        (r) =>
          (r.status === 'pending' || r.status === 'undone') &&
          (r.safety_category === 'safe_auto_repair' || r.can_auto_apply)
      ).length,
    [repairs]
  );

  const needsAttentionCount = useMemo(
    () =>
      repairs.filter(
        (r) =>
          (r.status === 'pending' || r.status === 'undone') &&
          r.safety_category !== 'safe_auto_repair' &&
          !r.can_auto_apply
      ).length,
    [repairs]
  );

  const autoFixedCount = useMemo(
    () =>
      repairs.filter(
        (r) =>
          r.display_status === 'Fixed Automatically' ||
          (r.status === 'approved' && r.can_auto_apply)
      ).length,
    [repairs]
  );

  const allFixedCount = useMemo(
    () => repairs.filter((r) => r.status === 'approved').length,
    [repairs]
  );

  const stillNotFixedCount = useMemo(
    () =>
      repairs.filter((r) => r.status === 'pending' || r.status === 'undone')
        .length,
    [repairs]
  );

  const counts = useMemo(
    () => ({
      all: repairs.length,
      attention: needsAttentionCount,
      safe: safePendingCount,
      applied: allFixedCount,
      not_fixed: stillNotFixedCount,
      rejected: repairs.filter((r) => r.status === 'rejected').length,
    }),
    [repairs, needsAttentionCount, safePendingCount, allFixedCount, stillNotFixedCount]
  );

  const visibleRepairs = useMemo(() => {
    if (tab === 'all') return repairs;
    if (tab === 'attention') {
      return repairs.filter(
        (r) =>
          (r.status === 'pending' || r.status === 'undone') &&
          r.safety_category !== 'safe_auto_repair' &&
          !r.can_auto_apply
      );
    }
    if (tab === 'safe') {
      return repairs.filter(
        (r) =>
          (r.status === 'pending' || r.status === 'undone') &&
          (r.safety_category === 'safe_auto_repair' || r.can_auto_apply)
      );
    }
    if (tab === 'applied') {
      return repairs.filter((r) => r.status === 'approved');
    }
    if (tab === 'not_fixed') {
      return repairs.filter(
        (r) => r.status === 'pending' || r.status === 'undone'
      );
    }
    return repairs.filter((r) => r.status === 'rejected');
  }, [repairs, tab]);

  if (!activeDataset) {
    return (
      <div className="df-panel" style={{ textAlign: 'center', padding: '3.25rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.85rem' }}>
          <MiniMascot size={64} mood="idle" />
        </div>
        <h2 className="df-panel__title" style={{ fontSize: '1.35rem' }}>
          No file uploaded yet
        </h2>
        <p className="df-panel__subtitle" style={{ marginTop: '0.5rem', marginBottom: '1.4rem' }}>
          Upload a spreadsheet first, then clean it with one click.
        </p>
        <button
          type="button"
          className="df-btn df-btn--primary"
          onClick={onGoToUpload}
        >
          <UploadCloud size={16} />
          <span>Upload Your Spreadsheet</span>
        </button>
      </div>
    );
  }

  if (loading && repairs.length === 0) {
    return <WorkspaceSkeleton cards={4} />;
  }

  if (!analysis && repairs.length === 0) {
    return (
      <div className="df-hero-card">
        <div>
          <h2 className="df-hero-card__title">
            Clean &ldquo;{activeDataset.original_filename}&rdquo;
          </h2>
          <p className="df-hero-card__desc">
            DataFix will fix problems it can identify safely. Anything uncertain will be shown for your review.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button
            type="button"
            className="df-btn df-btn--primary"
            onClick={onRunAutoClean}
            disabled={autoCleaning}
          >
            {autoCleaning ? (
              <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Sparkles size={17} />
            )}
            <span>{autoCleaning ? 'Cleaning...' : 'Clean My Data Automatically'}</span>
          </button>
          <button
            type="button"
            className="df-btn df-btn--secondary"
            onClick={onGoToAnalysis}
          >
            <SearchCheck size={16} />
            <span>Check My Data First</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Main Automatic Cleaning Hero */}
      <section className="df-hero-card df-stagger">
        <div>
          <h2 className="df-hero-card__title">Clean My Data Automatically</h2>
          <p className="df-hero-card__desc">
            DataFix will fix problems it can identify safely. Anything uncertain will be shown for your review.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button
            type="button"
            className="df-btn df-btn--primary"
            onClick={onRunAutoClean}
            disabled={autoCleaning || Boolean(busyRepairId)}
          >
            {autoCleaning ? (
              <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Sparkles size={17} />
            )}
            <span>
              {autoCleaning
                ? 'Cleaning Your Data...'
                : safePendingCount > 0
                  ? `Clean My Data Automatically (${safePendingCount} Safe)`
                  : 'Clean My Data Automatically'}
            </span>
          </button>

          <button
            type="button"
            className="df-btn df-btn--secondary"
            onClick={onGoToReports}
          >
            <span>Download Cleaned File</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </section>

      {/* Simple 4-Number Summary */}
      <section className="df-mini-stats df-stagger" aria-label="Cleaning Summary">
        <div className="df-mini-stat">
          <div className="df-mini-stat__label">Problems Found</div>
          <div className="df-mini-stat__value">
            <AnimatedNumber value={repairs.length} />
          </div>
        </div>
        <div className="df-mini-stat">
          <div className="df-mini-stat__label">Fixed</div>
          <div className="df-mini-stat__value" style={{ color: 'var(--accent-emerald)' }}>
            <AnimatedNumber value={allFixedCount} />
          </div>
          {autoFixedCount > 0 && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {autoFixedCount} automatic
            </div>
          )}
        </div>
        <div className="df-mini-stat">
          <div className="df-mini-stat__label">Needs Your Attention</div>
          <div className="df-mini-stat__value" style={{ color: 'var(--accent-amber)' }}>
            <AnimatedNumber value={needsAttentionCount} />
          </div>
        </div>
        <div className="df-mini-stat">
          <div className="df-mini-stat__label">Not Fixed Yet</div>
          <div className="df-mini-stat__value" style={{ color: 'var(--text-secondary)' }}>
            <AnimatedNumber value={stillNotFixedCount} />
          </div>
        </div>
      </section>

      {/* Filter Tabs */}
      <div className="df-panel df-stagger" style={{ padding: '1rem 1.25rem' }}>
        <div className="df-filter-tabs" role="tablist" aria-label="Filter items">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`df-tab ${tab === t.id ? 'df-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label} ({counts[t.id]})
            </button>
          ))}
        </div>
      </div>

      {/* Universal Schema-Aware Correction Cards */}
      <div className="df-repair-list">
        {visibleRepairs.map((item) => (
          <ManualCorrectionCard
            key={item.repair_id}
            item={item}
            columnProfile={item.column_name ? columnProfilesByName[item.column_name] : null}
            busy={busyRepairId === item.repair_id || autoCleaning}
            onSave={onApproveRepair}
            onKeepOriginal={onRejectRepair}
            onUndo={onUndoRepair}
          />
        ))}

        {visibleRepairs.length === 0 && (
          <div className="df-panel" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)' }}>
            Nothing to show in this tab.
          </div>
        )}
      </div>
    </div>
  );
}
