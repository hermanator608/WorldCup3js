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
  cubes: Record<string, CubeState>
  goalie: GoalieState
  balls: Record<string, BallState>
  particles: ParticleState[]
  roundState: RoundState
}

export interface ClientEventMove {
  type: 'move'
  controls: ControlsState
}

export interface ClientEventKick {
  type: 'kick'
  power: number
  state: 'start' | 'release'
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

export interface RoundState {
  isActive: boolean
  timeRemaining: number  // Time remaining in seconds
  timeTillNextRound: number // Time until next round starts in seconds
  winner?: {
    name: string
    score: number
    color: number
  }
}

export interface CubeState {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
  color: number
  name: string
  score: number
  moving: boolean
  kicking: boolean
}

export type GoalieState = Omit<CubeState, 'name' | 'score' | 'kicking' | 'moving'>;

export interface BallState {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
  color: number
}

export interface ParticleState {
  id: string
  color: number
  position: { x: number; y: number; z: number }
}
