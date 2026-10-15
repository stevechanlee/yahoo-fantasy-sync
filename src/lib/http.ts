import { setTimeout as sleep } from 'node:timers/promises';

export class HttpError extends Error {
  constructor(public status: number, public service: string) {
    super(`${service}: HTTP ${status}${status === 401 ? ' — reauthorize or check API access approval' : status === 403 ? ' — check account permissions, API enablement and quota' : ''}`);
  }
}
export type Fetch = typeof fetch;
export class Http {
  constructor(private transport: Fetch = fetch, private wait: (ms: number) => Promise<unknown> = sleep) {}
  async request(url: string, init: RequestInit = {}, service = 'API', retry = (init.method || 'GET') === 'GET'): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try { response = await this.transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(45_000) }); }
      catch {
        if (!retry || attempt >= 4) throw new Error(`${service}: network failure or timeout; request outcome may be unknown`);
        await this.wait(Math.min(30_000, 750 * 2 ** attempt) + Math.random() * 250); continue;
      }
      if (response.ok) return response;
      if (retry && attempt < 4 && (response.status === 429 || response.status >= 500)) {
        const header = response.headers.get('retry-after');
        const delay = header ? (/^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 750 * 2 ** attempt;
        await response.body?.cancel();
        await this.wait(Math.min(60_000, Math.max(0, Number.isFinite(delay) ? delay : 1000)) + Math.random() * 250); continue;
      }
      await response.body?.cancel();
      // Never surface response bodies or request headers: OAuth errors can contain secrets.
      throw new HttpError(response.status, service);
    }
  }
}
