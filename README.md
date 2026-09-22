# Zion — Multiplayer Red Light, Green Light

This is a real multiplayer browser game. The server keeps the room, players,
light state, movement and eliminations synchronized over WebSockets.

## Run locally

1. Install Node.js 18+.
2. In this folder run:
   npm install
   npm start
3. Open http://localhost:3000
4. Create a room and share the room code.

For friends on other devices, the server must be hosted on a public HTTPS-capable
Node host. A static-only host such as GitHub Pages cannot run the WebSocket server.

## Game rules

- GREEN LIGHT: hold the RUN button (or Space / Right Arrow) to move.
- RED LIGHT: freeze. If you are moving when red begins, you are eliminated.
- First living player to reach the finish wins.
- The host can reset the lobby and start another round.

## Customizing

Replace `public/zion.png` with another PNG/JPG if desired. The default player
name is Zion and every displayed player currently uses Zion's supplied avatar.
