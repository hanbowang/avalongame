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
  gameState: 'game:state',
  playerJoined: 'player:joined',
  playerLeft: 'player:left',
  playerReconnected: 'player:reconnected',
  teamProposed: 'team:proposed',
  voteSubmitted: 'vote:submitted',
  questSubmitted: 'quest:submitted',
  phaseChanged: 'phase:changed',
  gameEnded: 'game:ended',
  phaseAdvanceRequest: 'phase:advance',
  error: 'game:error'
} as const;

export const GamePhaseSchema = z.enum([
  'lobby',
  'role_assignment',
  'team_proposal',
  'voting',
  'quest',
  'endgame'
]);

export const VoteChoiceSchema = z.enum(['approve', 'reject']);
export const QuestActionSchema = z.enum(['success', 'fail']);

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

export const QuestResolutionSchema = z.object({
  questNumber: z.number().int().positive(),
  team: z.array(z.string()),
  approvals: z.number().int().nonnegative(),
  rejections: z.number().int().nonnegative(),
  succeeds: z.boolean(),
  failCount: z.number().int().nonnegative()
});

export const GameStateSchema = z.object({
  id: z.string(),
  phase: GamePhaseSchema,
  players: z.array(LobbyPlayerSchema),
  hostId: z.string(),
  round: z.number().int().positive(),
  turn: z.number().int().positive(),
  leaderSeat: z.number().int().positive(),
  proposedTeam: z.array(z.string()),
  votes: z.record(z.string(), VoteChoiceSchema),
  questActions: z.record(z.string(), QuestActionSchema),
  voteWindowEndsAt: z.number().nullable(),
  questWindowEndsAt: z.number().nullable(),
  failedProposalCount: z.number().int().nonnegative(),
  questResults: z.array(QuestResolutionSchema),
  winner: z.enum(['resistance', 'spy']).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  joinCode: JoinCodeSchema
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

export const TeamProposedSchema = z.object({
  teamPlayerIds: z.array(z.string()).min(1)
});

export const VoteSubmittedSchema = z.object({
  vote: VoteChoiceSchema
});

export const QuestSubmittedSchema = z.object({
  action: QuestActionSchema
});

export const PhaseChangedSchema = z.object({
  phase: GamePhaseSchema
});

export const GameEndedSchema = z.object({
  winner: z.enum(['resistance', 'spy'])
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
export type GameStatePayload = z.infer<typeof GameStateSchema>;
export type SessionPayload = z.infer<typeof SessionPayloadSchema>;
export type CreateGameRequest = z.infer<typeof CreateGameRequestSchema>;
export type CreateGameResponse = z.infer<typeof CreateGameResponseSchema>;
export type JoinGameRequest = z.infer<typeof JoinGameRequestSchema>;
export type JoinGameResponse = z.infer<typeof JoinGameResponseSchema>;
export type RejoinGameRequest = z.infer<typeof RejoinGameRequestSchema>;
export type RejoinGameResponse = z.infer<typeof RejoinGameResponseSchema>;
export type TeamProposedPayload = z.infer<typeof TeamProposedSchema>;
export type VoteSubmittedPayload = z.infer<typeof VoteSubmittedSchema>;
export type QuestSubmittedPayload = z.infer<typeof QuestSubmittedSchema>;
export type PhaseChangedPayload = z.infer<typeof PhaseChangedSchema>;
export type GameEndedPayload = z.infer<typeof GameEndedSchema>;
export type GameErrorPayload = z.infer<typeof GameErrorSchema>;
