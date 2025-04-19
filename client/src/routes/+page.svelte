<script lang="ts">
  import * as THREE from 'three'
  import { Game } from '$lib/game.svelte'
  import type { ClientEventMove, ControlsState, ServerState, ClientEventKick, ClientEventStartGame, RoundState } from '@repo/models'
  import equal from 'fast-deep-equal'
  import { onMount } from 'svelte'
  import Stats from 'stats.js'
  import GUI from 'lil-gui';
  import nipplejs from 'nipplejs';

  const activeKeys = new Set<string>(); // Track currently pressed keys
  let mousePosition = { x: 0, z: 0 }; // Track mouse position
  let mouseTimeout: number | undefined;
  let mouseHoldStartTime: number | undefined;
  let maxHoldTimeout: number | undefined;
  const maxHoldTime = 500; // Maximum hold time in ms
  let isTouchDevice = $state(false);
  let showStartGame = $state(true);
  let playerName = $state('');
  let backgroundMusic: HTMLAudioElement;
  let isMuted = $state(false);
  let playlist: string[] = [
    '/daily-coffee-upbeat-lofi-groove-242099.mp3',
    '/good-night-lofi-cozy-chill-music-160166.mp3',
    '/upbeat-lo-fi-chill-instrumental-music-royalty-free-195449.mp3',
  ];
  let currentTrackIndex = Math.floor(Math.random() * playlist.length);

  const GUI_VARS = {
    BLADE_COUNT: 200000,
    BLADE_WIDTH: 0.5,
    BLADE_HEIGHT: 0.2,
    BLADE_HEIGHT_VARIATION: 0.7,
  };

  if (import.meta.env.DEV) {
    const gui = new GUI();
    
    gui.add(GUI_VARS, 'BLADE_COUNT');
    gui.add(GUI_VARS, 'BLADE_WIDTH', 0.01, 1);
    gui.add(GUI_VARS, 'BLADE_HEIGHT', 0.01, 1);
    gui.add(GUI_VARS, 'BLADE_HEIGHT_VARIATION', 0.01, 1);
    gui.onChange(() => {
      game.createField();
    });
  }

  let canvas: HTMLCanvasElement | undefined = $state()
  const game = Game.getInstance(GUI_VARS)
  const socket: WebSocket = new WebSocket(import.meta.env.DEV ? `ws://localhost:3000/ws` : `wss://${window.location.hostname}/ws`)

  const viewportSize = {
    width: 0,
    height: 0,
  }

  let roundState = $state<RoundState>({
    isActive: false,
    timeRemaining: 0,
    winner: undefined,
    timeTillNextRound: 30  // Initialize with default time
  });

  // Send move events to the server when the controls state changes
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    game.controlsState

    // Check that the socket is open and user has entered name before sending events
    if (!socket || socket.readyState !== WebSocket.OPEN || showStartGame) {
      return
    }

    const event: ClientEventMove = {
      type: 'move',
      controls: game.controlsState,
    }
    socket.send(JSON.stringify(event))
  })

  function updateWindowSize() {
    // Update sizes
    viewportSize.width = window.innerWidth
    viewportSize.height = window.innerHeight

    if (!game.camera || !game.renderer) return

    game.camera.aspect = viewportSize.width / viewportSize.height
    game.camera.updateProjectionMatrix()

    // Update renderer
    game.renderer.setSize(viewportSize.width, viewportSize.height)
    game.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    // Position the camera
    game.needRender = true
  }

  function onKeyHandler(event: KeyboardEvent) {
    if (event.type === 'keydown') { // TODO: Check only for specifc keys
      activeKeys.add(event.key); // Add the key to the active set
    } else if (event.type === 'keyup') {
      activeKeys.delete(event.key); // Remove the key from the active set
    }

    // Update the control state based on active keys
    const controlState: ControlsState = {
      forward: activeKeys.has('w') || activeKeys.has('ArrowUp'),
      backward: activeKeys.has('s') || activeKeys.has('ArrowDown'),
      left: activeKeys.has('a') || activeKeys.has('ArrowLeft'),
      right: activeKeys.has('d') || activeKeys.has('ArrowRight'),
      jump: activeKeys.has(' '), // Space bar for jump
    };

    const stateSnapshot = $state.snapshot(game.controlsState)
    if (!equal(stateSnapshot, controlState)) {
      // Update the controls state
      game.controlsState = controlState
    }
  }

  function onMouseMove(event: MouseEvent) {
    if (!canvas || !game.camera) return;
    
    // Get canvas position and size
    const rect = canvas.getBoundingClientRect();
    
    // Only process mouse movement if it's within the canvas bounds
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      return;
    }
    
    // Calculate normalized device coordinates (-1 to 1)
    const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Create a raycaster from the camera through the mouse position
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), game.camera);
    
    // Create a plane at y=0 (ground level)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    
    // Find the intersection point
    const intersectionPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectionPoint);
    
    // Update mouse position
    mousePosition = {
      x: intersectionPoint.x,
      z: intersectionPoint.z
    };
    
    // Clear any existing timeout
    if (mouseTimeout) {
      window.clearTimeout(mouseTimeout);
    }
    
    // Set a new timeout to update the controls state
    mouseTimeout = window.setTimeout(() => {
      const stateSnapshot = $state.snapshot(game.controlsState);
      const newState = {
        ...stateSnapshot,
        mouseRotation: mousePosition
      };
      
      if (!equal(stateSnapshot, newState)) {
        game.controlsState = newState;
      }
    }, 16); // ~60fps
  }

  function onMouseDown(event: MouseEvent | TouchEvent) {
    if (!canvas || !game.camera || showStartGame) return;
    
    // Get canvas position and size
    const rect = canvas.getBoundingClientRect();
    
    // Only process if it's within the canvas bounds
    if (
      event instanceof MouseEvent &&
      (event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom)
    ) {
      return;
    } else if (event instanceof TouchEvent && event.type === 'touchstart' && event.touches.length > 0) {
      const touch = event.touches[0];
      if (
        touch.clientX < rect.left ||
        touch.clientX > rect.right ||
        touch.clientY < rect.top ||
        touch.clientY > rect.bottom
      ) {
        return;
      }
    }

    // Start tracking hold time
    mouseHoldStartTime = Date.now();

    // Send kick start event
    if (socket && socket.readyState === WebSocket.OPEN) {
      const event: ClientEventKick = {
        type: 'kick',
        power: 0,
        state: 'start'
      }
      socket.send(JSON.stringify(event))
    }

    // Set timeout to automatically kick at max power
    maxHoldTimeout = window.setTimeout(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        const event: ClientEventKick = {
          type: 'kick',
          power: 1.0, // Maximum power
          state: 'release'
        }
        socket.send(JSON.stringify(event))
      }
      mouseHoldStartTime = undefined;
    }, maxHoldTime);
  }

  function onMouseUp(event: MouseEvent | TouchEvent) {
    if (!canvas || !game.camera || !mouseHoldStartTime || showStartGame) return;
    
    // Get canvas position and size
    const rect = canvas.getBoundingClientRect();
    
    // Only process if it's within the canvas bounds
    if (
      event instanceof MouseEvent &&
      (event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom)
    ) {
      return;
    }

    // Clear the max hold timeout since we're releasing early
    if (maxHoldTimeout) {
      window.clearTimeout(maxHoldTimeout);
      maxHoldTimeout = undefined;
    }

    // Calculate hold duration and normalize power to 0-1
    const holdDuration = Date.now() - mouseHoldStartTime;
    const power = Math.min(1.0, holdDuration / maxHoldTime);

    // Send kick release event to server
    if (socket && socket.readyState === WebSocket.OPEN) {
      const event: ClientEventKick = {
        type: 'kick',
        power: power,
        state: 'release'
      }
      socket.send(JSON.stringify(event))
    }

    // Reset hold tracking
    mouseHoldStartTime = undefined;
  }

  const toggleMute = () => {
    isMuted = !isMuted;
    backgroundMusic.muted = isMuted;
  };

  const playNextTrack = () => {
    currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
    backgroundMusic.src = playlist[currentTrackIndex];
    backgroundMusic.play().catch(error => {
      console.error('Error playing background music:', error);
    });
  };

  onMount(() => {
    isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Initialize stats.js
    const stats = new Stats();
    stats.showPanel(0); // 0: FPS, 1: ms, 2: mb, 3+: custom
    if (import.meta.env.DEV) {
      document.body.appendChild(stats.dom);
    }

    const leftJoystickZone = document.getElementById('left-joystick-zone')
    const rightJoystickZone = document.getElementById('right-joystick-zone')
    if (leftJoystickZone && rightJoystickZone && isTouchDevice) {
      const left = nipplejs.create({
        zone: leftJoystickZone,
        mode: 'static',
        position: { left: '60px', bottom: '60px' },
        color: 'blue',
        size: 100,
        restOpacity: 0.5
      });

      left.on('dir', (evt, data) => {
        if (!data) return;
        
        const controlState: ControlsState = {
          forward: data.direction.angle === 'up',
          right:  data.direction.angle === 'right',
          backward:  data.direction.angle === 'down',
          left:  data.direction.angle === 'left',
          
          jump: false, // Jump is not controlled by the joystick
        };


        const stateSnapshot = $state.snapshot(game.controlsState)
        if (!equal(stateSnapshot, controlState)) {
          // Update the controls state
          game.controlsState = controlState
        }
      });

      left.on('end', () => {
        const controlState: ControlsState = {
          forward: false,
          backward: false,
          left: false,
          right: false,
          jump: false,
        };


        const stateSnapshot = $state.snapshot(game.controlsState)
        if (!equal(stateSnapshot, controlState)) {
          // Update the controls state
          game.controlsState = controlState
        }
      });

      const right = nipplejs.create({
        zone: rightJoystickZone,
        mode: 'static',
        position: { right: '60px', bottom: '60px' },
        color: 'blue',
        size: 100,
        restOpacity: 0.5
      });

      right.on('move', (evt, data) => {
        if (!data) return;

        const angle = data.angle.radian; // Rotation angle in radians

        const stateSnapshot = $state.snapshot(game.controlsState)
        const newState: ControlsState = {
          ...stateSnapshot,
          joystickRotationAngle: angle,
        };
      
        if (!equal(stateSnapshot, newState)) {
          game.controlsState = newState;
        }
      });
    }

    socket.onopen = () => {
      console.log('Connected to the server')
    }

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data)
      
      // Handle regular game state updates
      if (equal(data, game.serverState)) {
        return
      }
      if (data.debugData) {
        game.renderDebug(data.debugData.vertices, data.debugData.colors)
        // return
      }
      game.serverState = data

      // Update round state when receiving server updates
      roundState = data.roundState;
    }

    socket.onerror = (error) => {
      console.error('Error: ', error)
    }

    if (!canvas) {
      throw new Error('Canvas not found')
    }

    game.init(canvas, viewportSize)

    const startTime = Date.now();
    const tick = () => {
      const elapsedTime = Date.now() - startTime;
      stats.begin(); // Start measuring

      if (game.grassMesh) {
        const grassMaterial: THREE.ShaderMaterial = (Array.isArray(game.grassMesh.material) ? game.grassMesh.material[0] : game.grassMesh.material) as THREE.ShaderMaterial;

        grassMaterial.uniforms.iTime.value = elapsedTime;
      }

      game.render()
      game.needRender = false

      stats.end(); // Stop measuring
      window.requestAnimationFrame(tick)
    }

    tick()
    updateWindowSize()

    // Create and configure background music
    backgroundMusic = new Audio(playlist[currentTrackIndex]);
    backgroundMusic.loop = false; // Disable loop since we want to play the next track
    backgroundMusic.volume = 1; // Set volume to 100%
    backgroundMusic.muted = isMuted; // Set initial mute state
    
    // Add event listener for when the current track ends
    backgroundMusic.addEventListener('ended', playNextTrack);
  })

  const startGame = () => {
    if (playerName.trim().length > 0) {
      const event: ClientEventStartGame = {
        type: 'startGame',
        name: playerName.trim()
      }

      socket.send(JSON.stringify(event))
      showStartGame = false;
      
      // Start playing background music
      backgroundMusic.play().catch(error => {
        console.error('Error playing background music:', error);
      });
    }
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
</script>

<svelte:window 
  onresize={updateWindowSize} 
  onkeydown={onKeyHandler} 
  onkeyup={onKeyHandler}
  onmousemove={onMouseMove}
  onmousedown={onMouseDown}
  onmouseup={onMouseUp}
/>
<canvas bind:this={canvas}></canvas>

{#if !showStartGame}
<button
  onclick={toggleMute}
  style="
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    color: white;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    transition: all 0.3s ease;
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  "
  onmouseover={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
  onmouseout={(e) => e.currentTarget.style.transform = 'scale(1)'}
>
  {#if isMuted}
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <line x1="23" y1="9" x2="17" y2="15"></line>
      <line x1="17" y1="9" x2="23" y2="15"></line>
    </svg>
  {:else}
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    </svg>
  {/if}
</button>
{/if}

{#if showStartGame}
<div style="
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.85);
  padding: 30px;
  border-radius: 15px;
  z-index: 100;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  min-width: 300px;
">
  <h2 style="
    color: white;
    margin-bottom: 25px;
    font-size: 24px;
    text-align: center;
    font-weight: 600;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  ">Enter Your Name</h2>
  <input
    type="text"
    bind:value={playerName}
    style="
      padding: 12px 15px;
      font-size: 16px;
      width: 100%;
      margin-bottom: 20px;
      border: none;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      outline: none;
      transition: all 0.3s ease;
    "
    placeholder="Your name"
    onkeydown={(e) => e.key === 'Enter' && startGame()}
  />
  <button
    onclick={startGame}
    style="
      background: linear-gradient(135deg, #4CAF50, #45a049);
      color: white;
      border: none;
      padding: 12px 20px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      border-radius: 8px;
      transition: all 0.3s ease;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    "
    onmouseover={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
    onmouseout={(e) => e.currentTarget.style.transform = 'translateY(0)'}
  >
    Join Game
  </button>
</div>
{/if}

{#if isTouchDevice}
<button
  id="shoot-button"
  style="
    background-color: rgba(255, 0, 0, 0.3);
    border: none;
    color: white;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
    position: absolute;
    bottom: 165px;
    left: 30px;
    width: 100px;
    height: 50px;
    z-index: 10;
  "
  ontouchstart={onMouseDown}
  ontouchend={onMouseUp}
>
  Kick
</button>
{/if}
<div id="left-joystick-zone" style="
  position: absolute;
  bottom: 20px;
  left: 20px;
  width: 150px;
  height: 150px;
  z-index: 10;
"></div>
<div id="right-joystick-zone" style="
  position: absolute;
  bottom: 20px;
  right: 20px;
  width: 150px;
  height: 150px;
  z-index: 10;
"></div>
{#if !isTouchDevice}
<div
  style="
    position: fixed;
    top: 100px;
    left: 20px;
    background: rgba(0, 0, 0, 0.1);
    padding: 15px;
    border-radius: 10px;
    color: white;
    font-family: Arial, sans-serif;
    <!-- backdrop-filter: blur(8px); -->
    border: 1px solid rgba(255, 255, 255, 0.1);
    min-width: 200px;
    z-index: 100;
  "
>
  <h3 style="margin: 0 0 10px 0; font-size: 18px; text-align: center;">Leaderboard</h3>
  <div style="display: flex; flex-direction: column; gap: 5px;">
    {#each Object.entries(game.serverState.cubes)
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, 5) as [id, cube], i}
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: {cube.color}; font-weight: bold;">{cube.name}</span>
        <span style="font-weight: bold;">{cube.score}</span>
      </div>
    {/each}
  </div>
</div>
{/if}

<!-- Add round timer UI -->
{#if !showStartGame}
  <div style="
    position: fixed;
    top: 20px;
    left: 0;
    right: 0;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 15px 25px;
    font-size: 20px;
    font-weight: bold;
    text-align: center;
    z-index: 100;
    backdrop-filter: blur(8px);
  ">
    {#if roundState.isActive}
      Round Started!<br>
      Time Remaining: {formatTime(roundState.timeRemaining)}
    {:else}
      {#if roundState.winner}
        <div style="margin-bottom: 8px;">
          Winner: <span style="color: #{roundState.winner.color.toString(16).padStart(6, '0')}">{roundState.winner.name}</span>
          (Score: {roundState.winner.score})
        </div>
      {/if}
      Next Round In: {formatTime(roundState.timeTillNextRound)}
    {/if}
  </div>
{/if}
