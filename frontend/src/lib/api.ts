/**
 * Typed fetch wrappers for the dim-capture backend.
 *
 * Contract source: backend modules 01 (backend-core), 03 (sku-seed),
 * 04 (dim-api) STATE.md. Base URL comes from `VITE_API_URL`
 * (default `http://localhost:3005`). Every wrapper throws `ApiError` on a
 * non-2xx response so callers can branch on `err.status` (e.g. 404 lookups).
 */

const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3005').replace(/\/+$/, '')

// ---------------------------------------------------------------------------
// Wire types — mirror the backend response shapes exactly.
// ---------------------------------------------------------------------------

/** GET /api/progress */
export interface ProgressResponse {
  total: number
  captured: number
  syncedToCC: number
  pendingSync: number
  percentage: number
}

/** A row in GET /api/skus */
export interface SkuSummary {
  id: string
  barcode: string
  name: string
  hasDims: boolean
}

/** GET /api/skus */
export interface SkuListResponse {
  total: number
  captured: number
  skus: SkuSummary[]
}

/** GET /api/skus/:barcode */
export interface SkuDetail {
  id: string
  barcode: string
  name: string
  hasDims: boolean
  ccDimsCaptured: boolean
  source: 'db' | 'cc'
}

/** A persisted dimension record (POST/PUT /api/dims). */
export interface Dim {
  id: number
  skuId: string
  lengthMm: number
  widthMm: number
  heightMm: number
  weightKg: number
  measuredBy: string
  measuredAt: string
  syncedToCC: boolean
  syncedAt: string | null
  notes: string | null
}

/** POST /api/dims body. */
export interface SaveDimPayload {
  skuId: string
  lengthMm: number
  widthMm: number
  heightMm: number
  weightKg: number
  measuredBy: string
  notes?: string
}

/** PUT /api/dims/:id body (a correction — no skuId). */
export interface UpdateDimPayload {
  lengthMm: number
  widthMm: number
  heightMm: number
  weightKg: number
  measuredBy: string
  notes?: string
}

/** POST /api/sync/cc */
export interface SyncReport {
  synced: number
  failed: number
  pending: number
}

/** A row in GET /api/dims — a Dim joined with its SKU's name + barcode. */
export interface DimWithSku extends Dim {
  sku: { name: string; barcode: string }
}

// ---------------------------------------------------------------------------
// Error type + request helper
// ---------------------------------------------------------------------------

/** Thrown for any non-2xx response. `body` is the parsed error payload if any. */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch (cause) {
    // Network failure / backend down — surface as a 0-status ApiError so the
    // shell can degrade gracefully (e.g. the progress badge falls back to —).
    throw new ApiError(0, 'Network error: backend unreachable', cause)
  }

  const text = await res.text()
  const data: unknown = text ? safeJson(text) : null

  if (!res.ok) {
    const message =
      (isRecord(data) && typeof data.error === 'string' && data.error) ||
      `Request failed: ${res.status} ${res.statusText}`
    throw new ApiError(res.status, message, data)
  }

  return data as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

export const api = {
  getProgress(): Promise<ProgressResponse> {
    return request<ProgressResponse>('/api/progress')
  },

  getSkus(): Promise<SkuListResponse> {
    return request<SkuListResponse>('/api/skus')
  },

  getSkuByBarcode(barcode: string): Promise<SkuDetail> {
    return request<SkuDetail>(`/api/skus/${encodeURIComponent(barcode)}`)
  },

  getDims(): Promise<DimWithSku[]> {
    return request<DimWithSku[]>('/api/dims')
  },

  saveDim(payload: SaveDimPayload): Promise<Dim> {
    return request<Dim>('/api/dims', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  updateDim(id: number, payload: UpdateDimPayload): Promise<Dim> {
    return request<Dim>(`/api/dims/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },

  syncToCC(): Promise<SyncReport> {
    return request<SyncReport>('/api/sync/cc', { method: 'POST' })
  },
} as const

export { API_BASE }
