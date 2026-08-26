/**
 * CRM failures, typed by what the caller should do about them.
 *
 * The distinction that matters is retryable versus not. A 503 is worth retrying; a 422
 * means the request was wrong and retrying it will be wrong again, more expensively.
 */

export class CrmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number | undefined,
  ) {
    super(message);
    this.name = 'CrmError';
  }
}

/** The CRM could not be reached at all — DNS, TLS, timeout, connection refused. */
export class CrmUnavailableError extends CrmError {
  constructor(message: string) {
    super(message, true);
    this.name = 'CrmUnavailableError';
  }
}

/** Credentials are missing or rejected. Never retried: retrying a 401 is how you get locked out. */
export class CrmAuthError extends CrmError {
  constructor(message: string, status: number) {
    super(message, false, status);
    this.name = 'CrmAuthError';
  }
}

/** The CRM rejected the payload. A mapping problem, not a transient one. */
export class CrmRequestError extends CrmError {
  constructor(message: string, status: number) {
    super(message, false, status);
    this.name = 'CrmRequestError';
  }
}
