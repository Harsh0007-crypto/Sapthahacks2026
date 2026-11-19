import axios from 'axios';

const MISSING_API_URL_MESSAGE =
  'Backend API URL is not configured for production. Set VITE_API_BASE_URL to your deployed backend URL and rebuild the frontend.';

function resolveApiBaseUrl() {
  const configured = (import.meta.env.VITE_API_BASE_URL || '').trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  // In local Vite dev server only, use same-origin paths (/api, /health) via vite.config.js proxy
  if (import.meta.env.DEV) {
    return '';
  }
  // In production builds, never fall back to localhost or silently hit the Static Site origin
  return null;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const IS_PRODUCTION_API_UNCONFIGURED =
  !import.meta.env.DEV && API_BASE_URL === null;

if (IS_PRODUCTION_API_UNCONFIGURED && typeof console !== 'undefined') {
  console.error(`[DATAFIX] ${MISSING_API_URL_MESSAGE}`);
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL ?? '',
  timeout: 30000,
  headers: {
    Accept: 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  if (IS_PRODUCTION_API_UNCONFIGURED) {
    const err = new Error(MISSING_API_URL_MESSAGE);
    err.code = 'ERR_API_URL_MISSING';
    return Promise.reject(err);
  }
  return config;
});

/**
 * Extract a clean, human-readable error message from Axios / FastAPI error responses.
 */
export function extractApiError(error, fallback = 'Request failed. Please try again.') {
  if (!error) return fallback;
  if (error.code === 'ERR_API_URL_MISSING') {
    return error.message || MISSING_API_URL_MESSAGE;
  }
  if (error.response?.data) {
    const { detail, message } = error.response.data;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((item) => item?.msg || JSON.stringify(item))
        .join('; ');
    }
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
    if (import.meta.env.DEV) {
      return "We couldn't reach the local DataFix backend service. Make sure the backend server is running.";
    }
    return "We couldn't reach the DataFix API service. Please check your connection or verify the backend service is online.";
  }
  return error.message || fallback;
}

export async function checkHealth() {
  const { data } = await apiClient.get('/health', { timeout: 5000 });
  return data;
}

export async function uploadDataset(file, onUploadProgress) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await apiClient.post('/api/upload', formData, {
    onUploadProgress,
  });
  return data;
}

export async function listDatasets() {
  const { data } = await apiClient.get('/api/datasets');
  return data;
}

export async function getDataset(datasetId, { limit = 50, offset = 0 } = {}) {
  const { data } = await apiClient.get(`/api/datasets/${datasetId}`, {
    params: { limit, offset },
  });
  return data;
}

export async function analyzeDataset(datasetId) {
  const { data } = await apiClient.post(`/api/analyze/${datasetId}`);
  return data;
}

export async function getAnalysis(datasetId) {
  const { data } = await apiClient.get(`/api/analysis/${datasetId}`);
  return data;
}

export async function listRepairs(datasetId, params = {}) {
  const { data } = await apiClient.get(`/api/repairs/${datasetId}`, {
    params,
  });
  return data;
}

export async function approveRepair(
  repairId,
  customValue = undefined,
  justification = undefined
) {
  const payload = {};
  if (customValue !== undefined && customValue !== '') {
    payload.custom_value = customValue;
  }
  if (justification !== undefined && String(justification).trim() !== '') {
    payload.justification = String(justification).trim();
  }
  const { data } = await apiClient.post(
    `/api/repairs/${repairId}/approve`,
    Object.keys(payload).length > 0 ? payload : undefined
  );
  return data;
}

export async function rejectRepair(repairId, reason = undefined) {
  const payload = reason ? { reason } : undefined;
  const { data } = await apiClient.post(
    `/api/repairs/${repairId}/reject`,
    payload
  );
  return data;
}

export async function undoRepair(repairId) {
  const { data } = await apiClient.post(`/api/repairs/${repairId}/undo`);
  return data;
}

export async function autoCleanDataset(
  datasetId,
  { removeDuplicates = true } = {}
) {
  const { data } = await apiClient.post(`/api/clean/${datasetId}`, {
    remove_duplicates: removeDuplicates,
  });
  return data;
}

export async function getReport(datasetId) {
  const { data } = await apiClient.get(`/api/reports/${datasetId}`);
  return data;
}

export async function exportDataset(datasetId, format = 'csv') {
  const response = await apiClient.get(`/api/export/${datasetId}`, {
    params: { format, _ts: Date.now() },
    responseType: 'blob',
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });

  const exportedDatasetId = response.headers['x-dataset-id'] || null;
  if (exportedDatasetId && exportedDatasetId !== datasetId) {
    throw new Error(
      `Export dataset mismatch: requested ${datasetId} but received ${exportedDatasetId}.`
    );
  }

  let filename = `${datasetId}_cleaned.${format}`;
  const disposition = response.headers['content-disposition'];
  if (disposition) {
    const match = disposition.match(/filename="?([^"]+)"?/i);
    if (match?.[1]) {
      filename = match[1];
    }
  }

  return {
    blob: response.data,
    filename,
    exportedDatasetId: exportedDatasetId || datasetId,
    exportedRowCount: response.headers['x-row-count']
      ? Number(response.headers['x-row-count'])
      : null,
    exportedColumnCount: response.headers['x-column-count']
      ? Number(response.headers['x-column-count'])
      : null,
  };
}
