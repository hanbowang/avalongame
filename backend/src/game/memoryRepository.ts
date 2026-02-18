import type { GameRepository } from './repository.js';
import type { GameState } from './types.js';

export class InMemoryGameRepository implements GameRepository {
  private readonly games = new Map<string, GameState>();

  getById(gameId: string): GameState | undefined {
    return this.games.get(gameId);
  }

  save(game: GameState): void {
    this.games.set(game.id, game);
  }

  delete(gameId: string): void {
    this.games.delete(gameId);
  }

  list(): GameState[] {
    return [...this.games.values()];
  }
}
