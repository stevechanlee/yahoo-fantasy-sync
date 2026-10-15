import { join } from 'node:path';
import type { LeagueConfig } from '../config.js';
import type { Snapshot } from '../models.js';
import { readJson, writeJson } from '../lib/storage.js';
import type { SheetsApi } from './client.js';
import { dashboard, datasets, historyHeaders, historyRows, TABS, type Cell, type Table } from './schema.js';

interface Sheet { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } } }
interface Metadata { spreadsheetId: string; sheets: Sheet[]; developerMetadata?: { metadataKey: string; metadataValue: string }[] }
interface RegistryEntry { spreadsheetId?: string; leagueKey: string; creationPending?: boolean }
interface Registry { leagues: Record<string, RegistryEntry> }
export type Request = Record<string, unknown>;
const identityKey = 'yahoo_fantasy_league';
const quoted = (name: string): string => `'${name.replaceAll("'", "''")}'`;
const sheetUrl = (id: string): string => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export function cell(value: Cell): Record<string, unknown> {
  if (typeof value === 'string') {
    if (value.length > 45_000) throw new Error('A cell exceeds 45,000 characters; local snapshot saved, spreadsheet preserved');
    return { userEnteredValue: { stringValue: value } }; // Literal strings prevent formula injection.
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numeric spreadsheet value');
    return { userEnteredValue: { numberValue: value } };
  }
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  return {};
}
const rowData = (rows: Cell[][]) => rows.map(row => ({ values: row.map(cell) }));

export function replaceTable(sheet: Sheet, table: Table): Request[] {
  const { sheetId, gridProperties: grid } = sheet.properties;
  const neededRows = Math.max(2, table.rows.length + 1), neededCols = table.headers.length;
  const rowCount = Math.max(grid.rowCount, neededRows), columnCount = Math.max(grid.columnCount, neededCols);
  const range = { sheetId, startRowIndex: 0, endRowIndex: neededRows, startColumnIndex: 0, endColumnIndex: neededCols };
  return [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount, columnCount, frozenRowCount: 1 } }, fields: 'gridProperties' } },
    // updateCells clears unmatched userEnteredValue cells within this bounded range in the SAME atomic batch.
    { updateCells: { range: { ...range, endRowIndex: rowCount, endColumnIndex: columnCount }, rows: rowData([table.headers, ...table.rows]), fields: 'userEnteredValue' } },
    { repeatCell: { range, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Arial', fontSize: 10 }, verticalAlignment: 'TOP', wrapStrategy: 'CLIP' } }, fields: 'userEnteredFormat' } },
    { repeatCell: { range: { ...range, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.12, green: 0.22, blue: 0.34 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } }, fields: 'userEnteredFormat' } },
    { setBasicFilter: { filter: { range } } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: neededCols }, properties: { pixelSize: 150 }, fields: 'pixelSize' } },
  ];
}

export class SheetsSync {
  constructor(private api: SheetsApi, private dataDir: string) {}
  async verify(): Promise<void> {
    // An intentionally nonexistent ID exercises Sheets authentication/API enablement without creating a file.
    try { await this.api.get('spreadsheets/yahoo-fantasy-sync-connectivity-check?fields=spreadsheetId'); }
    catch (error) {
      const { HttpError } = await import('../lib/http.js');
      if (error instanceof HttpError && error.status === 404) return;
      throw error;
    }
  }
  async ensureSpreadsheet(config: LeagueConfig, leagueKey: string): Promise<string> {
    const path = join(this.dataDir, 'spreadsheets.json');
    const registry = await readJson<Registry>(path) ?? { leagues: {} };
    const saved = registry.leagues[config.id];
    if (saved && saved.leagueKey !== leagueKey) throw new Error('Saved spreadsheet belongs to another league/season');
    let id = config.spreadsheetId || saved?.spreadsheetId;
    if (id && !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid spreadsheet ID; configure the ID only, not the full URL');
    if (Object.entries(registry.leagues).some(([key, entry]) => key !== config.id && id && entry.spreadsheetId === id)) throw new Error('Spreadsheet already assigned to another league');
    if (!id) {
      if (saved?.creationPending) throw new Error(`Previous spreadsheet creation outcome is unknown. Find '${config.title}' in Drive, set ${config.id.toUpperCase()}_SPREADSHEET_ID, then rerun. If no file was created, remove only this league's creationPending entry in .state/spreadsheets.json.`);
      registry.leagues[config.id] = { leagueKey, creationPending: true };
      await writeJson(path, registry);
      // Persist intent before non-idempotent create, so a lost response cannot silently create duplicates.
      const response = await this.api.post<{ spreadsheetId: string }>('spreadsheets', {
        properties: { title: config.title, locale: 'en_US', timeZone: 'America/Los_Angeles' },
        sheets: TABS.map((title, sheetId) => ({ properties: { sheetId, title, gridProperties: { rowCount: 100, columnCount: 30, frozenRowCount: 1 } } })),
        developerMetadata: [{ metadataKey: identityKey, metadataValue: leagueKey, visibility: 'DOCUMENT', location: { spreadsheet: true } }],
      });
      if (!response.spreadsheetId) throw new Error('Google create response missing spreadsheet ID; check Drive before retrying');
      id = response.spreadsheetId;
    }
    registry.leagues[config.id] = { spreadsheetId: id, leagueKey };
    await writeJson(path, registry);
    return id;
  }
  async publish(id: string, snapshot: Snapshot): Promise<{ url: string; historyRowsAdded: number }> {
    const meta = await this.api.get<Metadata>(`spreadsheets/${id}?fields=spreadsheetId,sheets.properties,developerMetadata`);
    if (meta.spreadsheetId !== id || !Array.isArray(meta.sheets)) throw new Error('Invalid spreadsheet metadata');
    const bindings = meta.developerMetadata?.filter(m => m.metadataKey === identityKey) ?? [];
    if (bindings.some(m => m.metadataValue !== snapshot.league.leagueKey)) throw new Error('Spreadsheet is bound to a different Yahoo league; refusing all writes');
    const sheets = new Map(meta.sheets.map(s => [s.properties.title, s]));
    const ranges = [sheets.has('Dashboard') ? `${quoted('Dashboard')}!A:E` : undefined, sheets.has('History') ? `${quoted('History')}!A:B` : undefined].filter((v): v is string => !!v);
    const values = ranges.length ? await this.api.get<{ valueRanges: { values?: Cell[][] }[] }>(`spreadsheets/${id}/values:batchGet?${ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&')}`) : { valueRanges: [] };
    if (values.valueRanges.length !== ranges.length) throw new Error('Incomplete spreadsheet reconciliation response');
    let index = 0;
    const priorDashboard = sheets.has('Dashboard') ? values.valueRanges[index++]?.values ?? [] : [];
    const history = sheets.has('History') ? values.valueRanges[index++]?.values ?? [] : [];
    if (priorDashboard.slice(1).some(r => r[0] && r[0] !== snapshot.league.leagueKey) || history.slice(1).some(r => r[1] !== snapshot.league.leagueKey)) throw new Error('Existing spreadsheet rows belong to another league');
    if (history.length && historyHeaders.slice(0, 2).some((header, i) => history[0]?.[i] !== header)) throw new Error('History schema mismatch; refusing append');
    const requests: Request[] = [];
    if (!bindings.length) {
      // Only adopt empty dedicated tabs. Configuring an arbitrary populated ID cannot overwrite it.
      const existing = TABS.filter(title => sheets.has(title));
      if (existing.length) {
        const check = await this.api.get<{ valueRanges: { values?: Cell[][] }[] }>(`spreadsheets/${id}/values:batchGet?${existing.map(title => `ranges=${encodeURIComponent(`${quoted(title)}!A1:AD2`)}`).join('&')}`);
        if (check.valueRanges.length !== existing.length || check.valueRanges.some(v => v.values?.some(r => r.some(c => c !== null && c !== '')))) throw new Error('Configured spreadsheet has populated sync tabs but no league binding. Use an empty spreadsheet or the previously created bound spreadsheet.');
      }
      requests.push({ createDeveloperMetadata: { developerMetadata: { metadataKey: identityKey, metadataValue: snapshot.league.leagueKey, visibility: 'DOCUMENT', location: { spreadsheet: true } } } });
    }
    let nextSheetId = Math.max(0, ...meta.sheets.map(s => s.properties.sheetId)) + 1;
    for (const title of TABS) if (!sheets.has(title)) {
      const sheet: Sheet = { properties: { sheetId: nextSheetId++, title, gridProperties: { rowCount: 100, columnCount: 30 } } };
      sheets.set(title, sheet); requests.push({ addSheet: sheet });
    }
    const previous = new Map<string, string>();
    for (const row of priorDashboard.slice(1)) if (typeof row[1] === 'string' && row[1].startsWith('dataset:') && typeof row[4] === 'string') previous.set(row[1].slice(8), row[4]);
    const data = datasets(snapshot);
    for (const d of data) if (d.status === 'ok') requests.push(...replaceTable(sheets.get(d.name)!, d.table!));
    requests.push(...replaceTable(sheets.get('Dashboard')!, dashboard(snapshot, data, previous)));
    const additionalHistory = historyRows(snapshot, data, new Set(history.slice(1).map(row => String(row[0]))));
    const historySheet = sheets.get('History')!;
    if (!history.length) requests.push(...replaceTable(historySheet, { headers: historyHeaders, rows: [] }));
    if (additionalHistory.length) {
      const start = Math.max(1, history.length), needed = start + additionalHistory.length;
      requests.push({ updateSheetProperties: { properties: { sheetId: historySheet.properties.sheetId, gridProperties: { rowCount: Math.max(historySheet.properties.gridProperties.rowCount, needed), columnCount: Math.max(historySheet.properties.gridProperties.columnCount, historyHeaders.length), frozenRowCount: 1 } }, fields: 'gridProperties' } });
      requests.push({ updateCells: { start: { sheetId: historySheet.properties.sheetId, rowIndex: start, columnIndex: 0 }, rows: rowData(additionalHistory), fields: 'userEnteredValue' } });
      requests.push({ setBasicFilter: { filter: { range: { sheetId: historySheet.properties.sheetId, startRowIndex: 0, endRowIndex: needed, startColumnIndex: 0, endColumnIndex: historyHeaders.length } } } });
    }
    // Sheets' spreadsheet cell limit is 10 million, including allocated empty cells.
    const sizes = new Map(meta.sheets.map(s => [s.properties.sheetId, { ...s.properties.gridProperties }]));
    for (const sheet of sheets.values()) if (!sizes.has(sheet.properties.sheetId)) sizes.set(sheet.properties.sheetId, { ...sheet.properties.gridProperties });
    for (const request of requests) {
      const update = request.updateSheetProperties as { properties: Sheet['properties'] } | undefined;
      if (update) sizes.set(update.properties.sheetId, { ...update.properties.gridProperties });
    }
    if ([...sizes.values()].reduce((n, s) => n + s.rowCount * s.columnCount, 0) > 10_000_000) throw new Error('Spreadsheet would exceed 10 million cells; archive History to a backup spreadsheet before retrying');
    if (Buffer.byteLength(JSON.stringify({ requests })) > 40_000_000) throw new Error('Atomic sync exceeds 40 MB safety limit; narrow PLAYER_POSITIONS or archive history. Local snapshot saved.');
    // One all-or-nothing request: current data, history, and binding commit together.
    // Never automatically retry writes: rerun reconciles History IDs after an ambiguous response.
    await this.api.post(`spreadsheets/${id}:batchUpdate`, { requests, includeSpreadsheetInResponse: false });
    return { url: sheetUrl(id), historyRowsAdded: additionalHistory.length };
  }
}
