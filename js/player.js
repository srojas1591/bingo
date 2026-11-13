(function () {
  'use strict';

  // ===== DOM References =====
  const joinScreen = document.getElementById('join-screen');
  const joinForm = document.getElementById('join-form');
  const playerNameInput = document.getElementById('player-name');
  const playerIdDisplay = document.getElementById('player-id-display');
  const joinError = document.getElementById('join-error');
  const gameScreen = document.getElementById('game-screen');
  const playerInfoEl = document.getElementById('player-info');
  const statusEl = document.getElementById('status');
  const currentBall = document.getElementById('current-ball');
  const calledCountEl = document.getElementById('called-count');
  const cardGrid = document.getElementById('card-grid');
  const calledGrid = document.getElementById('called-grid');
  const winOverlay = document.getElementById('win-overlay');
  const winMessage = document.getElementById('win-message');

  // ===== Generate 5-digit Player ID =====
  const playerId = String(Math.floor(10000 + Math.random() * 90000));
  playerIdDisplay.textContent = playerId;

  // ===== Game State =====
  let card = [];          // 5x5 array from server
  let marked = [];        // 5x5 boolean array (read-only from server; player does NOT self-mark)
  let calledNumbers = [];
  let playerName = '';
  let gameOver = false;
  let isWinner = false;   // true if this player won the game

  // ===== WebSocket Connection =====
  let ws = null;
  let connected = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let joinData = null; // Store join data for reconnection

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;

  // ===== Join Form =====
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = playerNameInput.value.trim();

    if (!name) {
      joinError.classList.remove('hidden');
      playerNameInput.focus();
      return;
    }

    joinError.classList.add('hidden');
    playerName = name;

    // Connect to WebSocket and join
    connectAndJoin();
  });

  function connectAndJoin() {
    console.log('[Player] Connecting to WebSocket at:', wsUrl);

    // Clear any existing reconnect timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Player] WebSocket connected');
      reconnectAttempts = 0; // Reset on successful connection
      const data = joinData || { playerId, playerName };
      ws.send(JSON.stringify({
        type: 'join_player',
        playerId: data.playerId,
        playerName: data.playerName,
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log('[Player] Received:', message.type);
      handleMessage(message);
    };

    ws.onclose = () => {
      console.log('[Player] WebSocket disconnected');
      connected = false;

      // Clear any existing reconnect timer
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (!joinScreen.classList.contains('hidden')) {
        joinError.textContent = 'No se pudo conectar al servidor. Verifica que el servidor esté corriendo.';
        joinError.classList.remove('hidden');
      } else if (joinData) {
        // Already joined — try to reconnect automatically
        statusEl.textContent = 'Conexión perdida. Reconectando...';
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000); // Exponential backoff, max 10s
        console.log(`[Player] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        reconnectTimer = setTimeout(() => {
          connectAndJoin();
        }, delay);
      }
    };

    ws.onerror = (err) => {
      console.error('[Player] WebSocket error:', err);
      if (!joinScreen.classList.contains('hidden')) {
        joinError.textContent = 'Error de conexión. Asegúrate de estar en la misma red que el anfitrión.';
        joinError.classList.remove('hidden');
      }
    };
  }

  // ===== Message Handler =====
  function handleMessage(message) {
    switch (message.type) {
      case 'game_start':
        // Successfully joined — show game screen
        connected = true;
        ensureAudio();
        // Store join data for reconnection
        joinData = { playerId, playerName };

        card = message.card;
        calledNumbers = message.calledNumbers || [];
        gameOver = message.gameOver || false;

        // Initialize marked array — player must manually mark cells
        marked = Array.from({ length: 5 }, () => Array(5).fill(false));
        marked[2][2] = true; // FREE space

        // If game is already over, check if this player is a winner
        if (message.winners && message.winners.length > 0) {
          gameOver = true;
          isWinner = message.winners.some(w => w.id === playerId);
          if (isWinner) {
            winMessage.textContent = `¡Felicidades ${playerName}! ¡Has ganado!`;
          } else {
            winMessage.textContent = '¡El bingo ha finalizado! ¡No has ganado!';
          }
          winOverlay.classList.remove('hidden');
        }

        joinScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');

        playerInfoEl.textContent = `Jugador: ${playerName} (#${playerId})`;
        renderCard();
        renderCalledGrid();
        updateCalledCount();

        if (gameOver) {
          statusEl.textContent = 'El juego ha terminado';
        } else {
          statusEl.textContent = 'Esperando a que el anfitrión saque números...';
        }
        break;

      case 'number_called':
        if (gameOver) return;

        // Build the label defensively — use server's label or construct it ourselves
        const num = message.number;
        const label = message.label || labelForNumber(num);

        // Display the called number
        currentBall.classList.remove('pop');
        void currentBall.offsetWidth;
        currentBall.textContent = label;
        currentBall.classList.add('pop');

        statusEl.innerHTML = `Sacado: <strong>${num}</strong> — ${label}`;
        calledNumbers = message.calledNumbers || [];
        updateCalledCount();

        // Play a sound for the called number
        playCallSound();

        // Do NOT apply server marks — player must manually tap cells to mark them.
        // The card will show orange borders for called numbers, green only when tapped.
        renderCard();
        renderCalledGrid();
        break;

      case 'game_over':
        gameOver = true;
        // Handle multiple winners — check if this player is among the winners
        const winners = message.winners || [];
        isWinner = winners.some(w => w.id === playerId);

        if (isWinner) {
          // This player won!
          playWinSound();
          winMessage.textContent = `¡Felicidades ${playerName}! ¡Has ganado!`;
          // Highlight all marked cells
          document.querySelectorAll('.card-cell.marked').forEach((cell) => {
            cell.classList.add('winning');
          });
          const winnerNames = winners.map(w => w.name).join(', ');
          statusEl.innerHTML = `🎉 <strong>¡BINGO!</strong> ¡${winnerNames} ha ganado!`;
        } else {
          // This player did not win
          winMessage.textContent = '¡El bingo ha finalizado! ¡No has ganado!';
          const winnerNames = winners.map(w => w.name).join(', ');
          statusEl.innerHTML = `🎉 <strong>¡BINGO!</strong> ¡${winnerNames} ha ganado!`;
        }
        setTimeout(() => {
          winOverlay.classList.remove('hidden');
        }, 600);
        break;

      case 'game_reset':
        // Host started a new game — redirect to re-join
        console.log('[Player] Game reset:', message.message);
        window.location.href = '/player';
        break;
    }
  }

  // ===== Card Rendering =====
  function renderCard() {
    cardGrid.innerHTML = '';
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const cell = document.createElement('div');
        cell.className = 'card-cell';
        cell.dataset.row = row;
        cell.dataset.col = col;

        if (card[row][col] === null) {
          cell.classList.add('free', 'marked');
          cell.textContent = 'LIBRE';
        } else {
          cell.textContent = card[row][col];
          if (marked[row][col]) {
            cell.classList.add('marked');
          } else if (calledNumbers.includes(card[row][col])) {
            // Number has been called but not yet marked — orange border
            cell.classList.add('called');
          }
          // Allow player to tap/click to toggle marking
          cell.addEventListener('click', () => toggleCell(row, col));
          cell.addEventListener('touchend', (e) => {
            e.preventDefault();
            toggleCell(row, col);
          });
        }
        cardGrid.appendChild(cell);
      }
    }
  }

  // ===== Toggle Cell Marking =====
  function toggleCell(row, col) {
    if (card[row][col] === null) return; // FREE space can't be toggled
    if (gameOver) return; // Can't mark after game over

    const num = card[row][col];
    // Only allow marking if the number has been called
    if (!calledNumbers.includes(num)) {
      // Optional: provide visual feedback that the number hasn't been called yet
      return;
    }

    // Toggle the mark locally and send to server
    marked[row][col] = !marked[row][col];

    // Send mark update to server
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'toggle_mark',
        row,
        col,
        marked: marked[row][col],
      }));
    }

    // Play sound and re-render
    if (marked[row][col]) {
      playMarkSound();
    }
    renderCard();
  }

  // ===== Called Grid =====
  function renderCalledGrid() {
    calledGrid.innerHTML = '';
    for (let n = 1; n <= 75; n++) {
      const cell = document.createElement('div');
      cell.className = 'called-cell';
      cell.textContent = n;
      cell.dataset.num = n;
      if (calledNumbers.includes(n)) {
        cell.classList.add('active');
      }
      calledGrid.appendChild(cell);
    }
  }

  function updateCalledCount() {
    calledCountEl.textContent = calledNumbers.length;
  }

  // ===== Return Button =====
  const returnBtn = document.getElementById('return-btn');
  if (returnBtn) {
    returnBtn.addEventListener('click', () => {
      window.location.href = '/player';
    });
  }

  // ===== Service Worker =====
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
