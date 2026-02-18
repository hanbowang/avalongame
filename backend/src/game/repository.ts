import type { GameState } from './types.js';

export interface GameRepository {
  getById(gameId: string): GameState | undefined;
  save(game: GameState): void;
  delete(gameId: string): void;
  list(): GameState[];
}
