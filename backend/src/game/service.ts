import {
  advancePhase as advancePhaseState,
  createGame as createGameState,
  joinGame as joinGameState,
  proposeTeam as proposeTeamState,
  submitQuestAction as submitQuestActionState,
  submitVote as submitVoteState
} from './engine.js';
import type { GameRepository } from './repository.js';
import type {
  GameHostInput,
  JoinPlayerInput,
  ProposeTeamInput,
  QuestActionInput,
  VoteInput
} from './types.js';

const getRequiredGame = (repository: GameRepository, gameId: string) => {
  const game = repository.getById(gameId);
  if (!game) {
    throw new Error(`Game ${gameId} was not found`);
  }

  return game;
};

export const createGame = (host: GameHostInput, repository: GameRepository) => {
  const game = createGameState(host);
  repository.save(game);
  return game;
};

export const joinGame = (
  gameId: string,
  player: JoinPlayerInput,
  repository: GameRepository
) => {
  const nextState = joinGameState(getRequiredGame(repository, gameId), player);
  repository.save(nextState);
  return nextState;
};

export const proposeTeam = (
  gameId: string,
  input: ProposeTeamInput,
  repository: GameRepository
) => {
  const nextState = proposeTeamState(getRequiredGame(repository, gameId), input);
  repository.save(nextState);
  return nextState;
};

export const submitVote = (gameId: string, input: VoteInput, repository: GameRepository) => {
  const nextState = submitVoteState(getRequiredGame(repository, gameId), input);
  repository.save(nextState);
  return nextState;
};

export const submitQuestAction = (
  gameId: string,
  input: QuestActionInput,
  repository: GameRepository
) => {
  const nextState = submitQuestActionState(getRequiredGame(repository, gameId), input);
  repository.save(nextState);
  return nextState;
};

export const advancePhase = (gameId: string, repository: GameRepository) => {
  const nextState = advancePhaseState(getRequiredGame(repository, gameId));
  repository.save(nextState);
  return nextState;
};
