import { z } from 'zod';

export const SocketNamespaces = {
  game: '/game'
} as const;

export const GameEvents = {
  connectionAck: 'connection:ack',
  ping: 'game:ping',
  pong: 'game:pong'
} as const;

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
