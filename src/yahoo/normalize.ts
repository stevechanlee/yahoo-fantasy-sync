import type { Matchup, Player, Raw, Team, Transaction } from '../models.js';
import { collection, list, number, obj, required, text } from './xml.js';

export function team(raw: Raw): Team {
  const standings = obj(raw.team_standings), outcomes = obj(standings.outcome_totals);
  return { teamKey: required(raw.team_key, 'team_key'), name: required(raw.name, 'team name'),
    isOwnedByMe: String(raw.is_owned_by_current_login) === '1', rank: number(standings.rank),
    wins: number(outcomes.wins), losses: number(outcomes.losses), ties: number(outcomes.ties),
    pointsFor: number(standings.points_for), pointsAgainst: number(standings.points_against),
    waiverPriority: number(raw.waiver_priority), faabBalance: number(raw.faab_balance), raw };
}
export function player(raw: Raw, availability: Player['availability'], owner?: Team): Player {
  const position = text(obj(raw.selected_position).position);
  const projectedPoints = number(obj(raw.player_projected_points).total);
  return { playerKey: required(raw.player_key, 'player_key'), playerId: text(raw.player_id), name: text(obj(raw.name).full),
    nflTeam: text(raw.editorial_team_abbr), nflTeamKey: text(raw.editorial_team_key), displayPosition: text(raw.display_position),
    eligiblePositions: list(obj(raw.eligible_positions).position).map(text).filter((p): p is string => p !== null).sort(),
    injuryStatus: text(raw.status), injuryNote: text(raw.status_full), byeWeek: number(obj(raw.bye_weeks).week),
    selectedPosition: position, rosterGroup: availability !== 'rostered' ? 'available' : position === 'BN' ? 'bench' : position?.startsWith('IR') ? 'IR' : position ? 'starter' : 'unknown',
    teamKey: owner?.teamKey ?? null, teamName: owner?.name ?? null, availability,
    percentOwned: number(obj(raw.percent_owned).value), weeklyPoints: number(obj(raw.player_points).total),
    projectedPoints, projectionStatus: projectedPoints === null ? 'not_provided_by_official_api' : 'provided', raw };
}
export function matchups(scoreboard: Raw): Matchup[] {
  return collection(scoreboard, 'matchups', 'matchup').flatMap(raw => {
    const teams = collection(raw, 'teams', 'team');
    if (teams.length < 1 || teams.length > 2) throw new Error('Invalid matchup team count');
    const week = number(raw.week), keys = teams.map(t => required(t.team_key, 'matchup team key'));
    const matchupId = `${week ?? 'unknown'}:${[...keys].sort().join(':')}`;
    return teams.map(t => ({ matchupId, week, status: text(raw.status), isPlayoffs: text(raw.is_playoffs) === null ? null : text(raw.is_playoffs) === '1',
      winnerTeamKey: text(raw.winner_team_key), teamKey: required(t.team_key, 'team_key'), teamName: text(t.name),
      opponentTeamKey: keys.find(k => k !== t.team_key) ?? null, points: number(obj(t.team_points).total),
      projectedPoints: number(obj(t.team_projected_points).total), raw }));
  }).sort((a, b) => `${a.matchupId}:${a.teamKey}`.localeCompare(`${b.matchupId}:${b.teamKey}`));
}
export function transactions(raw: Raw[]): Transaction[] {
  return raw.flatMap(t => {
    const players = list(obj(t.players).player).map(obj);
    return (players.length ? players : [{}]).map(p => {
      const data = obj(p.transaction_data);
      return { transactionKey: required(t.transaction_key, 'transaction_key'), type: text(t.type), status: text(t.status),
        timestamp: number(t.timestamp) === null ? null : new Date(number(t.timestamp)! * 1000).toISOString(),
        playerKey: text(p.player_key), playerName: text(obj(p.name).full), action: text(data.type),
        sourceTeamKey: text(data.source_team_key), destinationTeamKey: text(data.destination_team_key), raw: t };
    });
  }).sort((a, b) => `${a.transactionKey}:${a.playerKey}`.localeCompare(`${b.transactionKey}:${b.playerKey}`));
}
