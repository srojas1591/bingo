const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

// ===== Configuration =====
const PORT = process.env.PORT || 3000;
const HOST_CODE = '1591';
const STATIC_DIR = path.join(__dirname, '..');

// ===== Network IP Detection =====
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non IPv4
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();

// ===== MIME types for static file serving =====
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ===== HTTP Server for static files =====
const server = http.createServer((req, res) => {
  const fullUrl = req.url;
  let urlPath = fullUrl.split('?')[0]; // strip query params

  console.log(`HTTP ${req.method} ${fullUrl}`);

  // Route /host to views/host.html, /player to views/player.html
  if (urlPath === '/host') {
    urlPath = '/views/host.html';
  } else if (urlPath === '/player') {
    urlPath = '/views/player.html';
  } else if (urlPath === '/' || urlPath === '/index.html') {
    urlPath = '/index.html';
  }

  const filePath = path.join(STATIC_DIR, urlPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    console.log(`Forbidden access attempt: ${filePath}`);
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.log(`File not found: ${filePath}`);
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': contentType };

    // No-cache for JS/CSS so service worker always gets fresh versions
    if (ext === '.js' || ext === '.css') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }

    res.writeHead(200, headers);
    res.end(data);
  });
});

// ===== WebSocket Server =====
const wss = new WebSocketServer({ server });

// Track host connection (only one host at a time)
let hostWs = null;

// ===== Session ID Generation =====
function generateSessionId() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit session ID
}

// ===== Game State =====
let game = {
  sessionId: null,     // unique session ID generated when host joins
  players: {},         // { [playerId]: { name, card, marked, patterns } }
  calledNumbers: [],   // array of called numbers
  callIndex: 0,
  gameOver: false,
  winners: [],         // array of winner objects { id, name } — multiple winners possible
};

// ===== Bingo Card Generation (server-side) =====
const LETTERS = ['B', 'I', 'N', 'G', 'O'];
const RANGES = {
  B: [1, 15],
  I: [16, 30],
  N: [31, 45],
  G: [46, 60],
  O: [61, 75],
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function letterForNumber(n) {
  if (n <= 15) return 'B';
  if (n <= 30) return 'I';
  if (n <= 45) return 'N';
  if (n <= 60) return 'G';
  return 'O';
}

function labelForNumber(n) {
  return `${letterForNumber(n)}-${n}`;
}

function generateColumn(col) {
  const [min, max] = RANGES[LETTERS[col]];
  const nums = [];
  while (nums.length < 5) {
    const n = randomInRange(min, max);
    if (!nums.includes(n)) nums.push(n);
  }
  return nums;
}

function generateCard() {
  const colMajor = [];
  for (let col = 0; col < 5; col++) {
    colMajor[col] = generateColumn(col);
  }
  // Transpose to row-major
  const rowMajor = [];
  for (let row = 0; row < 5; row++) {
    rowMajor[row] = [];
    for (let col = 0; col < 5; col++) {
      rowMajor[row][col] = colMajor[col][row];
    }
  }
  rowMajor[2][2] = null; // FREE space
  return rowMajor;
}

function createMarkedArray() {
  const marked = Array.from({ length: 5 }, () => Array(5).fill(false));
  marked[2][2] = true; // FREE space
  return marked;
}

// ===== Pattern Detection =====
function detectPatterns(card, marked) {
  const patterns = {
    rows: [],
    columns: [],
    diagonals: [],
  };

  // Check rows
  for (let r = 0; r < 5; r++) {
    let complete = true;
    for (let c = 0; c < 5; c++) {
      if (!marked[r][c]) { complete = false; break; }
    }
    if (complete) patterns.rows.push(r);
  }

  // Check columns
  for (let c = 0; c < 5; c++) {
    let complete = true;
    for (let r = 0; r < 5; r++) {
      if (!marked[r][c]) { complete = false; break; }
    }
    if (complete) patterns.columns.push(c);
  }

  // Check diagonal top-left → bottom-right
  let d1 = true;
  for (let i = 0; i < 5; i++) {
    if (!marked[i][i]) { d1 = false; break; }
  }
  if (d1) patterns.diagonals.push(0);

  // Check diagonal top-right → bottom-left
  let d2 = true;
  for (let i = 0; i < 5; i++) {
    if (!marked[i][4 - i]) { d2 = false; break; }
  }
  if (d2) patterns.diagonals.push(1);

  return patterns;
}

function countMarked(marked) {
  let count = 0;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (marked[r][c]) count++;
    }
  }
  return count;
}

// ===== Broadcast Helpers =====
function broadcastToAll(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
}

function broadcastToPlayers(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client !== hostWs && client.readyState === 1) {
      client.send(data);
    }
  });
}

function broadcastToHost(message) {
  const data = JSON.stringify(message);
  if (hostWs && hostWs.readyState === 1) {
    hostWs.send(data);
  }
}

// ===== Game Actions =====
function initGameState() {
  // Initialize game state without broadcasting (used when host first authenticates)
  game.calledNumbers = shuffle(Array.from({ length: 75 }, (_, i) => i + 1));
  game.callIndex = 0;
  game.gameOver = false;
  game.winners = [];
}

function initNewGame() {
  // Drop all players — they must re-login for a new game
  console.log('[Game] New game: dropping all players');

  // Close all player connections
  const playerClients = [];
  for (const client of wss.clients) {
    if (client !== hostWs && client.readyState === 1) {
      playerClients.push(client);
    }
  }

  // Notify players that the game has ended and they need to rejoin
  const disconnectMsg = JSON.stringify({
    type: 'game_reset',
    message: 'El anfitrión ha iniciado un nuevo juego. Por favor, únete de nuevo.',
  });
  playerClients.forEach((client) => {
    client.send(disconnectMsg);
    client.close();
  });

  // Clear all player data
  game.players = {};
  game.calledNumbers = shuffle(Array.from({ length: 75 }, (_, i) => i + 1));
  game.callIndex = 0;
  game.gameOver = false;
  game.winners = [];
  // Generate a new session ID so old player URLs no longer work
  game.sessionId = generateSessionId();
  console.log(`[Game] New session ID: ${game.sessionId}`);

  // Broadcast new game state to host only
  broadcastToHost({
    type: 'game_start',
    players: getPlayerList(),
    calledNumbers: [],
    sessionId: game.sessionId,
  });
}

function getPlayerList() {
  const list = [];
  for (const id in game.players) {
    const p = game.players[id];
    list.push({
      playerId: id,
      playerName: p.name,
      markedCount: countMarked(p.marked),
      patterns: p.patterns,
    });
  }
  // Sort by marked count descending, then by total patterns
  list.sort((a, b) => {
    const aTotal = a.markedCount + (a.patterns.rows.length + a.patterns.columns.length + a.patterns.diagonals.length) * 10;
    const bTotal = b.markedCount + (b.patterns.rows.length + b.patterns.columns.length + b.patterns.diagonals.length) * 10;
    return bTotal - aTotal;
  });
  return list;
}

function callNumber() {
  if (game.gameOver) return;
  if (game.callIndex >= 75) {
    broadcastToHost({ type: 'all_numbers_called' });
    return;
  }

  const num = game.calledNumbers[game.callIndex];
  game.callIndex++;

  const label = labelForNumber(num);

  // No auto-marking — players must manually tap their cells to mark numbers.
  // The server only broadcasts the called number; marking is player-initiated.

  // Broadcast the called number to each player with their own marked cells
  for (const client of wss.clients) {
    if (client !== hostWs && client.readyState === 1 && client.playerId) {
      const player = game.players[client.playerId];
      if (player) {
        client.send(JSON.stringify({
          type: 'number_called',
          number: num,
          label: label,
          calledNumbers: game.calledNumbers.slice(0, game.callIndex),
          callIndex: game.callIndex,
          marked: player.marked,
        }));
      }
    }
  }

  // Update host with classification board
  broadcastToHost({
    type: 'number_called',
    number: num,
    label: label,
    calledNumbers: game.calledNumbers.slice(0, game.callIndex),
    callIndex: game.callIndex,
    players: getPlayerList(),
  });

  // No win check here — wins are only detected when players manually mark cells via toggle_mark
}

function joinPlayer(playerId, playerName) {
  const card = generateCard();
  const marked = createMarkedArray();
  const patterns = detectPatterns(card, marked);

  game.players[playerId] = {
    name: playerName,
    card,
    marked,
    patterns,
  };

  // Send the card to the joining player
  const playerWs = findPlayerWebSocket(playerId);
  if (playerWs) {
    playerWs.send(JSON.stringify({
      type: 'game_start',
      card,
      calledNumbers: game.calledNumbers.slice(0, game.callIndex),
      callIndex: game.callIndex,
      gameOver: game.gameOver,
      winners: game.winners,
      sessionId: game.sessionId,
    }));
  }

  // Notify host about new player
  broadcastToHost({
    type: 'player_joined',
    playerId,
    playerName,
    players: getPlayerList(),
  });

  // Update all players list on host
  broadcastToHost({
    type: 'classification_update',
    players: getPlayerList(),
  });
}

function findPlayerWebSocket(playerId) {
  for (const client of wss.clients) {
    if (client.playerId === playerId && client.readyState === 1) {
      return client;
    }
  }
  return null;
}

// ===== WebSocket Connection Handling =====
wss.on('connection', (ws) => {
  console.log(`[WebSocket] New connection. Total clients: ${wss.clients.size}`);

  // Auto-close idle connections after 30 seconds (no message sent)
  let idleTimer = setTimeout(() => {
    if (!ws.isHost && !ws.playerId) {
      console.log('[WebSocket] Closing idle connection');
      ws.close();
    }
  }, 30000);

  // Auto-close host connections after 5 minutes of inactivity
  let hostIdleTimer = null;
  function resetIdleTimers() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!ws.isHost && !ws.playerId) {
        console.log('[WebSocket] Closing idle connection');
        ws.close();
      }
    }, 30000);
    if (ws.isHost) {
      clearTimeout(hostIdleTimer);
      hostIdleTimer = setTimeout(() => {
        console.log('[WebSocket] Host idle timeout, clearing host session');
        hostWs = null;
        ws.close();
      }, 300000); // 5 minutes
    }
  }

  ws.on('message', (raw) => {
    resetIdleTimers();
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (e) {
      console.error('[WebSocket] Invalid message:', raw.toString());
      return;
    }

    console.log(`[WebSocket] Received: ${message.type}`);

    switch (message.type) {
      case 'host_auth': {
        // Host authentication
        if (message.code === HOST_CODE && !hostWs) {
          hostWs = ws;
          ws.isHost = true;
          // Generate a new session ID for this host session
          game.sessionId = generateSessionId();
          console.log(`[Auth] Host authenticated successfully, session: ${game.sessionId}`);
          // Initialize a new game with shuffled numbers
          initGameState();
          // Send current game state to host with session ID
          ws.send(JSON.stringify({
            type: 'game_start',
            players: getPlayerList(),
            calledNumbers: game.calledNumbers.slice(0, game.callIndex),
            callIndex: game.callIndex,
            sessionId: game.sessionId,
          }));
        } else if (message.code !== HOST_CODE) {
          console.log('[Auth] Failed: wrong code');
          ws.send(JSON.stringify({ type: 'auth_failed' }));
          // Don't close — let the user retry with the correct code
        } else {
          console.log('[Auth] Failed: host already exists');
          ws.send(JSON.stringify({ type: 'auth_failed', reason: 'host_exists' }));
          // Don't close immediately — let the client handle it
          // The idle timeout will clean up this connection after 30s
        }
        break;
      }

      case 'join_player': {
        ws.playerId = message.playerId;
        console.log(`[Player] ${message.playerId} (${message.playerName}) joining`);
        joinPlayer(message.playerId, message.playerName);
        break;
      }

      case 'call_number': {
        if (ws.isHost) {
          callNumber();
        }
        break;
      }

      case 'new_game': {
        if (ws.isHost) {
          console.log('[Game] New game requested by host');
          initNewGame();
        }
        break;
      }

      case 'toggle_mark': {
        // Player manually toggled a cell mark
        if (ws.playerId && game.players[ws.playerId]) {
          const player = game.players[ws.playerId];
          const { row, col, marked: isMarked } = message;
          if (row >= 0 && row < 5 && col >= 0 && col < 5 && player.card[row][col] !== null) {
            // Only allow marking called numbers
            const num = player.card[row][col];
            if (game.calledNumbers.includes(num)) {
              player.marked[row][col] = isMarked;
              player.patterns = detectPatterns(player.card, player.marked);
              console.log(`[Player] ${ws.playerId} toggled cell [${row}][${col}] (${num}) to ${isMarked}`);

              // Notify host of the card update
              broadcastToHost({
                type: 'card_update',
                playerId: ws.playerId,
                markedCells: player.marked,
                patterns: player.patterns,
                markedCount: countMarked(player.marked),
              });
              broadcastToHost({
                type: 'classification_update',
                players: getPlayerList(),
              });

              // Check if this player just won by manual marking
              const hasPattern = player.patterns.rows.length > 0 || player.patterns.columns.length > 0 || player.patterns.diagonals.length > 0;
              const alreadyWinner = game.winners.some(w => w.id === ws.playerId);
              if (hasPattern && !alreadyWinner && !game.gameOver) {
                game.gameOver = true;
                game.winners.push({ id: ws.playerId, name: player.name });
                const winnersList = game.winners.map(w => ({ id: w.id, name: w.name }));
                broadcastToAll({
                  type: 'game_over',
                  winners: winnersList,
                });
                console.log(`[Game] Game over! Winners: ${winnersList.map(w => w.name).join(', ')}`);
              }
            }
          }
        }
        break;
      }

      default:
        console.log('Unknown message type:', message.type);
    }
  });

  ws.on('close', () => {
    console.log(`[WebSocket] Client disconnected. Total: ${wss.clients.size}`);
    if (ws.isHost) {
      hostWs = null;
      console.log('[Auth] Host disconnected');
    }
    // If a player disconnects, remove them
    if (ws.playerId && game.players[ws.playerId]) {
      console.log(`[Player] ${ws.playerId} disconnected and removed`);
      delete game.players[ws.playerId];
      broadcastToHost({
        type: 'player_left',
        playerId: ws.playerId,
        players: getPlayerList(),
      });
    }
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] Error:', err.message);
  });
});

// ===== Start Server =====
// Bind to 0.0.0.0 to accept connections from all network interfaces (local network + localhost)
server.listen(PORT, '0.0.0.0', () => {
  const addr = server.address();
  console.log('');
  console.log('========================================');
  console.log('  🎱 Bingo Multiplayer Server');
  console.log('========================================');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${LOCAL_IP}:${PORT}`);
  console.log('');
  console.log(`  Host view:  http://${LOCAL_IP}:${PORT}/host`);
  console.log(`  Player view: http://${LOCAL_IP}:${PORT}/player`);
  console.log('');
  console.log(`  Access code for host: ${HOST_CODE}`);
  console.log('========================================');
  console.log('');
});

// Handle server errors
server.on('error', (err) => {
  console.error('[Server] Error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`[Server] Port ${PORT} is already in use. Kill the existing process or use a different port.`);
  }
});
