import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import {
  ConnectionAckSchema,
  CreateGameRequestSchema,
  CreateGameResponseSchema,
  GameEndedSchema,
  GameErrorSchema,
  GameEvents,
  GamePingSchema,
  GamePongSchema,
  JoinCodeSchema,
  JoinGameRequestSchema,
  JoinGameResponseSchema,
  LobbyStateSchema,
  PhaseAdvanceRequestSchema,
  PhaseChangedSchema,
  QuestSubmittedSchema,
  RejoinGameRequestSchema,
  RejoinGameResponseSchema,
  SocketNamespaces,
  TeamProposedSchema,
  VoteSubmittedSchema
} from '@avalon/shared';
import { config } from './config.js';
import { InMemoryGameRepository } from './game/memoryRepository.js';
import { toPlayerState, toPublicState } from './game/serializers.js';
import {
  advancePhase as advancePhaseWithRepository,
  createGame as createGameWithRepository,
  joinGame as joinGameWithRepository,
  proposeTeam as proposeTeamWithRepository,
  submitQuestAction as submitQuestActionWithRepository,
  submitVote as submitVoteWithRepository
} from './game/service.js';
import type { GameState, QuestAction, VoteChoice } from './game/types.js';

interface SessionRecord {
  token: string;
  gameId: string;
  joinCode: string;
  playerId: string;
}

const HEARTBEAT_TIMEOUT_MS = 45_000;
const DISCONNECT_GRACE_MS = 12_000;
const ACTION_ID_TTL_MS = 2 * 60_000;

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

const repository = new InMemoryGameRepository();
const joinCodeToGameId = new Map<string, string>();
const gameIdToJoinCode = new Map<string, string>();
const sessions = new Map<string, SessionRecord>();
const socketToSession = new Map<string, string>();
const sessionToSockets = new Map<string, Set<string>>();
const socketLastSeenAt = new Map<string, number>();
const disconnectedAt = new Map<string, number>();
const pendingDisconnectTimers = new Map<string, NodeJS.Timeout>();
const processedActions = new Map<string, { fingerprint: string; processedAt: number }>();

const now = () => Date.now();

const createJoinCode = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 100; i += 1) {
    const code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    if (!joinCodeToGameId.has(code)) {
      return code;
    }
  }

  throw new Error('Unable to create unique join code');
};

const roomForJoinCode = (joinCode: string) => `game:${joinCode}`;
const keyForPlayer = (gameId: string, playerId: string) => `${gameId}:${playerId}`;
const keyForAction = (sessionToken: string, actionId: string) => `${sessionToken}:${actionId}`;

const clearDisconnectTimer = (sessionToken: string) => {
  const timer = pendingDisconnectTimers.get(sessionToken);
  if (timer) {
    clearTimeout(timer);
    pendingDisconnectTimers.delete(sessionToken);
  }
};

const getGameOrThrow = (gameId: string): GameState => {
  const game = repository.getById(gameId);
  if (!game) {
    throw new Error('Game not found');
  }
  return game;
};

const getJoinCodeOrThrow = (gameId: string): string => {
  const joinCode = gameIdToJoinCode.get(gameId);
  if (!joinCode) {
    throw new Error('Join code not found');
  }
  return joinCode;
};

const setPlayerConnected = (gameId: string, playerId: string, connected: boolean): GameState => {
  const game = getGameOrThrow(gameId);
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error('Player not found for game');
  }

  const nextGame: GameState = {
    ...game,
    players: game.players.map((candidate) =>
      candidate.id === playerId ? { ...candidate, connected } : candidate
    ),
    updatedAt: now()
  };

  repository.save(nextGame);

  const playerKey = keyForPlayer(gameId, playerId);
  if (connected) {
    disconnectedAt.delete(playerKey);
  } else {
    disconnectedAt.set(playerKey, now());
  }

  return nextGame;
};

const toLobbyState = (game: GameState) => {
  const joinCode = getJoinCodeOrThrow(game.id);

  return LobbyStateSchema.parse({
    gameId: game.id,
    joinCode,
    hostId: game.hostId,
    phase: game.phase,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      connected: player.connected
    }))
  });
};

const broadcastGameState = (gameId: string, io: Server) => {
  const game = getGameOrThrow(gameId);
  const joinCode = getJoinCodeOrThrow(gameId);
  const namespace = io.of(SocketNamespaces.game);
  const room = roomForJoinCode(joinCode);

  namespace.to(room).emit(GameEvents.gameState, toPublicState(game, joinCode));

  socketToSession.forEach((sessionToken, socketId) => {
    const session = sessions.get(sessionToken);
    if (!session || session.gameId !== gameId) {
      return;
    }

    namespace.to(socketId).emit(GameEvents.gameState, toPlayerState(game, session.playerId, joinCode));
  });
};

const broadcastLobbyState = (gameId: string, io: Server) => {
  const game = getGameOrThrow(gameId);
  const joinCode = getJoinCodeOrThrow(gameId);
  io.of(SocketNamespaces.game).to(roomForJoinCode(joinCode)).emit(GameEvents.lobbyState, toLobbyState(game));
};

const emitRoomEvent = (gameId: string, event: string, payload: unknown, io: Server) => {
  const joinCode = getJoinCodeOrThrow(gameId);
  io.of(SocketNamespaces.game).to(roomForJoinCode(joinCode)).emit(event, payload);
};

const createSession = (gameId: string, joinCode: string, playerId: string): SessionRecord => {
  const token = randomUUID();
  const session: SessionRecord = {
    token,
    gameId,
    joinCode,
    playerId
  };
  sessions.set(token, session);
  return session;
};

const executeCreateGame = (name: string) => {
  const hostId = randomUUID();
  const game = createGameWithRepository(
    {
      id: hostId,
      name
    },
    repository
  );

  const joinCode = createJoinCode();
  joinCodeToGameId.set(joinCode, game.id);
  gameIdToJoinCode.set(game.id, joinCode);

  const session = createSession(game.id, joinCode, hostId);

  return CreateGameResponseSchema.parse({
    lobby: toLobbyState(game),
    session: {
      sessionToken: session.token,
      playerId: hostId,
      isHost: true
    }
  });
};

const executeJoinGame = (joinCodeInput: string, name: string) => {
  const joinCode = JoinCodeSchema.parse(joinCodeInput);
  const gameId = joinCodeToGameId.get(joinCode);
  if (!gameId) {
    throw new Error('Game code not found');
  }

  const playerId = randomUUID();
  const game = joinGameWithRepository(
    gameId,
    {
      id: playerId,
      name
    },
    repository
  );

  const session = createSession(game.id, joinCode, playerId);

  return JoinGameResponseSchema.parse({
    lobby: toLobbyState(game),
    session: {
      sessionToken: session.token,
      playerId,
      isHost: game.hostId === playerId
    }
  });
};

const executeRejoin = (sessionToken: string) => {
  const session = sessions.get(sessionToken);
  if (!session) {
    throw new Error('Session not found');
  }

  clearDisconnectTimer(sessionToken);
  const game = setPlayerConnected(session.gameId, session.playerId, true);

  return RejoinGameResponseSchema.parse({
    lobby: toLobbyState(game),
    session: {
      sessionToken,
      playerId: session.playerId,
      isHost: game.hostId === session.playerId
    }
  });
};

const fingerprintPayload = (event: string, payload: unknown) => `${event}:${JSON.stringify(payload ?? {})}`;

const withIdempotency = (
  sessionToken: string,
  event: string,
  actionId: string | undefined,
  payload: unknown,
  execute: () => void
): void => {
  if (!actionId) {
    execute();
    return;
  }

  const key = keyForAction(sessionToken, actionId);
  const fingerprint = fingerprintPayload(event, payload);
  const existing = processedActions.get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new Error('Conflicting payload for re-used actionId');
    }
    return;
  }

  execute();
  processedActions.set(key, {
    fingerprint,
    processedAt: now()
  });
};

const markSocketActivity = (socketId: string) => {
  socketLastSeenAt.set(socketId, now());
};

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/game/create', (req, res) => {
  try {
    const request = CreateGameRequestSchema.parse(req.body);
    const payload = executeCreateGame(request.name);
    res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create game';
    res.status(400).json(GameErrorSchema.parse({ message }));
  }
});

app.post('/game/join', (req, res) => {
  try {
    const request = JoinGameRequestSchema.parse(req.body);
    const payload = executeJoinGame(request.joinCode, request.name);
    res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to join game';
    res.status(400).json(GameErrorSchema.parse({ message }));
  }
});

app.post('/game/rejoin', (req, res) => {
  try {
    const request = RejoinGameRequestSchema.parse(req.body);
    const payload = executeRejoin(request.sessionToken);
    res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to rejoin game';
    res.status(400).json(GameErrorSchema.parse({ message }));
  }
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: config.corsOrigin
  }
});

const gameNamespace = io.of(SocketNamespaces.game);

type GameSocket = Parameters<Parameters<typeof gameNamespace.on>[1]>[0];

const emitSocketError = (socket: GameSocket, message: string) => {
  socket.emit(GameEvents.error, GameErrorSchema.parse({ message }));
};

const getSessionFromSocket = (socket: GameSocket): SessionRecord => {
  const sessionToken = socketToSession.get(socket.id);
  if (!sessionToken) {
    throw new Error('No active session for socket');
  }

  const session = sessions.get(sessionToken);
  if (!session) {
    throw new Error('Session not found');
  }

  const game = getGameOrThrow(session.gameId);
  const currentPlayer = game.players.find((player) => player.id === session.playerId);
  if (!currentPlayer) {
    throw new Error('Session player no longer belongs to this game');
  }

  return session;
};

const autoResolvePendingPhases = () => {
  for (const game of repository.list()) {
    try {
      if (game.phase === 'voting') {
        const missing = game.players.filter((player) => !game.votes[player.id]);
        const timedOut = game.voteWindowEndsAt !== null && now() > game.voteWindowEndsAt;
        const staleDisconnectedMissing = missing.every((player) => {
          const at = disconnectedAt.get(keyForPlayer(game.id, player.id));
          return !!at && now() - at >= DISCONNECT_GRACE_MS;
        });

        if ((timedOut || staleDisconnectedMissing) && missing.length > 0) {
          let nextGame = getGameOrThrow(game.id);
          for (const player of missing) {
            nextGame = {
              ...nextGame,
              votes: {
                ...nextGame.votes,
                [player.id]: 'reject' as VoteChoice
              },
              updatedAt: now()
            };
          }
          repository.save(nextGame);
        }

        const latestGame = getGameOrThrow(game.id);
        if (Object.keys(latestGame.votes).length === latestGame.players.length) {
          const prevPhase = latestGame.phase;
          const advanced = advancePhaseWithRepository(game.id, repository);
          emitRoomEvent(game.id, GameEvents.phaseChanged, PhaseChangedSchema.parse({ phase: advanced.phase }), io);
          if (prevPhase !== advanced.phase && advanced.phase === 'endgame' && advanced.winner) {
            emitRoomEvent(game.id, GameEvents.gameEnded, GameEndedSchema.parse({ winner: advanced.winner }), io);
          }
          broadcastGameState(game.id, io);
          broadcastLobbyState(game.id, io);
        }
      }

      if (game.phase === 'quest') {
        const latest = getGameOrThrow(game.id);
        const missing = latest.proposedTeam.filter((playerId) => !latest.questActions[playerId]);
        const timedOut = latest.questWindowEndsAt !== null && now() > latest.questWindowEndsAt;
        const staleDisconnectedMissing = missing.every((playerId) => {
          const at = disconnectedAt.get(keyForPlayer(game.id, playerId));
          return !!at && now() - at >= DISCONNECT_GRACE_MS;
        });

        if ((timedOut || staleDisconnectedMissing) && missing.length > 0) {
          let nextGame = getGameOrThrow(game.id);
          for (const playerId of missing) {
            nextGame = {
              ...nextGame,
              questActions: {
                ...nextGame.questActions,
                [playerId]: 'success' as QuestAction
              },
              updatedAt: now()
            };
          }
          repository.save(nextGame);
        }

        const newest = getGameOrThrow(game.id);
        if (Object.keys(newest.questActions).length === newest.proposedTeam.length) {
          const prevPhase = newest.phase;
          const advanced = advancePhaseWithRepository(game.id, repository);
          emitRoomEvent(game.id, GameEvents.phaseChanged, PhaseChangedSchema.parse({ phase: advanced.phase }), io);
          if (prevPhase !== advanced.phase && advanced.phase === 'endgame' && advanced.winner) {
            emitRoomEvent(game.id, GameEvents.gameEnded, GameEndedSchema.parse({ winner: advanced.winner }), io);
          }
          broadcastGameState(game.id, io);
          broadcastLobbyState(game.id, io);
        }
      }
    } catch {
      // ignore stale/replaced games
    }
  }
};

const sweepHealth = () => {
  const namespace = io.of(SocketNamespaces.game);

  for (const [socketId, seenAt] of socketLastSeenAt.entries()) {
    if (now() - seenAt <= HEARTBEAT_TIMEOUT_MS) {
      continue;
    }

    const socket = namespace.sockets.get(socketId);
    if (socket) {
      socket.disconnect(true);
    }
    socketLastSeenAt.delete(socketId);
  }

  for (const [actionKey, processed] of processedActions.entries()) {
    if (now() - processed.processedAt > ACTION_ID_TTL_MS) {
      processedActions.delete(actionKey);
    }
  }

  autoResolvePendingPhases();
};

gameNamespace.on('connection', (socket) => {
  markSocketActivity(socket.id);

  const ackPayload = ConnectionAckSchema.parse({
    namespace: SocketNamespaces.game,
    message: 'Connected to game namespace'
  });
  socket.emit(GameEvents.connectionAck, ackPayload);

  socket.onAny(() => {
    markSocketActivity(socket.id);
  });

  const hydrateSocketSession = (sessionToken: string) => {
    const response = executeRejoin(sessionToken);
    const room = roomForJoinCode(response.lobby.joinCode);
    socket.join(room);

    const previousSession = socketToSession.get(socket.id);
    if (previousSession && previousSession !== sessionToken) {
      sessionToSockets.get(previousSession)?.delete(socket.id);
    }

    socketToSession.set(socket.id, response.session.sessionToken);
    if (!sessionToSockets.has(response.session.sessionToken)) {
      sessionToSockets.set(response.session.sessionToken, new Set());
    }
    sessionToSockets.get(response.session.sessionToken)?.add(socket.id);

    socket.emit(GameEvents.rejoinResponse, response);
    emitRoomEvent(
      response.lobby.gameId,
      GameEvents.playerReconnected,
      { playerId: response.session.playerId },
      io
    );
    broadcastLobbyState(response.lobby.gameId, io);
    broadcastGameState(response.lobby.gameId, io);
  };

  const authToken =
    typeof socket.handshake.auth?.sessionToken === 'string'
      ? socket.handshake.auth.sessionToken
      : typeof socket.handshake.query?.sessionToken === 'string'
        ? socket.handshake.query.sessionToken
        : undefined;

  if (authToken) {
    try {
      const parsed = RejoinGameRequestSchema.parse({ sessionToken: authToken });
      hydrateSocketSession(parsed.sessionToken);
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to restore session');
    }
  }

  socket.on(GameEvents.ping, (payload: unknown) => {
    try {
      const validPing = GamePingSchema.parse(payload);
      const pongPayload = GamePongSchema.parse({
        timestamp: validPing.timestamp,
        serverTime: Date.now()
      });
      socket.emit(GameEvents.pong, pongPayload);
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Invalid ping payload');
    }
  });

  socket.on(GameEvents.createGameRequest, (payload: unknown) => {
    try {
      const request = CreateGameRequestSchema.parse(payload);
      const response = executeCreateGame(request.name);
      const room = roomForJoinCode(response.lobby.joinCode);
      socket.join(room);
      socketToSession.set(socket.id, response.session.sessionToken);
      if (!sessionToSockets.has(response.session.sessionToken)) {
        sessionToSockets.set(response.session.sessionToken, new Set());
      }
      sessionToSockets.get(response.session.sessionToken)?.add(socket.id);
      socket.emit(GameEvents.createGameResponse, response);
      emitRoomEvent(response.lobby.gameId, GameEvents.playerJoined, { playerId: response.session.playerId }, io);
      broadcastLobbyState(response.lobby.gameId, io);
      broadcastGameState(response.lobby.gameId, io);
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to create game');
    }
  });

  socket.on(GameEvents.joinGameRequest, (payload: unknown) => {
    try {
      const request = JoinGameRequestSchema.parse(payload);
      const response = executeJoinGame(request.joinCode, request.name);
      const room = roomForJoinCode(response.lobby.joinCode);
      socket.join(room);
      socketToSession.set(socket.id, response.session.sessionToken);
      if (!sessionToSockets.has(response.session.sessionToken)) {
        sessionToSockets.set(response.session.sessionToken, new Set());
      }
      sessionToSockets.get(response.session.sessionToken)?.add(socket.id);
      socket.emit(GameEvents.joinGameResponse, response);
      emitRoomEvent(response.lobby.gameId, GameEvents.playerJoined, { playerId: response.session.playerId }, io);
      broadcastLobbyState(response.lobby.gameId, io);
      broadcastGameState(response.lobby.gameId, io);
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to join game');
    }
  });

  socket.on(GameEvents.rejoinRequest, (payload: unknown) => {
    try {
      const request = RejoinGameRequestSchema.parse(payload);
      hydrateSocketSession(request.sessionToken);
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to rejoin game');
    }
  });

  socket.on(GameEvents.teamProposed, (payload: unknown) => {
    try {
      const request = TeamProposedSchema.parse(payload);
      const session = getSessionFromSocket(socket);
      withIdempotency(
        session.token,
        GameEvents.teamProposed,
        request.actionId,
        { teamPlayerIds: request.teamPlayerIds },
        () => {
          const nextState = proposeTeamWithRepository(
            session.gameId,
            {
              leaderId: session.playerId,
              teamPlayerIds: request.teamPlayerIds
            },
            repository
          );
          emitRoomEvent(session.gameId, GameEvents.teamProposed, request, io);
          emitRoomEvent(
            session.gameId,
            GameEvents.phaseChanged,
            PhaseChangedSchema.parse({ phase: nextState.phase }),
            io
          );
          broadcastGameState(session.gameId, io);
          broadcastLobbyState(session.gameId, io);
        }
      );
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to propose team');
    }
  });

  socket.on(GameEvents.voteSubmitted, (payload: unknown) => {
    try {
      const request = VoteSubmittedSchema.parse(payload);
      const session = getSessionFromSocket(socket);
      withIdempotency(
        session.token,
        GameEvents.voteSubmitted,
        request.actionId,
        { vote: request.vote },
        () => {
          let nextState = submitVoteWithRepository(
            session.gameId,
            {
              playerId: session.playerId,
              vote: request.vote as VoteChoice
            },
            repository
          );

          emitRoomEvent(session.gameId, GameEvents.voteSubmitted, { playerId: session.playerId }, io);

          if (Object.keys(nextState.votes).length === nextState.players.length) {
            const prevPhase = nextState.phase;
            nextState = advancePhaseWithRepository(session.gameId, repository);
            emitRoomEvent(
              session.gameId,
              GameEvents.phaseChanged,
              PhaseChangedSchema.parse({ phase: nextState.phase }),
              io
            );
            if (prevPhase !== nextState.phase && nextState.phase === 'endgame' && nextState.winner) {
              emitRoomEvent(
                session.gameId,
                GameEvents.gameEnded,
                GameEndedSchema.parse({ winner: nextState.winner }),
                io
              );
            }
          }

          broadcastGameState(session.gameId, io);
          broadcastLobbyState(session.gameId, io);
        }
      );
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to submit vote');
    }
  });

  socket.on(GameEvents.questSubmitted, (payload: unknown) => {
    try {
      const request = QuestSubmittedSchema.parse(payload);
      const session = getSessionFromSocket(socket);
      withIdempotency(
        session.token,
        GameEvents.questSubmitted,
        request.actionId,
        { action: request.action },
        () => {
          let nextState = submitQuestActionWithRepository(
            session.gameId,
            {
              playerId: session.playerId,
              action: request.action as QuestAction
            },
            repository
          );

          emitRoomEvent(session.gameId, GameEvents.questSubmitted, { playerId: session.playerId }, io);

          if (Object.keys(nextState.questActions).length === nextState.proposedTeam.length) {
            const prevPhase = nextState.phase;
            nextState = advancePhaseWithRepository(session.gameId, repository);
            emitRoomEvent(
              session.gameId,
              GameEvents.phaseChanged,
              PhaseChangedSchema.parse({ phase: nextState.phase }),
              io
            );
            if (prevPhase !== nextState.phase && nextState.phase === 'endgame' && nextState.winner) {
              emitRoomEvent(
                session.gameId,
                GameEvents.gameEnded,
                GameEndedSchema.parse({ winner: nextState.winner }),
                io
              );
            }
          }

          broadcastGameState(session.gameId, io);
          broadcastLobbyState(session.gameId, io);
        }
      );
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to submit quest action');
    }
  });

  socket.on(GameEvents.phaseAdvanceRequest, (payload: unknown) => {
    try {
      const request = PhaseAdvanceRequestSchema.parse(payload ?? {});
      const session = getSessionFromSocket(socket);
      withIdempotency(session.token, GameEvents.phaseAdvanceRequest, request.actionId, {}, () => {
        const game = getGameOrThrow(session.gameId);
        if (game.hostId !== session.playerId) {
          throw new Error('Only the host can advance game phases manually');
        }
        const nextState = advancePhaseWithRepository(session.gameId, repository);
        emitRoomEvent(
          session.gameId,
          GameEvents.phaseChanged,
          PhaseChangedSchema.parse({ phase: nextState.phase }),
          io
        );
        if (nextState.phase === 'endgame' && nextState.winner) {
          emitRoomEvent(
            session.gameId,
            GameEvents.gameEnded,
            GameEndedSchema.parse({ winner: nextState.winner }),
            io
          );
        }
        broadcastGameState(session.gameId, io);
        broadcastLobbyState(session.gameId, io);
      });
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to advance phase');
    }
  });

  socket.on('disconnect', () => {
    socketLastSeenAt.delete(socket.id);

    const sessionToken = socketToSession.get(socket.id);
    if (!sessionToken) {
      return;
    }

    socketToSession.delete(socket.id);
    sessionToSockets.get(sessionToken)?.delete(socket.id);
    if ((sessionToSockets.get(sessionToken)?.size ?? 0) > 0) {
      return;
    }

    clearDisconnectTimer(sessionToken);
    pendingDisconnectTimers.set(
      sessionToken,
      setTimeout(() => {
        pendingDisconnectTimers.delete(sessionToken);
        const session = sessions.get(sessionToken);
        if (!session) {
          return;
        }

        if ((sessionToSockets.get(sessionToken)?.size ?? 0) > 0) {
          return;
        }

        try {
          setPlayerConnected(session.gameId, session.playerId, false);
          emitRoomEvent(session.gameId, GameEvents.playerLeft, { playerId: session.playerId }, io);
          broadcastLobbyState(session.gameId, io);
          broadcastGameState(session.gameId, io);
        } catch {
          // no-op for stale sessions
        }
      }, DISCONNECT_GRACE_MS)
    );
  });
});

setInterval(sweepHealth, 5_000);

httpServer.listen(config.port, () => {
  console.log(`Backend API listening on http://localhost:${config.port}`);
  console.log(`Socket namespace ready at ${SocketNamespaces.game}`);
});
