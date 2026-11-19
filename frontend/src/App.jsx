import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LandingPage from './components/landing/LandingPage';
import WorkspaceLayout from './components/workspace/WorkspaceLayout';
import DashboardView from './components/workspace/DashboardView';
import UploadView from './components/workspace/UploadView';
import AnalysisView from './components/workspace/AnalysisView';
import RepairCenterView from './components/workspace/RepairCenterView';
import ReportsView from './components/workspace/ReportsView';
import {
  analyzeDataset,
  approveRepair,
  autoCleanDataset,
  checkHealth,
  exportDataset,
  extractApiError,
  getAnalysis,
  getDataset,
  getReport,
  listDatasets,
  listRepairs,
  rejectRepair,
  undoRepair,
  uploadDataset,
} from './api/client';

const ACTIVE_DATASET_STORAGE_KEY = 'datafix_active_dataset_id';

const AUTO_CLEAN_STAGES = [
  'Scanning data',
  'Finding issues',
  'Applying safe repairs',
  'Validating results',
  'Generating report',
];

export default function App() {
  const [mode, setMode] = useState('landing'); // 'landing' | 'workspace'
  const [activeView, setActiveView] = useState('dashboard');

  const [backendStatus, setBackendStatus] = useState('checking'); // 'checking' | 'connected' | 'offline'
  const [datasets, setDatasets] = useState([]);
  const [activeDatasetId, setActiveDatasetId] = useState(
    () => window.localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY) || null
  );
  const [datasetDetail, setDatasetDetail] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [repairs, setRepairs] = useState([]);
  const [repairsCounts, setRepairsCounts] = useState({
    pending: 0,
    approved: 0,
    rejected: 0,
    undone: 0,
  });
  const [report, setReport] = useState(null);

  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [loadingDatasetData, setLoadingDatasetData] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [busyRepairId, setBusyRepairId] = useState(null);
  const [autoCleanState, setAutoCleanState] = useState({
    running: false,
    stageIndex: -1,
  });
  const [cleanSummary, setCleanSummary] = useState(null);
  const [exportingFormat, setExportingFormat] = useState(null);
  const [notification, setNotification] = useState(null);

  // Refs to prevent stale async responses from overwriting a newer active dataset
  const activeDatasetIdRef = useRef(activeDatasetId);
  const bundleSeqRef = useRef(0);

  useEffect(() => {
    activeDatasetIdRef.current = activeDatasetId;
    if (activeDatasetId) {
      window.localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, activeDatasetId);
    } else {
      window.localStorage.removeItem(ACTIVE_DATASET_STORAGE_KEY);
    }
  }, [activeDatasetId]);

  const showNotification = useCallback((type, message) => {
    setNotification({ type, message, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!notification) return undefined;
    const timer = window.setTimeout(() => {
      setNotification((curr) => (curr?.id === notification.id ? null : curr));
    }, 5500);
    return () => window.clearTimeout(timer);
  }, [notification]);

  // Sequence-guarded bundle loader so out-of-order responses never corrupt active state
  const loadDatasetBundle = useCallback(
    async (datasetId) => {
      const seq = ++bundleSeqRef.current;

      if (!datasetId) {
        setDatasetDetail(null);
        setAnalysis(null);
        setRepairs([]);
        setRepairsCounts({ pending: 0, approved: 0, rejected: 0, undone: 0 });
        setReport(null);
        setLoadingDatasetData(false);
        return;
      }

      setLoadingDatasetData(true);
      try {
        const [detailRes, repairsRes, reportRes] = await Promise.all([
          getDataset(datasetId, { limit: 50, offset: 0 }),
          listRepairs(datasetId),
          getReport(datasetId),
        ]);

        if (bundleSeqRef.current !== seq || activeDatasetIdRef.current !== datasetId) {
          return;
        }

        setDatasetDetail(detailRes);
        setRepairs(repairsRes.repairs || []);
        setRepairsCounts(
          repairsRes.counts_by_status || {
            pending: 0,
            approved: 0,
            rejected: 0,
            undone: 0,
          }
        );
        setReport(reportRes);

        if (detailRes.has_analysis) {
          try {
            const analysisRes = await getAnalysis(datasetId);
            if (bundleSeqRef.current === seq && activeDatasetIdRef.current === datasetId) {
              setAnalysis(analysisRes);
            }
          } catch (err) {
            if (bundleSeqRef.current === seq && err?.response?.status === 404) {
              setAnalysis(null);
            } else if (bundleSeqRef.current === seq) {
              throw err;
            }
          }
        } else {
          setAnalysis(null);
        }
      } catch (error) {
        if (bundleSeqRef.current !== seq) return;
        if (error?.response?.status === 404) {
          activeDatasetIdRef.current = null;
          setActiveDatasetId(null);
          setDatasetDetail(null);
          setAnalysis(null);
          setRepairs([]);
          setReport(null);
          showNotification(
            'info',
            `Dataset "${datasetId}" no longer exists on the server. Please select or upload a dataset.`
          );
        } else {
          showNotification('error', extractApiError(error));
        }
      } finally {
        if (bundleSeqRef.current === seq) {
          setLoadingDatasetData(false);
        }
      }
    },
    [showNotification]
  );

  const reconnectBackend = useCallback(async ({ silent = false } = {}) => {
    try {
      await checkHealth();
      setBackendStatus('connected');
      const list = await listDatasets();
      setDatasets(list);

      const currentId = activeDatasetIdRef.current;
      if (currentId && !list.some((d) => d.dataset_id === currentId)) {
        activeDatasetIdRef.current = null;
        setActiveDatasetId(null);
        setDatasetDetail(null);
        setAnalysis(null);
        setRepairs([]);
        setReport(null);
      } else if (currentId) {
        await loadDatasetBundle(currentId);
      }
      if (!silent) {
        showNotification('success', 'Connected to the DataFix service.');
      }
      return true;
    } catch (error) {
      setBackendStatus('offline');
      if (!silent) {
        showNotification('error', extractApiError(error));
      }
      return false;
    } finally {
      setLoadingDatasets(false);
    }
  }, [loadDatasetBundle, showNotification]);

  // Automatically poll health every 4s while offline so the UI recovers seamlessly once backend starts
  useEffect(() => {
    if (mode !== 'workspace' || backendStatus !== 'offline') return undefined;
    const id = window.setInterval(() => {
      reconnectBackend({ silent: true });
    }, 4000);
    return () => window.clearInterval(id);
  }, [mode, backendStatus, reconnectBackend]);

  // Initialize workspace: check backend health & load dataset list without silently switching activeDatasetId
  useEffect(() => {
    if (mode !== 'workspace') return undefined;
    let cancelled = false;

    async function initWorkspace() {
      try {
        await checkHealth();
        if (cancelled) return;
        setBackendStatus('connected');
        const list = await listDatasets();
        if (cancelled) return;
        setDatasets(list);

        const currentId = activeDatasetIdRef.current;
        if (currentId && !list.some((d) => d.dataset_id === currentId)) {
          // Do NOT silently fall back to an older dataset; clear stale localStorage ID explicitly
          activeDatasetIdRef.current = null;
          setActiveDatasetId(null);
          setDatasetDetail(null);
          setAnalysis(null);
          setRepairs([]);
          setReport(null);
        }
      } catch (error) {
        if (cancelled) return;
        setBackendStatus('offline');
        showNotification('error', extractApiError(error));
      } finally {
        if (!cancelled) setLoadingDatasets(false);
      }
    }

    initWorkspace();
    return () => {
      cancelled = true;
    };
  }, [mode, showNotification]);

  // Load dataset bundle whenever activeDatasetId changes in workspace mode
  useEffect(() => {
    if (mode !== 'workspace' || !activeDatasetId) return undefined;
    let cancelled = false;
    const seq = ++bundleSeqRef.current;

    async function fetchBundle() {
      try {
        const [detailRes, repairsRes, reportRes] = await Promise.all([
          getDataset(activeDatasetId, { limit: 50, offset: 0 }),
          listRepairs(activeDatasetId),
          getReport(activeDatasetId),
        ]);
        if (cancelled || bundleSeqRef.current !== seq) return;

        setDatasetDetail(detailRes);
        setRepairs(repairsRes.repairs || []);
        setRepairsCounts(
          repairsRes.counts_by_status || {
            pending: 0,
            approved: 0,
            rejected: 0,
            undone: 0,
          }
        );
        setReport(reportRes);

        if (detailRes.has_analysis) {
          try {
            const analysisRes = await getAnalysis(activeDatasetId);
            if (!cancelled && bundleSeqRef.current === seq) {
              setAnalysis(analysisRes);
            }
          } catch (err) {
            if (!cancelled && bundleSeqRef.current === seq && err?.response?.status === 404) {
              setAnalysis(null);
            } else if (!cancelled && bundleSeqRef.current === seq) {
              throw err;
            }
          }
        } else {
          setAnalysis(null);
        }
      } catch (error) {
        if (cancelled || bundleSeqRef.current !== seq) return;
        if (error?.response?.status === 404) {
          activeDatasetIdRef.current = null;
          setActiveDatasetId(null);
          setDatasetDetail(null);
          setAnalysis(null);
          setRepairs([]);
          setReport(null);
        } else {
          showNotification('error', extractApiError(error));
        }
      } finally {
        if (!cancelled && bundleSeqRef.current === seq) {
          setLoadingDatasetData(false);
        }
      }
    }

    fetchBundle();
    return () => {
      cancelled = true;
    };
  }, [mode, activeDatasetId, showNotification]);

  // Only expose detail/analysis/report when their dataset_id matches activeDatasetId
  const activeDataset = useMemo(() => {
    if (datasetDetail && datasetDetail.dataset_id === activeDatasetId) {
      return datasetDetail;
    }
    return datasets.find((d) => d.dataset_id === activeDatasetId) || null;
  }, [datasetDetail, datasets, activeDatasetId]);

  const activeAnalysis = useMemo(
    () => (analysis && analysis.dataset_id === activeDatasetId ? analysis : null),
    [analysis, activeDatasetId]
  );

  const activeReport = useMemo(
    () => (report && report.dataset_id === activeDatasetId ? report : null),
    [report, activeDatasetId]
  );

  const qualityScore = useMemo(() => {
    if (activeReport?.validation?.after_quality_score !== undefined) {
      return activeReport.validation.after_quality_score;
    }
    if (activeAnalysis?.quality_score !== undefined) {
      return activeAnalysis.quality_score;
    }
    return null;
  }, [activeReport, activeAnalysis]);

  const openWorkspace = (targetView) => {
    setLoadingDatasets(true);
    setActiveView(targetView);
    setMode('workspace');
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleUploadFile = async (file, onProgress) => {
    try {
      const res = await uploadDataset(file, onProgress);
      const newId = res.dataset.dataset_id;

      // Invalidate any older in-flight dataset fetches immediately
      bundleSeqRef.current += 1;
      activeDatasetIdRef.current = newId;
      window.localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, newId);

      setBackendStatus('connected');
      setLoadingDatasetData(true);
      setActiveDatasetId(newId);
      setDatasets((prev) => [
        res.dataset,
        ...prev.filter((d) => d.dataset_id !== newId),
      ]);
      setDatasetDetail({
        ...res.dataset,
        profile: res.profile,
        preview_rows: res.preview_rows,
        preview_limit: res.preview_rows.length,
        preview_offset: 0,
        has_analysis: false,
        approved_repairs_count: 0,
        pending_repairs_count: 0,
      });
      setAnalysis(null);
      setRepairs([]);
      setRepairsCounts({ pending: 0, approved: 0, rejected: 0, undone: 0 });
      setReport(null);

      showNotification(
        'success',
        `Uploaded "${res.dataset.original_filename}" (${res.dataset.row_count.toLocaleString()} rows). Click Continue to check your data.`
      );
      return res;
    } catch (error) {
      const msg = extractApiError(error, 'Failed to upload dataset.');
      showNotification('error', msg);
      throw new Error(msg, { cause: error });
    }
  };

  const handleSelectDataset = (datasetId) => {
    if (datasetId === activeDatasetIdRef.current) return;
    // Immediately clear stale dataset state so older data can never appear or be exported
    bundleSeqRef.current += 1;
    activeDatasetIdRef.current = datasetId;
    setDatasetDetail(null);
    setAnalysis(null);
    setRepairs([]);
    setRepairsCounts({ pending: 0, approved: 0, rejected: 0, undone: 0 });
    setReport(null);
    setLoadingDatasetData(true);
    setActiveDatasetId(datasetId);
  };

  const handleRunAnalysis = async (targetDatasetId = activeDatasetIdRef.current) => {
    if (!targetDatasetId) {
      showNotification('error', 'Upload or select a dataset before running analysis.');
      return null;
    }
    setAnalyzing(true);
    try {
      const res = await analyzeDataset(targetDatasetId);
      if (activeDatasetIdRef.current === targetDatasetId) {
        setAnalysis(res);
      }
      await Promise.all([
        loadDatasetBundle(targetDatasetId),
        listDatasets().then(setDatasets),
      ]);
      showNotification(
        'success',
        res.total_issues > 0
          ? `We found ${res.total_issues} problem${res.total_issues === 1 ? '' : 's'} in your file.`
          : 'Great news! We did not find any problems in your file.'
      );
      return res;
    } catch (error) {
      showNotification('error', extractApiError(error, 'Analysis failed.'));
      return null;
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApproveRepair = async (
    repairId,
    customValue = undefined,
    justification = undefined
  ) => {
    const targetDatasetId = activeDatasetIdRef.current;
    setBusyRepairId(repairId);
    try {
      const res = await approveRepair(repairId, customValue, justification);
      await Promise.all([
        loadDatasetBundle(targetDatasetId),
        listDatasets().then(setDatasets),
      ]);
      showNotification(
        'success',
        `Fixed and saved! ${res.current_issue_count === 0 ? 'All problems are resolved.' : `${res.current_issue_count} item${res.current_issue_count === 1 ? '' : 's'} remaining.`}`
      );
    } catch (error) {
      showNotification('error', extractApiError(error, 'Failed to approve repair.'));
    } finally {
      setBusyRepairId(null);
    }
  };

  const handleRejectRepair = async (repairId, reason = undefined) => {
    const targetDatasetId = activeDatasetIdRef.current;
    setBusyRepairId(repairId);
    try {
      const res = await rejectRepair(repairId, reason);
      await loadDatasetBundle(targetDatasetId);
      showNotification('info', res.message);
    } catch (error) {
      showNotification('error', extractApiError(error, 'Failed to reject repair.'));
    } finally {
      setBusyRepairId(null);
    }
  };

  const handleUndoRepair = async (repairId) => {
    const targetDatasetId = activeDatasetIdRef.current;
    setBusyRepairId(repairId);
    try {
      const res = await undoRepair(repairId);
      await Promise.all([
        loadDatasetBundle(targetDatasetId),
        listDatasets().then(setDatasets),
      ]);
      showNotification(
        'info',
        `${res.message} Current rows: ${res.current_row_count}.`
      );
    } catch (error) {
      showNotification('error', extractApiError(error, 'Failed to undo repair.'));
    } finally {
      setBusyRepairId(null);
    }
  };

  const handleRunAutoClean = async (
    targetDatasetId = activeDatasetIdRef.current,
    navigateTo = null
  ) => {
    if (!targetDatasetId) {
      showNotification('error', 'Upload or select a dataset before running automatic cleaning.');
      return null;
    }

    setCleanSummary(null);
    setAutoCleanState({ running: true, stageIndex: 0 });
    try {
      // Stage 1: Scanning dataset
      const detailRes = await getDataset(targetDatasetId, { limit: 50, offset: 0 });
      if (activeDatasetIdRef.current !== targetDatasetId) return null;
      setDatasetDetail(detailRes);

      // Stage 2: Detecting issues
      setAutoCleanState({ running: true, stageIndex: 1 });
      const analysisRes = await analyzeDataset(targetDatasetId);
      if (activeDatasetIdRef.current !== targetDatasetId) return null;
      setAnalysis(analysisRes);

      // Stage 3: Applying safe repairs
      setAutoCleanState({ running: true, stageIndex: 2 });
      const cleanRes = await autoCleanDataset(targetDatasetId, {
        removeDuplicates: true,
      });
      if (activeDatasetIdRef.current !== targetDatasetId) return null;

      // Stage 4: Validating changes
      setAutoCleanState({ running: true, stageIndex: 3 });
      const [updatedDetail, repairsRes, updatedList] = await Promise.all([
        getDataset(targetDatasetId, { limit: 50, offset: 0 }),
        listRepairs(targetDatasetId),
        listDatasets(),
      ]);
      if (activeDatasetIdRef.current !== targetDatasetId) return null;

      // Stage 5: Generating quality report
      setAutoCleanState({ running: true, stageIndex: 4 });
      const finalReport = await getReport(targetDatasetId);
      if (activeDatasetIdRef.current !== targetDatasetId) return null;

      setDatasetDetail(updatedDetail);
      setRepairs(repairsRes.repairs || []);
      setRepairsCounts(
        repairsRes.counts_by_status || {
          pending: 0,
          approved: 0,
          rejected: 0,
          undone: 0,
        }
      );
      setDatasets(updatedList);
      setReport(finalReport);
      setCleanSummary({
        safeApplied: cleanRes.safe_repairs_applied,
        manualReview: cleanRes.manual_review_count,
        unresolved: cleanRes.unresolved_count,
        beforeScore: cleanRes.before_quality_score,
        afterScore: cleanRes.after_quality_score,
      });

      showNotification(
        'success',
        `Done! Fixed ${cleanRes.safe_repairs_applied} problem${cleanRes.safe_repairs_applied === 1 ? '' : 's'} automatically.${
          cleanRes.manual_review_count > 0
            ? ` ${cleanRes.manual_review_count} item${cleanRes.manual_review_count === 1 ? '' : 's'} still need your review.`
            : ''
        }`
      );

      if (navigateTo) {
        setActiveView(navigateTo);
      }
      return cleanRes;
    } catch (error) {
      showNotification(
        'error',
        extractApiError(error, 'Automatic cleaning failed.')
      );
      return null;
    } finally {
      setAutoCleanState({ running: false, stageIndex: -1 });
    }
  };

  const handleExportDataset = async (format, expectedDatasetId = activeDatasetIdRef.current) => {
    const targetId = expectedDatasetId || activeDatasetIdRef.current;
    if (!targetId) {
      showNotification('error', 'No active dataset selected for export.');
      return;
    }
    if (targetId !== activeDatasetIdRef.current) {
      showNotification(
        'error',
        'Active dataset changed while preparing export. Please retry export for the current dataset.'
      );
      return;
    }

    setExportingFormat(format);
    try {
      const { blob, filename, exportedDatasetId, exportedRowCount, exportedColumnCount } =
        await exportDataset(targetId, format);

      if (exportedDatasetId && exportedDatasetId !== activeDatasetIdRef.current) {
        throw new Error(
          `Export safety check blocked download: received ${exportedDatasetId}, expected ${activeDatasetIdRef.current}.`
        );
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const updatedReport = await getReport(targetId);
      if (activeDatasetIdRef.current === targetId) {
        setReport(updatedReport);
      }
      const dims =
        exportedRowCount !== null && exportedColumnCount !== null
          ? ` (${exportedRowCount} rows × ${exportedColumnCount} cols)`
          : '';
      showNotification('success', `Downloaded "${filename}"${dims}.`);
    } catch (error) {
      showNotification(
        'error',
        extractApiError(error, `Failed to export ${format.toUpperCase()}.`)
      );
    } finally {
      setExportingFormat(null);
    }
  };

  if (mode === 'landing') {
    return (
      <LandingPage
        onAnalyzeClick={() => openWorkspace('upload')}
        onExploreClick={() => openWorkspace('dashboard')}
      />
    );
  }

  return (
    <WorkspaceLayout
      activeView={activeView}
      onSelectView={setActiveView}
      onBackToLanding={() => {
        setMode('landing');
        window.scrollTo({ top: 0, behavior: 'auto' });
      }}
      activeDataset={activeDataset}
      hasAnalysis={Boolean(activeAnalysis)}
      approvedRepairsCount={repairsCounts.approved}
      qualityScore={qualityScore}
      pendingRepairsCount={repairsCounts.pending}
      backendStatus={backendStatus}
      onRetryConnection={() => reconnectBackend({ silent: false })}
      autoCleanState={autoCleanState}
      autoCleanStages={AUTO_CLEAN_STAGES}
      cleanSummary={cleanSummary}
      onDismissCleanSummary={() => setCleanSummary(null)}
      notification={notification}
      onDismissNotification={() => setNotification(null)}
    >
      {activeView === 'dashboard' && (
        <DashboardView
          datasets={datasets}
          activeDataset={activeDataset}
          analysis={activeAnalysis}
          repairs={repairs}
          repairsCounts={repairsCounts}
          report={activeReport}
          qualityScore={qualityScore}
          loading={loadingDatasets || loadingDatasetData}
          onNavigate={setActiveView}
          onRunAnalysis={handleRunAnalysis}
          onRunAutoClean={() => handleRunAutoClean(activeDatasetIdRef.current)}
          analyzing={analyzing}
          autoCleaning={autoCleanState.running}
        />
      )}

      {activeView === 'upload' && (
        <UploadView
          datasets={datasets}
          activeDataset={activeDataset}
          analysis={activeAnalysis}
          loadingDatasets={loadingDatasets}
          loadingDetail={loadingDatasetData}
          onUploadFile={handleUploadFile}
          onSelectDataset={handleSelectDataset}
          onGoToAnalysis={() => setActiveView('analysis')}
          onRunAnalysis={async () => {
            const res = await handleRunAnalysis(activeDatasetIdRef.current);
            if (res) setActiveView('analysis');
          }}
          onRunAutoClean={() =>
            handleRunAutoClean(activeDatasetIdRef.current, 'repair')
          }
          analyzing={analyzing}
          autoCleaning={autoCleanState.running}
        />
      )}

      {activeView === 'analysis' && (
        <AnalysisView
          activeDataset={activeDataset}
          analysis={activeAnalysis}
          repairs={repairs}
          busyRepairId={busyRepairId}
          loading={loadingDatasetData}
          analyzing={analyzing}
          autoCleaning={autoCleanState.running}
          onRunAnalysis={() => handleRunAnalysis(activeDatasetIdRef.current)}
          onRunAutoClean={() =>
            handleRunAutoClean(activeDatasetIdRef.current, 'repair')
          }
          onApproveRepair={handleApproveRepair}
          onRejectRepair={handleRejectRepair}
          onUndoRepair={handleUndoRepair}
          onGoToUpload={() => setActiveView('upload')}
          onGoToRepair={() => setActiveView('repair')}
        />
      )}

      {activeView === 'repair' && (
        <RepairCenterView
          activeDataset={activeDataset}
          analysis={activeAnalysis}
          repairs={repairs}
          repairsCounts={repairsCounts}
          loading={loadingDatasetData}
          busyRepairId={busyRepairId}
          autoCleaning={autoCleanState.running}
          onApproveRepair={handleApproveRepair}
          onRejectRepair={handleRejectRepair}
          onUndoRepair={handleUndoRepair}
          onRunAutoClean={() => handleRunAutoClean(activeDatasetIdRef.current)}
          onGoToUpload={() => setActiveView('upload')}
          onGoToAnalysis={() => setActiveView('analysis')}
          onGoToReports={() => setActiveView('reports')}
        />
      )}

      {activeView === 'reports' && (
        <ReportsView
          activeDataset={activeDataset}
          report={activeReport}
          repairs={repairs}
          busyRepairId={busyRepairId}
          loading={loadingDatasetData}
          exportingFormat={exportingFormat}
          onApproveRepair={handleApproveRepair}
          onRejectRepair={handleRejectRepair}
          onUndoRepair={handleUndoRepair}
          onExportDataset={(fmt) =>
            handleExportDataset(fmt, activeDataset?.dataset_id)
          }
          onGoToUpload={() => setActiveView('upload')}
          onGoToAnalysis={() => setActiveView('analysis')}
          onRefreshReport={() =>
            activeDatasetIdRef.current && loadDatasetBundle(activeDatasetIdRef.current)
          }
        />
      )}
    </WorkspaceLayout>
  );
}
