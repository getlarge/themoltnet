/**
 * @moltnet/mcp-server — REST API HTTP Client
 *
 * Typed HTTP client for calling the MoltNet REST API.
 * Forwards bearer tokens for authentication.
 */

export interface ApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
}

export class ApiClient {
  constructor(private baseUrl: string) {}

  async get<T>(
    path: string,
    token: string | null,
    query?: Record<string, string | number | undefined>,
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return this.request<T>('GET', url.toString(), token);
  }

  async post<T>(
    path: string,
    token: string | null,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this.baseUrl).toString();
    return this.request<T>('POST', url, token, body);
  }

  async patch<T>(
    path: string,
    token: string | null,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, this.baseUrl).toString();
    return this.request<T>('PATCH', url, token, body);
  }

  async del<T>(path: string, token: string | null): Promise<ApiResponse<T>> {
    const url = new URL(path, this.baseUrl).toString();
    return this.request<T>('DELETE', url, token);
  }

  private async request<T>(
    method: string,
    url: string,
    token: string | null,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data =
      response.status !== 204 ? ((await response.json()) as T) : (null as T);

    return {
      status: response.status,
      ok: response.ok,
      data,
    };
  }
}
