export type GamePhase =
  | 'lobby'
  | 'role_assignment'
  | 'team_proposal'
  | 'voting'
  | 'quest'
  | 'endgame';

export type PlayerRole = 'unassigned' | 'resistance' | 'spy';

export interface Player {
  id: string;
  name: string;
  role: PlayerRole;
  seat: number;
  connected: boolean;
}

export interface GameHostInput {
  id: string;
  name: string;
}

export interface JoinPlayerInput {
  id: string;
  name: string;
}

export type VoteChoice = 'approve' | 'reject';
export type QuestAction = 'success' | 'fail';

export interface QuestResolution {
  questNumber: number;
  team: string[];
  approvals: number;
  rejections: number;
  succeeds: boolean;
  failCount: number;
}

export interface GameState {
  id: string;
  phase: GamePhase;
  players: Player[];
  hostId: string;
  round: number;
  turn: number;
  leaderSeat: number;
  proposedTeam: string[];
  votes: Record<string, VoteChoice>;
  questActions: Record<string, QuestAction>;
  voteWindowEndsAt: number | null;
  questWindowEndsAt: number | null;
  failedProposalCount: number;
  questResults: QuestResolution[];
  winner: 'resistance' | 'spy' | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProposeTeamInput {
  leaderId: string;
  teamPlayerIds: string[];
}

export interface VoteInput {
  playerId: string;
  vote: VoteChoice;
}

export interface QuestActionInput {
  playerId: string;
  action: QuestAction;
}

export interface GameRules {
  minPlayers: number;
  maxPlayers: number;
  voteWindowMs: number;
  questWindowMs: number;
  teamSizesByPlayerCount: Record<number, number[]>;
}
