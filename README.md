# World Cup Soccer Game

[WorldCup3JS](https://worldcup3js.dev)

# TODO:
* Add ability to curve shot
* Add player animations for strafing/kick
* Joysticks float instead of fixed?
* Persist all-time highs across server restarts

This repository provides a starting point for building a web-based multiplayer game, utilizing modern web development technologies. The project is implemented in [TypeScript](https://www.typescriptlang.org), powered by [pnpm](https://pnpm.io) for package management and [Turborepo](https://turbo.build) for efficient monorepo workflows. Code quality is maintained using [Prettier](https://prettier.io) and [ESLint](https://eslint.org).

World Cup Soccer Game is a small multiplayer 3D soccer game: join the match, move your player, dribble/kick, and score against a server-controlled goalie. The game runs in timed rounds (with a short break between) and shows both a per-round leaderboard and an all-time high score while the server is running.

The core idea is still server-authoritative simulation: physics and game state live on the server for fair play, while the client renders the scene, collects input (desktop + mobile), and sends control updates over WebSockets.

## Getting Started

```bash
# Clone the repository
git clone git@github.com:martinhjartmyr/multiplayer-web-game-starter.git

# Navigate to the project directory
cd multiplayer-web-game-starter

# Install dependencies
pnpm install

# Run development servers
pnpm run dev

# (Optional) Run the development servers in Debug Mode
pnpm run dev:debug
```

## Project Structure

The project consists of two main components:

- **Server (Backend):** Handles WebSocket communication, physics simulations, and game state management.
- **Client (Frontend):** Renders the 3D environment, processes user input, and sends it to the server via WebSockets.

## Technologies

### Server (Backend)

- **[Node.js](https://nodejs.org):** JavaScript runtime for the server.
- **[Hono](https://hono.dev):** Lightweight web framework for WebSocket and API handling.
- **[Rapier](https://rapier.rs):** High-performance physics engine for collision detection and simulation.

### Client (Frontend)

- **[Svelte](https://svelte.dev):** Framework for building web applications.
- **[Three.js](https://threejs.org):** Library for 3D rendering and animations.

## Features

- **Multiplayer Support:** Multiple players can join the game simultaneously.
- **Physics-Driven Interactions:** Server-side collision detection powered by Rapier.
- **Real-Time Synchronization:** Player positions and rotations are broadcasted to all connected clients.
- **User Input Handling:** The client processes user input and communicates it to the server using WebSockets.
- **Rounds:** 60s rounds with a 30s break; scores reset each round.
- **Leaderboards:** Current-round leaderboard + all-time high score (best score across rounds while the server is running).
- **Kick + Tackle/Steal:** Kicking near another player can knock/steal the ball.
- **Reset Player:** In-game reset button (server-enforced cooldown) to respawn.
- **Goalie:** Server-side goalie AI with catch + kick-back behavior.

## Controls

### Desktop

- **Move:** WASD / Arrow keys
- **Aim:** Mouse (your cube faces the cursor)
- **Jump:** Space
- **Kick:** Click and hold to charge, release to shoot
- **Tackle/Steal:** Kick near a player to steal

### Mobile

- **Move:** Left joystick
- **Aim:** Right joystick
- **Kick:** Tap/hold and release
- **Tackle/Steal:** Kick near a player to steal

### In-game Help

- Use the **Help** button to reopen controls + round rules while playing.
- The last 5 seconds before a new round starts shows a full-screen countdown.
