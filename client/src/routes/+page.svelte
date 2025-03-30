<script lang="ts">
  import * as THREE from 'three'
  import { Game } from '$lib/game.svelte'
  import type { ClientEventMove, ControlsState, ServerState } from '@repo/models'
  import equal from 'fast-deep-equal'
  import { onMount } from 'svelte'
  import Stats from 'stats.js'
  import GUI from 'lil-gui';

  const gui = new GUI();

  const GUI_VARS = {
    BLADE_COUNT: 200000,
    BLADE_WIDTH: 0.5,
    BLADE_HEIGHT: 0.2,
    BLADE_HEIGHT_VARIATION: 0.1,
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
    const controlState: ControlsState = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
    }
    if (event.key === 'w' || event.key === 'ArrowUp') {
      controlState.forward = event.type === 'keydown'
    }
    if (event.key === 's' || event.key === 'ArrowDown') {
      controlState.backward = event.type === 'keydown'
    }
    if (event.key === 'a' || event.key === 'ArrowLeft') {
      controlState.left = event.type === 'keydown'
    }
    if (event.key === 'd' || event.key === 'ArrowRight') {
      controlState.right = event.type === 'keydown'
    }
    if (event.key === ' ') { // Space bar for jump
      controlState.jump = event.type === 'keydown';
    }

    const stateSnapshot = $state.snapshot(game.controlsState)
    if (!equal(stateSnapshot, controlState)) {
      // Update the controls state
      game.controlsState = controlState
    }
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

<svelte:window onresize={updateWindowSize} onkeydown={onKeyHandler} onkeyup={onKeyHandler} />
<canvas bind:this={canvas}></canvas>
