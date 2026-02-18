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

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

const repository = new InMemoryGameRepository();
const joinCodeToGameId = new Map<string, string>();
const gameIdToJoinCode = new Map<string, string>();
const sessions = new Map<string, SessionRecord>();
const socketToSession = new Map<string, string>();

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

  return session;
};


gameNamespace.on('connection', (socket) => {
  const ackPayload = ConnectionAckSchema.parse({
    namespace: SocketNamespaces.game,
    message: 'Connected to game namespace'
  });
  socket.emit(GameEvents.connectionAck, ackPayload);

  socket.on(GameEvents.ping, (payload: unknown) => {
    const validPing = GamePingSchema.parse(payload);
    const pongPayload = GamePongSchema.parse({
      timestamp: validPing.timestamp,
      serverTime: Date.now()
    });
    socket.emit(GameEvents.pong, pongPayload);
  });

  socket.on(GameEvents.createGameRequest, (payload: unknown) => {
    try {
      const request = CreateGameRequestSchema.parse(payload);
      const response = executeCreateGame(request.name);
      const room = roomForJoinCode(response.lobby.joinCode);
      socket.join(room);
      socketToSession.set(socket.id, response.session.sessionToken);
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
      const response = executeRejoin(request.sessionToken);
      const room = roomForJoinCode(response.lobby.joinCode);
      socket.join(room);
      socketToSession.set(socket.id, response.session.sessionToken);
      socket.emit(GameEvents.rejoinResponse, response);
      emitRoomEvent(
        response.lobby.gameId,
        GameEvents.playerReconnected,
        { playerId: response.session.playerId },
        io
      );
      broadcastLobbyState(response.lobby.gameId, io);
      broadcastGameState(response.lobby.gameId, io);
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to rejoin game');
    }
  });

  socket.on(GameEvents.teamProposed, (payload: unknown) => {
    try {
      const request = TeamProposedSchema.parse(payload);
      const session = getSessionFromSocket(socket);
      const nextState = proposeTeamWithRepository(
        session.gameId,
        {
          leaderId: session.playerId,
          teamPlayerIds: request.teamPlayerIds
        },
        repository
      );
      emitRoomEvent(session.gameId, GameEvents.teamProposed, request, io);
      emitRoomEvent(session.gameId, GameEvents.phaseChanged, PhaseChangedSchema.parse({ phase: nextState.phase }), io);
      broadcastGameState(session.gameId, io);
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to propose team');
    }
  });

  socket.on(GameEvents.voteSubmitted, (payload: unknown) => {
    try {
      const request = VoteSubmittedSchema.parse(payload);
      const session = getSessionFromSocket(socket);
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
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to submit vote');
    }
  });

  socket.on(GameEvents.questSubmitted, (payload: unknown) => {
    try {
      const request = QuestSubmittedSchema.parse(payload);
      const session = getSessionFromSocket(socket);
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
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to submit quest action');
    }
  });

  socket.on(GameEvents.phaseAdvanceRequest, () => {
    try {
      const session = getSessionFromSocket(socket);
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
    } catch (error) {
      emitSocketError(socket, error instanceof Error ? error.message : 'Unable to advance phase');
    }
  });

  socket.on('disconnect', () => {
    const sessionToken = socketToSession.get(socket.id);
    if (!sessionToken) {
      return;
    }

    socketToSession.delete(socket.id);
    const session = sessions.get(sessionToken);
    if (!session) {
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
  });
});

httpServer.listen(config.port, () => {
  console.log(`Backend API listening on http://localhost:${config.port}`);
  console.log(`Socket namespace ready at ${SocketNamespaces.game}`);
});
