import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAuth } from '../src/auth.js';
import { Http } from '../src/lib/http.js';
import { hash, readJson, writeJson } from '../src/lib/storage.js';

test('refresh rotates tokens securely, shares concurrent refresh, and rejects changed client identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yahoo-auth-test-')), path = join(dir, 'token.json');
  try {
    await writeJson(path, { access_token: 'expired', refresh_token: 'old-refresh', expires_at: 0, client_hash: hash('client') });
    let calls = 0;
    const http = new Http(async (_url, init) => {
      calls++; assert.equal(init?.method, 'POST'); assert.ok(String(init?.body).includes('refresh_token=old-refresh'));
      return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: 'fspt-r' }));
    });
    const config = { provider: 'yahoo' as const, clientId: 'client', clientSecret: 'secret', tokenPath: path, tokenUrl: 'https://test/token', authUrl: 'https://test/auth', scope: 'fspt-r' };
    const oauth = new OAuth(config, http);
    assert.deepEqual(await Promise.all([oauth.access(), oauth.access()]), ['new-access', 'new-access']); assert.equal(calls, 1);
    assert.equal(await oauth.access(), 'new-access'); assert.equal(calls, 1);
    assert.equal((await readJson<any>(path)).refresh_token, 'new-refresh'); assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(() => new OAuth({ ...config, clientId: 'other' }, http).access(), /authorize/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('invalid_grant produces actionable error without revealing response secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yahoo-auth-test-')), path = join(dir, 'token.json');
  try {
    await writeJson(path, { access_token: 'expired', refresh_token: 'private', expires_at: 0, client_hash: hash('client') });
    const oauth = new OAuth({ provider: 'google', clientId: 'client', clientSecret: 'secret', tokenPath: path, tokenUrl: 'https://test/token', authUrl: 'https://test/auth', scope: 'sheets' }, new Http(async () => new Response('PRIVATE', { status: 400 })));
    await assert.rejects(() => oauth.access(), error => error instanceof Error && error.message.includes('auth:google') && !error.message.includes('PRIVATE'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
