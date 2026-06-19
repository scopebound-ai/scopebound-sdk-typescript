// verifier.ts — Attestation token verifier.
//
// Scopebound issues RSA-PSS SHA-256 signed JWTs as proof that a workflow
// evaluation passed. Customers can verify these tokens offline using the
// platform's public key — no Scopebound API call required.
//
// This is the "verifiable compliance evidence" piece — the artifact a
// regulated buyer's auditor can independently validate.

import { createVerify, type KeyObject } from 'node:crypto';
import type { AttestationClaims } from './types.js';
import { ScopeboundAttestationError } from './errors.js';

const SCOPEBOUND_ISSUER = 'scopebound';
const SUPPORTED_ALGORITHMS = ['PS256'] as const;

/**
 * Verifies attestation tokens issued by Scopebound. Constructed with the
 * platform's public key (RSA, 2048-bit minimum); call `verify()` per token.
 *
 * @example
 * ```typescript
 * import { readFileSync } from 'node:fs';
 * import { createPublicKey } from 'node:crypto';
 * import { AttestationVerifier } from '@scopebound/sdk';
 *
 * const pubKey = createPublicKey(readFileSync('scopebound-public.pem'));
 * const verifier = new AttestationVerifier(pubKey);
 *
 * const claims = verifier.verify(result.attestationToken!);
 * console.log(`Evaluation ${claims.evaluationId} verified, PR status: ${claims.productionReadinessStatus}`);
 * ```
 */
export class AttestationVerifier {
  constructor(
    private readonly publicKey: KeyObject,
    private readonly options: { expectedIssuer?: string; clockSkewSeconds?: number } = {},
  ) {}

  /**
   * Verify a Scopebound attestation token. Validates signature, expiration,
   * issuer, and structural integrity. Returns the decoded claims on success.
   *
   * @throws ScopeboundAttestationError with `reason` indicating the failure mode
   */
  verify(token: string): AttestationClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new ScopeboundAttestationError(
        'Invalid token format: expected three base64url segments separated by dots',
        'malformed',
      );
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    let header: { alg?: string; typ?: string };
    let claims: AttestationClaims;
    try {
      header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
      claims = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
    } catch {
      throw new ScopeboundAttestationError(
        'Invalid token: header or payload is not valid base64url-encoded JSON',
        'malformed',
      );
    }

    if (!header.alg || !SUPPORTED_ALGORITHMS.includes(header.alg as 'PS256')) {
      throw new ScopeboundAttestationError(
        `Unsupported signature algorithm: ${header.alg ?? '(missing)'}. Expected one of: ${SUPPORTED_ALGORITHMS.join(', ')}`,
        'unsupported_algorithm',
      );
    }

    const expectedIssuer = this.options.expectedIssuer ?? SCOPEBOUND_ISSUER;
    if (claims.iss !== expectedIssuer) {
      throw new ScopeboundAttestationError(
        `Token issuer mismatch: expected '${expectedIssuer}', got '${claims.iss}'`,
        'wrong_issuer',
      );
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const skew = this.options.clockSkewSeconds ?? 30;
    if (typeof claims.exp === 'number' && claims.exp + skew < nowSeconds) {
      throw new ScopeboundAttestationError(
        `Token expired at ${new Date(claims.exp * 1000).toISOString()}`,
        'expired',
      );
    }

    // Verify signature over `header.payload`
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = base64UrlDecode(signatureB64);

    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput);
    verifier.end();

    const valid = verifier.verify(
      {
        key: this.publicKey,
        padding: 6, // RSA_PKCS1_PSS_PADDING — matches Go's rsa.SignPSS
        saltLength: 32, // matches PS256 spec
      },
      signature,
    );

    if (!valid) {
      throw new ScopeboundAttestationError(
        'Token signature verification failed — token may be tampered with, or wrong public key',
        'signature_invalid',
      );
    }

    return claims;
  }
}

function base64UrlDecode(input: string): Buffer {
  // base64url → base64 (replace `-` and `_`, pad to multiple of 4)
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}
