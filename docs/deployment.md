# Deployment Guide

This project supports either a fully containerized deployment or split deployment (backend + static frontend).

## 1) Backend deployment (WebSocket-capable host)

Deploy the `backend` workspace to a host that supports long-lived WebSocket connections (Render/Fly.io/Heroku-style providers).

### Required backend environment variables

- `PORT`: server port (provided automatically by most hosts)
- `SESSION_SECRET`: random secret string for session token management
- `CORS_ORIGIN`: exact frontend origin, e.g. `https://avalon.example.com`

### Backend start command

```bash
npm run build -w shared && npm run build -w backend && npm run start -w backend
```

### Containerized backend

Use `backend/Dockerfile` and expose port `4000`.

## 2) Frontend deployment (static host)

Deploy the `frontend/dist` output to Vercel/Netlify/Cloudflare Pages or any static host.

### Frontend environment variable

- `VITE_WS_BASE_URL`: public HTTPS backend URL, e.g. `https://avalon-api.example.com`

### Frontend build command

```bash
npm run build -w shared && npm run build -w frontend
```

### Containerized frontend

Use `frontend/Dockerfile` and pass build arg:

```bash
docker build -f frontend/Dockerfile --build-arg VITE_WS_BASE_URL=https://avalon-api.example.com .
```

## 3) HTTPS + CORS setup

For cross-origin API/WS support:

1. Host backend on HTTPS (`https://...`) with valid TLS cert.
2. Host frontend on HTTPS.
3. Set backend `CORS_ORIGIN` to the exact frontend origin.
4. Set frontend `VITE_WS_BASE_URL` to the backend HTTPS URL.

`socket.io-client` will then connect over secure WebSockets (`wss`) via the HTTPS backend origin.

## 4) Separate deployment recommendation

- **Backend:** Render/Fly/Heroku-like service with WebSockets enabled.
- **Frontend:** Vercel/Netlify static deployment.
- Keep backend and frontend independently deployable for faster rollouts.
