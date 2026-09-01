// LCOS Core typed HTTP boundary — envelope + error + unwrap helpers.
// Only transport types. Never business state; never Spatial Truth.

import { HttpClient, HttpError, type RequestOptions } from './client.js';

export interface CoreEnvelopeOk<T> {
  ok: true;
  value: T;
  meta?: unknown;
}

export interface CoreEnvelopeError {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    origin?: string;
  };
  value?: unknown;
}

export type CoreEnvelope<T> = CoreEnvelopeOk<T> | CoreEnvelopeError;

export class CoreApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable?: boolean;
  readonly origin?: string;

  constructor(code: string, message: string, status: number, retryable?: boolean, origin?: string) {
    super(message);
    this.name = 'CoreApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.origin = origin;
  }
}

export function unwrapCoreValue<T>(envelope: CoreEnvelope<T>): T {
  if (envelope.ok) return envelope.value;
  throw new CoreApiError(
    envelope.error.code,
    envelope.error.message,
    0,
    envelope.error.retryable,
    envelope.error.origin,
  );
}

/** Convert any thrown error (incl. HttpClient HttpError) into a CoreApiError. */
export function toCoreApiError(err: unknown): CoreApiError {
  if (err instanceof HttpError) {
    const detail = err.detail as
      | { error?: { code?: string; message?: string; retryable?: boolean; origin?: string } }
      | undefined;
    if (detail?.error !== undefined) {
      return new CoreApiError(
        detail.error.code ?? err.code ?? 'HTTP_ERROR',
        detail.error.message ?? err.message,
        err.status,
        detail.error.retryable,
        detail.error.origin,
      );
    }
    return new CoreApiError(err.code ?? 'HTTP_ERROR', err.message, err.status);
  }
  if (err instanceof CoreApiError) return err;
  if (err instanceof Error) return new CoreApiError('INTERNAL', err.message, 0);
  return new CoreApiError('INTERNAL', String(err), 0);
}

/** Request the Core JSON envelope and unwrap to `value`. */
export async function coreRequest<T>(
  http: HttpClient,
  method: string,
  path: string,
  opts?: RequestOptions,
): Promise<T> {
  try {
    const envelope = await http.request<CoreEnvelope<T>>(method, path, { ...opts, mode: 'json' });
    return unwrapCoreValue(envelope);
  } catch (err) {
    throw toCoreApiError(err);
  }
}

/** Request the Core JSON envelope and keep the ok envelope (value + meta). */
export async function coreEnvelope<T>(
  http: HttpClient,
  method: string,
  path: string,
  opts?: RequestOptions,
): Promise<CoreEnvelopeOk<T>> {
  try {
    const envelope = await http.request<CoreEnvelope<T>>(method, path, { ...opts, mode: 'json' });
    if (!envelope.ok) {
      throw new CoreApiError(
        envelope.error.code,
        envelope.error.message,
        0,
        envelope.error.retryable,
        envelope.error.origin,
      );
    }
    return envelope;
  } catch (err) {
    throw toCoreApiError(err);
  }
}
