
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const COLORS = ["#f7c948","#61dafb","#ff7b9c","#9be564","#c7a4ff","#ff9f68","#7ee0b5","#f78fb3"];

function roomCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms.has(c));
  return c;
}
function safeName(name) {
  name = String(name || "Player").trim().slice(0, 18);
  return name || "Player";
}
function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    light: room.light,
    timeLeft: Math.max(0, Math.ceil((room.phaseEnds - Date.now()) / 1000)),
    winner: room.winner || null,
    players: [...room.players.values()].map(p => ({
      id:p.id, name:p.name, x:p.x, alive:p.alive, finished:p.finished, host:p.host, color:p.color
    }))
  };
}
function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}
function sendState(room) { broadcast(room, {type:"state", room: publicRoom(room)}); }

function startGame(room) {
  room.phase = "playing";
  room.winner = null;
  room.light = "green";
  room.phaseEnds = Date.now() + 4000;
  for (const p of room.players.values()) {
    p.x = 0; p.alive = true; p.finished = false; p.moving = false;
  }
  sendState(room);
}

function finishIfNeeded(room) {
  for (const p of room.players.values()) {
    if (p.alive && !p.finished && p.x >= 100) {
      p.x = 100; p.finished = true; p.moving = false;
      room.winner = p.name;
      room.phase = "finished";
      room.light = "red";
      room.phaseEnds = Infinity;
      sendState(room);
      return true;
    }
  }
  return false;
}

function tickRoom(room) {
  if (room.phase !== "playing") return;
  const now = Date.now();

  // Move players while green.
  if (room.light === "green") {
    for (const p of room.players.values()) {
      if (p.alive && p.moving && !p.finished) p.x = Math.min(100, p.x + 1.15);
    }
    if (finishIfNeeded(room)) return;
  }

  if (now >= room.phaseEnds) {
    if (room.light === "green") {
      room.light = "red";
      room.phaseEnds = now + 2500;
      // Anyone still holding/moving when red begins is caught.
      for (const p of room.players.values()) {
        if (p.alive && p.moving && !p.finished) {
          p.alive = false;
          p.moving = false;
        }
      }
    } else {
      room.light = "green";
      room.phaseEnds = now + 4000;
    }
    sendState(room);
  } else {
    // During red, a movement message is enough to eliminate a player.
    // The server also sends periodic state updates for smooth clients.
  }
}

setInterval(() => {
  for (const room of rooms.values()) {
    tickRoom(room);
    if (room.phase === "playing") sendState(room);
  }
}, 100);

const server = http.createServer((req, res) => {
  let file = req.url.split("?")[0];
  if (file === "/") file = "/index.html";
  const filePath = path.join(__dirname, "public", path.normalize(file));
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(filePath);
    const type = ext === ".html" ? "text/html; charset=utf-8" :
                 ext === ".png" ? "image/png" :
                 ext === ".js" ? "text/javascript" :
                 "application/octet-stream";
    res.writeHead(200, {"Content-Type": type});
    res.end(data);
  });
});

const wss = new WebSocket.Server({server});
wss.on("connection", ws => {
  const id = crypto.randomUUID();
  let player = null;
  let room = null;

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "create") {
      if (room) return;
      const code = roomCode();
      room = {
        code, phase:"lobby", light:"green", phaseEnds:0, winner:null,
        players:new Map()
      };
      player = {
        id, ws, name:safeName(msg.name || "Zion"), x:0, alive:true,
        finished:false, moving:false, host:true, color:COLORS[0]
      };
      room.players.set(id, player);
      rooms.set(code, room);
      ws.send(JSON.stringify({type:"joined", id, code, host:true}));
      sendState(room);
      return;
    }

    if (msg.type === "join") {
      if (room) return;
      const code = String(msg.code || "").toUpperCase().trim();
      room = rooms.get(code);
      if (!room || room.phase !== "lobby") {
        ws.send(JSON.stringify({type:"error", message:"That room does not exist or has already started."}));
        room = null;
        return;
      }
      player = {
        id, ws, name:safeName(msg.name || "Player"), x:0, alive:true,
        finished:false, moving:false, host:false,
        color:COLORS[room.players.size % COLORS.length]
      };
      room.players.set(id, player);
      ws.send(JSON.stringify({type:"joined", id, code, host:false}));
      sendState(room);
      return;
    }

    if (!room || !player) return;

    if (msg.type === "start" && player.host && room.phase === "lobby") {
      startGame(room);
      return;
    }
    if (msg.type === "move") {
      if (room.phase !== "playing" || !player.alive || player.finished) return;
      const moving = !!msg.moving;
      if (room.light === "red" && moving) {
        player.alive = false;
        player.moving = false;
        sendState(room);
      } else {
        player.moving = moving;
      }
      return;
    }
    if (msg.type === "reset" && player.host) {
      room.phase = "lobby"; room.light = "green"; room.winner = null; room.phaseEnds = 0;
      for (const p of room.players.values()) {
        p.x=0; p.alive=true; p.finished=false; p.moving=false;
      }
      sendState(room);
    }
  });

  ws.on("close", () => {
    if (!room || !player) return;
    room.players.delete(player.id);
    if (room.players.size === 0) {
      rooms.delete(room.code);
    } else if (player.host) {
      const next = room.players.values().next().value;
      next.host = true;
      sendState(room);
    } else {
      sendState(room);
    }
  });
});

server.listen(PORT, () => console.log(`Zion Squid Multiplayer running on port ${PORT}`));
