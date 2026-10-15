import type { Player, Raw, Result, Snapshot } from '../models.js';
import { canonical, hash } from '../lib/storage.js';
import { list, obj, text } from '../yahoo/xml.js';

export type Cell = string | number | boolean | null;
export interface Table { headers: string[]; rows: Cell[][] }
export const TABS = ['Dashboard', 'My Roster', 'Standings', 'All Rosters', 'Free Agents', 'Waivers', 'Matchups', 'Scoring Settings', 'Transactions', 'History'] as const;
export interface Dataset { name: string; status: 'ok' | 'error'; error?: string; table?: Table }
const playerHeaders = ['player_key', 'player_id', 'player_name', 'nfl_team', 'nfl_team_key', 'display_position', 'eligible_positions_json', 'injury_status', 'injury_note', 'bye_week', 'selected_position', 'roster_group', 'team_key', 'team_name', 'availability', 'percent_owned', 'weekly_points', 'projected_points', 'projection_status', 'raw_json'];
function playerRow(p: Player): Cell[] {
  return [p.playerKey, p.playerId, p.name, p.nflTeam, p.nflTeamKey, p.displayPosition, canonical(p.eligiblePositions), p.injuryStatus, p.injuryNote, p.byeWeek,
    p.selectedPosition, p.rosterGroup, p.teamKey, p.teamName, p.availability, p.percentOwned, p.weeklyPoints, p.projectedPoints, p.projectionStatus, canonical(p.raw)];
}
function settingsRows(settings: Raw): Cell[][] {
  const labels = new Map(list(obj(obj(settings.stat_categories).stats).stat).map(s => { const v = obj(s); return [text(v.stat_id), text(v.name)] as const; }));
  const result: Cell[][] = [];
  const walk = (value: unknown, path: string, context: { statId: string | null; name: string | null }) => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, context));
    else if (value !== null && typeof value === 'object') {
      const record = obj(value), statId = text(record.stat_id) ?? context.statId;
      const name = text(record.name) ?? labels.get(statId) ?? context.name;
      for (const [k, v] of Object.entries(record).sort(([a], [b]) => a.localeCompare(b))) walk(v, path ? `${path}.${k}` : k, { statId, name });
    } else result.push([path.startsWith('roster_positions') ? 'roster_requirement' : path.startsWith('stat_modifiers') ? 'scoring_modifier_or_bonus' : path.startsWith('stat_categories') ? 'stat_category' : 'league_setting', path, context.statId, context.name, typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null, canonical(value)]);
  };
  walk(settings, '', { statId: null, name: null }); return result;
}
export function datasets(snapshot: Snapshot): Dataset[] {
  const context = ['league_key', 'season', 'fantasy_week', 'sync_at'];
  const values: Cell[] = [snapshot.league.leagueKey, snapshot.league.season, snapshot.league.currentWeek, snapshot.syncAt];
  const make = <T>(name: string, result: Result<T>, headers: string[], rows: (data: T) => Cell[][]): Dataset => result.status === 'error' ? { name, status: 'error', error: result.error } : { name, status: 'ok', table: { headers: [...context, ...headers], rows: rows(result.data).map(row => [...values, ...row]) } };
  return [
    make('My Roster', snapshot.myRoster, playerHeaders, p => p.map(playerRow)),
    make('Standings', snapshot.standings, ['team_key', 'team_name', 'is_my_team', 'rank', 'wins', 'losses', 'ties', 'points_for', 'points_against', 'waiver_priority', 'faab_balance', 'raw_json'], teams => teams.map(t => [t.teamKey, t.name, t.teamKey === snapshot.league.myTeamKey, t.rank, t.wins, t.losses, t.ties, t.pointsFor, t.pointsAgainst, t.waiverPriority, t.faabBalance, canonical(t.raw)])),
    make('All Rosters', snapshot.allRosters, playerHeaders, p => p.map(playerRow)),
    make('Free Agents', snapshot.freeAgents, playerHeaders, p => p.map(playerRow)),
    make('Waivers', snapshot.waivers, playerHeaders, p => p.map(playerRow)),
    make('Matchups', snapshot.matchups, ['matchup_id', 'week', 'status', 'is_playoffs', 'winner_team_key', 'team_key', 'team_name', 'opponent_team_key', 'points', 'projected_points', 'raw_json'], rows => rows.map(m => [m.matchupId, m.week, m.status, m.isPlayoffs, m.winnerTeamKey, m.teamKey, m.teamName, m.opponentTeamKey, m.points, m.projectedPoints, canonical(m.raw)])),
    make('Scoring Settings', snapshot.settings, ['setting_type', 'setting_path', 'stat_id', 'stat_name', 'value', 'value_json'], settingsRows),
    make('Transactions', snapshot.transactions, ['transaction_key', 'transaction_type', 'transaction_status', 'transaction_at', 'player_key', 'player_name', 'action', 'source_team_key', 'destination_team_key', 'raw_json'], rows => rows.map(t => [t.transactionKey, t.type, t.status, t.timestamp, t.playerKey, t.playerName, t.action, t.sourceTeamKey, t.destinationTeamKey, canonical(t.raw)])),
  ];
}
export function dashboard(s: Snapshot, data: Dataset[], previous: Map<string, string>): Table {
  const rows: Cell[][] = [];
  const metric = (key: string, value: Cell, status = 'provided', sourceAt: Cell = s.syncAt) => rows.push([s.league.leagueKey, key, value, status, sourceAt]);
  metric('league_name', s.league.name); metric('league_id', s.league.leagueId); metric('game_key', s.league.gameKey); metric('season', s.league.season);
  metric('fantasy_week', s.league.currentWeek, s.league.currentWeek === null ? 'not_provided' : 'provided'); metric('my_team_key', s.league.myTeamKey);
  metric('team_count', s.league.numTeams); metric('last_sync_attempt_at', s.syncAt); metric('sync_status', s.errors.length ? 'partial_failure' : 'complete');
  metric('player_position_filters_json', canonical(s.playerPositions)); metric('transaction_limit', s.transactionLimit);
  metric('player_projections', 'Only values returned by the official API; no documented general player-projections endpoint is queried.', 'capability_note');
  metric('missing_values', 'Blank/null means not provided or not applicable; numeric 0 is a real zero. Injury blank does not certify health.', 'schema_note');
  metric('history_format', 'Rows are JSON fragments. Group by snapshot_id + entity_index; join fragments by chunk_index then JSON.parse. Manifest uses entity_index=-1.', 'schema_note');
  for (const d of data) { metric(`dataset:${d.name}`, d.status === 'ok' ? d.table!.rows.length : d.error ?? 'failed', d.status === 'ok' ? 'ok' : 'error_previous_data_preserved', d.status === 'ok' ? s.syncAt : previous.get(d.name) ?? null); }
  s.errors.forEach((error, i) => metric(`error:${i + 1}`, error, 'error'));
  return { headers: ['league_key', 'metric', 'value', 'status', 'source_sync_at'], rows };
}
export const historyHeaders = ['snapshot_id', 'league_key', 'season', 'fantasy_week', 'captured_at', 'dataset', 'entity_index', 'chunk_index', 'chunk_count', 'json_fragment'];
export function historyRows(s: Snapshot, data: Dataset[], existing: Set<string>): Cell[][] {
  const rows: Cell[][] = [];
  for (const d of data) {
    if (d.status !== 'ok' || !d.table) continue;
    // Timestamp is excluded from the fingerprint and stored once in captured_at.
    const headers = d.table.headers.filter(h => h !== 'sync_at');
    const records = d.table.rows.map(row => Object.fromEntries(d.table!.headers.map((h, i) => [h, row[i]]).filter(([h]) => h !== 'sync_at')));
    const manifest = { schema_version: 1, league: s.league, dataset: d.name, headers, row_count: records.length,
      player_positions: s.playerPositions, transaction_limit: s.transactionLimit };
    const id = hash({ manifest, records });
    if (existing.has(id)) continue;
    [manifest, ...records].forEach((record, index) => {
      const serialized = canonical(record);
      // Split by Unicode code points to avoid breaking surrogate pairs in Sheets.
      const codepoints = Array.from(serialized), chunks: string[] = [];
      for (let offset = 0; offset < codepoints.length; offset += 20_000) chunks.push(codepoints.slice(offset, offset + 20_000).join(''));
      chunks.forEach((chunk, chunkIndex) => rows.push([id, s.league.leagueKey, s.league.season, s.league.currentWeek, s.syncAt, d.name, index - 1, chunkIndex, chunks.length, chunk]));
    });
  }
  return rows;
}
