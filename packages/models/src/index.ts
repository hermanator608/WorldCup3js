export interface ServerState {
  debugData?: { vertices: Record<number, number>; colors: Record<number, number> }
  connectionIds: string[]
  cubes: Record<
    string,
    {
      position: { x: number; y: number; z: number }
      rotation: { x: number; y: number; z: number; w: number }
      color: number
    }
  >
  balls: Record<
    string,
    {
      position: { x: number; y: number; z: number }
      rotation: { x: number; y: number; z: number; w: number }
      color: number
    }
  >
  ballControllers?: Record<string, string> // Maps ballId to controllerId
  particles?: { color: number, position: { x: number; y: number; z: number } }[]
}

export interface ClientEvent {
  type: 'move' | 'kick'
}

export interface ClientEventMove extends ClientEvent {
  type: 'move'
  controls: ControlsState
}

export interface ClientEventKick extends ClientEvent {
  type: 'kick'
  power: number
}

export interface ControlsState {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  jump: boolean
  mouseRotation?: {
    x: number
    y: number
  }
}
