<script lang="ts">
  import * as THREE from 'three'
  import { Game } from '$lib/game.svelte'
  import type { ClientEventMove, ControlsState, ServerState, ClientEventKick } from '@repo/models'
  import equal from 'fast-deep-equal'
  import { onMount } from 'svelte'
  import Stats from 'stats.js'
  import GUI from 'lil-gui';

  const activeKeys = new Set<string>(); // Track currently pressed keys
  let mousePosition = { x: 0, y: 0 }; // Track mouse position
  let mouseTimeout: number | undefined;
  let mouseHoldStartTime: number | undefined;
  let maxHoldTimeout: number | undefined;
  const maxHoldTime = 500; // Maximum hold time in ms

  const gui = new GUI();

  const GUI_VARS = {
    BLADE_COUNT: 200000,
    BLADE_WIDTH: 0.5,
    BLADE_HEIGHT: 0.2,
    BLADE_HEIGHT_VARIATION: 0.7,
  };

  gui.add(GUI_VARS, 'BLADE_COUNT');
  gui.add(GUI_VARS, 'BLADE_WIDTH', 0.01, 1);
  gui.add(GUI_VARS, 'BLADE_HEIGHT', 0.01, 1);
  gui.add(GUI_VARS, 'BLADE_HEIGHT_VARIATION', 0.01, 1);

  let canvas: HTMLCanvasElement | undefined = $state()
  const game = Game.getInstance(GUI_VARS)
  const socket = new WebSocket('ws://localhost:3000/ws')

  gui.onChange(() => {
    game.createField();
  });

  const viewportSize = {
    width: 0,
    height: 0,
  }

  // Send move events to the server when the controls state changes
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    game.controlsState

    // Check that the socket is open before sending events
    if (!socket || socket.readyState !== WebSocket.OPEN) {
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
      y: intersectionPoint.z
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

  function onMouseDown(event: MouseEvent) {
    if (!canvas || !game.camera) return;
    
    // Get canvas position and size
    const rect = canvas.getBoundingClientRect();
    
    // Only process if it's within the canvas bounds
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      return;
    }

    // Start tracking hold time
    mouseHoldStartTime = Date.now();

    // Set timeout to automatically kick at max power
    maxHoldTimeout = window.setTimeout(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        const event: ClientEventKick = {
          type: 'kick',
          power: 1.0 // Maximum power
        }
        socket.send(JSON.stringify(event))
      }
      mouseHoldStartTime = undefined;
    }, maxHoldTime);
  }

  function onMouseUp(event: MouseEvent) {
    if (!canvas || !game.camera || !mouseHoldStartTime) return;
    
    // Get canvas position and size
    const rect = canvas.getBoundingClientRect();
    
    // Only process if it's within the canvas bounds
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
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

    // Send kick event to server
    if (socket && socket.readyState === WebSocket.OPEN) {
      const event: ClientEventKick = {
        type: 'kick',
        power: power
      }
      socket.send(JSON.stringify(event))
    }

    // Reset hold tracking
    mouseHoldStartTime = undefined;
  }

  onMount(() => {
    // Initialize stats.js
    const stats = new Stats();
    stats.showPanel(0); // 0: FPS, 1: ms, 2: mb, 3+: custom
    document.body.appendChild(stats.dom);

    socket.onopen = () => {
      console.log('Connected to the server')
    }

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data) as ServerState
      if (equal(data, game.serverState)) {
        return
      }
      if (data.debugData) {
        game.renderDebug(data.debugData.vertices, data.debugData.colors)

        // Do not update the server state if we are rendering debug data
        return
      }
      game.serverState = data
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

      // if (game.needRender) {
        game.render()
        game.needRender = false
      // }

      stats.end(); // Stop measuring
      window.requestAnimationFrame(tick)
    }

    tick()
    updateWindowSize()
  })
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
