// Typed errors so callers (routes/nccDebug.js, and eventually the real
// Customer Messages feature) can distinguish "nothing to fetch, tell the
// admin to configure NCC" from "NCC rejected our credentials" from "NCC
// itself errored" without string-matching messages.

export class NccNotConfiguredError extends Error {
  constructor(organizationId) {
    super(`NCC integration is not configured for organization ${organizationId} (no credentials at either the Customer or TAS-wide tier)`);
    this.name = 'NccNotConfiguredError';
    this.organizationId = organizationId;
  }
}

export class NccAuthError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'NccAuthError';
    this.status = status;
    this.body = body;
  }
}

export class NccApiError extends Error {
  constructor(message, { status, body, method, path } = {}) {
    super(message);
    this.name = 'NccApiError';
    this.status = status;
    this.body = body;
    this.method = method;
    this.path = path;
  }
}
