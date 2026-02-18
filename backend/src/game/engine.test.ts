import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RULES,
  advancePhase,
  createGame,
  joinGame,
  proposeTeam,
  submitQuestAction,
  submitVote
} from './engine.js';
import { toPlayerState } from './serializers.js';

const addPlayersToMinimum = () => {
  let game = createGame({ id: 'host-1', name: 'Host' });
  game = joinGame(game, { id: 'p2', name: 'Player 2' });
  game = joinGame(game, { id: 'p3', name: 'Player 3' });
  game = joinGame(game, { id: 'p4', name: 'Player 4' });
  game = joinGame(game, { id: 'p5', name: 'Player 5' });
  return game;
};

const addPlayersToSix = () => {
  let game = addPlayersToMinimum();
  game = joinGame(game, { id: 'p6', name: 'Player 6' });
  return game;
};

test('createGame seeds lobby state for host', () => {
  const game = createGame({ id: 'host-1', name: 'Host' });

  assert.equal(game.phase, 'lobby');
  assert.equal(game.players.length, 1);
  assert.equal(game.players[0]?.seat, 1);
  assert.equal(game.hostId, 'host-1');
  assert.equal(game.round, 1);
  assert.equal(game.turn, 1);
  assert.equal(game.leaderSeat, 1);
});

test('joinGame allows joining in lobby and increments seat assignment', () => {
  const game = createGame({ id: 'host-1', name: 'Host' });
  const updated = joinGame(game, { id: 'p2', name: 'Player 2' });

  assert.equal(updated.players.length, 2);
  assert.deepEqual(
    updated.players.map((player) => ({ id: player.id, seat: player.seat })),
    [
      { id: 'host-1', seat: 1 },
      { id: 'p2', seat: 2 }
    ]
  );
});

test('joinGame rejects duplicate players and full lobbies', () => {
  const rules = { ...DEFAULT_RULES, maxPlayers: 2 };
  const game = createGame({ id: 'host-1', name: 'Host' });
  const withSecondPlayer = joinGame(game, { id: 'p2', name: 'Player 2' }, rules);

  assert.throws(() => joinGame(withSecondPlayer, { id: 'p2', name: 'Player 2' }), /already joined/);
  assert.throws(() => joinGame(withSecondPlayer, { id: 'p3', name: 'Player 3' }, rules), /Lobby is full/);
});

test('advancePhase rejects starting lobby until minimum players join', () => {
  const game = createGame({ id: 'host-1', name: 'Host' });
  assert.throws(() => advancePhase(game), /Need at least/);
});

test('role_assignment transition assigns only resistance/spy roles with correct spy count for 6 players', () => {
  let game = addPlayersToSix();
  game = advancePhase(game);
  game = advancePhase(game);

  assert.equal(game.phase, 'team_proposal');
  assert.ok(game.players.every((player) => player.role !== 'unassigned'));

  const spyCount = game.players.filter((player) => player.role === 'spy').length;
  assert.equal(spyCount, 2);
});

test('toPlayerState exposes known spies only to spy players', () => {
  let game = addPlayersToMinimum();
  game = advancePhase(game);
  game = advancePhase(game);

  const spies = game.players.filter((player) => player.role === 'spy').map((player) => player.id);
  assert.ok(spies.length > 0);

  const spyView = toPlayerState(game, spies[0] as string, 'AB12');
  assert.deepEqual([...spyView.privateState.knownSpies].sort(), [...spies].sort());

  const resistancePlayer = game.players.find((player) => player.role === 'resistance');
  assert.ok(resistancePlayer);
  const resistanceView = toPlayerState(game, resistancePlayer.id, 'AB12');
  assert.deepEqual(resistanceView.privateState.knownSpies, []);
});

test('leader can propose valid team and move to voting', () => {
  let game = addPlayersToMinimum();
  game = advancePhase(game);
  game = advancePhase(game);

  const proposed = proposeTeam(game, { leaderId: 'host-1', teamPlayerIds: ['host-1', 'p2'] });

  assert.equal(proposed.phase, 'voting');
  assert.deepEqual(proposed.proposedTeam, ['host-1', 'p2']);
  assert.deepEqual(proposed.votes, {});
  assert.ok((proposed.voteWindowEndsAt ?? 0) > Date.now());
});

test('proposeTeam enforces leader, team size, uniqueness, and membership', () => {
  let game = addPlayersToMinimum();
  game = advancePhase(game);
  game = advancePhase(game);

  assert.throws(
    () => proposeTeam(game, { leaderId: 'p2', teamPlayerIds: ['host-1', 'p2'] }),
    /Only the current leader/
  );
  assert.throws(
    () => proposeTeam(game, { leaderId: 'host-1', teamPlayerIds: ['host-1'] }),
    /Team size must be/
  );
  assert.throws(
    () => proposeTeam(game, { leaderId: 'host-1', teamPlayerIds: ['host-1', 'host-1'] }),
    /duplicate/
  );
  assert.throws(
    () => proposeTeam(game, { leaderId: 'host-1', teamPlayerIds: ['host-1', 'unknown'] }),
    /is not part/
  );
});

test('voting requires phase, valid player, single vote, and open window', () => {
  let game = addPlayersToMinimum();

  assert.throws(() => submitVote(game, { playerId: 'host-1', vote: 'approve' }), /voting phase/);

  game = advancePhase(game);
  game = advancePhase(game);
  game = proposeTeam(game, { leaderId: 'host-1', teamPlayerIds: ['host-1', 'p2'] });

  const voted = submitVote(game, { playerId: 'host-1', vote: 'approve' });
  assert.equal(voted.votes['host-1'], 'approve');

  assert.throws(() => submitVote(voted, { playerId: 'host-1', vote: 'reject' }), /already submitted/);
  assert.throws(() => submitVote(game, { playerId: 'ghost', vote: 'approve' }), /is not part/);

  const expired = { ...game, voteWindowEndsAt: Date.now() - 1 };
  assert.throws(() => submitVote(expired, { playerId: 'p2', vote: 'approve' }), /already closed/);
});

test('rejected votes rotate leader and eventually give spies auto-win after 5 failed proposals', () => {
  let game = addPlayersToMinimum();
  game = advancePhase(game);
  game = advancePhase(game);

  for (let failedProposals = 1; failedProposals <= 5; failedProposals += 1) {
    const leader = game.players.find((player) => player.seat === game.leaderSeat);
    assert.ok(leader);

    const secondMember = leader.id === 'p2' ? 'host-1' : 'p2';
    game = proposeTeam(game, { leaderId: leader.id, teamPlayerIds: [leader.id, secondMember] });

    for (const player of game.players) {
      game = submitVote(game, { playerId: player.id, vote: 'reject' });
    }

    game = advancePhase(game);

    if (failedProposals < 5) {
      assert.equal(game.phase, 'team_proposal');
      assert.equal(game.failedProposalCount, failedProposals);
    }
  }

  assert.equal(game.phase, 'endgame');
  assert.equal(game.winner, 'spy');
});

test('approved vote enters quest and quest action rules are enforced', () => {
  let game = addPlayersToMinimum();
  game = advancePhase(game);
  game = advancePhase(game);
  game = proposeTeam(game, { leaderId: 'host-1', teamPlayerIds: ['host-1', 'p2'] });

  for (const player of game.players) {
    game = submitVote(game, { playerId: player.id, vote: 'approve' });
  }

  game = advancePhase(game);
  assert.equal(game.phase, 'quest');
  assert.ok((game.questWindowEndsAt ?? 0) > Date.now());

  assert.throws(() => submitQuestAction(game, { playerId: 'p3', action: 'success' }), /selected team/);

  const first = submitQuestAction(game, { playerId: 'host-1', action: 'success' });
  assert.throws(() => submitQuestAction(first, { playerId: 'host-1', action: 'fail' }), /already submitted/);

  const expired = { ...game, questWindowEndsAt: Date.now() - 1 };
  assert.throws(() => submitQuestAction(expired, { playerId: 'host-1', action: 'success' }), /already closed/);
});

test('quest resolution tracks history and resistance wins after 3 successful quests', () => {
  let game = addPlayersToMinimum();
  game = advancePhase(game);
  game = advancePhase(game);

  const teamsByRound: Record<number, string[]> = {
    1: ['host-1', 'p2'],
    2: ['host-1', 'p2', 'p3'],
    3: ['host-1', 'p2']
  };

  for (let round = 1; round <= 3; round += 1) {
    const leader = game.players.find((player) => player.seat === game.leaderSeat);
    assert.ok(leader);

    const team = teamsByRound[round];
    game = proposeTeam(game, { leaderId: leader.id, teamPlayerIds: team });

    for (const player of game.players) {
      game = submitVote(game, { playerId: player.id, vote: 'approve' });
    }

    game = advancePhase(game);

    for (const playerId of team) {
      game = submitQuestAction(game, { playerId, action: 'success' });
    }

    game = advancePhase(game);
  }

  assert.equal(game.phase, 'endgame');
  assert.equal(game.winner, 'resistance');
  assert.equal(game.questResults.length, 3);
  assert.equal(game.questResults[0]?.questNumber, 1);
});
