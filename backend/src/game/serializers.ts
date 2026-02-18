import { GameStateSchema, PlayerGameStateSchema } from '@avalon/shared';
import type { GameState } from './types.js';

const toPublicPlayers = (game: GameState) =>
  game.players.map((player) => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    connected: player.connected
  }));

export const toPublicState = (game: GameState, joinCode: string) => {
  return GameStateSchema.parse({
    id: game.id,
    phase: game.phase,
    hostId: game.hostId,
    round: game.round,
    turn: game.turn,
    leaderSeat: game.leaderSeat,
    proposedTeam: game.proposedTeam,
    votes: game.votes,
    questActions: game.questActions,
    voteWindowEndsAt: game.voteWindowEndsAt,
    questWindowEndsAt: game.questWindowEndsAt,
    failedProposalCount: game.failedProposalCount,
    questResults: game.questResults,
    winner: game.winner,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    joinCode,
    players: toPublicPlayers(game)
  });
};

export const toPlayerState = (game: GameState, playerId: string, joinCode: string) => {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Player ${playerId} was not found in game ${game.id}`);
  }

  const knownSpies =
    player.role === 'spy'
      ? game.players.filter((candidate) => candidate.role === 'spy').map((candidate) => candidate.id)
      : [];

  return PlayerGameStateSchema.parse({
    ...toPublicState(game, joinCode),
    privateState: {
      role: player.role,
      knownSpies
    }
  });
};
