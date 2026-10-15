import { join } from 'node:path';
import { readJson, writeJson, hash } from './lib/storage.js';
import type { LeagueConfig } from './config.js';
import type { Snapshot } from './models.js';
import type { YahooService } from './yahoo/client.js';
import type { SheetsSync } from './google/sync.js';

export async function exportSnapshot(directory: string, id: string, snapshot: Snapshot): Promise<string> {
  const { syncAt: _time, ...content } = snapshot;
  const fingerprint = hash(content);
  const path = join(directory, id, `${snapshot.league.season}-${fingerprint}.json`);
  if (!await readJson(path)) await writeJson(path, snapshot);
  await writeJson(join(directory, id, 'latest.json'), snapshot);
  return path;
}
export interface RunOptions { leagues: LeagueConfig[]; positions: string[]; transactionCount: number; snapshotDir: string; dataDir: string }
export interface LeagueReport { league: string; status: 'complete' | 'partial_failure' | 'error'; teams?: number; rosterCount?: number; freeAgents?: number; waivers?: number; syncAt?: string; spreadsheetUrl?: string; snapshotPath?: string; errors: string[] }
export async function synchronize(options: RunOptions, yahoo: Pick<YahooService, 'collect'>, sheets?: Pick<SheetsSync, 'ensureSpreadsheet' | 'publish'>, log: (message: string) => void = console.log): Promise<LeagueReport[]> {
  const reports: LeagueReport[] = [];
  for (const config of options.leagues) {
    const report: LeagueReport = { league: config.name, status: 'error', errors: [] };
    reports.push(report);
    try {
      const snapshot = await yahoo.collect(config, options.positions, options.transactionCount);
      report.syncAt = snapshot.syncAt; report.teams = snapshot.league.numTeams;
      report.rosterCount = snapshot.allRosters.status === 'ok' ? snapshot.allRosters.data.length : undefined;
      report.freeAgents = snapshot.freeAgents.status === 'ok' ? snapshot.freeAgents.data.length : undefined;
      report.waivers = snapshot.waivers.status === 'ok' ? snapshot.waivers.data.length : undefined;
      report.errors.push(...snapshot.errors);
      report.snapshotPath = await exportSnapshot(options.snapshotDir, config.id, snapshot);
      if (sheets) {
        const id = await sheets.ensureSpreadsheet(config, snapshot.league.leagueKey);
        report.spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${id}/edit`;
        await sheets.publish(id, snapshot);
      }
      report.status = report.errors.length ? 'partial_failure' : 'complete';
    } catch (error) { report.errors.push(error instanceof Error ? error.message : 'Unknown synchronization failure'); }
    const available = report.freeAgents !== undefined && report.waivers !== undefined ? report.freeAgents + report.waivers : 'unknown (fetch failed)';
    log(`${config.name}: ${report.status} | teams=${report.teams ?? 'unknown'} | roster players=${report.rosterCount ?? 'unknown'} | available=${available} (FA=${report.freeAgents ?? '?'}, W=${report.waivers ?? '?'}) | ${report.syncAt ?? new Date().toISOString()}${report.spreadsheetUrl ? ` | ${report.spreadsheetUrl}` : ''}`);
    for (const error of report.errors) log(`  ERROR: ${error}`);
  }
  await writeJson(join(options.dataDir, 'last-run.json'), { finishedAt: new Date().toISOString(), exportOnly: !sheets, reports });
  return reports;
}
