// Tests for ScopeboundClient. Focused on the wire transcoding and error
// mapping that's easy to get subtly wrong. Network calls are mocked.

import { describe, it, expect, vi } from 'vitest';
import { ScopeboundClient } from '../src/client.js';
import {
  ScopeboundAuthError,
  ScopeboundNotFoundError,
  ScopeboundValidationError,
  ScopeboundAPIError,
} from '../src/errors.js';

function mockFetch(response: {
  status: number;
  body: unknown;
  contentType?: string;
}): typeof fetch {
  return vi.fn(async () => {
    const headers = new Headers({
      'content-type': response.contentType ?? 'application/json',
      'x-request-id': 'req_test_123',
    });
    const bodyStr =
      response.contentType === 'text/plain'
        ? String(response.body)
        : JSON.stringify(response.body);
    return new Response(bodyStr, { status: response.status, headers });
  }) as unknown as typeof fetch;
}

describe('ScopeboundClient', () => {
  describe('constructor', () => {
    it('throws when apiKey is missing', () => {
      expect(() => new ScopeboundClient({ apiKey: '' })).toThrow(/apiKey is required/);
    });

    it('strips trailing slash from baseUrl', () => {
      const client = new ScopeboundClient({
        apiKey: 'sb-test',
        baseUrl: 'http://localhost:8080/',
        fetch: mockFetch({ status: 200, body: {} }),
      });
      // No public way to read baseUrl; this just validates construction succeeds.
      expect(client).toBeDefined();
    });
  });

  describe('evaluate', () => {
    it('converts camelCase request to snake_case on the wire', async () => {
      const fetchSpy = mockFetch({
        status: 200,
        body: {
          evaluation_id: 'eval_123',
          workflow_hash: 'hash_abc',
          soc1_status: 'pass',
          soc2_status: 'not_evaluated',
          production_readiness_status: 'pass',
          violations: [],
          warnings: [],
          evaluated_at: '2026-06-19T12:00:00Z',
        },
      });

      const client = new ScopeboundClient({ apiKey: 'sb-test', fetch: fetchSpy });

      await client.evaluate({
        roleId: 'ap-processor',
        evaluationProfile: ['SOC1'],
        workflow: {
          workflowId: 'wf-1',
          nodes: [],
          edges: [],
        },
      });

      const call = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const requestInit = call[1] as RequestInit;
      const wireBody = JSON.parse(requestInit.body as string);

      expect(wireBody).toMatchObject({
        role_id: 'ap-processor',
        evaluation_profile: ['SOC1'],
        workflow: {
          workflow_id: 'wf-1',
        },
      });
    });

    it('converts snake_case response to camelCase', async () => {
      const client = new ScopeboundClient({
        apiKey: 'sb-test',
        fetch: mockFetch({
          status: 200,
          body: {
            evaluation_id: 'eval_123',
            workflow_hash: 'hash_abc',
            soc1_status: 'fail',
            soc2_status: 'not_evaluated',
            production_readiness_status: 'fail',
            violations: [
              {
                node_id: 'n1',
                code: 'SB-SCOPE-003',
                control: 'SB-SCOPE-003',
                severity: 'critical',
                message: 'cred not allowed',
                layer: 1,
              },
            ],
            warnings: [],
            evaluated_at: '2026-06-19T12:00:00Z',
          },
        }),
      });

      const result = await client.evaluate({
        roleId: 'r',
        evaluationProfile: ['PRODUCTION_READINESS'],
        workflow: { workflowId: 'wf', nodes: [], edges: [] },
      });

      expect(result.evaluationId).toBe('eval_123');
      expect(result.productionReadinessStatus).toBe('fail');
      expect(result.violations[0].nodeId).toBe('n1');
      expect(result.violations[0].code).toBe('SB-SCOPE-003');
    });

    it('throws ScopeboundAuthError on 401', async () => {
      const client = new ScopeboundClient({
        apiKey: 'sb-bad',
        fetch: mockFetch({ status: 401, body: { error: 'invalid api key' } }),
      });

      await expect(
        client.evaluate({
          roleId: 'r',
          evaluationProfile: ['SOC1'],
          workflow: { workflowId: 'wf', nodes: [], edges: [] },
        }),
      ).rejects.toBeInstanceOf(ScopeboundAuthError);
    });

    it('throws ScopeboundNotFoundError on 404', async () => {
      const client = new ScopeboundClient({
        apiKey: 'sb-test',
        fetch: mockFetch({
          status: 404,
          body: 'role not found',
          contentType: 'text/plain',
        }),
      });

      await expect(
        client.evaluate({
          roleId: 'missing',
          evaluationProfile: ['SOC1'],
          workflow: { workflowId: 'wf', nodes: [], edges: [] },
        }),
      ).rejects.toBeInstanceOf(ScopeboundNotFoundError);
    });

    it('throws ScopeboundValidationError on 400', async () => {
      const client = new ScopeboundClient({
        apiKey: 'sb-test',
        fetch: mockFetch({
          status: 400,
          body: { message: 'role_id is required' },
        }),
      });

      await expect(
        client.evaluate({
          roleId: '',
          evaluationProfile: ['SOC1'],
          workflow: { workflowId: 'wf', nodes: [], edges: [] },
        }),
      ).rejects.toBeInstanceOf(ScopeboundValidationError);
    });

    it('throws generic ScopeboundAPIError on 500', async () => {
      const client = new ScopeboundClient({
        apiKey: 'sb-test',
        fetch: mockFetch({
          status: 500,
          body: { error: 'internal' },
        }),
      });

      await expect(
        client.evaluate({
          roleId: 'r',
          evaluationProfile: ['SOC1'],
          workflow: { workflowId: 'wf', nodes: [], edges: [] },
        }),
      ).rejects.toBeInstanceOf(ScopeboundAPIError);
    });
  });
});
