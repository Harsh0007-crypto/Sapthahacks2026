import { useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Copy,
  FileWarning,
  Loader2,
  Play,
  Search,
  Sparkles,
  Type,
  Unlink,
  UploadCloud,
} from 'lucide-react';
import { AnimatedNumber, WorkspaceSkeleton } from './MotionPrimitives';
import { useStaggerEntrance } from './useStaggerEntrance';
import ManualCorrectionCard from './ManualCorrectionCard';
import { MiniMascot } from '../landing/Mascot2D';

const SIMPLE_CATEGORIES = [
  {
    id: 'missing_value',
    label: 'Missing Information',
    shortDesc: 'Some cells in your file are empty.',
    icon: Unlink,
    color: 'var(--accent-cyan)',
  },
  {
    id: 'duplicate_record',
    label: 'Duplicate Entries',
    shortDesc: 'Exact repeated rows were found.',
    icon: Copy,
    color: 'var(--accent-blue)',
  },
  {
    id: 'invalid_format',
    label: 'Incorrect Format',
    shortDesc: 'Dates, emails, or numbers are formatted differently.',
    icon: Type,
    color: 'var(--accent-violet-soft)',
  },
  {
    id: 'inconsistent_category',
    label: 'Different Formatting',
    shortDesc: 'Same value written with different capitalization or extra spaces.',
    icon: FileWarning,
    color: 'var(--accent-amber)',
  },
  {
    id: 'statistical_anomaly',
    label: 'Unusual Values',
    shortDesc: 'Numbers that look unusually high, low, or negative.',
    icon: AlertOctagon,
    color: 'var(--accent-rose)',
  },
];

const LABEL_MAP = Object.fromEntries(SIMPLE_CATEGORIES.map((c) => [c.id, c.label]));

function formatShortValue(val) {
  if (val === null || val === undefined || val === '') return 'Empty';
  if (typeof val === 'object') return 'Repeated row';
  return String(val);
}

function formatTechnicalDescription(description, rowIndex) {
  if (!description) return '';
  const zeroBasedPattern = new RegExp(`\\brow\\s+${rowIndex}\\b`, 'gi');
  return String(description).replace(zeroBasedPattern, `Row ${rowIndex + 1}`);
}

function humanizeIssueSummary(issue) {
  const col = issue.column_name ? `"${issue.column_name}"` : 'this row';
  switch (issue.issue_type) {
    case 'missing_value':
      return `The ${col} cell is empty.`;
    case 'duplicate_record':
      return 'This row is an exact copy of an earlier row.';
    case 'inconsistent_category':
      return `The wording or capitalization in ${col} does not match other rows.`;
    case 'invalid_format':
      return `The value in ${col} is not in a standard format.`;
    case 'statistical_anomaly':
      return `The number in ${col} looks unusual compared to the rest of your file.`;
    default:
      return issue.description;
  }
}

export default function AnalysisView({
  activeDataset,
  analysis,
  repairs = [],
  busyRepairId = null,
  loading,
  analyzing,
  autoCleaning,
  onRunAnalysis,
  onRunAutoClean,
  onApproveRepair,
  onRejectRepair,
  onUndoRepair,
  onGoToUpload,
  onGoToRepair,
}) {
  const containerRef = useRef(null);
  const tableRef = useRef(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [activeRepairKey, setActiveRepairKey] = useState(null);

  useStaggerEntrance(containerRef, analysis?.analysis_id || activeDataset?.dataset_id || 'check');

  const columnProfilesByName = useMemo(() => {
    const map = {};
    const cols = activeDataset?.profile?.columns || analysis?.profile?.columns || [];
    for (const c of cols) map[c.name] = c;
    return map;
  }, [activeDataset, analysis]);

  const repairsByKey = useMemo(() => {
    const map = {};
    for (const r of repairs) {
      map[`${r.row_index}::${r.column_name || '__ROW__'}::${r.issue_type}`] = r;
    }
    return map;
  }, [repairs]);

  const activeRepairItem = activeRepairKey ? repairsByKey[activeRepairKey] || null : null;

  const issues = useMemo(() => analysis?.issues || [], [analysis]);
  const issuesByType = useMemo(() => analysis?.issues_by_type || {}, [analysis]);

  // Grab one real example per category from the user's file
  const exampleByType = useMemo(() => {
    const map = {};
    for (const issue of issues) {
      if (!map[issue.issue_type]) {
        map[issue.issue_type] = issue;
      }
    }
    return map;
  }, [issues]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (filter !== 'all' && issue.issue_type !== filter) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        String(issue.row_index + 1).includes(q) ||
        (issue.column_name || '').toLowerCase().includes(q) ||
        (LABEL_MAP[issue.issue_type] || '').toLowerCase().includes(q) ||
        issue.description.toLowerCase().includes(q) ||
        formatShortValue(issue.value).toLowerCase().includes(q)
      );
    });
  }, [issues, filter, query]);

  const handleSelectCategory = (categoryId) => {
    setFilter((prev) => (prev === categoryId ? 'all' : categoryId));
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
          Upload a CSV or Excel spreadsheet first, and we will check it for problems.
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

  if (loading && !analysis) {
    return <WorkspaceSkeleton cards={4} />;
  }

  if (!analysis) {
    return (
      <div className="df-panel" style={{ textAlign: 'center', padding: '3.25rem 1.5rem' }}>
        <Sparkles size={34} style={{ color: 'var(--accent-cyan)', margin: '0 auto 1rem' }} />
        <h2 className="df-panel__title" style={{ fontSize: '1.3rem' }}>
          Ready to check &ldquo;{activeDataset.original_filename}&rdquo;
        </h2>
        <p className="df-panel__subtitle" style={{ marginTop: '0.5rem', marginBottom: '1.4rem' }}>
          We will scan your spreadsheet for empty cells, duplicates, formatting differences, and unusual numbers.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button
            type="button"
            className="df-btn df-btn--primary"
            onClick={onRunAnalysis}
            disabled={analyzing || autoCleaning}
          >
            {analyzing ? (
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Play size={16} />
            )}
            <span>{analyzing ? 'Checking your file...' : 'Check My Data'}</span>
          </button>
          <button
            type="button"
            className="df-btn df-btn--secondary"
            onClick={onRunAutoClean}
            disabled={autoCleaning || analyzing}
          >
            <Sparkles size={16} />
            <span>Clean My Data Automatically</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '1.6rem' }}>
      {/* Simple Summary & Next Step */}
      <section className="df-hero-card df-stagger">
        <div>
          <h2 className="df-hero-card__title">
            We found <AnimatedNumber value={analysis.total_issues} /> problem
            {analysis.total_issues === 1 ? '' : 's'} in &ldquo;{activeDataset.original_filename}&rdquo;
          </h2>
          <p className="df-hero-card__desc">
            Review the simple summary below, or let DataFix clean safe problems automatically in one click.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.7rem' }}>
          <button
            type="button"
            className="df-btn df-btn--primary"
            onClick={onRunAutoClean}
            disabled={autoCleaning || analyzing}
          >
            {autoCleaning ? (
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Sparkles size={16} />
            )}
            <span>{autoCleaning ? 'Cleaning...' : 'Clean My Data Automatically'}</span>
          </button>
          <button
            type="button"
            className="df-btn df-btn--secondary"
            onClick={onGoToRepair}
          >
            <span>Continue to Clean Data</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </section>

      {/* 5 Everyday-English Problem Cards with Simple Examples */}
      <section className="df-issue-card-grid" aria-label="Problems Found">
        {SIMPLE_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const count = issuesByType[cat.id] || 0;
          const example = exampleByType[cat.id];
          const isActive = filter === cat.id;

          return (
            <div
              key={cat.id}
              className={`df-issue-card df-stagger ${isActive ? 'df-issue-card--active' : ''}`}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                  <Icon size={17} style={{ color: cat.color }} />
                  <span>{cat.label}</span>
                </span>
                <span className={`df-pill ${count > 0 ? 'df-pill--amber' : 'df-pill--emerald'}`}>
                  {count > 0 ? `${count} found` : 'None'}
                </span>
              </div>

              <div className="df-kpi__value" style={{ fontSize: '1.9rem', marginTop: '0.1rem' }}>
                <AnimatedNumber value={count} />
              </div>

              <p style={{ fontSize: '0.87rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {cat.shortDesc}
              </p>

              {example && (
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    padding: '0.45rem 0.6rem',
                    borderRadius: '8px',
                    background: 'rgba(15, 23, 42, 0.55)',
                  }}
                >
                  Example: Row {example.row_index + 1}
                  {example.column_name ? ` (${example.column_name})` : ''} —{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {formatShortValue(example.value)}
                  </strong>
                </div>
              )}

              <button
                type="button"
                className="df-btn df-btn--secondary df-btn--sm"
                style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}
                onClick={() => handleSelectCategory(cat.id)}
              >
                <span>{isActive ? 'Showing Below' : 'See Details'}</span>
                <ArrowDown size={14} />
              </button>
            </div>
          );
        })}
      </section>

      {/* Clean Details List with Optional "More details" Toggle */}
      <div ref={tableRef} className="df-panel df-stagger">
        <div className="df-toolbar" style={{ marginBottom: '1.15rem' }}>
          <div className="df-filter-tabs" role="tablist" aria-label="Filter problems">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              className={`df-tab ${filter === 'all' ? 'df-tab--active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All ({issues.length})
            </button>
            {SIMPLE_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={filter === c.id}
                className={`df-tab ${filter === c.id ? 'df-tab--active' : ''}`}
                onClick={() => setFilter(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <label className="df-search">
              <Search size={15} style={{ color: 'var(--text-muted)' }} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search row or column..."
                aria-label="Search problems"
              />
            </label>

            <button
              type="button"
              className="df-btn df-btn--secondary df-btn--sm"
              onClick={() => setShowMoreDetails((prev) => !prev)}
            >
              <span>{showMoreDetails ? 'Less details' : 'More details'}</span>
              {showMoreDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {activeRepairItem && (
          <div style={{ marginBottom: '1.25rem' }}>
            <ManualCorrectionCard
              key={activeRepairItem.repair_id}
              item={activeRepairItem}
              columnProfile={
                activeRepairItem.column_name
                  ? columnProfilesByName[activeRepairItem.column_name]
                  : null
              }
              busy={busyRepairId === activeRepairItem.repair_id || autoCleaning}
              onSave={onApproveRepair}
              onKeepOriginal={onRejectRepair}
              onUndo={onUndoRepair}
            />
          </div>
        )}

        {/* Desktop & Tablet Table (fits container with Action always visible) */}
        <div className="df-table-wrap df-desktop-table">
          <table className="df-table df-table--compact">
            <thead>
              <tr>
                <th>Row</th>
                <th>Column</th>
                <th>Problem</th>
                <th>Current Value</th>
                <th>Explanation</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredIssues.map((issue) => {
                const key = `${issue.row_index}::${issue.column_name || '__ROW__'}::${issue.issue_type}`;
                const matchingRepair = repairsByKey[key];
                const isSelected = activeRepairKey === key;

                return (
                  <tr key={issue.issue_id} className={isSelected ? 'df-row--selected' : ''}>
                    <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      Row {issue.row_index + 1}
                    </td>
                    <td>{issue.column_name || 'Entire Row'}</td>
                    <td>
                      <span className="df-pill df-pill--violet">
                        {LABEL_MAP[issue.issue_type] || issue.issue_type}
                      </span>
                    </td>
                    <td style={{ maxWidth: '165px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span className="df-cell-fault">{formatShortValue(issue.value)}</span>
                    </td>
                    <td className="df-td-wrap" style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                      <div>
                        {showMoreDetails
                          ? formatTechnicalDescription(issue.description, issue.row_index)
                          : humanizeIssueSummary(issue)}
                      </div>
                      {showMoreDetails && issue.rule && (
                        <div className="df-rule-tag">Rule: {issue.rule}</div>
                      )}
                    </td>
                    <td>
                      {matchingRepair ? (
                        <button
                          type="button"
                          className="df-btn df-btn--secondary df-btn--sm"
                          onClick={() => setActiveRepairKey(isSelected ? null : key)}
                        >
                          <span>
                            {isSelected
                              ? 'Close'
                              : matchingRepair.status === 'approved'
                                ? 'Fixed'
                                : 'Fix'}
                          </span>
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredIssues.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{ textAlign: 'center', padding: '2.25rem', color: 'var(--text-secondary)' }}
                  >
                    No problems match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Cards (<= 768px) */}
        <div className="df-mobile-cards" aria-label="Problems List">
          {filteredIssues.map((issue) => {
            const key = `${issue.row_index}::${issue.column_name || '__ROW__'}::${issue.issue_type}`;
            const matchingRepair = repairsByKey[key];
            const isSelected = activeRepairKey === key;

            return (
              <article
                key={issue.issue_id}
                className={`df-mobile-card ${isSelected ? 'df-mobile-card--selected' : ''}`}
              >
                <div className="df-mobile-card__top">
                  <div className="df-mobile-card__row">
                    <strong>Row {issue.row_index + 1}</strong>
                    <span>· {issue.column_name || 'Entire Row'}</span>
                  </div>
                  <span className="df-pill df-pill--violet">
                    {LABEL_MAP[issue.issue_type] || issue.issue_type}
                  </span>
                </div>

                <div className="df-mobile-card__val">
                  <span className="df-mobile-card__label">Current Value</span>
                  <span className="df-cell-fault">{formatShortValue(issue.value)}</span>
                </div>

                <p className="df-mobile-card__desc">
                  {showMoreDetails
                    ? formatTechnicalDescription(issue.description, issue.row_index)
                    : humanizeIssueSummary(issue)}
                </p>

                {showMoreDetails && issue.rule && (
                  <div className="df-rule-tag">Rule: {issue.rule}</div>
                )}

                {matchingRepair && (
                  <button
                    type="button"
                    className="df-btn df-btn--secondary df-btn--sm"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => setActiveRepairKey(isSelected ? null : key)}
                  >
                    <span>
                      {isSelected
                        ? 'Close'
                        : matchingRepair.status === 'approved'
                          ? 'Fixed'
                          : 'Fix This Item'}
                    </span>
                  </button>
                )}
              </article>
            );
          })}

          {filteredIssues.length === 0 && (
            <div style={{ textAlign: 'center', padding: '1.75rem', color: 'var(--text-secondary)' }}>
              No problems match this filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
