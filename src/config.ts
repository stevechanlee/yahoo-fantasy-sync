import 'dotenv/config';
import { resolve, join } from 'node:path';
import { z } from 'zod';

export interface LeagueConfig { id: 'bao' | 'standard'; leagueId: string; name: string; title: string; season: number; spreadsheetId?: string; teamKey?: string }
export function configuration(env: NodeJS.ProcessEnv = process.env) {
  const count = z.coerce.number().int().min(1).max(1000).parse(env.TRANSACTION_COUNT || 100);
  const positions = (env.PLAYER_POSITIONS || '').split(',').map(p => p.trim()).filter(Boolean);
  if (positions.some(p => !/^[A-Za-z0-9/+-]+$/.test(p))) throw new Error('Invalid PLAYER_POSITIONS');
  const required = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Configure ${key} in your local .env; see .env.example.`);
    return value;
  };
  const league = (id: LeagueConfig['id']): LeagueConfig => {
    const prefix = id.toUpperCase(), leagueId = required(`${prefix}_LEAGUE_ID`);
    if (!/^[1-9]\d*$/.test(leagueId)) throw new Error(`${prefix}_LEAGUE_ID must be a positive numeric Yahoo league ID.`);
    return { id, leagueId, name: required(`${prefix}_LEAGUE_NAME`), title: required(`${prefix}_SPREADSHEET_TITLE`), season: 2026,
      spreadsheetId: env[`${prefix}_SPREADSHEET_ID`] || undefined, teamKey: env[`${prefix}_TEAM_KEY`] || undefined };
  };
  const leagues: LeagueConfig[] = [league('bao'), league('standard')];
  if (leagues[0]!.leagueId === leagues[1]!.leagueId) throw new Error('Each league must have a different Yahoo league ID');
  if (leagues[0]!.spreadsheetId && leagues[0]!.spreadsheetId === leagues[1]!.spreadsheetId) throw new Error('Each league must use a different spreadsheet');
  const dataDir = resolve(env.DATA_DIR || '.state');
  return { leagues, positions, transactionCount: count, dataDir, snapshotDir: resolve(env.SNAPSHOT_DIR || 'snapshots'),
    yahooToken: join(dataDir, 'yahoo-token.json'), googleToken: join(dataDir, 'google-token.json'),
    googleClientFile: resolve(env.GOOGLE_CLIENT_FILE || '.credentials/google-client.json') };
}
