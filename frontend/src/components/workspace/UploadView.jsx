import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import { WorkspaceSkeleton } from './MotionPrimitives';
import { useStaggerEntrance } from './useStaggerEntrance';
import { MiniMascot } from '../landing/Mascot2D';

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const FILE_STATUS = {
  repaired: { label: 'Cleaned', pill: 'df-pill--emerald' },
  analyzed: { label: 'Checked', pill: 'df-pill--violet' },
  uploaded: { label: 'Uploaded', pill: 'df-pill--cyan' },
};

export default function UploadView({
  datasets,
  activeDataset,
  analysis,
  loadingDatasets,
  loadingDetail,
  onUploadFile,
  onSelectDataset,
  onRunAnalysis,
  onRunAutoClean,
  analyzing,
  autoCleaning,
}) {
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);

  useStaggerEntrance(containerRef, activeDataset?.dataset_id || 'upload');

  const flaggedCells = useMemo(() => {
    const set = new Set();
    if (analysis?.issues) {
      for (const iss of analysis.issues) {
        if (iss.column_name) {
          set.add(`${iss.row_index}::${iss.column_name}`);
        } else {
          set.add(`${iss.row_index}::__ROW__`);
        }
      }
    }
    return set;
  }, [analysis]);

  const handleFiles = async (files) => {
    if (!files || !files.length) return;
    const file = files[0];
    setUploadError(null);
    setUploading(true);
    setUploadProgress(15);

    try {
      await onUploadFile(file, (evt) => {
        if (evt.total) {
          const pct = Math.min(95, Math.round((evt.loaded / evt.total) * 100));
          setUploadProgress(pct);
        }
      });
      setUploadProgress(100);
    } catch (err) {
      setUploadError(err.message || 'Could not upload this file. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (!uploading) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const profileColumns = activeDataset?.profile?.columns || [];
  const previewRows = activeDataset?.preview_rows || [];

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '1.65rem' }}>
      {/* One Large, Friendly Upload Area */}
      <div
        className={`df-dropzone df-stagger ${isDragging ? 'df-dropzone--drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!uploading) fileInputRef.current?.click();
          }
        }}
        aria-label="Upload your spreadsheet"
        style={{ padding: '3rem 1.75rem' }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />

        <div className="df-dropzone__mascot" aria-hidden="true">
          <MiniMascot size={62} mood={uploading ? 'working' : 'idle'} />
        </div>

        <div>
          <h2 className="df-display" style={{ fontSize: '1.55rem', fontWeight: 600 }}>
            {uploading ? 'Uploading your spreadsheet...' : 'Upload your spreadsheet'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.96rem', marginTop: '0.4rem' }}>
            Choose a CSV or Excel file and DataFix will check it for problems.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', marginTop: '0.35rem' }}>
            Supported formats: .csv, .xlsx, .xls · Maximum file size: 25 MB · Your original file is always kept safe.
          </p>
        </div>

        {uploading ? (
          <div style={{ width: '100%', maxWidth: '420px', marginTop: '0.6rem' }}>
            <div className="df-progress-track">
              <div className="df-progress-fill" style={{ width: `${uploadProgress}%` }} />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.85rem',
                color: 'var(--accent-cyan-bright)',
                marginTop: '0.5rem',
              }}
            >
              <span>Reading your file...</span>
              <span>{uploadProgress}%</span>
            </div>
          </div>
        ) : (
          <span className="df-btn df-btn--primary" style={{ marginTop: '0.5rem' }}>
            <UploadCloud size={16} />
            <span>Browse Files</span>
          </span>
        )}
      </div>

      {uploadError && (
        <div
          className="df-panel"
          role="alert"
          style={{
            borderColor: 'rgba(251, 113, 133, 0.45)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.7rem',
            color: '#fecdd3',
            fontSize: '0.92rem',
          }}
        >
          <AlertCircle size={18} />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Uploaded File Confirmation + Clear Continue Button */}
      {activeDataset && (
        <div className="df-panel df-stagger">
          <div className="df-panel__head">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <CheckCircle2 size={20} style={{ color: 'var(--accent-emerald)' }} />
                <h2 className="df-panel__title">{activeDataset.original_filename}</h2>
              </div>
              <p className="df-panel__subtitle">
                {activeDataset.row_count.toLocaleString()} rows · {activeDataset.column_count} columns ·{' '}
                {formatBytes(activeDataset.file_size_bytes)}
              </p>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.7rem' }}>
              <button
                type="button"
                className="df-btn df-btn--primary"
                onClick={onRunAnalysis}
                disabled={analyzing || autoCleaning}
              >
                {analyzing ? (
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <span>Check My Data</span>
                )}
                {!analyzing && <ArrowRight size={16} />}
                {analyzing && <span>Checking your file...</span>}
              </button>

              <button
                type="button"
                className="df-btn df-btn--secondary"
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
            </div>
          </div>

          {loadingDetail && previewRows.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-secondary)', padding: '1.5rem 0' }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Loading preview...</span>
            </div>
          ) : (
            <div className="df-table-wrap">
              <table className="df-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    {profileColumns.map((col) => (
                      <th key={col.name}>{col.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 12).map((row, idx) => {
                    const isDupRow = flaggedCells.has(`${idx}::__ROW__`);
                    return (
                      <tr key={idx}>
                        <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                        {profileColumns.map((col) => {
                          const rawVal = row[col.name];
                          const isMissingVal =
                            rawVal === null || rawVal === undefined || String(rawVal).trim() === '';
                          const isFlagged =
                            isDupRow || isMissingVal || flaggedCells.has(`${idx}::${col.name}`);
                          const displayVal = isMissingVal ? 'Empty' : String(rawVal);

                          return (
                            <td key={col.name}>
                              {isFlagged ? (
                                <span className="df-cell-fault">{displayVal}</span>
                              ) : (
                                displayVal
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Previously Uploaded Files */}
      {datasets.length > 0 && (
        <div className="df-panel df-stagger">
          <div className="df-panel__head">
            <div>
              <h2 className="df-panel__title">Your Uploaded Files</h2>
              <p className="df-panel__subtitle">
                Click any file to switch to it
              </p>
            </div>
            <span className="df-pill df-pill--cyan">
              {datasets.length} {datasets.length === 1 ? 'File' : 'Files'}
            </span>
          </div>

          {loadingDatasets ? (
            <WorkspaceSkeleton cards={2} />
          ) : (
            <div className="df-preset-grid">
              {datasets.map((ds) => {
                const isActive = activeDataset?.dataset_id === ds.dataset_id;
                const badge = FILE_STATUS[ds.status] || FILE_STATUS.uploaded;
                return (
                  <button
                    key={ds.dataset_id}
                    type="button"
                    className={`df-preset-card ${isActive ? 'df-preset-card--active' : ''}`}
                    onClick={() => onSelectDataset(ds.dataset_id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <FileSpreadsheet size={19} style={{ color: 'var(--accent-cyan)' }} />
                      <span className={`df-pill ${badge.pill}`}>{badge.label}</span>
                    </div>
                    <div
                      style={{
                        fontSize: '0.93rem',
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        marginTop: '0.35rem',
                        wordBreak: 'break-all',
                      }}
                    >
                      {ds.original_filename}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {ds.row_count.toLocaleString()} rows · {ds.column_count} columns · {formatBytes(ds.file_size_bytes)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
