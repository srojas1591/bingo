# Bingo en Español — Multiplayer 🎱

Juego de Bingo en español para móviles con modo **multiplayer en tiempo real**. Un anfitrión controla el juego y los jugadores se unen desde sus propios dispositivos a través de una red local.

## Características

- **Modo Anfitrión**: Controla el juego, saca números y monitorea la clasificación
- **Modo Jugador**: Cada jugador tiene su propio cartón en su dispositivo
- **Tiempo real**: Sincronización instantánea vía WebSocket
- **Código QR**: Los jugadores se unen escaneando el código QR del anfitrión
- **Tabla de clasificación**: El anfitrión ve marcados y patrones completados de cada jugador
- **Efectos de sonido**: Sonidos al sacar números, marcar casillas y ganar
- **Cartón de Bingo 5×5** con espacio LIBRE en el centro
- **Detección de Bingo** — filas, columnas y diagonales
- **Diseño responsivo** optimizado para móviles
- **Instalable** como app nativa (PWA)

## Requisitos

- **Node.js** 16+ instalado en tu máquina

## Instalación

```bash
# Instala las dependencias del servidor
cd server
npm install
```

## Cómo ejecutar

```bash
# Inicia el servidor (desde la carpeta server)
cd server
npm start
```

El servidor se ejecuta en `http://localhost:3000`.

## Cómo jugar

### Como Anfitrión

1. Abre `http://localhost:3000/host` en tu navegador
2. Ingresa el código de acceso: **1591**
3. Comparte el código QR o la URL con los jugadores
4. Presiona **"Sacar número"** para comenzar
5. Monitorea la tabla de clasificación en tiempo real

### Como Jugador

1. Escanea el código QR del anfitrión o abre `http://localhost:3000/player`
2. Ingresa tu nombre (se genera un ID de 5 dígitos automáticamente)
3. Recibe tu cartón de Bingo
4. Los números se marcan automáticamente cuando el anfitrión los saca
5. ¡Grita **¡BINGO!** cuando completes una línea!

### Jugar en red local

Para jugar desde diferentes dispositivos en la misma red WiFi:

1. Encuentra la IP de tu máquina:
   ```bash
   # En macOS/Linux
   ipconfig getifaddr en0
   
   # En Windows
   ipconfig
   ```
2. Los jugadores abren `http://TU_IP:3000/player` en sus dispositivos
3. El anfitrión abre `http://TU_IP:3000/host`

## Estructura del proyecto

```
bingo-project/
├── server/
│   ├── server.js          # Servidor Node.js + WebSocket
│   └── package.json       # Dependencias
├── index.html             # Página de inicio (router)
├── views/
│   ├── host.html          # Vista del anfitrión
│   └── player.html        # Vista del jugador
├── styles/
│   ├── host.css           # Estilos del anfitrión
│   └── player.css         # Estilos del jugador
├── js/
│   ├── host.js            # Lógica del anfitrión
│   ├── player.js          # Lógica del jugador
│   └── shared.js          # Utilidades compartidas (sonidos)
├── manifest.json          # Configuración PWA
├── sw.js                  # Service Worker
├── icon-192.png, icon-512.png  # Iconos PWA
└── README.md              # Este archivo
```

## Tecnologías

- HTML5, CSS3, JavaScript vanilla (sin frameworks)
- Node.js + WebSocket (`ws`) para comunicación en tiempo real
- Progressive Web App (PWA)
- Service Worker para caché offline
- Diseño mobile-first responsivo
