// errors.ts — Error class hierarchy for the Scopebound SDK.
//
// All errors thrown by the SDK extend ScopeboundError. Library consumers can
// narrow by error class to handle specific failure modes (auth, validation,
// not found, network, etc.) instead of parsing error messages.

/**
 * Base error class for all SDK-thrown errors.
 */
export class ScopeboundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Maintain proper prototype chain for `instanceof` to work after transpile
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the network call itself fails — DNS resolution, TCP refused,
 * fetch timeout, etc. Distinct from API-side errors which have a response.
 */
export class ScopeboundNetworkError extends ScopeboundError {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
  }
}

/**
 * Thrown when the API returns a non-2xx HTTP status. `status` is the HTTP
 * status code; `body` is the parsed response body (typically a JSON error
 * object, but may be a string for plain-text 4xx/5xx responses).
 */
export class ScopeboundAPIError extends ScopeboundError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

/**
 * Subtype of ScopeboundAPIError for 401 responses — invalid or missing API
 * key. Surfaces separately so callers can prompt for credential refresh
 * without parsing the parent error.
 */
export class ScopeboundAuthError extends ScopeboundAPIError {
  constructor(body: unknown, requestId?: string) {
    super('Authentication failed — check your API key', 401, body, requestId);
  }
}

/**
 * Subtype of ScopeboundAPIError for 404 responses — resource not found.
 * Common case: a role_id that doesn't exist.
 */
export class ScopeboundNotFoundError extends ScopeboundAPIError {
  constructor(message: string, body: unknown, requestId?: string) {
    super(message, 404, body, requestId);
  }
}

/**
 * Subtype of ScopeboundAPIError for 400 responses — request validation
 * failure. Typically the body has a structured error detailing which field
 * failed validation.
 */
export class ScopeboundValidationError extends ScopeboundAPIError {
  constructor(message: string, body: unknown, requestId?: string) {
    super(message, 400, body, requestId);
  }
}

/**
 * Thrown when an attestation token fails verification (signature mismatch,
 * expired, malformed, wrong issuer, etc).
 */
export class ScopeboundAttestationError extends ScopeboundError {
  constructor(
    message: string,
    public readonly reason:
      | 'signature_invalid'
      | 'expired'
      | 'malformed'
      | 'wrong_issuer'
      | 'unsupported_algorithm',
  ) {
    super(message);
  }
}
