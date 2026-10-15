import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { configuration } from './config.js';
import { readJson, writeJson, hash } from './lib/storage.js';
import { Http, HttpError } from './lib/http.js';

type Provider = 'yahoo' | 'google';
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().optional(), expires_in: z.coerce.number().positive().optional(), scope: z.string().optional() });
const storedSchema = z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_at: z.number(), client_hash: z.string() });
type StoredToken = z.infer<typeof storedSchema>;
interface OAuthConfig { provider: Provider; clientId: string; clientSecret: string; tokenPath: string; tokenUrl: string; authUrl: string; scope: string }

export async function oauth(provider: Provider): Promise<OAuth> {
  const c = configuration();
  if (provider === 'yahoo') {
    if (!process.env.YAHOO_CLIENT_ID || !process.env.YAHOO_CLIENT_SECRET) throw new Error('Configure YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in .env; see README step 2.');
    if (process.env.YAHOO_REDIRECT_URI && process.env.YAHOO_REDIRECT_URI !== 'oob') throw new Error('This local Yahoo flow uses YAHOO_REDIRECT_URI=oob. Configure oob in your Yahoo app.');
    return new OAuth({ provider, clientId: process.env.YAHOO_CLIENT_ID, clientSecret: process.env.YAHOO_CLIENT_SECRET, tokenPath: c.yahooToken,
      tokenUrl: 'https://api.login.yahoo.com/oauth2/get_token', authUrl: 'https://api.login.yahoo.com/oauth2/request_auth', scope: 'fspt-r' });
  }
  const file = await readJson<unknown>(c.googleClientFile);
  const parsed = z.object({ installed: z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) }) }).safeParse(file);
  if (!parsed.success) throw new Error('Google Desktop OAuth JSON missing or invalid. Save it to GOOGLE_CLIENT_FILE; see README step 4.');
  return new OAuth({ provider, clientId: parsed.data.installed.client_id, clientSecret: parsed.data.installed.client_secret, tokenPath: c.googleToken,
    tokenUrl: 'https://oauth2.googleapis.com/token', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', scope: 'https://www.googleapis.com/auth/spreadsheets' });
}

export class OAuth {
  private pending?: Promise<string>;
  constructor(private config: OAuthConfig, private http = new Http()) {}
  async access(force = false): Promise<string> {
    if (this.pending) return this.pending;
    this.pending = this.loadAccess(force);
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  private async loadAccess(force: boolean): Promise<string> {
    const raw = await readJson<unknown>(this.config.tokenPath);
    const result = storedSchema.safeParse(raw);
    if (!result.success || result.data.client_hash !== hash(this.config.clientId)) throw new Error(`Run npm run auth:${this.config.provider} to authorize this application.`);
    const token = result.data;
    if (!force && token.expires_at > Date.now() + 90_000) return token.access_token;
    if (!token.refresh_token) throw new Error(`Refresh token missing; run npm run auth:${this.config.provider}.`);
    return this.exchange({ grant_type: 'refresh_token', refresh_token: token.refresh_token }, token);
  }
  private async exchange(parameters: Record<string, string>, previous?: StoredToken): Promise<string> {
    const body = new URLSearchParams(parameters);
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (this.config.provider === 'yahoo') headers.Authorization = `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`;
    else { body.set('client_id', this.config.clientId); body.set('client_secret', this.config.clientSecret); }
    let response: Response;
    try { response = await this.http.request(this.config.tokenUrl, { method: 'POST', headers, body }, `${this.config.provider} OAuth`, false); }
    catch (error) {
      if (error instanceof HttpError && [400, 401].includes(error.status)) throw new Error(`${this.config.provider} OAuth grant rejected. Check credentials/API access and rerun npm run auth:${this.config.provider}.`);
      throw error;
    }
    const token = tokenSchema.safeParse(await response.json());
    if (!token.success) throw new Error(`${this.config.provider} OAuth returned an invalid token response`);
    if (token.data.scope && !token.data.scope.split(' ').includes(this.config.scope)) throw new Error(`${this.config.provider} OAuth did not grant the required scope`);
    const stored: StoredToken = { access_token: token.data.access_token, refresh_token: token.data.refresh_token ?? previous?.refresh_token,
      expires_at: Date.now() + (token.data.expires_in ?? 3600) * 1000, client_hash: hash(this.config.clientId) };
    if (!stored.refresh_token) throw new Error(`No ${this.config.provider} refresh token returned. Revoke the app grant and authorize again with offline access.`);
    await writeJson(this.config.tokenPath, stored);
    return stored.access_token;
  }
  async authorize(): Promise<void> {
    const state = randomBytes(32).toString('base64url');
    const url = new URL(this.config.authUrl);
    url.search = new URLSearchParams({ client_id: this.config.clientId, response_type: 'code', scope: this.config.scope, state }).toString();
    if (this.config.provider === 'yahoo') {
      url.searchParams.set('redirect_uri', 'oob');
      console.log(`Open this URL in your system browser:\n${url.href}`);
      // Do not echo authorization codes into terminal scrollback or session logs.
      const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
      const terminal = createInterface({ input: stdin, output: silent, terminal: Boolean(stdin.isTTY) });
      let code: string;
      stdout.write('Paste the Yahoo verification code (hidden; local terminal only): ');
      try { code = (await terminal.question('')).trim(); }
      finally { terminal.close(); silent.end(); stdout.write('\n'); }
      if (!code || code.length > 4096 || /\s/.test(code)) throw new Error('Invalid Yahoo verification code');
      await this.exchange({ grant_type: 'authorization_code', code, redirect_uri: 'oob' });
    } else {
      const verifier = randomBytes(48).toString('base64url');
      const server = createServer();
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Could not start Google loopback callback');
      const redirect = `http://127.0.0.1:${address.port}/oauth2callback`;
      url.searchParams.set('redirect_uri', redirect);
      url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      try {
        const code = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Google authorization timed out after five minutes')), 300_000);
          server.on('request', (req, res) => {
            const callback = new URL(req.url || '/', redirect);
            res.setHeader('Content-Type', 'text/plain'); res.setHeader('Cache-Control', 'no-store');
            if (callback.pathname !== '/oauth2callback') { res.writeHead(404).end(); return; }
            if (callback.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid OAuth state'); return; }
            clearTimeout(timer);
            const code = callback.searchParams.get('code');
            if (!code || callback.searchParams.has('error')) { res.end('Authorization denied. Return to the terminal.'); reject(new Error('Google authorization denied')); return; }
            res.end('Authorization received. Return to the terminal for verification.'); resolve(code);
          });
          server.once('close', () => clearTimeout(timer));
          console.log(`Open this URL in your system browser (expires in five minutes):\n${url.href}`);
        });
        await this.exchange({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier });
      } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }
    console.log(`${this.config.provider} authorization saved securely. Run npm run verify:${this.config.provider}.`);
  }
}
