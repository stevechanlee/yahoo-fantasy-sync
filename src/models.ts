export type Raw = Record<string, unknown>;
export type Result<T> = { status: 'ok'; data: T } | { status: 'error'; error: string };
export interface League {
  leagueKey: string; gameKey: string; leagueId: string; name: string; season: number;
  currentWeek: number | null; numTeams: number; myTeamKey: string; raw: Raw;
}
export interface Team {
  teamKey: string; name: string; isOwnedByMe: boolean; rank: number | null; wins: number | null;
  losses: number | null; ties: number | null; pointsFor: number | null; pointsAgainst: number | null;
  waiverPriority: number | null; faabBalance: number | null; raw: Raw;
}
export interface Player {
  playerKey: string; playerId: string | null; name: string | null; nflTeam: string | null;
  nflTeamKey: string | null; displayPosition: string | null; eligiblePositions: string[];
  injuryStatus: string | null; injuryNote: string | null; byeWeek: number | null;
  selectedPosition: string | null; rosterGroup: 'starter' | 'bench' | 'IR' | 'unknown' | 'available';
  teamKey: string | null; teamName: string | null; availability: 'rostered' | 'FA' | 'W';
  percentOwned: number | null; weeklyPoints: number | null; projectedPoints: number | null;
  projectionStatus: 'provided' | 'not_provided_by_official_api'; raw: Raw;
}
export interface Matchup {
  matchupId: string; week: number | null; status: string | null; isPlayoffs: boolean | null;
  winnerTeamKey: string | null; teamKey: string; teamName: string | null; opponentTeamKey: string | null;
  points: number | null; projectedPoints: number | null; raw: Raw;
}
export interface Transaction {
  transactionKey: string; type: string | null; status: string | null; timestamp: string | null;
  playerKey: string | null; playerName: string | null; action: string | null;
  sourceTeamKey: string | null; destinationTeamKey: string | null; raw: Raw;
}
export interface Snapshot {
  schemaVersion: 1; syncAt: string; league: League;
  settings: Result<Raw>; standings: Result<Team[]>; myRoster: Result<Player[]>; allRosters: Result<Player[]>;
  freeAgents: Result<Player[]>; waivers: Result<Player[]>; matchups: Result<Matchup[]>; transactions: Result<Transaction[]>;
  playerPositions: string[]; transactionLimit: number; errors: string[];
}
