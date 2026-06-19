// client.ts — Main Scopebound API client.
//
// Wire format note: the server uses snake_case JSON; TypeScript consumers
// see camelCase. The transcode helpers below convert at the HTTP boundary
// so the wire format is invisible to callers.

import {
  AgentRole,
  EvaluationFilter,
  EvaluationListItem,
  EvaluationRecord,
  EvaluationRequest,
  EvaluationResult,
  ScopeboundClientOptions,
} from './types.js';
import {
  ScopeboundAPIError,
  ScopeboundAuthError,
  ScopeboundNetworkError,
  ScopeboundNotFoundError,
  ScopeboundValidationError,
} from './errors.js';

const DEFAULT_BASE_URL = 'https://api.scopebound.ai';
const DEFAULT_TIMEOUT_MS = 30_000;
const AUTH_HEADER = 'X-Scopebound-API-Key';
const SDK_VERSION = '0.1.0-preview.1';

// ─── camelCase ↔ snake_case at the wire boundary ──────────────────────────────

function snakeCase(key: string): string {
  return key.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function camelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function transformKeys(value: unknown, transform: (k: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => transformKeys(v, transform));
  }
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        transform(k),
        transformKeys(v, transform),
      ]),
    );
  }
  return value;
}

const toWire = (v: unknown): unknown => transformKeys(v, snakeCase);
const fromWire = (v: unknown): unknown => transformKeys(v, camelCase);

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * Main Scopebound API client.
 *
 * @example
 * ```typescript
 * const client = new ScopeboundClient({
 *   apiKey: process.env.SCOPEBOUND_API_KEY!,
 * });
 *
 * const result = await client.evaluate({
 *   roleId: 'ap-processor',
 *   evaluationProfile: ['SOC1', 'PRODUCTION_READINESS'],
 *   workflow: { ... },
 * });
 *
 * if (result.productionReadinessStatus === 'fail') {
 *   for (const v of result.violations) {
 *     console.error(`${v.code}: ${v.message}`);
 *   }
 * }
 * ```
 */
export class ScopeboundClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ScopeboundClientOptions) {
    if (!options.apiKey) {
      throw new Error('ScopeboundClient: apiKey is required');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error(
        'ScopeboundClient: no fetch implementation available. ' +
          'Node 18+ has native fetch; older runtimes need a polyfill passed via options.fetch.',
      );
    }
  }

  // ─── Workflow evaluation (primary use case) ─────────────────────────────────

  /**
   * Evaluate a workflow against the specified role and compliance profiles.
   *
   * For canonical Savant-shaped workflows, pass `workflow`. For source-native
   * exports (n8n, Make, Zapier), pass `workflowRaw` + `sourceFormat` and the
   * server-side translator will produce the canonical DAG.
   *
   * @throws ScopeboundAuthError on invalid API key
   * @throws ScopeboundNotFoundError if roleId doesn't exist
   * @throws ScopeboundValidationError on malformed request
   * @throws ScopeboundAPIError on other 4xx/5xx
   * @throws ScopeboundNetworkError on network failure
   */
  async evaluate(request: EvaluationRequest): Promise<EvaluationResult> {
    return this.request<EvaluationResult>('POST', '/v1/workflow/evaluate', request);
  }

  // ─── Role management ────────────────────────────────────────────────────────

  /**
   * List all roles registered for the authenticated partner.
   */
  async listRoles(): Promise<AgentRole[]> {
    const res = await this.request<{ roles: AgentRole[] }>('GET', '/mgmt/v1/roles');
    return res.roles;
  }

  /**
   * Fetch a single role by ID.
   *
   * @throws ScopeboundNotFoundError if no role with this ID exists
   */
  async getRole(roleId: string): Promise<AgentRole> {
    return this.request<AgentRole>('GET', `/mgmt/v1/roles/${encodeURIComponent(roleId)}`);
  }

  /**
   * Fetch a single role by human-readable name.
   *
   * @throws ScopeboundNotFoundError if no role with this name exists
   */
  async getRoleByName(name: string): Promise<AgentRole> {
    return this.request<AgentRole>(
      'GET',
      `/mgmt/v1/roles/by-name/${encodeURIComponent(name)}`,
    );
  }

  // ─── Evaluation history ─────────────────────────────────────────────────────

  /**
   * List recent evaluations for the authenticated partner, optionally
   * filtered. Results are paginated; use `offset` and `limit` to page.
   */
  async listEvaluations(filter?: EvaluationFilter): Promise<EvaluationListItem[]> {
    const params = new URLSearchParams();
    if (filter?.roleId) params.set('role_id', filter.roleId);
    if (filter?.workflowId) params.set('workflow_id', filter.workflowId);
    if (filter?.status) params.set('status', filter.status);
    if (filter?.since) params.set('since', filter.since);
    if (filter?.until) params.set('until', filter.until);
    if (filter?.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter?.offset !== undefined) params.set('offset', String(filter.offset));

    const query = params.toString();
    const path = query ? `/v1/evaluations?${query}` : '/v1/evaluations';
    const res = await this.request<{ evaluations: EvaluationListItem[] }>('GET', path);
    return res.evaluations;
  }

  /**
   * Fetch a single evaluation by ID, including the full result payload.
   *
   * @throws ScopeboundNotFoundError if no evaluation with this ID exists
   */
  async getEvaluation(evaluationId: string): Promise<EvaluationRecord> {
    return this.request<EvaluationRecord>(
      'GET',
      `/v1/evaluations/${encodeURIComponent(evaluationId)}`,
    );
  }

  // ─── Internal HTTP plumbing ─────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          [AUTH_HEADER]: this.apiKey,
          'Content-Type': 'application/json',
          'User-Agent': `scopebound-sdk-typescript/${SDK_VERSION}`,
        },
        body: body !== undefined ? JSON.stringify(toWire(body)) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      throw new ScopeboundNetworkError(
        `Scopebound API request failed: ${cause.message}`,
        cause,
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    const requestId = response.headers.get('X-Request-Id') ?? undefined;
    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const rawBody = isJson ? await response.json() : await response.text();

    if (response.ok) {
      return fromWire(rawBody) as T;
    }

    // Map status codes to specific error subclasses for ergonomic catching
    const errorMessage = isJson
      ? extractErrorMessage(rawBody) ?? `Scopebound API returned ${response.status}`
      : String(rawBody).slice(0, 500);

    switch (response.status) {
      case 400:
        throw new ScopeboundValidationError(errorMessage, rawBody, requestId);
      case 401:
        throw new ScopeboundAuthError(rawBody, requestId);
      case 404:
        throw new ScopeboundNotFoundError(errorMessage, rawBody, requestId);
      default:
        throw new ScopeboundAPIError(errorMessage, response.status, rawBody, requestId);
    }
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const obj = body as Record<string, unknown>;
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.error === 'string') return obj.error;
  return undefined;
}
