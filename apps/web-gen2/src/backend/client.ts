// Thin HTTP client for LCOS Gen2.
// Only: base URL, JSON, error normalization, AbortSignal, explicit typed body
// mode (json/text/blob). NEVER holds business state / selection / cache / UI mode.

export interface HttpClientConfig {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export type ResponseMode = 'json' | 'text' | 'blob';

export interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  auth?: 'bearer' | 'basic' | 'none';
  mode?: ResponseMode;
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

  private async requestCore(method: string, path: string, opts?: RequestOptions): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.config.baseUrl}${path}`;
    const headers = this.resolveHeaders(opts);
    return this.fetcher(url, {
      method,
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts?.signal,
    });
  }

  private async assertOk(response: Response): Promise<Response> {
    if (response.ok) return response;
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

  private async parseBody(response: Response, mode: ResponseMode): Promise<unknown> {
    switch (mode) {
      case 'blob':
        return response.blob();
      case 'text':
        return response.text();
      case 'json':
      default: {
        const text = await response.text();
        if (!text) return undefined;
        try {
          return JSON.parse(text);
        } catch {
          throw new HttpError(response.status, 'Response was not valid JSON');
        }
      }
    }
  }

  /** Generic request with explicit mode. */
  async request<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
    let response: Response;
    try {
      response = await this.requestCore(method, path, opts);
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new HttpError(0, aborted ? 'Request aborted' : `Network error: ${String(err)}`, aborted ? 'aborted' : 'network');
    }
    await this.assertOk(response);
    return (await this.parseBody(response, opts?.mode ?? 'json')) as T;
  }

  async getJson<T>(path: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, { signal, headers, mode: 'json' });
  }

  async getText(path: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<string> {
    return this.request<string>('GET', path, { signal, headers, mode: 'text' });
  }

  async getBlob(path: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<Blob> {
    return this.request<Blob>('GET', path, { signal, headers, mode: 'blob' });
  }

  async postJson<T>(path: string, body?: unknown, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, { body, signal, headers, mode: 'json' });
  }

  async putJson<T>(path: string, body?: unknown, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('PUT', path, { body, signal, headers, mode: 'json' });
  }

  async patchJson<T>(path: string, body?: unknown, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('PATCH', path, { body, signal, headers, mode: 'json' });
  }

  async deleteJson<T>(path: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('DELETE', path, { signal, headers, mode: 'json' });
  }
}
