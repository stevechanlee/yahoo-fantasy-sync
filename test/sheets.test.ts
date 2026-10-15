import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SheetsSync, cell, type Request } from '../src/google/sync.js';
import type { SheetsApi } from '../src/google/client.js';
import { datasets, historyRows } from '../src/google/schema.js';
import { synchronize, exportSnapshot } from '../src/sync.js';
import { readJson } from '../src/lib/storage.js';
import { YahooService } from '../src/yahoo/client.js';
import { bao, FixtureYahoo, key, okSnapshot, standard } from './helpers.js';

// In-memory Sheets API applies a batch atomically and can simulate a lost success response.
class FakeSheets implements SheetsApi {
  sheets: any[] = []; bindings: any[] = []; data = new Map<number, any[][]>();
  creates = 0; batches: Request[][] = []; loseResponse = false; failBeforeCommit = false;
  async get<T>(path: string): Promise<T> {
    if (path.includes('/values:batchGet')) {
      const query = new URL(`https://test/${path}`).searchParams;
      return { valueRanges: query.getAll('ranges').map(range => {
        const title = range.match(/^'([^']+)'!/)?.[1];
        const sheet = this.sheets.find(s => s.properties.title === title);
        const columns = range.endsWith('!A:B') ? 2 : range.endsWith('!A:E') ? 5 : 30;
        let values = (this.data.get(sheet?.properties.sheetId) ?? []).map(r => r.slice(0, columns));
        if (range.endsWith('!A1:AD2')) values = values.slice(0, 2);
        while (values.length && !values.at(-1)?.some(v => v !== '' && v !== null && v !== undefined)) values.pop();
        return { values };
      }) } as T;
    }
    return { spreadsheetId: 'test-id', sheets: this.sheets, developerMetadata: this.bindings } as T;
  }
  async post<T>(path: string, body: any): Promise<T> {
    if (path === 'spreadsheets') { this.creates++; this.sheets = structuredClone(body.sheets); this.bindings = structuredClone(body.developerMetadata); return { spreadsheetId: 'test-id' } as T; }
    this.batches.push(body.requests);
    if (this.failBeforeCommit) throw new Error('Rejected atomic batch');
    const next = structuredClone(this.data), sheets = structuredClone(this.sheets), bindings = structuredClone(this.bindings);
    for (const r of body.requests) {
      if (r.addSheet) sheets.push(r.addSheet);
      if (r.createDeveloperMetadata) bindings.push(r.createDeveloperMetadata.developerMetadata);
      if (r.updateSheetProperties) {
        const properties = r.updateSheetProperties.properties;
        Object.assign(sheets.find((s: any) => s.properties.sheetId === properties.sheetId).properties, properties);
      }
      if (r.updateCells) {
        const u = r.updateCells, id = u.range?.sheetId ?? u.start.sheetId;
        const rows = next.get(id) ?? [];
        const start = u.range?.startRowIndex ?? u.start.rowIndex;
        if (u.range) for (let index = start; index < u.range.endRowIndex; index++) rows[index] = [];
        for (const [offset, row] of u.rows.entries()) rows[start + offset] = row.values.map((v: any) => {
          const entered = v.userEnteredValue; return entered?.stringValue ?? entered?.numberValue ?? entered?.boolValue ?? '';
        });
        next.set(id, rows);
      }
    }
    this.data = next; this.sheets = sheets; this.bindings = bindings;
    if (this.loseResponse) { this.loseResponse = false; throw new Error('Network timeout after commit'); }
    return {} as T;
  }
  rows(title: string): any[][] { return this.data.get(this.sheets.find(s => s.properties.title === title)?.properties.sheetId) ?? []; }
}
async function withDirectory(fn: (directory: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'yahoo-sync-test-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('history ignores timestamp-only changes, snapshots zero rows, and includes setting bonus paths', async () => {
  const snapshot = await new YahooService(new FixtureYahoo()).collect(bao, [], 100);
  const data = datasets(snapshot), history = historyRows(snapshot, data, new Set());
  const ids = new Set(history.map(row => String(row[0])));
  assert.equal(ids.size, 8); assert.ok(history.length > 8);
  const repeat = { ...snapshot, syncAt: '2026-10-15T00:00:00Z' };
  assert.deepEqual(historyRows(repeat, datasets(repeat), ids), []);
  assert.ok(data.find(d => d.name === 'Scoring Settings')?.table?.rows.some(row => String(row[5]).includes('bonuses.bonus.target') && row.includes('300')));
  const empty = okSnapshot(); assert.equal(historyRows(empty, datasets(empty), new Set()).length, 8);
});
test('formulas remain literal strings; null is empty; numeric zero remains numeric', () => {
  assert.deepEqual(cell('=IMPORTXML("evil")'), { userEnteredValue: { stringValue: '=IMPORTXML("evil")' } });
  assert.deepEqual(cell(null), {}); assert.deepEqual(cell(0), { userEnteredValue: { numberValue: 0 } });
  assert.throws(() => cell('x'.repeat(45_001)), /exceeds/);
});
test('initial creation persists IDs and writes all ten tabs; rerun does not recreate or append duplicate history', async () => withDirectory(async dir => {
  const api = new FakeSheets(), sheets = new SheetsSync(api, dir);
  const snapshot = await new YahooService(new FixtureYahoo()).collect(bao, [], 100);
  const id = await sheets.ensureSpreadsheet(bao, key());
  const first = await sheets.publish(id, snapshot);
  assert.ok(first.historyRowsAdded > 8); assert.equal(api.sheets.length, 10);
  assert.equal((await sheets.publish(id, { ...snapshot, syncAt: '2026-10-15T00:00:00Z' })).historyRowsAdded, 0);
  assert.equal(await sheets.ensureSpreadsheet(bao, key()), id); assert.equal(api.creates, 1);
  assert.ok(api.rows('All Rosters')[1]?.includes(key()));
  const registry = await readJson<any>(join(dir, 'spreadsheets.json')); assert.equal(registry.leagues.bao.spreadsheetId, id);
}));
test('partial failures preserve old tabs and source timestamps; successful empty response removes stale rows', async () => withDirectory(async dir => {
  const api = new FakeSheets(), sheets = new SheetsSync(api, dir);
  const snapshot = await new YahooService(new FixtureYahoo()).collect(bao, [], 100);
  const id = await sheets.ensureSpreadsheet(bao, key()); await sheets.publish(id, snapshot);
  const before = structuredClone(api.rows('Free Agents'));
  const next = { ...snapshot, syncAt: '2026-10-16T12:00:00Z', freeAgents: { status: 'error' as const, error: 'Page 2 failed' }, waivers: { status: 'ok' as const, data: [] }, errors: ['Page 2 failed'] };
  await sheets.publish(id, next);
  assert.deepEqual(api.rows('Free Agents'), before);
  assert.ok(!api.rows('Waivers').slice(1).some(r => r.length));
  const dashboard = api.rows('Dashboard').find(r => r[1] === 'dataset:Free Agents');
  assert.equal(dashboard?.[3], 'error_previous_data_preserved'); assert.equal(dashboard?.[4], snapshot.syncAt);
}));
test('lost batch response reconciles remote history before retry and cannot duplicate committed snapshots', async () => withDirectory(async dir => {
  const api = new FakeSheets(), sheets = new SheetsSync(api, dir), snapshot = okSnapshot();
  const id = await sheets.ensureSpreadsheet(bao, key()); api.loseResponse = true;
  await assert.rejects(() => sheets.publish(id, snapshot), /timeout/);
  assert.equal((await sheets.publish(id, snapshot)).historyRowsAdded, 0);
  assert.equal(api.rows('History').filter(r => r[0]).length, 9);
}));
test('failed atomic batch leaves all previous values and history intact', async () => withDirectory(async dir => {
  const api = new FakeSheets(), sheets = new SheetsSync(api, dir), snapshot = okSnapshot();
  const id = await sheets.ensureSpreadsheet(bao, key()); await sheets.publish(id, snapshot);
  const prior = structuredClone(api.data); api.failBeforeCommit = true;
  await assert.rejects(() => sheets.publish(id, { ...snapshot, playerPositions: ['QB'] }), /Rejected/);
  assert.deepEqual(api.data, prior);
}));
test('league binding rejects cross-league publication before any mutations', async () => withDirectory(async dir => {
  const api = new FakeSheets(), sheets = new SheetsSync(api, dir);
  const id = await sheets.ensureSpreadsheet(bao, key());
  const wrong = { ...okSnapshot(), league: { ...okSnapshot().league, leagueKey: key(standard) } };
  await assert.rejects(() => sheets.publish(id, wrong), /different Yahoo league/); assert.equal(api.batches.length, 0);
  await assert.rejects(() => sheets.ensureSpreadsheet({ ...standard, spreadsheetId: id }, key(standard)), /another league/);
}));
test('ambiguous spreadsheet creation saves pending intent and refuses another create', async () => withDirectory(async dir => {
  let calls = 0;
  const api: SheetsApi = { get: async () => { throw new Error('unused'); }, post: async () => { calls++; throw new Error('timeout'); } };
  const sheets = new SheetsSync(api, dir);
  await assert.rejects(() => sheets.ensureSpreadsheet(bao, key()), /timeout/);
  await assert.rejects(() => sheets.ensureSpreadsheet(bao, key()), /outcome is unknown/); assert.equal(calls, 1);
}));
test('full mocked orchestration creates separate spreadsheets; one league failure does not block the other', async () => withDirectory(async dir => {
  const apis = new Map([['bao', new FakeSheets()], ['standard', new FakeSheets()]]);
  const publishers = new Map([...apis].map(([id, api]) => [id, new SheetsSync(api, join(dir, id))]));
  const sheets = {
    ensureSpreadsheet: async (c: any, k: string) => { await publishers.get(c.id)!.ensureSpreadsheet(c, k); return c.id; },
    publish: async (id: string, s: any) => publishers.get(id)!.publish('test-id', s),
  };
  const yahoo = { collect: (c: any, positions: string[], count: number) => new YahooService(new FixtureYahoo(c)).collect(c, positions, count) };
  const options = { leagues: [bao, standard], positions: [], transactionCount: 100, snapshotDir: join(dir, 'snapshots'), dataDir: dir };
  const reports = await synchronize(options, yahoo, sheets, () => {});
  assert.deepEqual(reports.map(r => r.status), ['complete', 'complete']); assert.deepEqual(reports.map(r => r.teams), [2, 3]);
  assert.ok(apis.get('bao')!.rows('My Roster')[1]?.includes(key(bao)));
  assert.ok(apis.get('standard')!.rows('My Roster')[1]?.includes(key(standard)));
  const failedYahoo = { collect: async (c: any, p: string[], n: number) => { if (c.id === 'bao') throw new Error('denied'); return yahoo.collect(c, p, n); } };
  const failures = await synchronize(options, failedYahoo, undefined, () => {});
  assert.deepEqual(failures.map(r => r.status), ['error', 'complete']);
}));
test('identical JSON exports reuse the content file while latest tracks the attempt', async () => withDirectory(async dir => {
  const first = okSnapshot(), next = { ...first, syncAt: '2026-10-17T00:00:00Z' };
  assert.equal(await exportSnapshot(dir, 'bao', first), await exportSnapshot(dir, 'bao', next));
  assert.equal((await readJson<any>(join(dir, 'bao', 'latest.json'))).syncAt, next.syncAt);
}));
