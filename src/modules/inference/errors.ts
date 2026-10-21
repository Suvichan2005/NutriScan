export type InferenceErrorCode = 'provider_invalid' | 'unknown_citation' | 'unknown_image';

/** A transport-independent validation failure that the server adapter can map to HTTP errors. */
export class InferenceModuleError extends Error {
  constructor(readonly code: InferenceErrorCode, message: string) {
    super(message);
    this.name = 'InferenceModuleError';
  }
}
