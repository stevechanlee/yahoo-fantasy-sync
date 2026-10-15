import type { OAuth } from '../auth.js';
import { Http, HttpError } from '../lib/http.js';

export interface SheetsApi { get<T>(path: string): Promise<T>; post<T>(path: string, body: unknown): Promise<T> }
export class GoogleClient implements SheetsApi {
  constructor(private auth: Pick<OAuth, 'access'>, private http = new Http()) {}
  private async call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    if (!/^spreadsheets(?:$|\/)/.test(path)) throw new Error('Invalid Google Sheets path');
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.access(attempt > 0);
      try {
        const response = await this.http.request(`https://sheets.googleapis.com/v4/${path}`, { method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, 'Google Sheets', method === 'GET');
        return await response.json() as T;
      } catch (error) {
        // A definitive 401 did not apply the mutation; ambiguous writes are never replayed.
        if (error instanceof HttpError && error.status === 401 && attempt === 0) continue;
        throw error;
      }
    }
  }
  get<T>(path: string): Promise<T> { return this.call<T>(path, 'GET'); }
  post<T>(path: string, body: unknown): Promise<T> { return this.call<T>(path, 'POST', body); }
}
