import { XMLBuilder } from 'fast-xml-parser';
import { xml } from '../src/yahoo/xml.js';
import type { Raw, Snapshot } from '../src/models.js';
import type { LeagueConfig } from '../src/config.js';
import type { YahooReader } from '../src/yahoo/client.js';

// Synthetic fixtures modeled on the official XML schema. Never used as live league data.
export const bao: LeagueConfig = { id: 'bao', leagueId: '100001', name: 'Example Superflex League', title: 'Example Superflex League 2026', season: 2026 };
export const standard: LeagueConfig = { id: 'standard', leagueId: '100002', name: 'Example Standard League', title: 'Example Standard League 2026', season: 2026 };
export const gameKey = '999';
export const key = (c = bao) => `${gameKey}.l.${c.leagueId}`;
export const fixtureXml = (body: Raw): string => new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_' }).build({ fantasy_content: body });
export const roundTrip = (body: Raw): Raw => xml(fixtureXml(body));
export function playerRaw(id: number, position?: string): Raw {
  return { player_key: `${gameKey}.p.${id}`, player_id: String(id), name: { full: `Player ${id}` }, editorial_team_abbr: 'SF', editorial_team_key: 'nfl.t.25', display_position: 'QB', eligible_positions: { position: ['QB', 'Q/W/R/T'] }, bye_weeks: { week: '9' }, ...(position ? { selected_position: { position, week: '6' } } : {}) };
}
export class FixtureYahoo implements YahooReader {
  paths: string[] = [];
  failures = new Set<string>();
  teamCount: number;
  constructor(public config = bao, count = config.id === 'bao' ? 2 : 3) { this.teamCount = count; }
  async get(path: string): Promise<Raw> {
    this.paths.push(path);
    if ([...this.failures].some(value => path.includes(value))) throw new Error('Simulated endpoint failure');
    const leagueKey = key(this.config);
    const team = (id: number) => ({ team_key: `${leagueKey}.t.${id}`, name: `Team ${id}`, is_owned_by_current_login: id === 1 ? '1' : '0', waiver_priority: String(id), team_standings: { rank: String(id), outcome_totals: { wins: '0', losses: '0', ties: '0' }, points_for: '0' } });
    let body: Raw;
    if (path.startsWith('games;')) body = { games: { '@_count': '1', game: { game_key: gameKey, code: 'nfl', type: 'full', season: '2026' } } };
    else if (path.endsWith('/metadata')) body = { league: { league_key: leagueKey, league_id: this.config.leagueId, season: '2026', name: this.config.name, num_teams: String(this.teamCount), current_week: '6' } };
    else if (path.endsWith('/standings')) body = { league: { standings: { teams: { '@_count': String(this.teamCount), team: Array.from({ length: this.teamCount }, (_, i) => team(i + 1)) } } } };
    else if (path.endsWith('/settings')) body = { league: { settings: { roster_positions: { roster_position: [{ position: 'QB', count: this.config.id === 'bao' ? '2' : '1' }, { position: 'BN', count: '6' }] }, stat_categories: { stats: { stat: { stat_id: '4', name: 'Passing Yards' } } }, stat_modifiers: { stats: { stat: { stat_id: '4', value: this.config.id === 'bao' ? '0.05' : '0.04', bonuses: { bonus: { target: '300', points: '5' } } } } } } } };
    else if (path.includes('/roster')) {
      const id = Number(path.match(/\.t\.(\d+)/)?.[1]);
      body = { team: { ...team(id), roster: { week: '6', players: { '@_count': '3', player: [playerRaw(id * 10, 'QB'), playerRaw(id * 10 + 1, 'BN'), playerRaw(id * 10 + 2, 'IR')] } } } };
    } else if (path.includes('/players;')) {
      const start = Number(path.match(/;start=(\d+)/)?.[1]);
      const status = path.includes(';status=FA') ? 'FA' : 'W';
      // Short pages (2 rows) deliberately ensure pagination does not stop at <25.
      const players = start === 0 ? [playerRaw(status === 'FA' ? 100 : 200), playerRaw(status === 'FA' ? 101 : 201)] : start === 2 ? [playerRaw(status === 'FA' ? 102 : 202)] : [];
      body = { league: { players: { '@_count': String(players.length), player: players } } };
    } else if (path.includes('/scoreboard')) body = { league: { scoreboard: { week: '6', matchups: { '@_count': '1', matchup: { week: '6', status: 'midevent', is_playoffs: '0', teams: { '@_count': '2', team: [{ ...team(1), team_points: { total: '0' }, team_projected_points: { total: '120.5' } }, { ...team(2), team_points: { total: '12' } }] } } } } } };
    else if (path.includes('/transactions')) body = { league: { transactions: { '@_count': '1', transaction: { transaction_key: `${leagueKey}.tr.1`, type: 'add/drop', status: 'successful', timestamp: '1792000000', players: { player: [{ ...playerRaw(100), transaction_data: { type: 'add', destination_team_key: `${leagueKey}.t.1` } }, { ...playerRaw(101), transaction_data: { type: 'drop', source_team_key: `${leagueKey}.t.1` } }] } } } } };
    else throw new Error(`Unexpected fixture path: ${path}`);
    return roundTrip(body);
  }
}
export function okSnapshot(): Snapshot {
  return { schemaVersion: 1, syncAt: '2026-10-14T12:00:00.000Z', league: { leagueKey: key(), gameKey, leagueId: bao.leagueId, season: 2026, name: bao.name, currentWeek: 6, numTeams: 2, myTeamKey: `${key()}.t.1`, raw: {} },
    settings: { status: 'ok', data: {} }, standings: { status: 'ok', data: [] }, myRoster: { status: 'ok', data: [] }, allRosters: { status: 'ok', data: [] }, freeAgents: { status: 'ok', data: [] }, waivers: { status: 'ok', data: [] }, matchups: { status: 'ok', data: [] }, transactions: { status: 'ok', data: [] }, playerPositions: [], transactionLimit: 100, errors: [] };
}
