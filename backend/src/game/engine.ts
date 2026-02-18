import type {
  GameHostInput,
  GameRules,
  GameState,
  Player,
  ProposeTeamInput,
  QuestActionInput,
  VoteInput
} from './types.js';

const DEFAULT_RULES: GameRules = {
  minPlayers: 5,
  maxPlayers: 10,
  voteWindowMs: 30_000,
  questWindowMs: 45_000,
  teamSizesByPlayerCount: {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5]
  }
};

const now = (): number => Date.now();

const getTeamSizeForRound = (game: GameState, rules: GameRules): number => {
  const sizes = rules.teamSizesByPlayerCount[game.players.length];
  if (!sizes) {
    throw new Error(`Unsupported player count: ${game.players.length}`);
  }

  const size = sizes[game.round - 1];
  if (!size) {
    throw new Error(`Invalid round ${game.round}`);
  }

  return size;
};

const findPlayer = (game: GameState, playerId: string): Player => {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Player ${playerId} is not part of this game`);
  }
  return player;
};

const getLeader = (game: GameState): Player => {
  const leader = game.players.find((player) => player.seat === game.leaderSeat);
  if (!leader) {
    throw new Error('Leader seat is invalid for current player list');
  }
  return leader;
};

const rotateLeader = (game: GameState): number => {
  const nextSeat = game.leaderSeat + 1;
  return nextSeat > game.players.length ? 1 : nextSeat;
};

const hasTeamWon = (game: GameState, team: 'resistance' | 'spy'): boolean => {
  const successfulQuests = game.questResults.filter((result) => result.succeeds).length;
  const failedQuests = game.questResults.filter((result) => !result.succeeds).length;
  return team === 'resistance' ? successfulQuests >= 3 : failedQuests >= 3;
};

const withTimestamp = (game: GameState): GameState => ({
  ...game,
  updatedAt: now()
});

export const createGame = (host: GameHostInput): GameState => {
  const timestamp = now();

  return {
    id: `game_${Math.random().toString(36).slice(2, 10)}_${now()}`,
    phase: 'lobby',
    players: [
      {
        id: host.id,
        name: host.name,
        role: 'unassigned',
        seat: 1,
        connected: true
      }
    ],
    hostId: host.id,
    round: 1,
    turn: 1,
    leaderSeat: 1,
    proposedTeam: [],
    votes: {},
    questActions: {},
    voteWindowEndsAt: null,
    questWindowEndsAt: null,
    failedProposalCount: 0,
    questResults: [],
    winner: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

export const joinGame = (
  game: GameState,
  player: Pick<Player, 'id' | 'name'>,
  rules: GameRules = DEFAULT_RULES
): GameState => {
  if (game.phase !== 'lobby') {
    throw new Error('Players can only join while in lobby phase');
  }

  if (game.players.length >= rules.maxPlayers) {
    throw new Error(`Lobby is full (${rules.maxPlayers} max players)`);
  }

  if (game.players.some((existing) => existing.id === player.id)) {
    throw new Error(`Player ${player.id} has already joined`);
  }

  const nextSeat = game.players.length + 1;
  return withTimestamp({
    ...game,
    players: [
      ...game.players,
      {
        id: player.id,
        name: player.name,
        role: 'unassigned',
        seat: nextSeat,
        connected: true
      }
    ]
  });
};

export const proposeTeam = (
  game: GameState,
  input: ProposeTeamInput,
  rules: GameRules = DEFAULT_RULES
): GameState => {
  if (game.phase !== 'team_proposal') {
    throw new Error('Team proposals are only allowed during team_proposal phase');
  }

  const leader = getLeader(game);
  if (leader.id !== input.leaderId) {
    throw new Error(`Only the current leader (${leader.id}) may propose a team`);
  }

  const requiredTeamSize = getTeamSizeForRound(game, rules);
  if (input.teamPlayerIds.length !== requiredTeamSize) {
    throw new Error(`Team size must be ${requiredTeamSize} for round ${game.round}`);
  }

  const uniqueTeamMembers = new Set(input.teamPlayerIds);
  if (uniqueTeamMembers.size !== input.teamPlayerIds.length) {
    throw new Error('Team proposal cannot include duplicate players');
  }

  input.teamPlayerIds.forEach((playerId) => {
    findPlayer(game, playerId);
  });

  return withTimestamp({
    ...game,
    phase: 'voting',
    proposedTeam: [...input.teamPlayerIds],
    votes: {},
    voteWindowEndsAt: now() + rules.voteWindowMs
  });
};

export const submitVote = (game: GameState, input: VoteInput): GameState => {
  if (game.phase !== 'voting') {
    throw new Error('Votes can only be submitted during voting phase');
  }

  findPlayer(game, input.playerId);

  if (game.voteWindowEndsAt !== null && now() > game.voteWindowEndsAt) {
    throw new Error('Voting window has already closed');
  }

  if (game.votes[input.playerId]) {
    throw new Error(`Player ${input.playerId} already submitted a vote`);
  }

  const updatedVotes = {
    ...game.votes,
    [input.playerId]: input.vote
  };

  return withTimestamp({
    ...game,
    votes: updatedVotes
  });
};

export const submitQuestAction = (game: GameState, input: QuestActionInput): GameState => {
  if (game.phase !== 'quest') {
    throw new Error('Quest cards can only be submitted during quest phase');
  }

  if (game.questWindowEndsAt !== null && now() > game.questWindowEndsAt) {
    throw new Error('Quest submission window has already closed');
  }

  if (!game.proposedTeam.includes(input.playerId)) {
    throw new Error('Only players on the selected team can submit quest actions');
  }

  if (game.questActions[input.playerId]) {
    throw new Error(`Player ${input.playerId} already submitted a quest card`);
  }

  return withTimestamp({
    ...game,
    questActions: {
      ...game.questActions,
      [input.playerId]: input.action
    }
  });
};

export const advancePhase = (game: GameState, rules: GameRules = DEFAULT_RULES): GameState => {
  if (game.phase === 'lobby') {
    if (game.players.length < rules.minPlayers) {
      throw new Error(`Need at least ${rules.minPlayers} players to start`);
    }

    return withTimestamp({
      ...game,
      phase: 'role_assignment'
    });
  }

  if (game.phase === 'role_assignment') {
    return withTimestamp({
      ...game,
      phase: 'team_proposal'
    });
  }

  if (game.phase === 'voting') {
    const totalPlayers = game.players.length;
    if (Object.keys(game.votes).length !== totalPlayers) {
      throw new Error('Cannot advance voting phase until all players vote');
    }

    const approvals = Object.values(game.votes).filter((vote) => vote === 'approve').length;
    const rejections = totalPlayers - approvals;

    if (approvals > rejections) {
      return withTimestamp({
        ...game,
        phase: 'quest',
        questActions: {},
        questWindowEndsAt: now() + rules.questWindowMs,
        voteWindowEndsAt: null
      });
    }

    const failedProposalCount = game.failedProposalCount + 1;
    if (failedProposalCount >= 5) {
      return withTimestamp({
        ...game,
        phase: 'endgame',
        winner: 'spy',
        failedProposalCount,
        voteWindowEndsAt: null
      });
    }

    return withTimestamp({
      ...game,
      phase: 'team_proposal',
      turn: game.turn + 1,
      leaderSeat: rotateLeader(game),
      proposedTeam: [],
      votes: {},
      voteWindowEndsAt: null,
      failedProposalCount
    });
  }

  if (game.phase === 'quest') {
    const teamSize = game.proposedTeam.length;
    if (Object.keys(game.questActions).length !== teamSize) {
      throw new Error('Cannot resolve quest until all selected players submit actions');
    }

    const failCount = Object.values(game.questActions).filter((action) => action === 'fail').length;
    const succeeds = failCount === 0;
    const approvals = Object.values(game.votes).filter((vote) => vote === 'approve').length;
    const rejections = game.players.length - approvals;

    const questResult = {
      questNumber: game.round,
      team: [...game.proposedTeam],
      approvals,
      rejections,
      succeeds,
      failCount
    };

    const intermediateGame = withTimestamp({
      ...game,
      questResults: [...game.questResults, questResult],
      round: game.round + 1,
      turn: game.turn + 1,
      phase: 'team_proposal',
      leaderSeat: rotateLeader(game),
      proposedTeam: [],
      votes: {},
      questActions: {},
      voteWindowEndsAt: null,
      questWindowEndsAt: null,
      failedProposalCount: 0
    });

    if (hasTeamWon(intermediateGame, 'resistance')) {
      return withTimestamp({
        ...intermediateGame,
        phase: 'endgame',
        winner: 'resistance'
      });
    }

    if (hasTeamWon(intermediateGame, 'spy') || intermediateGame.round > 5) {
      return withTimestamp({
        ...intermediateGame,
        phase: 'endgame',
        winner: 'spy'
      });
    }

    return intermediateGame;
  }

  if (game.phase === 'team_proposal' || game.phase === 'endgame') {
    throw new Error(`Cannot auto-advance from phase ${game.phase}`);
  }

  return game;
};

export { DEFAULT_RULES };
