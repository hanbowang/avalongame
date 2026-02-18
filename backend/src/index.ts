import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import {
  ConnectionAckSchema,
  GameEvents,
  GamePingSchema,
  GamePongSchema,
  SocketNamespaces
} from '@avalon/shared';
import { config } from './config.js';

const app = express();
app.use(cors({ origin: config.corsOrigin }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: config.corsOrigin
  }
});

const gameNamespace = io.of(SocketNamespaces.game);

gameNamespace.on('connection', (socket) => {
  const ackPayload = ConnectionAckSchema.parse({
    namespace: SocketNamespaces.game,
    message: 'Connected to game namespace'
  });
  socket.emit(GameEvents.connectionAck, ackPayload);

  socket.on(GameEvents.ping, (payload) => {
    const validPing = GamePingSchema.parse(payload);
    const pongPayload = GamePongSchema.parse({
      timestamp: validPing.timestamp,
      serverTime: Date.now()
    });
    socket.emit(GameEvents.pong, pongPayload);
  });
});

httpServer.listen(config.port, () => {
  console.log(`Backend API listening on http://localhost:${config.port}`);
  console.log(`Socket namespace ready at ${SocketNamespaces.game}`);
});
