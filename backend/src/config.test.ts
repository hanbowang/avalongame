import test from 'node:test';
import assert from 'node:assert/strict';

const importConfigFresh = async () => import(`./config.js?cacheBust=${Date.now()}_${Math.random()}`);

const withEnv = async (vars: Record<string, string | undefined>, run: () => Promise<void>) => {
  const original: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(vars)) {
    original[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

test('config reads required values and default port', async () => {
  await withEnv(
    {
      PORT: undefined,
      CORS_ORIGIN: 'http://localhost:5173',
      SESSION_SECRET: 'secret'
    },
    async () => {
      const { config } = await importConfigFresh();
      assert.equal(config.port, 4000);
      assert.equal(config.corsOrigin, 'http://localhost:5173');
      assert.equal(config.sessionSecret, 'secret');
    }
  );
});

test('config allows explicit numeric port', async () => {
  await withEnv(
    {
      PORT: '5050',
      CORS_ORIGIN: 'https://example.com',
      SESSION_SECRET: 'top-secret'
    },
    async () => {
      const { config } = await importConfigFresh();
      assert.equal(config.port, 5050);
    }
  );
});

test('config throws when CORS_ORIGIN is missing', async () => {
  await withEnv(
    {
      CORS_ORIGIN: undefined,
      SESSION_SECRET: 'secret'
    },
    async () => {
      await assert.rejects(importConfigFresh(), /Missing required environment variable: CORS_ORIGIN/);
    }
  );
});

test('config throws when SESSION_SECRET is missing', async () => {
  await withEnv(
    {
      CORS_ORIGIN: 'http://localhost:5173',
      SESSION_SECRET: undefined
    },
    async () => {
      await assert.rejects(importConfigFresh(), /Missing required environment variable: SESSION_SECRET/);
    }
  );
});
