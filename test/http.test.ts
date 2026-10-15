import test from 'node:test';
import assert from 'node:assert/strict';
import { Http } from '../src/lib/http.js';

test('GET retries 429 and 5xx with Retry-After; errors redact response bodies', async () => {
  let calls = 0; const waits: number[] = [];
  const http = new Http(async () => ++calls === 1 ? new Response('secret', { status: 429, headers: { 'Retry-After': '2' } }) : calls === 2 ? new Response('secret', { status: 503 }) : new Response('ok'), async ms => { waits.push(ms); });
  assert.equal(await (await http.request('https://example.test')).text(), 'ok');
  assert.equal(calls, 3); assert.ok(waits[0]! >= 2000 && waits[0]! < 2250);
  const fail = new Http(async () => new Response('access_token=SECRET', { status: 403 }));
  await assert.rejects(() => fail.request('https://example.test'), error => error instanceof Error && !error.message.includes('SECRET') && error.message.includes('403'));
});
test('mutations are never retried on network ambiguity or rate limits', async () => {
  for (const networkFailure of [false, true]) {
    let calls = 0;
    const http = new Http(async () => { calls++; if (networkFailure) throw new Error('secret'); return new Response('secret', { status: 429 }); });
    await assert.rejects(() => http.request('https://example.test', { method: 'POST' })); assert.equal(calls, 1);
  }
});
