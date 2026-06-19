// types.ts — TypeScript types mirroring the Go structs in
// github.com/scopebound/enforcement-plane/pkg/types.
//
// Naming convention: TypeScript-idiomatic camelCase on the public surface,
// snake_case translation happens at the HTTP boundary (see client.ts).

// ─── Compliance evaluation ────────────────────────────────────────────────────

/**
 * Compliance evaluation profiles. PRODUCTION_READINESS enforces SB-SCOPE
 * rules including credential aliasing (SB-84). SOC1/SOC2_TYPE_II are the
 * audit-aligned profiles.
 */
export type EvaluationProfile =
  | 'SOC1'
  | 'SOC2_TYPE_II'
  | 'PRODUCTION_READINESS'
  | 'HIPAA';

/**
 * Source formats supported by the SB-81 translator family. Use 'savant' (or
 * omit entirely) for canonical workflows. 'n8n', 'make', 'zapier' invoke the
 * corresponding translator to produce the canonical DAG.
 */
export type SourceFormat = 'savant' | 'n8n' | 'make' | 'zapier';

export type NodeType = 'source' | 'tool' | 'transform' | 'destination';

export type ViolationSeverity = 'critical' | 'high' | 'medium' | 'low';

export type EvaluationStatus = 'pass' | 'fail' | 'warnings' | 'not_evaluated';

/**
 * A node in a canonical workflow DAG. For requests, only `id`, `type`, and
 * `tool` are typically required; the translator/normalizer fills the rest.
 */
export interface WorkflowNode {
  id: string;
  type: NodeType;
  tool?: string | null;
  mcpServer?: string | null;
  label?: string;
  name?: string;
  roleId?: string;
  dataClassification?: string;
  credentials?: string[];
  callArgs?: Record<string, unknown>;
  sourceMeta?: Record<string, string>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
}

export interface WorkflowMetadata {
  createdBy?: string;
  customerId?: string;
}

export interface WorkflowDefinition {
  workflowId: string;
  name?: string;
  version?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata?: WorkflowMetadata;
  sourceFormat?: SourceFormat;
  translatorVersion?: string;
}

/**
 * Request payload for POST /v1/workflow/evaluate.
 *
 * Either `workflow` (canonical DAG) or `workflowRaw` + `sourceFormat` (raw
 * source-native export to translate) must be provided, not both.
 */
export interface EvaluationRequest {
  roleId: string;
  evaluationProfile: EvaluationProfile[];
  workflow?: WorkflowDefinition;
  workflowRaw?: unknown;
  sourceFormat?: SourceFormat;
}

export interface EvaluationViolation {
  nodeId: string;
  code: string;
  control: string;
  severity: ViolationSeverity;
  message: string;
  layer: number;
}

export interface EvaluationWarning {
  nodeId?: string;
  code: string;
  message: string;
}

/**
 * Result of a workflow evaluation. The three `*Status` fields correspond to
 * the three compliance profiles; `not_evaluated` means the profile wasn't
 * requested.
 *
 * `attestationToken` is only issued when no critical violations are present.
 * It's a JWT signed by the platform's signing key.
 */
export interface EvaluationResult {
  evaluationId: string;
  workflowHash: string;
  soc1Status: EvaluationStatus;
  soc2Status: EvaluationStatus;
  productionReadinessStatus: EvaluationStatus;
  violations: EvaluationViolation[];
  warnings: EvaluationWarning[];
  attestationToken?: string;
  evaluatedAt: string; // ISO 8601 timestamp
}

// ─── Role management ──────────────────────────────────────────────────────────

export interface DataScope {
  tenants?: string[];
  tables?: string[];
  maxRows?: number;
  maxBytes?: number;
  allowedEnvs?: string[];
}

export interface CredentialBinding {
  sourceFormat: SourceFormat;
  sourceId: string;
}

/**
 * Agent role definition. Mirrors `pkg/types.AgentRole` from the Go server.
 */
export interface AgentRole {
  id: string;
  name: string;
  description?: string;
  allowedTools: string[];
  approvalRequired?: string[];
  financialTools?: string[];
  allowedMcpServers?: string[];
  auditTools?: string[];
  allowedCredentials?: string[];
  credentialMapping?: Record<string, CredentialBinding[]>;
  dataScope: DataScope;
  maxDelegationDepth: number;
  defaultTtlSeconds: number;
  rateLimitPerMinute?: number;
  rateLimitPerHour?: number;
  webhookUrl?: string;
  webhookSecretHint?: string;
  parameterConstraints?: Record<string, unknown>;
  allowedHoursStart?: number;
  allowedHoursEnd?: number;
  allowedDays?: string[];
  parentRoleId?: string;
  approvalTtlSeconds?: number;
  mcpServerRateLimits?: Record<string, number>;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Evaluation history ───────────────────────────────────────────────────────

export interface EvaluationFilter {
  roleId?: string;
  workflowId?: string;
  status?: EvaluationStatus;
  since?: string; // ISO 8601
  until?: string; // ISO 8601
  limit?: number;
  offset?: number;
}

export interface EvaluationListItem {
  evaluationId: string;
  workflowId: string;
  roleId: string;
  customerId: string;
  workflowHash: string;
  soc1Status: EvaluationStatus;
  soc2Status: EvaluationStatus;
  productionReadinessStatus: EvaluationStatus;
  createdAt: string;
}

export interface EvaluationRecord extends EvaluationListItem {
  result: EvaluationResult;
}

// ─── Attestation token claims ─────────────────────────────────────────────────

/**
 * Decoded attestation token payload. The JWT is signed with the platform's
 * signing key (RSA-PSS SHA-256). Use AttestationVerifier to validate.
 */
export interface AttestationClaims {
  iss: string;
  sub: string; // evaluation_id
  aud: string;
  iat: number;
  exp: number;
  evaluationId: string;
  workflowHash: string;
  roleId: string;
  soc1Status: EvaluationStatus;
  soc2Status: EvaluationStatus;
  productionReadinessStatus: EvaluationStatus;
}

// ─── HTTP transport ───────────────────────────────────────────────────────────

export interface ScopeboundClientOptions {
  /** API key issued by Scopebound platform. Provisioned via `provision-partner`. */
  apiKey: string;
  /** Base URL of the enforcement plane. Defaults to https://api.scopebound.ai */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
  /** Optional fetch implementation override (for tests, custom proxies, etc.) */
  fetch?: typeof fetch;
}
