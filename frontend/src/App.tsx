import React from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  ConnectionAckPayload,
  CreateGameResponse,
  GameEndedPayload,
  GameErrorPayload,
  GameEvents,
  GameStatePayload,
  JoinGameResponse,
  LobbyStatePayload,
  PhaseChangedPayload,
  RejoinGameResponse,
  SocketNamespaces
} from '@avalon/shared';
import './styles.css';

const wsBaseUrl = import.meta.env.VITE_WS_BASE_URL ?? 'http://localhost:4000';
const SESSION_KEY = 'avalon_session_token';
const NICKNAME_KEY = 'avalon_nickname';

type Screen = 'home' | 'join' | 'lobby';
type ConnectionState = 'connecting' | 'connected' | 'disconnected';

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return '—';
  }

  return new Date(timestamp).toLocaleTimeString();
}

export function App() {
  const socketRef = React.useRef<Socket | null>(null);
  const [screen, setScreen] = React.useState<Screen>('home');
  const [nickname, setNickname] = React.useState(() => window.localStorage.getItem(NICKNAME_KEY) ?? '');
  const [joinCode, setJoinCode] = React.useState('');
  const [status, setStatus] = React.useState('Connecting to game server…');
  const [error, setError] = React.useState('');
  const [gameState, setGameState] = React.useState<GameStatePayload | LobbyStatePayload | null>(null);
  const [isHost, setIsHost] = React.useState(false);
  const [currentPlayerId, setCurrentPlayerId] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [connectionNonce, setConnectionNonce] = React.useState(0);
  const [copiedCode, setCopiedCode] = React.useState(false);
  const [connectionState, setConnectionState] = React.useState<ConnectionState>('connecting');
  const [latestPhaseChange, setLatestPhaseChange] = React.useState<string | null>(null);
  const [winnerAnnouncement, setWinnerAnnouncement] = React.useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = React.useState<string[]>([]);

  React.useEffect(() => {
    window.localStorage.setItem(NICKNAME_KEY, nickname);
  }, [nickname]);

  React.useEffect(() => {
    if (!copiedCode) {
      return;
    }

    const timeout = window.setTimeout(() => setCopiedCode(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copiedCode]);

  React.useEffect(() => {
    const socket = io(`${wsBaseUrl}${SocketNamespaces.game}`);
    socketRef.current = socket;
    setConnectionState('connecting');

    socket.on(GameEvents.connectionAck, (payload: ConnectionAckPayload) => {
      setStatus(payload.message);
      setConnectionState('connected');
      const rememberedToken = window.localStorage.getItem(SESSION_KEY);
      if (rememberedToken) {
        setStatus('Reconnecting to your previous lobby…');
        socket.emit(GameEvents.rejoinRequest, { sessionToken: rememberedToken });
      }
    });

    socket.on(GameEvents.gameState, (payload: GameStatePayload) => {
      setGameState(payload);
      setSelectedTeam(payload.proposedTeam);
      setWinnerAnnouncement(payload.winner);
      setScreen('lobby');
      setConnecting(false);
      setError('');
    });

    socket.on(GameEvents.phaseChanged, (payload: PhaseChangedPayload) => {
      setLatestPhaseChange(payload.phase);
      setStatus(`Phase changed to ${payload.phase.replace('_', ' ')}.`);
    });

    socket.on(GameEvents.gameEnded, (payload: GameEndedPayload) => {
      setWinnerAnnouncement(payload.winner);
      setStatus(`Game ended. ${payload.winner} wins.`);
    });

    socket.on(GameEvents.createGameResponse, (payload: CreateGameResponse) => {
      window.localStorage.setItem(SESSION_KEY, payload.session.sessionToken);
      setIsHost(payload.session.isHost);
      setCurrentPlayerId(payload.session.playerId);
      setGameState(payload.lobby);
      setScreen('lobby');
      setConnecting(false);
      setError('');
      setStatus('Game created successfully. Invite players with your join code.');
    });

    socket.on(GameEvents.joinGameResponse, (payload: JoinGameResponse) => {
      window.localStorage.setItem(SESSION_KEY, payload.session.sessionToken);
      setIsHost(payload.session.isHost);
      setCurrentPlayerId(payload.session.playerId);
      setGameState(payload.lobby);
      setScreen('lobby');
      setConnecting(false);
      setError('');
      setStatus('Joined lobby successfully. Waiting for the host to start.');
    });

    socket.on(GameEvents.rejoinResponse, (payload: RejoinGameResponse) => {
      window.localStorage.setItem(SESSION_KEY, payload.session.sessionToken);
      setIsHost(payload.session.isHost);
      setCurrentPlayerId(payload.session.playerId);
      setGameState(payload.lobby);
      setScreen('lobby');
      setConnecting(false);
      setError('');
      setStatus('Reconnected to your previous lobby.');
    });

    socket.on(GameEvents.error, (payload: GameErrorPayload) => {
      setError(payload.message);
      setConnecting(false);
      setStatus('Something went wrong. Please review the message below.');
    });

    socket.on('connect_error', () => {
      setStatus('Unable to connect to the game server. Check backend and CORS settings.');
      setError('Could not reach game server. Try again in a moment.');
      setConnecting(false);
      setConnectionState('disconnected');
    });

    socket.on('disconnect', () => {
      setConnectionState('disconnected');
      setStatus('Disconnected from game server. Reconnecting…');
    });

    socket.on('reconnect', () => {
      setConnectionState('connected');
      setStatus('Reconnected to game server.');
    });

    return () => {
      socket.disconnect();
    };
  }, [connectionNonce]);

  const normalizedName = nickname.trim();
  const normalizedJoinCode = joinCode.trim().toUpperCase();
  const canSubmitName = normalizedName.length >= 2;
  const isValidJoinCode = normalizedJoinCode.length >= 4 && normalizedJoinCode.length <= 6;

  const handleCreateGame = () => {
    if (!socketRef.current || !canSubmitName || connecting) {
      return;
    }

    setConnecting(true);
    setError('');
    setStatus('Creating lobby…');
    socketRef.current.emit(GameEvents.createGameRequest, { name: normalizedName });
  };

  const handleJoinGame = () => {
    if (!socketRef.current || !canSubmitName || !isValidJoinCode || connecting) {
      return;
    }

    setConnecting(true);
    setError('');
    setStatus(`Joining lobby ${normalizedJoinCode}…`);
    socketRef.current.emit(GameEvents.joinGameRequest, {
      name: normalizedName,
      joinCode: normalizedJoinCode
    });
  };

  const leaveLobby = () => {
    window.localStorage.removeItem(SESSION_KEY);
    setGameState(null);
    setScreen('home');
    setIsHost(false);
    setCurrentPlayerId(null);
    setLatestPhaseChange(null);
    setWinnerAnnouncement(null);
    setSelectedTeam([]);
    setStatus('Connecting to game server…');
    setError('');
    setJoinCode('');
    setConnectionNonce((nonce) => nonce + 1);
  };

  const copyCodeToClipboard = async () => {
    if (!gameState?.joinCode) {
      return;
    }

    try {
      await window.navigator.clipboard.writeText(gameState.joinCode);
      setCopiedCode(true);
    } catch {
      setError('Clipboard permission denied. You can still copy the code manually.');
    }
  };

  const playerList = React.useMemo(() => {
    const players = gameState?.players ?? [];
    return [...players].sort((left, right) => left.seat - right.seat);
  }, [gameState]);

  const currentPlayer = playerList.find((player) => player.id === currentPlayerId) ?? null;
  const gameDetails = gameState && 'leaderSeat' in gameState ? gameState : null;
  const leaderSeat = gameDetails?.leaderSeat ?? null;
  const isLeader = Boolean(currentPlayer && leaderSeat && currentPlayer.seat === leaderSeat);
  const isProposedQuestMember = Boolean(
    gameDetails && currentPlayerId && gameDetails.proposedTeam.includes(currentPlayerId)
  );

  const canAdvancePhase = isHost && (gameState?.phase === 'lobby' || gameState?.phase === 'role_assignment');

  const submitPhaseAdvance = () => {
    if (!socketRef.current || !canAdvancePhase) {
      return;
    }

    socketRef.current.emit(GameEvents.phaseAdvanceRequest, {});
  };

  const toggleTeamSelection = (playerId: string) => {
    setSelectedTeam((team) =>
      team.includes(playerId) ? team.filter((id) => id !== playerId) : [...team, playerId]
    );
  };

  const submitTeamProposal = () => {
    if (!socketRef.current || !selectedTeam.length || !gameDetails) {
      return;
    }

    socketRef.current.emit(GameEvents.teamProposed, { teamPlayerIds: selectedTeam });
  };

  const submitVote = (vote: 'approve' | 'reject') => {
    if (!socketRef.current || gameState?.phase !== 'voting') {
      return;
    }

    socketRef.current.emit(GameEvents.voteSubmitted, { vote });
  };

  const submitQuest = (action: 'success' | 'fail') => {
    if (!socketRef.current || gameState?.phase !== 'quest' || !isProposedQuestMember) {
      return;
    }

    socketRef.current.emit(GameEvents.questSubmitted, { action });
  };

  const renderHome = () => (
    <section className="card stack-lg" aria-label="Home screen">
      <h1>Avalon Lobby</h1>
      <p className="subtle">Create a private room in seconds, then share the code with your group.</p>
      <label className="field">
        <span>Nickname</span>
        <input
          type="text"
          maxLength={24}
          value={nickname}
          placeholder="Enter your name"
          onChange={(event) => setNickname(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleCreateGame();
            }
          }}
        />
      </label>
      {!canSubmitName ? <p className="field-help">Use at least 2 characters.</p> : null}
      <div className="stack-sm">
        <button className="btn btn-primary" onClick={handleCreateGame} disabled={!canSubmitName || connecting}>
          {connecting ? 'Creating…' : 'Create Game'}
        </button>
        <button className="btn" onClick={() => setScreen('join')} disabled={connecting}>
          Join Existing Game
        </button>
      </div>
    </section>
  );

  const renderJoin = () => (
    <section className="card stack-lg" aria-label="Join screen">
      <h1>Join Lobby</h1>
      <p className="subtle">Enter the host's join code and the nickname you want to use.</p>
      <label className="field">
        <span>Game code (4-6 characters)</span>
        <input
          type="text"
          value={joinCode}
          minLength={4}
          maxLength={6}
          placeholder="AB12C"
          onChange={(event) => setJoinCode(event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleJoinGame();
            }
          }}
        />
      </label>
      {!isValidJoinCode ? <p className="field-help">Code must be 4-6 letters/numbers.</p> : null}
      <label className="field">
        <span>Nickname</span>
        <input
          type="text"
          maxLength={24}
          value={nickname}
          placeholder="Your name"
          onChange={(event) => setNickname(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleJoinGame();
            }
          }}
        />
      </label>
      {!canSubmitName ? <p className="field-help">Use at least 2 characters.</p> : null}
      <div className="stack-sm">
        <button
          className="btn btn-primary"
          onClick={handleJoinGame}
          disabled={!isValidJoinCode || !canSubmitName || connecting}
        >
          {connecting ? 'Joining…' : 'Join Lobby'}
        </button>
        <button className="btn" onClick={() => setScreen('home')} disabled={connecting}>
          Back
        </button>
      </div>
    </section>
  );

  const renderPhaseControls = () => {
    if (!gameState) {
      return null;
    }

    if (canAdvancePhase) {
      return (
        <button className="btn btn-primary" onClick={submitPhaseAdvance}>
          Start Game
        </button>
      );
    }

    if (gameState.phase === 'team_proposal') {
      const canProposeTeam = isHost || isLeader;
      return (
        <div className="stack-sm">
          <p className="subtle">{canProposeTeam ? 'Select a team and submit it.' : 'Waiting for leader to propose team.'}</p>
          <ul className="player-list">
            {playerList.map((player) => (
              <li key={`select-${player.id}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedTeam.includes(player.id)}
                    onChange={() => toggleTeamSelection(player.id)}
                    disabled={!canProposeTeam}
                  />{' '}
                  {player.name}
                </label>
              </li>
            ))}
          </ul>
          <button className="btn btn-primary" onClick={submitTeamProposal} disabled={!canProposeTeam || !selectedTeam.length}>
            Submit Team Proposal
          </button>
        </div>
      );
    }

    if (gameState.phase === 'voting') {
      return (
        <div className="stack-sm">
          <p className="subtle">Vote on the proposed team.</p>
          <div className="stack-sm">
            <button className="btn btn-primary" onClick={() => submitVote('approve')}>
              Approve Team
            </button>
            <button className="btn" onClick={() => submitVote('reject')}>
              Reject Team
            </button>
          </div>
        </div>
      );
    }

    if (gameState.phase === 'quest') {
      return (
        <div className="stack-sm">
          <p className="subtle">
            {isProposedQuestMember
              ? 'Submit your quest action.'
              : 'Waiting for selected quest members to submit actions.'}
          </p>
          <div className="stack-sm">
            <button className="btn btn-primary" onClick={() => submitQuest('success')} disabled={!isProposedQuestMember}>
              Quest Success
            </button>
            <button className="btn" onClick={() => submitQuest('fail')} disabled={!isProposedQuestMember}>
              Quest Fail
            </button>
          </div>
        </div>
      );
    }

    return <p className="subtle">No actions available in this phase.</p>;
  };

  const renderLobby = () => (
    <section className="card stack-lg" aria-label="Lobby screen">
      <div className="lobby-header">
        <h1>Lobby</h1>
        <div className="join-code-group">
          <span className="chip chip-highlight">Code: {gameState?.joinCode ?? '----'}</span>
          <button className="btn btn-inline" onClick={copyCodeToClipboard} disabled={!gameState?.joinCode}>
            {copiedCode ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <p className="subtle">Share the join code with your friends. Connected players appear live below.</p>
      <div className="chip-row">
        <span className="chip chip-highlight">{playerList.length} players</span>
        <span className="chip">{isHost ? 'You are host' : 'Waiting for host'}</span>
        <span className="chip">Phase: {gameState?.phase ?? 'unknown'}</span>
      </div>
      {gameDetails ? (
        <div className="stack-sm" aria-label="Game state details">
          <p className="subtle">Leader seat: {gameDetails.leaderSeat}</p>
          <p className="subtle">
            Proposed team:{' '}
            {gameDetails.proposedTeam.length
              ? gameDetails.proposedTeam
                  .map((playerId: string) => playerList.find((player) => player.id === playerId)?.name ?? playerId)
                  .join(', ')
              : 'None'}
          </p>
          <p className="subtle">Vote window ends: {formatTimestamp(gameDetails.voteWindowEndsAt)}</p>
          <p className="subtle">Quest window ends: {formatTimestamp(gameDetails.questWindowEndsAt)}</p>
          <p className="subtle">
            Quest results:{' '}
            {gameDetails.questResults.length
              ? gameDetails.questResults
                  .map((result: GameStatePayload['questResults'][number]) => `Q${result.questNumber}: ${result.succeeds ? 'Success' : 'Fail'}`)
                  .join(' | ')
              : 'No completed quests yet'}
          </p>
        </div>
      ) : null}
      {latestPhaseChange ? <p className="subtle">Latest phase event: {latestPhaseChange}</p> : null}
      {winnerAnnouncement ? <p className="subtle">Winner: {winnerAnnouncement}</p> : null}
      <ul className="player-list" aria-live="polite">
        {playerList.map((player) => (
          <li key={player.id}>
            <span>
              {player.name}
              {gameState?.hostId === player.id ? <strong className="host-badge">Host</strong> : null}
            </span>
            <span className={`chip ${player.connected ? 'chip-good' : 'chip-bad'}`}>
              {player.connected ? 'Connected' : 'Disconnected'}
            </span>
          </li>
        ))}
      </ul>
      <div className="stack-sm">
        {renderPhaseControls()}
        <button className="btn" onClick={leaveLobby}>
          Leave Lobby
        </button>
      </div>
    </section>
  );

  return (
    <main className="app-shell">
      <div className="status-card stack-sm full-width" role="status" aria-live="polite">
        <div className="connection-row">
          <span className={`connection-dot connection-${connectionState}`} />
          <p className="status">{status}</p>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>
      {screen === 'home' ? renderHome() : null}
      {screen === 'join' ? renderJoin() : null}
      {screen === 'lobby' ? renderLobby() : null}
    </main>
  );
}
