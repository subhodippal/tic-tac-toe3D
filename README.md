# Tic Tac Toe 3D

A neon, mobile-first 3D tic tac toe that runs in the browser and installs as a PWA. Built with
[three.js](https://threejs.org/) (with bloom post-processing for the neon glow). It's a static site with no build step,
so it can be hosted on GitHub Pages as-is. Same structure as Ludo 3D.

## Features

- **Boards from 3×3 to 10×10**, with three win rules:
  - **3 in a row**
  - **4 in a row** (4×4 and up)
  - **Square & wrap** (4×4 and up): four in a row, a 2×2 block, or a straight diagonal of four. Rows, columns and blocks wrap round the edges like a Karnaugh map, so the four corners count.
- **2–4 players**, each with a neon symbol: cyan ✕, pink ◯, lime ▲, amber ■. 3×3 fits 2 players, 4×4 fits 3, and 5×5 and up fit 4.
- **Play vs Computer**: Easy, Normal or Hard. On a 2-player 3×3 board it uses perfect minimax, and everywhere else it uses a threat-scoring AI.
- **Pass & Play**: any mix of humans and computers on one device.
- **Online**: create a room and share the 5-letter code or link. Uses WebRTC (PeerJS), so no server of your own is needed. Empty seats are filled by the computer, and if a player drops out the computer takes over. Emoji reactions are included.
- **Rounds and scores**: scores add up across rounds, and the first move passes to the next player each round.
- **Two themes**: Neon (the default) and Paper & Pen. Switch with the Theme toggle on the home menu or in Settings, even mid-game.
  - **Neon**: synthwave glow and bloom.
  - **Paper & pen**: a spiral notebook on a wooden desk with a coffee mug, a pencil, an eraser, sticky notes and a crumpled paper ball, all casting real shadows. The grid is pencil-sketched and the ink is blue and red ballpoint (green and yellow for players 3 and 4). A 3D pen draws every ✕, ◯, ▲ and ■ stroke by stroke, leaving little ink splats, and you hear the pen scratch. All lines gently "boil" like hand-drawn animation, and doodles fill the margins. On a win, the pen strikes through the line (or circles the squares), the winning marks jump and the pen doodles stars around them. A draw gets a "cat's game" cat sketch. Each new round flips the page over to a fresh sheet. The scoreboard is sticky notes and the status is masking tape.
- **Neon 3D**: a synthwave grid floor, a glowing board frame in the colour of the player to move, marks that drop in, a laser strike-through on the winning line (light pillars for square/wrap shapes), fireworks, confetti and synth sound effects. All sounds are generated with Web Audio.
- **Controls**: tap or click a square. Drag to orbit, pinch or scroll to zoom. The layers button (or **V**) switches between 3D and top-down view. **Esc** pauses, and **Enter** starts the next round.
- **Settings**: sound, vibration, *Bloom* or *Battery saver* glow quality, and default camera.
- Local games auto-save and can be continued. Works offline except for online play.

## Run locally

```bash
node server.js            # http://localhost:8080 (no npm install needed)
PORT=3000 node server.js
```

Open `http://<your-computer-ip>:8080` on your phone (same Wi-Fi) to test on mobile.

## Deploy to GitHub Pages

```bash
git add . && git commit -m "Tic Tac Toe 3D"
git remote add origin https://github.com/<you>/tic-tac-toe3D.git
git push -u origin main
```

Then go to **Settings → Pages → Source: Deploy from a branch**, choose `main` / `(root)` and save. All paths are relative, so any repo name works.
**After each deploy, bump `VERSION` in `sw.js`** so installed copies pick up the new files.

## Project layout

```
index.html, css/style.css   UI shell and neon styles
js/main.js     Controller: menus, setup, turns, CPU, online sync, celebrations
js/scene.js    three.js arena: board, marks, bloom, picking, win effects, camera
js/paper.js    Paper & pen theme: notebook texture, ink strokes, drawing animation, 3D pen
js/rules.js    Pure rules engine (sizes, win patterns, scoring)
js/ai.js       Computer opponent
js/net.js      PeerJS host/client
js/audio.js    Procedural synth sound effects
js/bgfx.js, js/fx3d.js, js/anim.js   2D fireworks overlay, 3D particles, tweens
vendor/        three.js r170 + addons, PeerJS 1.5.4 (MIT)
fonts/         Orbitron, Patrick Hand (SIL OFL)
sw.js, manifest.webmanifest, icons/   PWA
```
