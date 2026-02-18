import React from 'react';
import ReactDOM from 'react-dom/client';
import { io, type Socket } from 'socket.io-client';
import {
  ConnectionAckPayload,
  CreateGameResponse,
  GameErrorPayload,
  GameEvents,
  JoinGameResponse,
  LobbyStatePayload,
  RejoinGameResponse,
  SocketNamespaces
} from '@avalon/shared';
import './styles.css';

const wsBaseUrl = import.meta.env.VITE_WS_BASE_URL ?? 'http://localhost:4000';
const SESSION_KEY = 'avalon_session_token';

type Screen = 'home' | 'join' | 'lobby';

function App() {
  const socketRef = React.useRef<Socket | null>(null);
  const [screen, setScreen] = React.useState<Screen>('home');
  const [nickname, setNickname] = React.useState('');
  const [joinCode, setJoinCode] = React.useState('');
  const [status, setStatus] = React.useState('Connecting...');
  const [error, setError] = React.useState('');
  const [lobby, setLobby] = React.useState<LobbyStatePayload | null>(null);
  const [isHost, setIsHost] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);

  React.useEffect(() => {
    const socket = io(`${wsBaseUrl}${SocketNamespaces.game}`);
    socketRef.current = socket;

    socket.on(GameEvents.connectionAck, (payload: ConnectionAckPayload) => {
      setStatus(payload.message);
      const rememberedToken = window.localStorage.getItem(SESSION_KEY);
      if (rememberedToken) {
        socket.emit(GameEvents.rejoinRequest, { sessionToken: rememberedToken });
      }
    });

    socket.on(GameEvents.lobbyState, (payload: LobbyStatePayload) => {
      setLobby(payload);
      setScreen('lobby');
      setConnecting(false);
      setError('');
    });

    socket.on(GameEvents.createGameResponse, (payload: CreateGameResponse) => {
      window.localStorage.setItem(SESSION_KEY, payload.session.sessionToken);
      setIsHost(payload.session.isHost);
      setLobby(payload.lobby);
      setScreen('lobby');
      setConnecting(false);
      setError('');
      setStatus('Game created');
    });

    socket.on(GameEvents.joinGameResponse, (payload: JoinGameResponse) => {
      window.localStorage.setItem(SESSION_KEY, payload.session.sessionToken);
      setIsHost(payload.session.isHost);
      setLobby(payload.lobby);
      setScreen('lobby');
      setConnecting(false);
      setError('');
      setStatus('Joined lobby');
    });

    socket.on(GameEvents.rejoinResponse, (payload: RejoinGameResponse) => {
      window.localStorage.setItem(SESSION_KEY, payload.session.sessionToken);
      setIsHost(payload.session.isHost);
      setLobby(payload.lobby);
      setScreen('lobby');
      setConnecting(false);
      setError('');
      setStatus('Reconnected');
    });

    socket.on(GameEvents.error, (payload: GameErrorPayload) => {
      setError(payload.message);
      setConnecting(false);
    });

    socket.on('connect_error', () => {
      setStatus('Socket connection failed');
      setConnecting(false);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const canSubmitName = nickname.trim().length >= 2;

  const handleCreateGame = () => {
    if (!socketRef.current || !canSubmitName) {
      return;
    }

    setConnecting(true);
    setError('');
    socketRef.current.emit(GameEvents.createGameRequest, { name: nickname.trim() });
  };

  const handleJoinGame = () => {
    if (!socketRef.current || !canSubmitName) {
      return;
    }

    setConnecting(true);
    setError('');
    socketRef.current.emit(GameEvents.joinGameRequest, {
      name: nickname.trim(),
      joinCode: joinCode.trim().toUpperCase()
    });
  };

  const renderHome = () => (
    <section className="card stack-lg">
      <h1>Avalon</h1>
      <p className="subtle">Gather friends quickly and jump into a private lobby.</p>
      <label className="field">
        <span>Nickname</span>
        <input
          type="text"
          maxLength={24}
          value={nickname}
          placeholder="Enter your name"
          onChange={(event) => setNickname(event.target.value)}
        />
      </label>
      <div className="stack-sm">
        <button className="btn btn-primary" onClick={handleCreateGame} disabled={!canSubmitName || connecting}>
          Create Game
        </button>
        <button className="btn" onClick={() => setScreen('join')}>
          Join Game
        </button>
      </div>
    </section>
  );

  const renderJoin = () => (
    <section className="card stack-lg">
      <h1>Join Lobby</h1>
      <label className="field">
        <span>Game code (4-6 characters)</span>
        <input
          type="text"
          value={joinCode}
          minLength={4}
          maxLength={6}
          placeholder="AB12C"
          onChange={(event) => setJoinCode(event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())}
        />
      </label>
      <label className="field">
        <span>Nickname</span>
        <input
          type="text"
          maxLength={24}
          value={nickname}
          placeholder="Your name"
          onChange={(event) => setNickname(event.target.value)}
        />
      </label>
      <div className="stack-sm">
        <button
          className="btn btn-primary"
          onClick={handleJoinGame}
          disabled={joinCode.trim().length < 4 || joinCode.trim().length > 6 || !canSubmitName || connecting}
        >
          Join Lobby
        </button>
        <button className="btn" onClick={() => setScreen('home')}>
          Back
        </button>
      </div>
    </section>
  );

  const renderLobby = () => (
    <section className="card stack-lg">
      <div className="lobby-header">
        <h1>Lobby</h1>
        <span className="chip">Code: {lobby?.joinCode ?? '----'}</span>
      </div>
      <p className="subtle">Share code with friends and wait for everyone to connect.</p>
      <div className="chip-row">
        <span className="chip chip-highlight">{lobby?.players.length ?? 0} players</span>
        <span className="chip">{isHost ? 'Host controls enabled' : 'Waiting for host'}</span>
      </div>
      <ul className="player-list">
        {(lobby?.players ?? []).map((player) => (
          <li key={player.id}>
            <span>{player.name}</span>
            <span className={`chip ${player.connected ? 'chip-good' : 'chip-bad'}`}>
              {player.connected ? 'Connected' : 'Disconnected'}
            </span>
          </li>
        ))}
      </ul>
      <div className="stack-sm">
        <button className="btn btn-primary" disabled={!isHost}>
          {isHost ? 'Start Game (coming soon)' : 'Only host can start'}
        </button>
        <button
          className="btn"
          onClick={() => {
            window.localStorage.removeItem(SESSION_KEY);
            setLobby(null);
            setScreen('home');
            setIsHost(false);
          }}
        >
          Leave Lobby
        </button>
      </div>
    </section>
  );

  return (
    <main className="app-shell">
      <div className="stack-sm full-width">
        <p className="status">{status}</p>
        {error ? <p className="error">{error}</p> : null}
      </div>
      {screen === 'home' ? renderHome() : null}
      {screen === 'join' ? renderJoin() : null}
      {screen === 'lobby' ? renderLobby() : null}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
