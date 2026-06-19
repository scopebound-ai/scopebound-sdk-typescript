# @scopebound/sdk

Official TypeScript SDK for [Scopebound](https://scopebound.ai) — runtime authorization and pre-execution scope enforcement for AI agent workflows.

> **v0.1.0-preview**
>
> This is a preview release with a focused surface (evaluate, role read, evaluation history, offline attestation verification). Full role CRUD, streaming, approval workflow inspection, and webhook verification are on the roadmap below. APIs may change before v1.0.

## Install

```bash
npm install @scopebound/sdk
# or
pnpm add @scopebound/sdk
# or
yarn add @scopebound/sdk
```

**Requirements:** Node.js 18+ (uses native `fetch` and `node:crypto`).

## Quickstart

### Evaluate a workflow

```typescript
import { ScopeboundClient } from '@scopebound/sdk';

const client = new ScopeboundClient({
  apiKey: process.env.SCOPEBOUND_API_KEY!,
});

const result = await client.evaluate({
  roleId: 'ap-processor',
  evaluationProfile: ['SOC1', 'PRODUCTION_READINESS'],
  workflow: {
    workflowId: 'invoice-processing-v3',
    nodes: [
      { id: 'source', type: 'source', tool: 'manual_trigger' },
      { id: 'fetch', type: 'tool', tool: 'parse_invoices' },
      {
        id: 'post',
        type: 'tool',
        tool: 'post_to_erp',
        credentials: ['sap-prod-api'],
      },
    ],
    edges: [
      { from: 'source', to: 'fetch' },
      { from: 'fetch', to: 'post' },
    ],
  },
});

if (result.productionReadinessStatus === 'fail') {
  for (const v of result.violations) {
    console.error(`${v.code} on ${v.nodeId}: ${v.message}`);
  }
  process.exit(1);
}

console.log(`Workflow passed — attestation token: ${result.attestationToken}`);
```

### Evaluate an n8n workflow export

The server-side translator handles n8n's native format directly. No client-side conversion needed:

```typescript
import { readFileSync } from 'node:fs';

const n8nExport = JSON.parse(readFileSync('./my-workflow.json', 'utf8'));

const result = await client.evaluate({
  roleId: 'ap-processor',
  evaluationProfile: ['PRODUCTION_READINESS'],
  workflowRaw: n8nExport,
  sourceFormat: 'n8n',
});
```

### Verify an attestation token offline

Attestation tokens are RSA-PSS signed JWTs. You can verify them without calling the Scopebound API — useful for audit pipelines and CI gates:

```typescript
import { readFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';
import { AttestationVerifier, ScopeboundAttestationError } from '@scopebound/sdk';

const publicKey = createPublicKey(readFileSync('./scopebound-public.pem'));
const verifier = new AttestationVerifier(publicKey);

try {
  const claims = verifier.verify(result.attestationToken!);
  console.log(`Evaluation ${claims.evaluationId} verified.`);
  console.log(`Workflow hash: ${claims.workflowHash}`);
  console.log(`Production-readiness: ${claims.productionReadinessStatus}`);
} catch (err) {
  if (err instanceof ScopeboundAttestationError) {
    console.error(`Verification failed (${err.reason}): ${err.message}`);
  }
}
```

### List recent evaluations

```typescript
const evaluations = await client.listEvaluations({
  roleId: 'ap-processor',
  status: 'fail',
  since: '2026-06-01T00:00:00Z',
  limit: 50,
});

for (const e of evaluations) {
  console.log(`${e.evaluationId} — ${e.productionReadinessStatus}`);
}
```

## Error handling

All SDK errors extend `ScopeboundError`. Narrow by subclass to handle specific failure modes:

```typescript
import {
  ScopeboundAuthError,
  ScopeboundNotFoundError,
  ScopeboundValidationError,
  ScopeboundNetworkError,
} from '@scopebound/sdk';

try {
  await client.evaluate(request);
} catch (err) {
  if (err instanceof ScopeboundAuthError) {
    // Invalid API key — prompt for refresh
  } else if (err instanceof ScopeboundNotFoundError) {
    // role_id doesn't exist
  } else if (err instanceof ScopeboundValidationError) {
    // request body is malformed; err.body has details
  } else if (err instanceof ScopeboundNetworkError) {
    // fetch failed — retry with backoff
  } else {
    throw err;
  }
}
```

## Local development against your own enforcement plane

When testing against a locally-running `enforcement-plane` binary:

```typescript
const client = new ScopeboundClient({
  apiKey: 'sb-...',
  baseUrl: 'http://localhost:8080',
});
```

## API surface (v0.1.0-preview)

| Method                          | Description                                       |
| ------------------------------- | ------------------------------------------------- |
| `client.evaluate(req)`          | Evaluate a workflow against role + profiles       |
| `client.getRole(id)`            | Fetch a single role by ID                         |
| `client.getRoleByName(name)`    | Fetch a single role by human-readable name        |
| `client.listRoles()`            | List all roles for the authenticated partner      |
| `client.listEvaluations(filter)`| Paginated history of evaluations                  |
| `client.getEvaluation(id)`      | Fetch a single evaluation including full result   |
| `new AttestationVerifier(key)`  | Offline JWT verification of attestation tokens    |

## Roadmap to v1.0

- Streaming evaluation results for large workflows
- Role create / update / delete via SDK
- Approval workflow inspection (pending approvals, approver actions)
- Webhook signature verification helper
- Browser-safe build (currently Node-only due to `node:crypto`)
- Additional `sourceFormat` translators (Make, Zapier, LangGraph)
- Retry-with-backoff policy on idempotent reads
- Typed event emitter for client-side observability

## License

Apache 2.0
