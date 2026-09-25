const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));

function code() {
  let c;
  do c = Math.floor(100000 + Math.random() * 900000).toString();
  while (rooms.has(c));
  return c;
}

function roomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    phase: room.phase,
    hard: room.hard,
    timeLeft: Math.max(0, Math.ceil((room.endAt - Date.now()) / 100) / 10),
    phaseEndsIn: Math.max(0, room.phaseEnd - Date.now()),
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, number: p.number, x: p.x,
      alive: p.alive, ready: p.ready
    }))
  };
}

function broadcast(room) {
  io.to(room.code).emit("state", roomState(room));
}

function setPhase(room, phase) {
  room.phase = phase;
  const min = phase === "green" ? (room.hard ? 900 : 1700) : (room.hard ? 700 : 1200);
  const max = phase === "green" ? (room.hard ? 1700 : 3300) : (room.hard ? 1300 : 2800);
  room.phaseEnd = Date.now() + min + Math.random() * (max - min);
  clearTimeout(room.phaseTimer);
  room.phaseTimer = setTimeout(() => tickPhase(room), room.phaseEnd - Date.now());
  broadcast(room);
}

function tickPhase(room) {
  if (room.status !== "playing") return;
  setPhase(room, room.phase === "green" ? "red" : "green");
}

function finish(room, result) {
  room.status = result;
  clearTimeout(room.phaseTimer);
  room.endAt = Date.now();
  broadcast(room);
}

function maybeStart(room) {
  const players = [...room.players.values()];
  if (room.status !== "lobby" || players.length < 1 || !players.every(p => p.ready)) return;
  room.status = "countdown";
  room.countdownEnd = Date.now() + 3000;
  broadcast(room);
  clearTimeout(room.startTimer);
  room.startTimer = setTimeout(() => {
    if (room.status !== "countdown") return;
    room.status = "playing";
    room.startedAt = Date.now();
    room.endAt = Date.now() + (room.hard ? 40000 : 60000);
    setPhase(room, "green");
    broadcast(room);
  }, 3000);
}

function eliminateMovingPlayers(room) {
  if (room.status !== "playing" || room.phase !== "red") return;
  for (const p of room.players.values()) {
    if (p.alive && p.movedDuringRed) {
      p.alive = false;
      p.movedDuringRed = false;
      io.to(p.id).emit("eliminated", { reason: "You moved during RED LIGHT." });
    }
  }
  broadcast(room);
}

const phaseCheck = setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status !== "playing") continue;
    if (Date.now() >= room.endAt) {
      finish(room, "lost");
      continue;
    }
    if (room.phase === "red") eliminateMovingPlayers(room);
    const alive = [...room.players.values()].filter(p => p.alive);
    const winner = alive.find(p => p.x >= 1000);
    if (winner) {
      winner.alive = true;
      room.winnerId = winner.id;
      finish(room, "won");
    } else if (!alive.length) {
      finish(room, "lost");
    }
  }
}, 100);

io.on("connection", socket => {
  socket.on("createRoom", ({ name, hard }) => {
    const roomCode = code();
    const room = {
      code: roomCode, hostId: socket.id, status: "lobby", phase: "red",
      phaseEnd: 0, endAt: 0, hard: !!hard, players: new Map()
    };
    rooms.set(roomCode, room);
    addPlayer(socket, room, name || "Player");
  });

  socket.on("joinRoom", ({ code: roomCode, name }) => {
    const room = rooms.get(String(roomCode || "").trim());
    if (!room) return socket.emit("errorMessage", "Room not found.");
    if (room.status !== "lobby") return socket.emit("errorMessage", "That game has already started.");
    if (room.players.size >= MAX_PLAYERS) return socket.emit("errorMessage", "Room is full.");
    addPlayer(socket, room, name || "Player");
  });

  socket.on("ready", () => {
    const room = socket.room && rooms.get(socket.room);
    const p = room?.players.get(socket.id);
    if (!room || !p) return;
    p.ready = !p.ready;
    maybeStart(room);
    broadcast(room);
  });

  socket.on("move", () => {
    const room = socket.room && rooms.get(socket.room);
    const p = room?.players.get(socket.id);
    if (!room || !p || room.status !== "playing" || !p.alive) return;
    if (room.phase === "red") {
      p.movedDuringRed = true;
      return;
    }
    p.x = Math.min(1000, p.x + (room.hard ? 7 : 11));
    broadcast(room);
  });

  socket.on("restart", () => {
    const room = socket.room && rooms.get(socket.room);
    if (!room || room.hostId !== socket.id) return;
    clearTimeout(room.phaseTimer);
    clearTimeout(room.startTimer);
    room.status = "lobby"; room.phase = "red"; room.winnerId = null;
    for (const p of room.players.values()) {
      p.x = 120; p.alive = true; p.ready = false; p.movedDuringRed = false;
    }
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = socket.room && rooms.get(socket.room);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.hostId === socket.id) {
      const next = room.players.values().next().value;
      room.hostId = next?.id || null;
    }
    if (!room.players.size) {
      clearTimeout(room.phaseTimer);
      clearTimeout(room.startTimer);
      rooms.delete(room.code);
    } else broadcast(room);
  });
});

function addPlayer(socket, room, name) {
  const nums = [...room.players.values()].map(p => p.number);
  let number = nums.includes("067") ? "456" : "067";
  if (number === "456") {
    const candidates = ["143","218","321","198","109","333","512","777"];
    number = candidates.find(n => !nums.includes(n)) || String(100 + room.players.size);
  }
  const player = {
    id: socket.id, name: String(name).slice(0, 18),
    number, x: 120, alive: true, ready: false, movedDuringRed: false
  };
  room.players.set(socket.id, player);
  socket.join(room.code);
  socket.room = room.code;
  socket.emit("joined", { code: room.code, you: player.id });
  broadcast(room);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Zion Squid Game listening on port ${PORT}`);
});
