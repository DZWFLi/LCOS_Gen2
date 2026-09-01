// Thin HTTP client for LCOS Gen2.
// Only: base URL, JSON, error normalization, AbortSignal, typed response.
// NEVER holds business state / selection / cache / UI mode / runtime orchestration.

export interface HttpClientConfig {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  auth?: 'bearer' | 'basic' | 'none';
}

export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: unknown;
  constructor(status: number, message: string, code?: string, detail?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export class HttpClient {
  readonly config: HttpClientConfig;
  private readonly fetcher: typeof fetch;

  constructor(config: HttpClientConfig) {
    this.config = config;
    this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private resolveHeaders(opts?: RequestOptions): Record<string, string> {
    const auth: Record<string, string> = {};
    const mode = opts?.auth ?? (this.config.token ? 'bearer' : 'none');
    if (mode === 'bearer' && this.config.token) {
      auth['Authorization'] = `Bearer ${this.config.token}`;
    }
    return {
      Accept: 'application/json',
      ...(opts?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...opts?.headers,
      ...auth,
    };
  }

  private async request<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.config.baseUrl}${path}`;
    const headers = this.resolveHeaders(opts);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers,
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts?.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new HttpError(0, aborted ? 'Request aborted' : `Network error: ${String(err)}`, aborted ? 'aborted' : 'network');
    }

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      let code: string | undefined;
      let detail: unknown;
      try {
        const text = await response.text();
        try {
          const json = JSON.parse(text) as { message?: string; code?: string };
          if (json.message) message = json.message;
          if (json.code) code = json.code;
          detail = json;
        } catch {
          detail = text;
        }
      } catch {
        // ignore body parse failure
      }
      throw new HttpError(response.status, message, code, detail);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  get<T>(path: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, { signal, headers });
  }

  post<T>(path: string, body?: unknown, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, { body, signal, headers });
  }

  put<T>(path: string, body?: unknown, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('PUT', path, { body, signal, headers });
  }

  patch<T>(path: string, body?: unknown, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('PATCH', path, { body, signal, headers });
  }

  delete<T>(path: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('DELETE', path, { signal, headers });
  }
}
