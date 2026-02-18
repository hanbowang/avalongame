import { spawn } from 'node:child_process';
import process from 'node:process';
import { io } from 'socket.io-client';

const PORT = 4100;
const BACKEND_URL = `http://127.0.0.1:${PORT}`;
const NAMESPACE_URL = `${BACKEND_URL}/game`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate, timeoutMs, label) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await predicate();
    if (result) {
      return result;
    }
    await delay(250);
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

const onceEvent = (socket, event, timeoutMs = 10_000) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for event: ${event}`)), timeoutMs);

    socket.once(event, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });


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

const main = async () => {
  const { proc, isReady } = startBackend();

  proc.on('exit', (code) => {
    if (code !== 0) {
      process.stderr.write(`Backend exited with code ${String(code)}\n`);
    }
  });

  try {
    await waitFor(() => isReady(), 20_000, 'backend startup');

    const host = await connectClient();

    const createResponsePromise = onceEvent(host, 'game:create:ok');
    host.emit('game:create', { name: 'Host Player' });
    const createResponse = await createResponsePromise;

    const joinCode = createResponse?.lobby?.joinCode;
    if (!joinCode) {
      throw new Error('Create flow did not return a joinCode');
    }

    const guest = await connectClient();
    const joinResponsePromise = onceEvent(guest, 'game:join:ok');
    guest.emit('game:join', { name: 'Guest Player', joinCode });

    const joinResponse = await joinResponsePromise;
    const playerCount = joinResponse?.lobby?.players?.length ?? 0;
    if (playerCount < 2) {
      throw new Error(`Expected at least 2 players after join, got ${String(playerCount)}`);
    }

    host.disconnect();
    guest.disconnect();

    process.stdout.write(`Smoke test passed for join code ${joinCode}\n`);
  } finally {
    await stopBackend(proc);
  }
};

await main();
