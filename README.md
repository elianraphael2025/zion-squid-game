# Zion Squid Game Multiplayer

Real-time Red Light, Green Light multiplayer game using Node.js, Express and Socket.IO.

## Files

- `server.js` — multiplayer game server
- `package.json` — dependencies/start command
- `public/index.html` — browser game
- `public/zion.png` — Player 067 character image

## Local test

```bash
npm install
npm start
```

Open http://localhost:3000

## Railway

1. Push this folder to GitHub.
2. In Railway, create/use the `zion-squid-game` project.
3. Deploy the GitHub repository.
4. Railway detects `package.json` and runs `npm start`.
5. Generate a public domain in Railway.
6. Share the generated URL. Players can create/join rooms from that page.

The server binds to `0.0.0.0` and uses Railway's `PORT` environment variable.
