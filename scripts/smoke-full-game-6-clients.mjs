import { spawn } from 'node:child_process';
import process from 'node:process';
import { io } from 'socket.io-client';

const PORT = 4102;
const BACKEND_URL = `http://127.0.0.1:${PORT}`;
const NAMESPACE_URL = `${BACKEND_URL}/game`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const onceEvent = (socket, event, timeoutMs = 10_000) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for event: ${event}`)), timeoutMs);

    socket.once(event, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });

const waitFor = async (predicate, timeoutMs, label) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await predicate();
    if (result) {
      return result;
    }
    await delay(50);
  }

  throw new Error(`Timed out waiting for ${label}`);
};

const startBackend = () => {
  const proc = spawn('npm', ['run', 'dev', '-w', 'backend'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      CORS_ORIGIN: 'http://localhost:5173',
      SESSION_SECRET: 'smoke-test-secret'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  let ready = false;

  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (text.includes('Socket namespace ready')) {
      ready = true;
    }
  });

  proc.stderr.on('data', (chunk) => {
    process.stderr.write(chunk.toString());
  });

  return { proc, isReady: () => ready };
};

const stopBackend = async (proc) => {
  if (proc.exitCode !== null || proc.killed) {
    return;
  }

  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    return;
  }

  await Promise.race([
    new Promise((resolve) => proc.once('exit', resolve)),
    delay(2_000)
  ]);

  if (proc.exitCode === null) {
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      // no-op
    }
  }
};

const connectClient = () => {
  const socket = io(NAMESPACE_URL, {
    transports: ['websocket'],
    timeout: 10_000
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting client socket')), 10_000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
};

const teamSizeForRound = {
  1: 2,
  2: 3,
  3: 4,
  4: 3,
  5: 4
};

const main = async () => {
  const { proc, isReady } = startBackend();

  proc.on('exit', (code) => {
    if (typeof code === 'number' && code !== 0) {
      process.stderr.write(`Backend exited with code ${String(code)}\n`);
    }
  });

  const clients = [];

  try {
    await waitFor(() => isReady(), 20_000, 'backend startup');

    const host = await connectClient();
    clients.push(host);

    const createResponsePromise = onceEvent(host, 'game:create:ok');
    host.emit('game:create', { name: 'Player 1' });
    const createResponse = await createResponsePromise;

    const joinCode = createResponse?.lobby?.joinCode;
    if (!joinCode) {
      throw new Error('Create flow did not return a joinCode');
    }

    const sessions = [createResponse.session];
    for (let i = 2; i <= 6; i += 1) {
      const client = await connectClient();
      clients.push(client);
      const joinResponsePromise = onceEvent(client, 'game:join:ok');
      client.emit('game:join', { name: `Player ${i}`, joinCode });
      const joinResponse = await joinResponsePromise;
      sessions.push(joinResponse.session);
    }

    const latestStates = new Array(6).fill(null);
    clients.forEach((client, index) => {
      client.on('game:state', (state) => {
        latestStates[index] = state;
      });

      client.on('game:error', (payload) => {
        throw new Error(`Client ${index + 1} received game:error: ${payload?.message ?? 'Unknown error'}`);
      });
    });

    const advancePhase = async () => {
      host.emit('phase:advance', {});
      await delay(100);
    };

    await advancePhase();
    await advancePhase();

    await waitFor(() => latestStates[0]?.phase === 'team_proposal', 5_000, 'team proposal phase');

    const runRound = async () => {
      const state = latestStates[0];
      const leader = state.players.find((player) => player.seat === state.leaderSeat);
      if (!leader) {
        throw new Error('Missing leader for team proposal');
      }

      const leaderIndex = sessions.findIndex((session) => session.playerId === leader.id);
      if (leaderIndex < 0) {
        throw new Error('Unable to map leader to connected client');
      }

      const teamSize = teamSizeForRound[state.round];
      if (!teamSize) {
        throw new Error(`Unexpected round number for 6-player game: ${String(state.round)}`);
      }

      const teamPlayerIds = state.players.slice(0, teamSize).map((player) => player.id);

      clients[leaderIndex].emit('team:proposed', { teamPlayerIds });
      await waitFor(() => latestStates[0]?.phase === 'voting', 5_000, 'voting phase');

      clients.forEach((client) => {
        client.emit('vote:submitted', { vote: 'approve' });
      });
      await waitFor(() => latestStates[0]?.phase === 'quest', 5_000, 'quest phase');

      sessions.forEach((session, index) => {
        if (teamPlayerIds.includes(session.playerId)) {
          clients[index].emit('quest:submitted', { action: 'success' });
        }
      });

      await waitFor(
        () => latestStates[0]?.phase === 'team_proposal' || latestStates[0]?.phase === 'endgame',
        5_000,
        'post-quest phase transition'
      );
    };

    while (latestStates[0]?.phase !== 'endgame') {
      await runRound();
    }

    const finalState = latestStates[0];
    if (finalState.winner !== 'resistance') {
      throw new Error(`Expected resistance victory, got ${String(finalState.winner)}`);
    }

    if ((finalState.questResults?.length ?? 0) < 3) {
      throw new Error('Expected at least 3 resolved quests in completed game');
    }

    process.stdout.write(`Smoke test passed for 6-player full game with join code ${joinCode}\n`);
  } finally {
    clients.forEach((client) => client.disconnect());
    await stopBackend(proc);
  }
};

await main();
