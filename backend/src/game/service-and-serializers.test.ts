import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryGameRepository } from './memoryRepository.js';
import {
  advancePhase,
  createGame,
  joinGame,
  proposeTeam,
  submitQuestAction,
  submitVote
} from './service.js';
import { toPlayerState, toPublicState } from './serializers.js';

test('service persists lifecycle transitions in repository', () => {
  const repository = new InMemoryGameRepository();

  const created = createGame({ id: 'host-1', name: 'Host' }, repository);
  assert.equal(repository.list().length, 1);

  joinGame(created.id, { id: 'p2', name: 'Player 2' }, repository);
  joinGame(created.id, { id: 'p3', name: 'Player 3' }, repository);
  joinGame(created.id, { id: 'p4', name: 'Player 4' }, repository);
  joinGame(created.id, { id: 'p5', name: 'Player 5' }, repository);

  advancePhase(created.id, repository);
  advancePhase(created.id, repository);

  proposeTeam(created.id, { leaderId: 'host-1', teamPlayerIds: ['host-1', 'p2'] }, repository);

  for (const playerId of ['host-1', 'p2', 'p3', 'p4', 'p5']) {
    submitVote(created.id, { playerId, vote: 'approve' }, repository);
  }

  advancePhase(created.id, repository);
  submitQuestAction(created.id, { playerId: 'host-1', action: 'success' }, repository);
  submitQuestAction(created.id, { playerId: 'p2', action: 'success' }, repository);
  advancePhase(created.id, repository);

  const persisted = repository.getById(created.id);
  assert.ok(persisted);
  assert.equal(persisted.phase, 'team_proposal');
  assert.equal(persisted.round, 2);
  assert.equal(persisted.questResults.length, 1);
});

test('service throws when game id is missing', () => {
  const repository = new InMemoryGameRepository();

  assert.throws(
    () => joinGame('does-not-exist', { id: 'p2', name: 'Player 2' }, repository),
    /was not found/
  );
});

test('toPublicState strips hidden role info and includes join code', () => {
  const repository = new InMemoryGameRepository();
  const game = createGame({ id: 'host-1', name: 'Host' }, repository);

  const withSpy = {
    ...game,
    players: [
      { ...game.players[0], role: 'spy' as const },
      { id: 'p2', name: 'Player 2', seat: 2, connected: true, role: 'resistance' as const }
    ]
  };

  const publicState = toPublicState(withSpy, 'AB12');

  assert.equal(publicState.joinCode, 'AB12');
  assert.deepEqual(publicState.players[0], {
    id: 'host-1',
    name: 'Host',
    seat: 1,
    connected: true
  });
  assert.ok(!('role' in publicState.players[0]));
});

test('toPlayerState returns private role and known spies for spy player', () => {
  const repository = new InMemoryGameRepository();
  const game = createGame({ id: 'host-1', name: 'Host' }, repository);

  const setup = {
    ...game,
    players: [
      { ...game.players[0], role: 'spy' as const },
      { id: 'p2', name: 'Spy Ally', seat: 2, connected: true, role: 'spy' as const },
      { id: 'p3', name: 'Resistance', seat: 3, connected: true, role: 'resistance' as const }
    ]
  };

  const hostView = toPlayerState(setup, 'host-1', 'AB12');
  const resistanceView = toPlayerState(setup, 'p3', 'AB12');

  assert.equal(hostView.privateState.role, 'spy');
  assert.deepEqual(hostView.privateState.knownSpies, ['host-1', 'p2']);

  assert.equal(resistanceView.privateState.role, 'resistance');
  assert.deepEqual(resistanceView.privateState.knownSpies, []);
});

test('toPlayerState throws when requesting player is not in game', () => {
  const repository = new InMemoryGameRepository();
  const game = createGame({ id: 'host-1', name: 'Host' }, repository);

  assert.throws(() => toPlayerState(game, 'ghost', 'AB12'), /was not found/);
});

