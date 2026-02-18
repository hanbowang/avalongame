import test from 'node:test';
import assert from 'node:assert/strict';

import { createGame } from './engine.js';
import { InMemoryGameRepository } from './memoryRepository.js';

test('InMemoryGameRepository supports save, get, list, and delete', () => {
  const repository = new InMemoryGameRepository();
  const first = createGame({ id: 'host-1', name: 'Host' });
  const second = createGame({ id: 'host-2', name: 'Host 2' });

  repository.save(first);
  repository.save(second);

  assert.equal(repository.getById(first.id)?.hostId, 'host-1');
  assert.equal(repository.list().length, 2);

  repository.delete(first.id);
  assert.equal(repository.getById(first.id), undefined);
  assert.equal(repository.list().length, 1);
});
