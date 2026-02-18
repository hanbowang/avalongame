export {
  advancePhase,
  createGame,
  joinGame,
  proposeTeam,
  submitQuestAction,
  submitVote,
  DEFAULT_RULES
} from './engine.js';
export { InMemoryGameRepository } from './memoryRepository.js';
export type { GameRepository } from './repository.js';
export {
  advancePhase as advancePhaseWithRepository,
  createGame as createGameWithRepository,
  joinGame as joinGameWithRepository,
  proposeTeam as proposeTeamWithRepository,
  submitQuestAction as submitQuestActionWithRepository,
  submitVote as submitVoteWithRepository
} from './service.js';
export type {
  GameHostInput,
  GamePhase,
  GameRules,
  GameState,
  JoinPlayerInput,
  Player,
  PlayerRole,
  ProposeTeamInput,
  QuestAction,
  QuestActionInput,
  QuestResolution,
  VoteChoice,
  VoteInput
} from './types.js';
