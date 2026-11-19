import { useMemo, useRef } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileCode2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  UploadCloud,
} from 'lucide-react';
import { AnimatedNumber, WorkspaceSkeleton } from './MotionPrimitives';
import { useStaggerEntrance } from './useStaggerEntrance';
import ManualCorrectionCard from './ManualCorrectionCard';
import { MiniMascot } from '../landing/Mascot2D';

function formatChangeBadge(action) {
  switch (action) {
    case 'dataset_uploaded':
      return { label: 'Uploaded', pill: 'df-pill--cyan' };
    case 'dataset_analyzed':
      return { label: 'Checked', pill: 'df-pill--violet' };
    case 'auto_clean_completed':
      return { label: 'Auto Cleaned', pill: 'df-pill--emerald' };
    case 'auto_repair_applied':
      return { label: 'Fixed Automatically', pill: 'df-pill--emerald' };
    case 'repair_approved':
      return { label: 'Fixed by You', pill: 'df-pill--emerald' };
    case 'repair_rejected':
      return { label: 'Skipped', pill: 'df-pill--rose' };
    case 'repair_undone':
      return { label: 'Undone', pill: 'df-pill--amber' };
    case 'dataset_exported':
      return { label: 'Downloaded', pill: 'df-pill--cyan' };
    default:
      return { label: action.replaceAll('_', ' '), pill: 'df-pill--cyan' };
  }
}

function formatChangeDescription(entry) {
  const d = entry.details || {};
  switch (entry.action) {
    case 'dataset_uploaded':
      return `Uploaded "${d.original_filename || 'spreadsheet'}" (${d.row_count ?? 0} rows)`;
    case 'dataset_analyzed':
      return `Checked your file and found ${d.total_issues ?? 0} problem(s)`;
    case 'auto_clean_completed':
      return `Automatically fixed ${d.safe_repairs_applied ?? 0} problem(s)`;
    case 'auto_repair_applied':
    case 'repair_approved':
      return `Row ${(d.row_index ?? 0) + 1}${d.column_name ? ` (${d.column_name})` : ''}: ${d.before_value ?? 'Empty'} → ${d.applied_value ?? 'Removed'}`;
    case 'repair_rejected':
      return `Kept original value on Row ${(d.row_index ?? 0) + 1}${d.column_name ? ` (${d.column_name})` : ''}`;
    case 'repair_undone':
      return `Undid change on Row ${(d.row_index ?? 0) + 1}${d.column_name ? ` (${d.column_name})` : ''}`;
    case 'dataset_exported':
      return `Downloaded "${d.export_filename || 'cleaned file'}" (${d.row_count ?? 0} rows)`;
    default:
      return '—';
  }
}

export default function ReportsView({
  activeDataset,
  report,
  repairs = [],
  busyRepairId = null,
  loading,
  exportingFormat,
  onApproveRepair,
  onRejectRepair,
  onUndoRepair,
  onExportDataset,
  onGoToUpload,
  onRefreshReport,
}) {
  const containerRef = useRef(null);
  useStaggerEntrance(containerRef, report?.dataset_id || activeDataset?.dataset_id || 'reports');

  const columnProfilesByName = useMemo(() => {
    const map = {};
    const cols = report?.current_profile?.columns || activeDataset?.profile?.columns || [];
    for (const c of cols) map[c.name] = c;
    return map;
  }, [report, activeDataset]);

  const pendingAttentionRepairs = useMemo(
    () =>
      repairs.filter(
        (r) =>
          (r.status === 'pending' || r.status === 'undone') &&
          !r.can_auto_apply
      ),
    [repairs]
  );

  if (!activeDataset) {
    return (
      <div className="df-panel" style={{ textAlign: 'center', padding: '3.25rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.85rem' }}>
          <MiniMascot size={64} mood="idle" />
        </div>
        <h2 className="df-panel__title" style={{ fontSize: '1.35rem' }}>
          No file ready to download yet
        </h2>
        <p className="df-panel__subtitle" style={{ marginTop: '0.5rem', marginBottom: '1.4rem' }}>
          Upload and clean a spreadsheet to see your final summary and download it.
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

  if (loading && !report) {
    return <WorkspaceSkeleton cards={4} />;
  }

  if (!report) {
    return (
      <div className="df-panel" style={{ textAlign: 'center', padding: '2.5rem' }}>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          We couldn&apos;t load the summary for this file.
        </p>
        <button
          type="button"
          className="df-btn df-btn--secondary df-btn--sm"
          onClick={onRefreshReport}
        >
          <RefreshCw size={14} />
          <span>Try Again</span>
        </button>
      </div>
    );
  }

  const {
    validation,
    repair_summary: repairSummary,
    provenance_breakdown: provenance = {},
    modification_history: history,
  } = report;

  const exportDisabled =
    Boolean(exportingFormat) ||
    loading ||
    report.dataset_id !== activeDataset.dataset_id;

  const itemsNeedingAttention =
    (provenance.manual_review_pending ?? 0) + (provenance.unresolved ?? 0);
  const completelyClean = validation.after_issue_count === 0;
  const hasAppliedFixes = (repairSummary?.approved ?? 0) > 0;

  const heroTitle = completelyClean
    ? 'Your file is clean and ready!'
    : hasAppliedFixes && itemsNeedingAttention > 0
      ? 'Safe fixes applied — review remaining items'
      : hasAppliedFixes
        ? 'Your file is cleaned and ready to download!'
        : validation.before_issue_count > 0
          ? 'Your file has been checked — ready to clean'
          : 'Your file is ready to review';

  const heroDesc = completelyClean
    ? `"${report.original_filename}" passed all checks with ${validation.after_row_count.toLocaleString()} clean rows.`
    : hasAppliedFixes
      ? `${repairSummary.approved} problem${repairSummary.approved === 1 ? ' was' : 's were'} fixed safely.${
          itemsNeedingAttention > 0
            ? ` ${itemsNeedingAttention} item${itemsNeedingAttention === 1 ? ' still needs' : 's still need'} your attention.`
            : ' You can download your cleaned file anytime.'
        } Your original uploaded file is still kept safe.`
      : `${validation.before_issue_count} problem${validation.before_issue_count === 1 ? ' was' : 's were'} found during inspection.${
          itemsNeedingAttention > 0
            ? ` ${itemsNeedingAttention} item${itemsNeedingAttention === 1 ? ' needs' : 's need'} your review.`
            : ''
        } Your original uploaded file is still kept safe.`;

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '1.65rem' }}>
      {/* Honest Summary Hero + Obvious Download Button */}
      <section className="df-hero-card df-stagger">
        <div>
          <h2 className="df-hero-card__title">{heroTitle}</h2>
          <p className="df-hero-card__desc">{heroDesc}</p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button
            type="button"
            className="df-btn df-btn--primary"
            disabled={exportDisabled}
            onClick={() => onExportDataset('csv')}
          >
            {exportingFormat === 'csv' ? (
              <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <FileSpreadsheet size={17} />
            )}
            <span>
              {exportingFormat === 'csv'
                ? 'Preparing Download...'
                : 'Download Cleaned File'}
            </span>
          </button>

          <button
            type="button"
            className="df-btn df-btn--secondary"
            disabled={exportDisabled}
            onClick={() => onExportDataset('json')}
          >
            {exportingFormat === 'json' ? (
              <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <FileCode2 size={17} />
            )}
            <span>
              {exportingFormat === 'json' ? 'Preparing...' : 'Download as JSON'}
            </span>
          </button>
        </div>
      </section>

      {/* Simple 5-Card Summary */}
      <section className="df-mini-stats df-mini-stats--five df-stagger" aria-label="Final Summary">
        <div className="df-mini-stat">
          <div className="df-mini-stat__label">Total Rows Checked</div>
          <div className="df-mini-stat__value">
            <AnimatedNumber value={validation.before_row_count} />
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            In download: {validation.after_row_count.toLocaleString()} rows
          </div>
        </div>

        <div className="df-mini-stat">
          <div className="df-mini-stat__label">Problems Found</div>
          <div className="df-mini-stat__value">
            <AnimatedNumber value={validation.before_issue_count} />
          </div>
        </div>

        <div className="df-mini-stat">
          <div className="df-mini-stat__label">Problems Fixed</div>
          <div className="df-mini-stat__value" style={{ color: 'var(--accent-emerald)' }}>
            <AnimatedNumber value={repairSummary.approved} />
          </div>
        </div>

        <div className="df-mini-stat">
          <div className="df-mini-stat__label">Needs Your Attention</div>
          <div
            className="df-mini-stat__value"
            style={{ color: itemsNeedingAttention > 0 ? 'var(--accent-amber)' : 'var(--text-primary)' }}
          >
            <AnimatedNumber value={itemsNeedingAttention} />
          </div>
        </div>

        <div className="df-mini-stat">
          <div className="df-mini-stat__label">Final Quality Check</div>
          <div
            className="df-mini-stat__value"
            style={{
              fontSize: '1.25rem',
              color: validation.all_integrity_checks_passed
                ? 'var(--accent-emerald)'
                : 'var(--accent-rose)',
            }}
          >
            {validation.all_integrity_checks_passed ? 'Passed' : 'Needs Review'}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Score: {validation.after_quality_score.toFixed(1)}%
          </div>
        </div>
      </section>

      {/* Optional Inline Corrections Before Downloading */}
      {pendingAttentionRepairs.length > 0 && (
        <div className="df-panel df-stagger">
          <div className="df-panel__head">
            <div>
              <h2 className="df-panel__title">Still Needs Your Attention</h2>
              <p className="df-panel__subtitle">
                Fix any remaining items right here before downloading, or keep them as original
              </p>
            </div>
            <span className="df-pill df-pill--amber">
              {pendingAttentionRepairs.length} Remaining
            </span>
          </div>

          <div className="df-repair-list">
            {pendingAttentionRepairs.slice(0, 6).map((item) => (
              <ManualCorrectionCard
                key={item.repair_id}
                item={item}
                columnProfile={item.column_name ? columnProfilesByName[item.column_name] : null}
                busy={busyRepairId === item.repair_id}
                onSave={onApproveRepair}
                onKeepOriginal={onRejectRepair}
                onUndo={onUndoRepair}
              />
            ))}
          </div>
        </div>
      )}

      {/* Final Quality Check List */}
      <div className="df-panel df-stagger">
        <div className="df-panel__head">
          <div>
            <h2 className="df-panel__title">Final Quality Check</h2>
            <p className="df-panel__subtitle">
              We verified your cleaned file to make sure nothing important was lost
            </p>
          </div>
          <span
            className={`df-pill ${
              validation.all_integrity_checks_passed ? 'df-pill--emerald' : 'df-pill--rose'
            }`}
          >
            {validation.all_integrity_checks_passed ? 'All Checks Passed' : 'Check Failed'}
          </span>
        </div>

        <div className="df-activity-list">
          {validation.integrity_checks.map((check) => (
            <div key={check.name} className="df-activity-item" style={{ cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                {check.passed ? (
                  <CheckCircle2 size={17} style={{ color: 'var(--accent-emerald)', flexShrink: 0 }} />
                ) : (
                  <AlertCircle size={17} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} />
                )}
                <span style={{ fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                  {check.details}
                </span>
              </div>
              <span className={`df-pill ${check.passed ? 'df-pill--emerald' : 'df-pill--rose'}`}>
                {check.passed ? 'Passed' : 'Failed'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Changes Made */}
      <div className="df-panel df-stagger">
        <div className="df-panel__head">
          <div>
            <h2 className="df-panel__title">Changes Made</h2>
            <p className="df-panel__subtitle">
              Every action taken on &ldquo;{report.original_filename}&rdquo;
            </p>
          </div>
          <button
            type="button"
            className="df-btn df-btn--secondary df-btn--sm"
            disabled={exportDisabled}
            onClick={() => onExportDataset('csv')}
          >
            <Download size={14} />
            <span>Download Cleaned File</span>
          </button>
        </div>

        <div className="df-table-wrap df-desktop-table">
          <table className="df-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>What Changed</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().slice(0, 30).map((entry) => {
                const badge = formatChangeBadge(entry.action);
                return (
                  <tr key={entry.audit_id}>
                    <td>
                      <span className={`df-pill ${badge.pill}`}>{badge.label}</span>
                    </td>
                    <td className="df-td-wrap" style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                      {formatChangeDescription(entry)}
                    </td>
                    <td style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}

              {history.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', padding: '1.75rem', color: 'var(--text-secondary)' }}>
                    No changes recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Audit Cards (<= 768px) */}
        <div className="df-mobile-cards" aria-label="Changes Made List">
          {[...history].reverse().slice(0, 30).map((entry) => {
            const badge = formatChangeBadge(entry.action);
            return (
              <article key={entry.audit_id} className="df-mobile-card">
                <div className="df-mobile-card__top">
                  <span className={`df-pill ${badge.pill}`}>{badge.label}</span>
                  <span className="df-mobile-card__time">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="df-mobile-card__desc" style={{ color: 'var(--text-primary)' }}>
                  {formatChangeDescription(entry)}
                </p>
              </article>
            );
          })}

          {history.length === 0 && (
            <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>
              No changes recorded yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
