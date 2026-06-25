// Example: evaluate a workflow against PRODUCTION_READINESS, then verify the
// attestation token offline.
//
// Run: SCOPEBOUND_API_KEY=sb-... npx tsx examples/evaluate.ts
//
// For local testing against your enforcement-plane binary on :8080:
//   SCOPEBOUND_API_KEY=sb-... SCOPEBOUND_BASE_URL=http://localhost:8080 npx tsx examples/evaluate.ts

import { readFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';
import {
  ScopeboundClient,
  AttestationVerifier,
  ScopeboundAttestationError,
  type EvaluationRequest,
} from '../src/index.js';

async function main() {
  const apiKey = process.env.SCOPEBOUND_API_KEY;
  if (!apiKey) {
    console.error('SCOPEBOUND_API_KEY not set');
    process.exit(1);
  }

  const client = new ScopeboundClient({
    apiKey,
    baseUrl: process.env.SCOPEBOUND_BASE_URL ?? 'http://localhost:8080',
  });

  // Minimal canonical workflow with one credential reference
  const request: EvaluationRequest = {
    roleId: '747b0d54-3b89-48ab-b0d3-5f0f551630d6',
    //evaluationProfile: ['SOC1', 'PRODUCTION_READINESS'],
    evaluationProfile: ['PRODUCTION_READINESS'],
    workflow: {
      workflowId: 'sdk-example',
      nodes: [
        { id: 'source', type: 'source', tool: 'manual_trigger' },
        { id: 'fetch', type: 'tool', tool: 'parse_invoices' },
        { id: 'approve', type: 'tool', tool: 'request_approval' },
        { id: 'audit', type: 'tool', tool: 'emit_audit_event' },
        {
          id: 'post',
          type: 'destination',
          tool: 'post_to_erp',
          credentials: ['sap-prod-api'],
        },
      ],
      edges: [
        { from: 'source', to: 'fetch' },
        { from: 'fetch', to: 'approve' },
        { from: 'approve', to: 'audit' },
        { from: 'audit', to: 'post' },
      ],
    },
  };

  const result = await client.evaluate(request);

  console.log(`Evaluation ${result.evaluationId}`);
  console.log(`  SOC1: ${result.soc1Status}`);
  console.log(`  Production-readiness: ${result.productionReadinessStatus}`);
  console.log(`  Violations: ${result.violations.length}`);

  for (const v of result.violations) {
    console.log(`    [${v.severity}] ${v.code} on ${v.nodeId}: ${v.message}`);
  }

  if (!result.attestationToken) {
    console.log('No attestation token issued (workflow has critical violations).');
    return;
  }

  // Verify the token offline (no Scopebound API call)
  const pubKeyPath = process.env.SCOPEBOUND_PUBLIC_KEY_PATH;
  if (!pubKeyPath) {
    console.log('SCOPEBOUND_PUBLIC_KEY_PATH not set, skipping offline verification.');
    return;
  }

  const verifier = new AttestationVerifier(createPublicKey(readFileSync(pubKeyPath)));
  try {
    const claims = verifier.verify(result.attestationToken);
    console.log(`Attestation verified offline. Claims:`);
    console.log(`  Issued at: ${new Date(claims.iat * 1000).toISOString()}`);
    console.log(`  Expires at: ${new Date(claims.exp * 1000).toISOString()}`);
    console.log(`  Workflow hash: ${claims.workflowHash}`);
  } catch (err) {
    if (err instanceof ScopeboundAttestationError) {
      console.error(`Attestation verification failed: ${err.reason} — ${err.message}`);
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
