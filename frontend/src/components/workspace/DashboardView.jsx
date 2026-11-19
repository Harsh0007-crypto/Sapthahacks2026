import { useMemo, useRef } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  SearchCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import { AnimatedNumber, WorkspaceSkeleton } from './MotionPrimitives';
import { useStaggerEntrance } from './useStaggerEntrance';
import { MiniMascot } from '../landing/Mascot2D';

function formatChangeText(entry) {
  switch (entry.action) {
    case 'dataset_uploaded':
      return `Uploaded "${entry.details?.original_filename || 'spreadsheet'}"`;
    case 'dataset_analyzed':
      return `Checked your file and found ${entry.details?.total_issues ?? 0} problem(s)`;
    case 'auto_clean_completed':
      return `Automatically fixed ${entry.details?.safe_repairs_applied ?? 0} problem(s)`;
    case 'repair_approved':
      return `Fixed Row ${(entry.details?.row_index ?? 0) + 1}${entry.details?.column_name ? ` (${entry.details.column_name})` : ''}`;
    case 'repair_rejected':
      return `Kept Row ${(entry.details?.row_index ?? 0) + 1} as original`;
    case 'repair_undone':
      return `Undid change on Row ${(entry.details?.row_index ?? 0) + 1}`;
    case 'dataset_exported':
      return `Downloaded cleaned ${String(entry.details?.format || 'CSV').toUpperCase()} file`;
    default:
      return entry.action.replaceAll('_', ' ');
  }
}

export default function DashboardView({
  datasets,
  activeDataset,
  analysis,
  repairs,
  repairsCounts,
  report,
  loading,
  onNavigate,
  onRunAnalysis,
  onRunAutoClean,
  analyzing,
  autoCleaning,
}) {
  const containerRef = useRef(null);
  useStaggerEntrance(containerRef, activeDataset?.dataset_id || 'home');

  const problemsFound =
    report?.validation?.before_issue_count ?? analysis?.total_issues ?? 0;
  const fixedAutomatically = useMemo(
    () =>
      repairs.filter(
        (r) =>
          r.display_status === 'Fixed Automatically' ||
          (r.status === 'approved' && r.can_auto_apply)
      ).length,
    [repairs]
  );
  const needsAttention = useMemo(
    () =>
      repairs.filter(
        (r) =>
          (r.status === 'pending' || r.status === 'undone') &&
          r.safety_category !== 'safe_auto_repair' &&
          !r.can_auto_apply
      ).length,
    [repairs]
  );
  const safeToFix = useMemo(
    () =>
      repairs.filter(
        (r) =>
          (r.status === 'pending' || r.status === 'undone') &&
          (r.safety_category === 'safe_auto_repair' || r.can_auto_apply)
      ).length,
    [repairs]
  );

  const recentChanges = useMemo(() => {
    const logs = report?.modification_history || [];
    const readable = logs.filter((l) => l.action !== 'auto_repair_applied');
    return [...(readable.length ? readable : logs)].reverse().slice(0, 5);
  }, [report]);

  // Decide one crystal-clear "What should I do next?" recommendation
  const nextStep = useMemo(() => {
    if (!activeDataset) {
      if (datasets.length > 0) {
        return {
          title: 'Choose a spreadsheet to continue',
          desc: `You have ${datasets.length} uploaded file${datasets.length === 1 ? '' : 's'}. Open My Files to select one or upload a new spreadsheet.`,
          buttonLabel: 'Open My Files',
          icon: FileSpreadsheet,
          onClick: () => onNavigate('upload'),
          busy: false,
        };
      }
      return {
        title: 'Start by uploading your spreadsheet',
        desc: 'Choose a CSV or Excel file. DataFix will check it for problems and help you clean it safely.',
        buttonLabel: 'Upload Your Spreadsheet',
        icon: UploadCloud,
        onClick: () => onNavigate('upload'),
        busy: false,
      };
    }
    if (!analysis) {
      return {
        title: 'Next step: Check your file for problems',
        desc: `"${activeDataset.original_filename}" is uploaded (${activeDataset.row_count.toLocaleString()} rows). Let's check it or clean it automatically.`,
        buttonLabel: 'Check My Data',
        icon: SearchCheck,
        onClick: async () => {
          const res = await onRunAnalysis(activeDataset.dataset_id);
          if (res) onNavigate('analysis');
        },
        busy: analyzing,
      };
    }
    if (safeToFix > 0) {
      return {
        title: 'Next step: Clean safe problems automatically',
        desc: `We found ${safeToFix} problem${safeToFix === 1 ? '' : 's'} that can be fixed safely in one click.`,
        buttonLabel: 'Clean My Data Automatically',
        icon: Sparkles,
        onClick: () => onRunAutoClean(),
        busy: autoCleaning,
      };
    }
    if (needsAttention > 0) {
      return {
        title: `${needsAttention} item${needsAttention === 1 ? ' needs' : 's need'} your attention`,
        desc: 'Everything safe has been fixed. Review the remaining uncertain items, or download your file whenever you are ready.',
        buttonLabel: 'Review Remaining Items',
        icon: AlertCircle,
        onClick: () => onNavigate('repair'),
        busy: false,
      };
    }
    return {
      title: 'Your cleaned file is ready to download!',
      desc: 'All checks are complete. Head to Reports to see your final summary and download your cleaned spreadsheet.',
      buttonLabel: 'Download Cleaned File',
      icon: Download,
      onClick: () => onNavigate('reports'),
      busy: false,
    };
  }, [
    datasets.length,
    activeDataset,
    analysis,
    safeToFix,
    needsAttention,
    analyzing,
    autoCleaning,
    onNavigate,
    onRunAnalysis,
    onRunAutoClean,
  ]);

  if (loading && !activeDataset && datasets.length === 0) {
    return <WorkspaceSkeleton cards={4} />;
  }

  const NextIcon = nextStep.icon;

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '1.65rem' }}>
      {/* Clear "What should I do next?" Hero Card */}
      <section className="df-hero-card df-stagger">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.1rem' }}>
          <MiniMascot size={64} mood={nextStep.busy ? 'working' : 'idle'} />
          <div>
            <h2 className="df-hero-card__title">{nextStep.title}</h2>
            <p className="df-hero-card__desc">{nextStep.desc}</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button
            type="button"
            className="df-btn df-btn--primary"
            onClick={nextStep.onClick}
            disabled={nextStep.busy || autoCleaning || analyzing}
          >
            {nextStep.busy ? (
              <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <NextIcon size={17} />
            )}
            <span>{nextStep.busy ? 'Working...' : nextStep.buttonLabel}</span>
            {!nextStep.busy && <ArrowRight size={16} />}
          </button>

          {activeDataset && !analysis && (
            <button
              type="button"
              className="df-btn df-btn--secondary"
              onClick={onRunAutoClean}
              disabled={autoCleaning || analyzing}
            >
              <Sparkles size={16} />
              <span>Clean My Data Automatically</span>
            </button>
          )}
        </div>
      </section>

      {/* 4 Simple Status Cards answering the user's immediate questions */}
      <section className="df-kpi-grid" aria-label="Your File Summary">
        <article className="df-kpi df-stagger">
          <div className="df-kpi__top">
            <span>Files Uploaded</span>
            <FileSpreadsheet size={18} style={{ color: 'var(--accent-cyan)' }} />
          </div>
          <div className="df-kpi__value">
            <AnimatedNumber value={datasets.length} />
          </div>
          <div className="df-kpi__delta" style={{ color: 'var(--text-secondary)' }}>
            <span>
              {activeDataset
                ? `Active: ${activeDataset.original_filename}`
                : datasets.length > 0
                  ? 'Select a file in My Files'
                  : 'No file uploaded yet'}
            </span>
          </div>
        </article>

        <article className="df-kpi df-stagger">
          <div className="df-kpi__top">
            <span>Problems Found</span>
            <SearchCheck size={18} style={{ color: 'var(--accent-blue)' }} />
          </div>
          <div className="df-kpi__value">
            {analysis ? <AnimatedNumber value={problemsFound} /> : '—'}
          </div>
          <div className="df-kpi__delta" style={{ color: 'var(--text-secondary)' }}>
            <span>
              {analysis
                ? 'Detected in your spreadsheet'
                : 'Check your file to find issues'}
            </span>
          </div>
        </article>

        <article className="df-kpi df-stagger">
          <div className="df-kpi__top">
            <span>Fixed Automatically</span>
            <CheckCircle2 size={18} style={{ color: 'var(--accent-emerald)' }} />
          </div>
          <div className="df-kpi__value" style={{ color: 'var(--accent-emerald)' }}>
            <AnimatedNumber value={fixedAutomatically} />
          </div>
          <div className="df-kpi__delta" style={{ color: 'var(--text-secondary)' }}>
            <span>
              {repairsCounts?.approved
                ? `${repairsCounts.approved} total fixed & saved`
                : 'Safe formatting & duplicate fixes'}
            </span>
          </div>
        </article>

        <article className="df-kpi df-stagger">
          <div className="df-kpi__top">
            <span>Needs Your Attention</span>
            <AlertCircle size={18} style={{ color: 'var(--accent-amber)' }} />
          </div>
          <div
            className="df-kpi__value"
            style={{ color: needsAttention > 0 ? 'var(--accent-amber)' : 'var(--text-primary)' }}
          >
            <AnimatedNumber value={needsAttention} />
          </div>
          <div className="df-kpi__delta" style={{ color: 'var(--text-secondary)' }}>
            <span>
              {needsAttention > 0
                ? 'Uncertain items waiting for your choice'
                : 'Nothing uncertain waiting'}
            </span>
          </div>
        </article>
      </section>

      {/* Simple Recent Changes Card (shown only when there is activity) */}
      {recentChanges.length > 0 && (
        <section className="df-panel df-stagger">
          <div className="df-panel__head">
            <div>
              <h2 className="df-panel__title">Changes Made</h2>
              <p className="df-panel__subtitle">
                Your latest steps on {activeDataset?.original_filename}
              </p>
            </div>
            <button
              type="button"
              className="df-btn df-btn--secondary df-btn--sm"
              onClick={() => onNavigate('reports')}
            >
              <span>See Full Summary</span>
              <ArrowRight size={14} />
            </button>
          </div>

          <div className="df-activity-list">
            {recentChanges.map((entry) => (
              <div key={entry.audit_id} className="df-activity-item" style={{ cursor: 'default' }}>
                <span style={{ fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                  {formatChangeText(entry)}
                </span>
                <span className="df-activity-item__time">
                  {new Date(entry.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
