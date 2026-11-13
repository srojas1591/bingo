(function () {
  'use strict';

  // ===== WebSocket Connection =====
  let ws = null;
  let connected = false;
  let players = [];
  let calledNumbers = [];
  let gameOver = false;
  let sessionId = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let authCode = null; // Store auth code for reconnection

  // Get the protocol for WebSocket (ws or wss)
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;

  // ===== Initialize when DOM is ready =====
  function init() {
    console.log('[Host] Initializing host view');

    // ===== DOM References =====
    const authScreen = document.getElementById('auth-screen');
    const authForm = document.getElementById('auth-form');
    const accessCodeInput = document.getElementById('access-code');
    const authError = document.getElementById('auth-error');
    const dashboard = document.getElementById('dashboard');
    const statusEl = document.getElementById('status');
    const currentBall = document.getElementById('current-ball');
    const callBtn = document.getElementById('call-btn');
    const newGameBtn = document.getElementById('new-game-btn');
    const calledCountEl = document.getElementById('called-count');
    const calledGrid = document.getElementById('called-grid');
    const classificationBoard = document.getElementById('classification-board');
    const winOverlay = document.getElementById('win-overlay');
    const winMessage = document.getElementById('win-message');
    const playAgainBtn = document.getElementById('play-again-btn');
    const backBtn = document.getElementById('back-btn');

    if (!authScreen || !authForm || !dashboard) {
      console.error('[Host] Missing required DOM elements. Is this the host page?');
      return;
    }

    // Back button — return to index.html
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        window.location.href = '/';
      });
    }

    // ===== Auth Form =====
    authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = accessCodeInput.value.trim();

      if (!code) return;

      // Connect to WebSocket and authenticate
      connectAsHost(code);
    });

    function connectAsHost(code) {
      console.log('[Host] Connecting to WebSocket at:', wsUrl);

      // If there's an existing connection, close it first
      if (ws && ws.readyState === 1) {
        ws.close();
      }

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[Host] WebSocket connected, sending auth');
        reconnectAttempts = 0; // Reset on successful connection
        const authCodeToUse = code || authCode;
        if (authCodeToUse) {
          ws._authCode = authCodeToUse; // Store on ws for game_start handler
          ws.send(JSON.stringify({ type: 'host_auth', code: authCodeToUse }));
        }
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log('[Host] Received:', message.type);
        handleMessage(message);
      };

      ws.onclose = (event) => {
        console.log('[Host] WebSocket disconnected (code:', event.code, ')');
        connected = false;

        // Clear any existing reconnect timer
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        if (!authScreen.classList.contains('hidden')) {
          // Connection failed before auth — show helpful message
          if (event.code === 1006) {
            authError.textContent = 'No se pudo conectar al servidor. Verifica que esté corriendo y recarga la página (Cmd+Shift+R).';
          } else {
            authError.textContent = 'Ya hay un anfitrión activo. Recarga la página (Cmd+Shift+R) para intentar de nuevo.';
          }
          authError.classList.remove('hidden');
        } else {
          // Already authenticated — try to reconnect automatically
          if (authCode) {
            statusEl.textContent = 'Conexión perdida. Reconectando...';
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000); // Exponential backoff, max 10s
            console.log(`[Host] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
            reconnectTimer = setTimeout(() => {
              connectAsHost(authCode);
            }, delay);
          }
        }
      };

      ws.onerror = (err) => {
        console.error('[Host] WebSocket error:', err);
        // Don't show error on auth screen if we already got game_start
        if (!authScreen.classList.contains('hidden')) {
          authError.textContent = 'Error de conexión. Asegúrate de que el servidor esté corriendo.';
          authError.classList.remove('hidden');
        }
      };
    }

    // ===== Message Handler =====
    function handleMessage(message) {
      switch (message.type) {
        case 'auth_failed':
          if (message.reason === 'host_exists') {
            authError.textContent = 'Ya hay un anfitrión activo. Recarga la página (Cmd+Shift+R) para intentar de nuevo.';
          } else {
            authError.textContent = 'Código incorrecto. Intenta de nuevo.';
            accessCodeInput.value = '';
          }
          authError.classList.remove('hidden');
          accessCodeInput.focus();
          // Don't close the WebSocket — let the user retry
          break;

        case 'game_start':
          // Auth successful — show dashboard
          connected = true;
          authScreen.classList.add('hidden');
          dashboard.classList.remove('hidden');
          ensureAudio();
          // Store auth code for reconnection
          authCode = '1591';

          if (message.players) {
            players = message.players;
          }
          if (message.calledNumbers) {
            calledNumbers = message.calledNumbers;
          }
          // Capture session ID
          if (message.sessionId) {
            sessionId = message.sessionId;
            console.log('[Host] Session ID:', sessionId);
          }

          renderCalledGrid();
          renderClassificationBoard();
          updateCallButton();
          statusEl.textContent = 'Presiona "Sacar número" para comenzar';
          break;

        case 'number_called':
          playCallSound();
          currentBall.classList.remove('pop');
          void currentBall.offsetWidth;
          currentBall.textContent = message.label;
          currentBall.classList.add('pop');

          statusEl.innerHTML = `Sacado: <strong>${message.number}</strong> — ${message.label}`;
          calledCountEl.textContent = message.callIndex;
          calledNumbers = message.calledNumbers;

          renderCalledGrid();

          if (message.players) {
            players = message.players;
            renderClassificationBoard();
          }
          break;

        case 'card_update':
          // Card update from a player — classification board already updated via number_called
          break;

        case 'player_joined':
          statusEl.innerHTML = `🎉 <strong>${message.playerName}</strong> se unió al juego`;
          if (message.players) {
            players = message.players;
            renderClassificationBoard();
          }
          updateCallButton();
          break;

        case 'player_left':
          statusEl.textContent = 'Un jugador se desconectó';
          if (message.players) {
            players = message.players;
            renderClassificationBoard();
          }
          updateCallButton();
          break;

        case 'classification_update':
          if (message.players) {
            players = message.players;
            renderClassificationBoard();
          }
          break;

        case 'game_over':
          gameOver = true;
          callBtn.disabled = true;
          // Handle multiple winners
          const winners = message.winners || [];
          const winnerNames = winners.map(w => w.name).join(', ');
          statusEl.innerHTML = `🎉 <strong>¡BINGO!</strong> ¡${winnerNames} ha ganado!`;
          winMessage.textContent = `¡Felicidades ${winnerNames}! ¡Han ganado!`;
          playWinSound();
          setTimeout(() => {
            winOverlay.classList.remove('hidden');
          }, 600);
          break;

        case 'all_numbers_called':
          statusEl.textContent = '¡Se han sacado todos los números!';
          callBtn.disabled = true;
          break;
      }
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

    // ===== Classification Board =====
    function renderClassificationBoard() {
      if (players.length === 0) {
        classificationBoard.innerHTML = '<p class="empty-msg">Aún no hay jugadores.</p>';
        return;
      }

      // Sort by score: patterns weighted more than marks
      const sorted = [...players].sort((a, b) => {
        const aScore = a.markedCount + (a.patterns.rows.length + a.patterns.columns.length + a.patterns.diagonals.length) * 10;
        const bScore = b.markedCount + (b.patterns.rows.length + b.patterns.columns.length + b.patterns.diagonals.length) * 10;
        return bScore - aScore;
      });

      let html = `
        <table class="classification-table">
          <thead>
            <tr>
              <th>Jugador</th>
              <th>Marcados</th>
              <th>Filas</th>
              <th>Columnas</th>
              <th>Diagonales</th>
            </tr>
          </thead>
          <tbody>
      `;

      sorted.forEach((player, idx) => {
        const isLeader = idx === 0;
        html += `
          <tr class="${isLeader ? 'leader' : ''}">
            <td class="player-name-cell">
              ${player.playerName}
              <span class="player-id">#${player.playerId}</span>
            </td>
            <td>${player.markedCount}/25</td>
            <td class="patterns-cell">${renderPatterns(player.patterns.rows, 5)}</td>
            <td class="patterns-cell">${renderPatterns(player.patterns.columns, 5)}</td>
            <td class="patterns-cell">${renderPatterns(player.patterns.diagonals, 2)}</td>
          </tr>
        `;
      });

      html += '</tbody></table>';
      classificationBoard.innerHTML = html;
    }

    function renderPatterns(completed, total) {
      let result = '';
      for (let i = 0; i < total; i++) {
        if (completed.includes(i)) {
          result += '<span class="pattern-check">✓</span> ';
        } else {
          result += '<span class="pattern-empty">○</span> ';
        }
      }
      return result.trim();
    }

    // ===== Call Button State =====
    function updateCallButton() {
      callBtn.disabled = players.length === 0 || gameOver;
      if (players.length === 0 && !gameOver) {
        statusEl.textContent = 'Esperando jugadores...';
      }
    }

    // ===== Event Listeners =====
    callBtn.addEventListener('click', () => {
      if (connected && ws && !gameOver) {
        ws.send(JSON.stringify({ type: 'call_number' }));
      }
    });

    newGameBtn.addEventListener('click', () => {
      if (connected && ws) {
        ws.send(JSON.stringify({ type: 'new_game' }));
        gameOver = false;
        callBtn.disabled = false;
        currentBall.textContent = '--';
        currentBall.classList.remove('pop');
        calledNumbers = [];
        calledCountEl.textContent = '0';
        winOverlay.classList.add('hidden');
        renderCalledGrid();
        statusEl.textContent = 'Nuevo juego iniciado. Presiona "Sacar número"';
      }
    });

    playAgainBtn.addEventListener('click', () => {
      if (connected && ws) {
        ws.send(JSON.stringify({ type: 'new_game' }));
        gameOver = false;
        callBtn.disabled = false;
        currentBall.textContent = '--';
        currentBall.classList.remove('pop');
        calledNumbers = [];
        calledCountEl.textContent = '0';
        winOverlay.classList.add('hidden');
        renderCalledGrid();
        statusEl.textContent = 'Nuevo juego iniciado. Presiona "Sacar número"';
      }
    });

    const returnBtn = document.getElementById('return-btn');
    if (returnBtn) {
      returnBtn.addEventListener('click', () => {
        window.location.href = '/host';
      });
    }

    // ===== Service Worker =====
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      });
    }
  }

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
