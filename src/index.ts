// Scopebound SDK — TypeScript client for the Scopebound enforcement plane.
//
// v0.1.0-preview: ScopeboundClient (evaluate, role management, evaluation
// history), AttestationVerifier (offline JWT verification), and full
// TypeScript types matching the server-side Go structs.
//
// Roadmap to v1.0:
//   - Streaming evaluation results
//   - Role create/update/delete via SDK
//   - Approval workflow inspection
//   - Webhook signature verification helper
//   - Browser-safe build (currently Node-only due to node:crypto dependency)

export { ScopeboundClient } from './client.js';
export { AttestationVerifier } from './verifier.js';

export {
  ScopeboundError,
  ScopeboundNetworkError,
  ScopeboundAPIError,
  ScopeboundAuthError,
  ScopeboundNotFoundError,
  ScopeboundValidationError,
  ScopeboundAttestationError,
} from './errors.js';

export type {
  // Evaluation
  EvaluationProfile,
  SourceFormat,
  NodeType,
  ViolationSeverity,
  EvaluationStatus,
  WorkflowNode,
  WorkflowEdge,
  WorkflowMetadata,
  WorkflowDefinition,
  EvaluationRequest,
  EvaluationViolation,
  EvaluationWarning,
  EvaluationResult,
  // Roles
  DataScope,
  CredentialBinding,
  AgentRole,
  // History
  EvaluationFilter,
  EvaluationListItem,
  EvaluationRecord,
  // Attestation
  AttestationClaims,
  // Client config
  ScopeboundClientOptions,
} from './types.js';
