import { z } from 'zod';

export const SocketNamespaces = {
  game: '/game'
} as const;

export const GameEvents = {
  connectionAck: 'connection:ack',
  ping: 'game:ping',
  pong: 'game:pong',
  createGameRequest: 'game:create',
  createGameResponse: 'game:create:ok',
  joinGameRequest: 'game:join',
  joinGameResponse: 'game:join:ok',
  rejoinRequest: 'game:rejoin',
  rejoinResponse: 'game:rejoin:ok',
  lobbyState: 'game:lobby:state',
  error: 'game:error'
} as const;

export const JoinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,6}$/);

export const LobbyPlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  seat: z.number().int().positive(),
  connected: z.boolean()
});

export const LobbyStateSchema = z.object({
  gameId: z.string(),
  joinCode: JoinCodeSchema,
  hostId: z.string(),
  players: z.array(LobbyPlayerSchema),
  phase: z.string(),
  createdAt: z.number(),
  updatedAt: z.number()
});

export const SessionPayloadSchema = z.object({
  sessionToken: z.string(),
  playerId: z.string(),
  isHost: z.boolean()
});

export const CreateGameRequestSchema = z.object({
  name: z.string().trim().min(2).max(24)
});

export const CreateGameResponseSchema = z.object({
  lobby: LobbyStateSchema,
  session: SessionPayloadSchema
});

export const JoinGameRequestSchema = z.object({
  joinCode: JoinCodeSchema,
  name: z.string().trim().min(2).max(24)
});

export const JoinGameResponseSchema = z.object({
  lobby: LobbyStateSchema,
  session: SessionPayloadSchema
});

export const RejoinGameRequestSchema = z.object({
  sessionToken: z.string().min(1)
});

export const RejoinGameResponseSchema = z.object({
  lobby: LobbyStateSchema,
  session: SessionPayloadSchema
});

export const GameErrorSchema = z.object({
  message: z.string()
});

export const ConnectionAckSchema = z.object({
  namespace: z.literal(SocketNamespaces.game),
  message: z.string()
});

export const GamePingSchema = z.object({
  timestamp: z.number()
});

export const GamePongSchema = z.object({
  timestamp: z.number(),
  serverTime: z.number()
});

export type ConnectionAckPayload = z.infer<typeof ConnectionAckSchema>;
export type GamePingPayload = z.infer<typeof GamePingSchema>;
export type GamePongPayload = z.infer<typeof GamePongSchema>;
export type LobbyStatePayload = z.infer<typeof LobbyStateSchema>;
export type SessionPayload = z.infer<typeof SessionPayloadSchema>;
export type CreateGameRequest = z.infer<typeof CreateGameRequestSchema>;
export type CreateGameResponse = z.infer<typeof CreateGameResponseSchema>;
export type JoinGameRequest = z.infer<typeof JoinGameRequestSchema>;
export type JoinGameResponse = z.infer<typeof JoinGameResponseSchema>;
export type RejoinGameRequest = z.infer<typeof RejoinGameRequestSchema>;
export type RejoinGameResponse = z.infer<typeof RejoinGameResponseSchema>;
export type GameErrorPayload = z.infer<typeof GameErrorSchema>;
