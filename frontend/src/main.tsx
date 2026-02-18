import React from 'react';
import ReactDOM from 'react-dom/client';
import { io } from 'socket.io-client';
import {
  ConnectionAckPayload,
  GameEvents,
  GamePongPayload,
  SocketNamespaces
} from '@avalon/shared';
import './styles.css';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
const wsBaseUrl = import.meta.env.VITE_WS_BASE_URL ?? 'http://localhost:4000';

function App() {
  const [health, setHealth] = React.useState('Checking API health...');
  const [socketStatus, setSocketStatus] = React.useState('Connecting to /game...');
  const [lastPong, setLastPong] = React.useState<GamePongPayload | null>(null);

  React.useEffect(() => {
    fetch(`${apiBaseUrl}/health`)
      .then((response) => response.json())
      .then((data: { status: string }) => {
        setHealth(`API status: ${data.status}`);
      })
      .catch(() => {
        setHealth('API status: unreachable');
      });

    const socket = io(`${wsBaseUrl}${SocketNamespaces.game}`);

    socket.on(GameEvents.connectionAck, (payload: ConnectionAckPayload) => {
      setSocketStatus(payload.message);
      socket.emit(GameEvents.ping, { timestamp: Date.now() });
    });

    socket.on(GameEvents.pong, (payload: GamePongPayload) => {
      setLastPong(payload);
    });

    socket.on('connect_error', () => {
      setSocketStatus('Socket connection failed');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="card">
        <h1>Avalon Game Starter</h1>
        <p>{health}</p>
        <p>Socket: {socketStatus}</p>
        {lastPong ? (
          <p>
            Last pong timestamp: <strong>{new Date(lastPong.serverTime).toLocaleTimeString()}</strong>
          </p>
        ) : (
          <p>Waiting for ping response...</p>
        )}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
