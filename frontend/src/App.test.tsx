import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameEvents, type GameStatePayload, type LobbyStatePayload } from '@avalon/shared';
import { App } from './App';

type Handler = (payload?: any) => void;

class FakeSocket {
  handlers = new Map<string, Handler>();
  emit = vi.fn();
  disconnect = vi.fn();

  on = vi.fn((event: string, handler: Handler) => {
    this.handlers.set(event, handler);
    return this;
  });

  receive(event: string, payload?: any) {
    const handler = this.handlers.get(event);
    if (!handler) {
      throw new Error(`No handler for event ${event}`);
    }

    handler(payload);
  }
}

const fakeSocket = new FakeSocket();

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket)
}));

const basePlayers = [
  { id: 'p1', name: 'Host', seat: 1, connected: true },
  { id: 'p2', name: 'Ally', seat: 2, connected: true },
  { id: 'p3', name: 'Guest', seat: 3, connected: true }
];

const baseLobbyState: LobbyStatePayload = {
  gameId: 'game-1',
  joinCode: 'ABCD',
  hostId: 'p1',
  players: basePlayers,
  phase: 'lobby',
  createdAt: 1,
  updatedAt: 1
};

const baseGameState: GameStatePayload = {
  id: 'game-1',
  phase: 'team_proposal',
  players: basePlayers,
  hostId: 'p1',
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
  createdAt: 1,
  updatedAt: 1,
  joinCode: 'ABCD'
};

describe('App game progression', () => {
  beforeEach(() => {
    window.localStorage.clear();
    fakeSocket.handlers.clear();
    fakeSocket.emit.mockClear();
    fakeSocket.on.mockClear();
    fakeSocket.disconnect.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('allows host to start from lobby by emitting phase advance request', async () => {
    render(<App />);

    await waitFor(() => expect(fakeSocket.handlers.has(GameEvents.connectionAck)).toBe(true));

    fakeSocket.receive(GameEvents.connectionAck, { message: 'connected', namespace: '/game' });
    fakeSocket.receive(GameEvents.createGameResponse, {
      lobby: baseLobbyState,
      session: { sessionToken: 't-1', playerId: 'p1', isHost: true }
    });

    await screen.findByRole('button', { name: 'Start Game' });

    fireEvent.click(screen.getByRole('button', { name: 'Start Game' }));

    expect(fakeSocket.emit).toHaveBeenCalledWith(GameEvents.phaseAdvanceRequest, {});
  });

  it('covers team proposal, voting, and quest action flow with server state updates', async () => {
    render(<App />);

    await waitFor(() => expect(fakeSocket.handlers.has(GameEvents.connectionAck)).toBe(true));

    fakeSocket.receive(GameEvents.connectionAck, { message: 'connected', namespace: '/game' });
    fakeSocket.receive(GameEvents.createGameResponse, {
      lobby: baseLobbyState,
      session: { sessionToken: 't-1', playerId: 'p1', isHost: true }
    });
    fakeSocket.receive(GameEvents.gameState, baseGameState);

    await screen.findByRole('button', { name: 'Submit Team Proposal' });

    fireEvent.click(screen.getByLabelText(/Host/));
    fireEvent.click(screen.getByLabelText(/Ally/));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Team Proposal' }));

    expect(fakeSocket.emit).toHaveBeenCalledWith(GameEvents.teamProposed, {
      teamPlayerIds: ['p1', 'p2']
    });

    fakeSocket.receive(GameEvents.phaseChanged, { phase: 'voting' });
    fakeSocket.receive(GameEvents.gameState, {
      ...baseGameState,
      phase: 'voting',
      proposedTeam: ['p1', 'p2'],
      voteWindowEndsAt: 1700000000000
    });

    await screen.findByRole('button', { name: 'Approve Team' });
    fireEvent.click(screen.getByRole('button', { name: 'Approve Team' }));
    expect(fakeSocket.emit).toHaveBeenCalledWith(GameEvents.voteSubmitted, { vote: 'approve' });
    expect(screen.getByText(/Latest phase event: voting/i)).toBeInTheDocument();

    fakeSocket.receive(GameEvents.phaseChanged, { phase: 'quest' });
    fakeSocket.receive(GameEvents.gameState, {
      ...baseGameState,
      phase: 'quest',
      proposedTeam: ['p1', 'p2'],
      questWindowEndsAt: 1700000010000
    });

    await screen.findByRole('button', { name: 'Quest Success' });
    fireEvent.click(screen.getByRole('button', { name: 'Quest Success' }));
    expect(fakeSocket.emit).toHaveBeenCalledWith(GameEvents.questSubmitted, { action: 'success' });

    fakeSocket.receive(GameEvents.gameEnded, { winner: 'resistance' });
    expect(await screen.findByText(/Winner: resistance/i)).toBeInTheDocument();
  });
});
