# Avalon Game

![Coverage](https://img.shields.io/badge/backend%20coverage-99.59%25-brightgreen)

A lightweight, real-time multiplayer **Avalon lobby + game-state server/client** built with a TypeScript monorepo.

This project currently provides:
- A React frontend to create/join a private lobby.
- A Socket.IO backend for real-time game and lobby events.
- A shared contracts package (`@avalon/shared`) with Zod schemas and shared event/type definitions.

---

## Table of Contents

- [What this project does](#what-this-project-does)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Quick start (local development)](#quick-start-local-development)
- [Environment variables](#environment-variables)
- [Available scripts](#available-scripts)
- [Game flow currently implemented](#game-flow-currently-implemented)
- [Socket namespaces and core events](#socket-namespaces-and-core-events)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## What this project does

At this stage, the app focuses on **session + lobby lifecycle** and foundational real-time state syncing:

- Host creates a game and receives a short join code.
- Other players join using the code.
- All clients receive synchronized lobby/game updates over Socket.IO.
- Players can reconnect using a stored session token.
- Backend tracks connection/disconnection state and broadcasts updates.

The UI includes a visible placeholder for starting gameplay (`Start Game (coming soon)`), while backend game-phase infrastructure already exists and is evolving.

---

## Tech stack

- **Monorepo + npm workspaces**
- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js + Express + Socket.IO + TypeScript
- **Shared package:** Zod schemas, event constants, and types used by both frontend and backend
- **Linting:** ESLint

---

## Repository structure

```text
.
├── backend/         # Express + Socket.IO server
├── frontend/        # React + Vite web app
├── shared/          # Shared contracts/types/schemas
├── scripts/         # Utility scripts (incl. smoke test)
└── docs/            # Project docs (deployment guide)
```

---

## Prerequisites

- Node.js 20+ recommended
- npm 10+

---

## Quick start (local development)

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create environment variables for the backend (see [Environment variables](#environment-variables)).

3. Start all workspaces in dev mode (shared compiler watcher + backend + frontend):

   ```bash
   npm run dev
   ```

4. Open the frontend in your browser:

   - `http://localhost:5173`

By default, backend runs on `http://localhost:4000` and Socket.IO namespace `/game`.

---

## Environment variables

Backend requires the following variables:

- `CORS_ORIGIN` (required)
  - Exact frontend origin, e.g. `http://localhost:5173`
- `SESSION_SECRET` (required)
  - Any random secret string for session token management
- `PORT` (optional)
  - Defaults to `4000`

Example:

```bash
export CORS_ORIGIN=http://localhost:5173
export SESSION_SECRET=change-me-in-dev
export PORT=4000
npm run dev -w backend
```

Frontend variable for non-local deployment:

- `VITE_WS_BASE_URL`
  - Public backend URL (e.g. `https://avalon-api.example.com`)

---

## Available scripts

From repo root:

- `npm run dev`
  - Runs shared, backend, and frontend in watch/dev mode concurrently.
- `npm run build`
  - Builds shared, backend, frontend.
- `npm run lint`
  - Lints backend and frontend.
- `npm run typecheck`
  - Builds shared, then type-checks backend and frontend.
- `npm run smoke:create-join`
  - Starts backend and runs an end-to-end smoke test for create/join flow.
- `npm run test:coverage -w @avalon/backend`
  - Runs backend unit tests with c8 and prints a coverage summary.

Workspace-specific examples:

```bash
npm run dev -w backend
npm run dev -w frontend
npm run build -w shared
npm run start -w backend
```

---

## Game flow currently implemented

Implemented now:

- Create game
- Join game by code
- Rejoin via session token
- Real-time lobby/game state broadcast
- Player connectivity status updates

In progress / partially surfaced in UI:

- Full gameplay progression from lobby to endgame
- Team proposal / voting / quest flow UI

---

## Socket namespaces and core events

Namespace:

- `/game`

Examples of important events:

- Connection/health: `connection:ack`, `game:ping`, `game:pong`
- Session/lobby: `game:create`, `game:create:ok`, `game:join`, `game:join:ok`, `game:rejoin`, `game:rejoin:ok`
- State updates: `game:lobby:state`, `game:state`
- Progression/actions: `team:proposed`, `vote:submitted`, `quest:submitted`, `phase:changed`, `game:ended`, `phase:advance`
- Error channel: `game:error`

Contracts and payload schemas are defined in `shared/src/contracts.ts`.

---

## Deployment

See the dedicated guide:

- [`docs/deployment.md`](docs/deployment.md)

Highlights:

- Deploy backend to a WebSocket-capable host.
- Deploy frontend as static assets.
- Use HTTPS for both services in production.
- Configure backend CORS and frontend backend URL consistently.

---

## Troubleshooting

### Backend fails to start with missing env error

Set required backend vars (`CORS_ORIGIN`, `SESSION_SECRET`) before running backend commands.

### Frontend cannot connect to backend

Check:

- Backend is running.
- `CORS_ORIGIN` exactly matches frontend origin.
- Frontend points to correct backend URL (`VITE_WS_BASE_URL` in deployed environments).

### Smoke test timeouts

- Ensure local machine/CI allows opening local WebSocket connections.
- Confirm no port conflict on `4100` (used by smoke script backend instance).

---

If you'd like, I can also add a short **developer API reference** section that documents each socket event payload in table format.
