import type { OAuth } from '../auth.js';
import type { LeagueConfig } from '../config.js';
import { Http, HttpError } from '../lib/http.js';
import type { League, Player, Raw, Result, Snapshot, Team } from '../models.js';
import { matchups, player, team, transactions } from './normalize.js';
import { collection, container, list, number, obj, required, text, xml } from './xml.js';

export interface YahooReader { get(path: string): Promise<Raw> }
export class YahooClient implements YahooReader {
  constructor(private auth: Pick<OAuth, 'access'>, private http = new Http()) {}
  async get(path: string): Promise<Raw> {
    if (!/^(games;|league\/|team\/|users;)/.test(path) || /[?#\s]/.test(path)) throw new Error('Invalid Yahoo read path');
    const url = `https://fantasysports.yahooapis.com/fantasy/v2/${path}`;
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.access(attempt > 0);
      try {
        const response = await this.http.request(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/xml' } }, 'Yahoo Fantasy');
        return xml(await response.text());
      } catch (error) {
        if (error instanceof HttpError && error.status === 401 && attempt === 0) continue;
        throw error;
      }
    }
  }
}

export class YahooService {
  constructor(private client: YahooReader, private progress: (message: string) => void = () => {}) {}
  async verify(config: LeagueConfig): Promise<{ league: League; teams: Team[] }> {
    const response = await this.client.get(`games;game_codes=nfl;seasons=${config.season}`);
    const games = collection(response, 'games', 'game').filter(g => text(g.code) === 'nfl' && number(g.season) === config.season && (!g.type || g.type === 'full'));
    if (!games.length) throw new Error(`Yahoo has not returned an NFL game for ${config.season}`);
    const failures: string[] = [];
    for (const game of games) {
      const gameKey = required(game.game_key, 'game_key');
      try {
        const leagueKey = `${gameKey}.l.${config.leagueId}`;
        const raw = container(await this.client.get(`league/${leagueKey}/metadata`), 'league');
        if (text(raw.league_key) !== leagueKey || text(raw.league_id) !== config.leagueId || number(raw.season) !== config.season || (raw.game_code && raw.game_code !== 'nfl')) throw new Error('League identity/season mismatch');
        const numTeams = number(raw.num_teams);
        if (!numTeams || !Number.isInteger(numTeams)) throw new Error('Missing or invalid league team count');
        const teams = await this.fetchStandings(leagueKey, numTeams);
        let owned = teams.filter(t => t.isOwnedByMe).map(t => t.teamKey);
        if (!owned.length) {
          const user = container(await this.client.get(`users;use_login=1/games;game_keys=${gameKey}/teams`), 'users');
          // User collections in XML have repeated <user>; each contains games/game/teams.
          owned = list(user.user).flatMap(u => collection(obj(u), 'games', 'game').flatMap(g => collection(g, 'teams', 'team').map(t => required(t.team_key, 'owned team key')))).filter(k => k.startsWith(`${leagueKey}.t.`));
        }
        const myTeamKey = config.teamKey ?? (owned.length === 1 ? owned[0] : undefined);
        if (!myTeamKey || !owned.includes(myTeamKey) || !teams.some(t => t.teamKey === myTeamKey)) throw new Error(`Cannot identify your team uniquely. Check account or configure ${config.id.toUpperCase()}_TEAM_KEY from your owned team keys.`);
        return { league: { leagueKey, gameKey, leagueId: config.leagueId, name: required(raw.name, 'league name'), season: config.season,
          currentWeek: number(raw.current_week), numTeams, myTeamKey, raw }, teams };
      } catch (error) { failures.push(`${gameKey}: ${error instanceof Error ? error.message : 'unknown error'}`); }
    }
    throw new Error(`Cannot verify ${config.name} (${config.leagueId}): ${failures.join('; ')}`);
  }
  private async fetchStandings(key: string, expected: number): Promise<Team[]> {
    const raw = container(await this.client.get(`league/${key}/standings`), 'league');
    const teams = collection(container(raw, 'standings'), 'teams', 'team').map(team);
    if (teams.length !== expected || new Set(teams.map(t => t.teamKey)).size !== expected || teams.some(t => !t.teamKey.startsWith(`${key}.t.`))) throw new Error('Incomplete standings or wrong-league team keys');
    return teams.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.teamKey.localeCompare(b.teamKey));
  }
  async available(league: League, status: 'FA' | 'W', positions: string[]): Promise<Player[]> {
    const union = new Map<string, Player>();
    for (const position of positions.length ? positions : ['']) {
      const seen = new Set<string>();
      let finished = false;
      for (let start = 0, page = 0; page < 1000; page++) {
        const path = `league/${league.leagueKey}/players;status=${status}${position ? `;position=${encodeURIComponent(position)}` : ''};sort=NAME;start=${start};count=25;out=percent_owned`;
        const root = container(await this.client.get(path), 'league');
        const rows = collection(root, 'players', 'player');
        if (!rows.length) { finished = true; break; }
        for (const raw of rows) {
          const p = player(raw, status);
          if (!p.playerKey.startsWith(`${league.gameKey}.p.`)) throw new Error('Player belongs to another game');
          if (seen.has(p.playerKey)) throw new Error(`Yahoo ${status} pagination repeated a player; retry after player pool settles`);
          seen.add(p.playerKey); union.set(p.playerKey, p);
        }
        // Advance by actual count; do not assume Yahoo honored our requested page size.
        start += rows.length;
      }
      if (!finished) throw new Error(`Yahoo ${status} pagination exceeded safety limit; refusing truncated data`);
    }
    return [...union.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.playerKey.localeCompare(b.playerKey));
  }
  async collect(config: LeagueConfig, positions: string[], transactionLimit: number): Promise<Snapshot> {
    const { league, teams } = await this.verify(config);
    const errors: string[] = [];
    const capture = async <T>(name: string, fn: () => Promise<T>): Promise<Result<T>> => {
      this.progress(`${config.name}: fetching ${name}`);
      try { return { status: 'ok', data: await fn() }; }
      catch (error) { const message = `${name}: ${error instanceof Error ? error.message : 'unknown failure'}`; errors.push(message); return { status: 'error', error: message }; }
    };
    const settings = await capture('settings', async () => {
      const raw = container(container(await this.client.get(`league/${league.leagueKey}/settings`), 'league'), 'settings');
      const positions = collection(raw, 'roster_positions', 'roster_position');
      if (!positions.length || positions.some(p => !text(p.position) || number(p.count) === null)) throw new Error('Incomplete roster requirements');
      container(raw, 'stat_categories'); container(raw, 'stat_modifiers');
      return raw;
    });
    const rosterResults = new Map<string, Result<Player[]>>();
    for (const t of teams) {
      rosterResults.set(t.teamKey, await capture(`roster ${t.name}`, async () => {
        const raw = container(await this.client.get(`team/${t.teamKey}/roster${league.currentWeek === null ? '' : `;week=${league.currentWeek}`}`), 'team');
        if (text(raw.team_key) !== t.teamKey) throw new Error('Roster team identity mismatch');
        const roster = container(raw, 'roster');
        if (league.currentWeek !== null && number(roster.week) !== league.currentWeek) throw new Error('Roster week mismatch');
        const players = collection(roster, 'players', 'player').map(p => player(p, 'rostered', t));
        if (players.some(p => !p.playerKey.startsWith(`${league.gameKey}.p.`) || p.rosterGroup === 'unknown') || new Set(players.map(p => p.playerKey)).size !== players.length) throw new Error('Incomplete roster player identities/positions');
        return players.sort((a, b) => a.playerKey.localeCompare(b.playerKey));
      }));
    }
    const rosterFailures = [...rosterResults.values()].filter(r => r.status === 'error');
    let allRosters: Result<Player[]> = rosterFailures.length ? { status: 'error', error: 'One or more rosters failed; All Rosters preserved' } : { status: 'ok', data: [...rosterResults.values()].flatMap(r => r.status === 'ok' ? r.data : []).sort((a, b) => `${a.teamKey}:${a.playerKey}`.localeCompare(`${b.teamKey}:${b.playerKey}`)) };
    if (allRosters.status === 'ok' && new Set(allRosters.data.map(p => p.playerKey)).size !== allRosters.data.length) {
      const message = 'Player appears on multiple teams; roster collection changed during sync'; errors.push(message); allRosters = { status: 'error', error: message };
    }
    const freeAgents = await capture('free agents', () => this.available(league, 'FA', positions));
    const waivers = await capture('waivers', () => this.available(league, 'W', positions));
    const matchupsResult = await capture('matchups', async () => {
      const raw = container(await this.client.get(`league/${league.leagueKey}/scoreboard${league.currentWeek === null ? '' : `;week=${league.currentWeek}`}`), 'league');
      const board = container(raw, 'scoreboard');
      if (league.currentWeek !== null && number(board.week) !== league.currentWeek) throw new Error('Scoreboard week mismatch');
      const result = matchups(board);
      if (result.some(m => !teams.some(t => t.teamKey === m.teamKey) || (league.currentWeek !== null && m.week !== league.currentWeek))) throw new Error('Matchup league/week mismatch');
      return result;
    });
    const transactionsResult = await capture('transactions', async () => {
      const raw = container(await this.client.get(`league/${league.leagueKey}/transactions;count=${transactionLimit}`), 'league');
      const result = transactions(collection(raw, 'transactions', 'transaction'));
      if (result.some(t => !t.transactionKey.startsWith(`${league.leagueKey}.`))) throw new Error('Transaction league identity mismatch');
      return result;
    });
    // Availability can move during a long run; refuse contradictory current-state sets.
    const rosterKeys = new Set(allRosters.status === 'ok' ? allRosters.data.map(p => p.playerKey) : []);
    const faKeys = new Set(freeAgents.status === 'ok' ? freeAgents.data.map(p => p.playerKey) : []);
    if ((freeAgents.status === 'ok' && freeAgents.data.some(p => rosterKeys.has(p.playerKey))) || (waivers.status === 'ok' && waivers.data.some(p => rosterKeys.has(p.playerKey) || faKeys.has(p.playerKey)))) {
      const message = 'Availability changed during sync; Free Agents and Waivers preserved. Retry.';
      errors.push(message);
      return { schemaVersion: 1, syncAt: new Date().toISOString(), league, settings, standings: { status: 'ok', data: teams }, myRoster: rosterResults.get(league.myTeamKey)!, allRosters,
        freeAgents: { status: 'error', error: message }, waivers: { status: 'error', error: message }, matchups: matchupsResult, transactions: transactionsResult, playerPositions: positions, transactionLimit, errors };
    }
    return { schemaVersion: 1, syncAt: new Date().toISOString(), league, settings, standings: { status: 'ok', data: teams }, myRoster: rosterResults.get(league.myTeamKey)!, allRosters,
      freeAgents, waivers, matchups: matchupsResult, transactions: transactionsResult, playerPositions: positions, transactionLimit, errors };
  }
}
