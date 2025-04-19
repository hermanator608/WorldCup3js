export interface Cube {
  name: string
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
  color: number
  score: number
  moving: boolean
  kicking: boolean
}

export interface ServerState {
  debugData?: { vertices: Record<number, number>; colors: Record<number, number> }
  connectionIds: string[]
  playerNames?: Record<string, string>
  cubes: Record<
    string,
    Cube
  >
  balls: Record<
    string,
    {
      position: { x: number; y: number; z: number }
      rotation: { x: number; y: number; z: number; w: number }
      color: number
    }
  >
  particles?: { color: number, position: { x: number; y: number; z: number } }[]
}

export interface ClientEventMove {
  type: 'move'
  controls: ControlsState
}

export interface ClientEventKick {
  type: 'kick'
  power: number
}

export interface ClientEventStartGame {
  type: 'startGame'
  name: string
}

export type ClientEvent = ClientEventMove | ClientEventKick | ClientEventStartGame;

export interface ControlsState {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  jump: boolean
  mouseRotation?: {
    x: number
    z: number
  }
  joystickRotationAngle?: number;
}
