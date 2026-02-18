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
import type { GameState } from './types.js';

const setupFivePlayers = () => {
  let game = createGame({ id: 'host-1', name: 'Host' });
  game = joinGame(game, { id: 'p2', name: 'Player 2' });
  game = joinGame(game, { id: 'p3', name: 'Player 3' });
  game = joinGame(game, { id: 'p4', name: 'Player 4' });
  game = joinGame(game, { id: 'p5', name: 'Player 5' });
  return game;
};

test('joinGame rejects joins outside lobby phase', () => {
  let game = setupFivePlayers();
  game = advancePhase(game);

  assert.throws(() => joinGame(game, { id: 'p6', name: 'Player 6' }), /only join while in lobby/);
});

test('proposeTeam rejects invalid phase, leader seat, unsupported player count, and invalid round', () => {
  const lobby = setupFivePlayers();
  assert.throws(
    () => proposeTeam(lobby, { leaderId: 'host-1', teamPlayerIds: ['host-1', 'p2'] }),
    /team_proposal phase/
  );

  let game = advancePhase(lobby);
  game = advancePhase(game);

  const badLeaderSeat = { ...game, leaderSeat: 99 };
  assert.throws(
    () => proposeTeam(badLeaderSeat, { leaderId: 'host-1', teamPlayerIds: ['host-1', 'p2'] }),
    /Leader seat is invalid/
  );

  const unsupportedPlayerCount = {
    ...createGame({ id: 'host-2', name: 'Host 2' }),
    phase: 'team_proposal' as const,
    players: [
      { id: 'host-2', name: 'Host 2', role: 'unassigned' as const, seat: 1, connected: true },
      { id: 'p2', name: 'Player 2', role: 'unassigned' as const, seat: 2, connected: true },
      { id: 'p3', name: 'Player 3', role: 'unassigned' as const, seat: 3, connected: true },
      { id: 'p4', name: 'Player 4', role: 'unassigned' as const, seat: 4, connected: true }
    ],
    leaderSeat: 1,
    round: 1
  };

  assert.throws(
    () => proposeTeam(unsupportedPlayerCount, { leaderId: 'host-2', teamPlayerIds: ['host-2', 'p2'] }),
    /Unsupported player count/
  );

  const invalidRound = { ...game, round: 6 };
  assert.throws(
    () => proposeTeam(invalidRound, { leaderId: 'host-1', teamPlayerIds: ['host-1', 'p2'] }),
    /Invalid round/
  );
});

test('advancePhase rejects incomplete voting and incomplete quest actions', () => {
  let game = setupFivePlayers();
  game = advancePhase(game);
  game = advancePhase(game);
  game = proposeTeam(game, { leaderId: 'host-1', teamPlayerIds: ['host-1', 'p2'] });
  game = submitVote(game, { playerId: 'host-1', vote: 'approve' });

  assert.throws(() => advancePhase(game), /until all players vote/);

  for (const player of ['p2', 'p3', 'p4', 'p5']) {
    game = submitVote(game, { playerId: player, vote: 'approve' });
  }

  game = advancePhase(game);
  game = submitQuestAction(game, { playerId: 'host-1', action: 'success' });

  assert.throws(() => advancePhase(game), /until all selected players submit/);
});

test('quest failures can produce spy victory and round cutoff can also force spy win', () => {
  let game = setupFivePlayers();
  game = advancePhase(game);
  game = advancePhase(game);

  const teamsByRound: Record<number, string[]> = {
    1: ['host-1', 'p2'],
    2: ['p2', 'p3', 'p4'],
    3: ['p3', 'p4']
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

    team.forEach((playerId, index) => {
      game = submitQuestAction(game, { playerId, action: index === 0 ? 'fail' : 'success' });
    });

    game = advancePhase(game);
  }

  assert.equal(game.phase, 'endgame');
  assert.equal(game.winner, 'spy');

  const forcedRoundCutoff: GameState = {
    ...setupFivePlayers(),
    phase: 'quest',
    round: 6,
    turn: 6,
    leaderSeat: 1,
    proposedTeam: ['host-1', 'p2'],
    votes: {
      'host-1': 'approve',
      p2: 'approve',
      p3: 'approve',
      p4: 'reject',
      p5: 'reject'
    },
    questActions: {
      'host-1': 'success',
      p2: 'success'
    },
    questWindowEndsAt: Date.now() + 10_000
  };

  const cutoffResolved = advancePhase(forcedRoundCutoff);
  assert.equal(cutoffResolved.phase, 'endgame');
  assert.equal(cutoffResolved.winner, 'spy');
});

test('advancePhase rejects auto-advance in team_proposal and endgame phases', () => {
  let game = setupFivePlayers();
  game = advancePhase(game);
  game = advancePhase(game);

  assert.throws(() => advancePhase(game), /Cannot auto-advance from phase team_proposal/);
  assert.throws(() => advancePhase({ ...game, phase: 'endgame' }), /Cannot auto-advance from phase endgame/);
});

test('advancePhase returns input for unknown phase values', () => {
  const game = createGame({ id: 'host-1', name: 'Host' }) as GameState & { phase: string };
  game.phase = 'mystery';

  const result = advancePhase(game as unknown as GameState);
  assert.equal(result.phase, 'mystery');
});

test('DEFAULT_RULES can be overridden for smaller minimum players and team size', () => {
  let game = createGame({ id: 'host-1', name: 'Host' });
  game = joinGame(game, { id: 'p2', name: 'Player 2' });

  const customRules = {
    ...DEFAULT_RULES,
    minPlayers: 2,
    teamSizesByPlayerCount: {
      ...DEFAULT_RULES.teamSizesByPlayerCount,
      2: [1, 1, 1, 1, 1]
    }
  };

  game = advancePhase(game, customRules);
  game = advancePhase(game, customRules);

  const proposed = proposeTeam(game, { leaderId: 'host-1', teamPlayerIds: ['host-1'] }, customRules);
  assert.equal(proposed.phase, 'voting');
});
