import type { Mat3, Vec3 } from './math';

/** Motor electrical/mechanical model parameters. */
export interface MotorSpec {
  id: string;
  name: string;
  kind: 'brushed' | 'brushless';
  /** Speed constant [rpm/V]. */
  kv: number;
  /** Winding resistance incl. driver [ohm]. */
  resistance: number;
  /** No-load current [A]. */
  noLoadCurrent: number;
  /** Mechanical time constant with typical prop [s]. */
  timeConstant: number;
  /** Continuous max current [A]. */
  maxCurrent: number;
  /** Mass [kg]. */
  mass: number;
  /** Can diameter / length [m] (for 3D + mass props). */
  diameter: number;
  length: number;
  /** Shaft diameter [m]. */
  shaftDiameter: number;
  /** Market availability (multi-vendor generic part = common). */
  availability?: Availability;
}

export type Availability = 'common' | 'limited';

export interface PropSpec {
  id: string;
  name: string;
  /** Diameter [m]. */
  diameter: number;
  /** Pitch [m]. */
  pitch: number;
  blades: number;
  /** Thrust coefficient CT (T = CT rho n^2 D^4, n in rev/s). */
  ct: number;
  /** Power coefficient CP (P = CP rho n^3 D^5). */
  cp: number;
  mass: number;
  /** Shaft bore [m]. */
  bore: number;
  availability?: Availability;
}

export interface RotorSpec {
  /** Rotor hub position in body FLU frame relative to CG [m]. */
  position: Vec3;
  /** +1 = CCW seen from above. */
  spin: 1 | -1;
  motor: MotorSpec;
  prop: PropSpec;
}

export interface BatterySpec {
  id: string;
  name: string;
  cells: number;
  capacityAh: number;
  /** Pack internal resistance incl. connector [ohm]. */
  internalResistance: number;
  mass: number;
  cellVoltageMin: number;
  cellVoltageNominal: number;
  cellVoltageMax: number;
  maxDischargeC: number;
  /** Box dimensions [m] (length along x, width, height). */
  size: Vec3;
  connector: string;
}

export interface SensorSpec {
  /** Gyro white noise std per sample [rad/s]. */
  gyroStd: number;
  /** Gyro bias random walk [rad/s/sqrt(s)]. */
  gyroBiasWalk: number;
  /** Accelerometer white noise std [m/s^2]. */
  accelStd: number;
  /** Constant accel bias magnitude [m/s^2]. */
  accelBias: number;
  /** Horizontal position sensor noise [m] and rate [Hz]. */
  posStd: number;
  posRateHz: number;
  /** Horizontal position drift random walk [m/sqrt(s)] (optical flow integration). */
  posDriftWalk: number;
  /** Altitude sensor (ToF/baro) noise [m] and rate [Hz]. */
  altStd: number;
  altRateHz: number;
  /** Heading (magnetometer / flow-yaw) noise [rad]. */
  yawStd: number;
  /** Battery voltage ADC noise [V]. */
  voltStd: number;
}

/** Controller gains in bandwidth form (independent of mass/inertia). */
export interface ControllerGains {
  posP: Vec3;
  velP: Vec3;
  velI: Vec3;
  velD: Vec3;
  attP: Vec3;
  rateP: Vec3;
  rateI: Vec3;
  rateD: Vec3;
  /** Rate-loop D-term low-pass cutoff [Hz]. */
  rateDCutoffHz: number;
  maxTiltRad: number;
  maxHorizSpeed: number;
  maxVertSpeed: number;
  maxHorizAccel: number;
  maxRate: Vec3;
  /** Integrator limits (in accel units / angular accel units). */
  velIntLimit: number;
  rateIntLimit: number;
}

export interface DroneParams {
  name: string;
  /** Total mass [kg]. */
  mass: number;
  /** Inertia about CG in body frame [kg m^2]. */
  inertia: Mat3;
  rotors: RotorSpec[];
  battery: BatterySpec;
  /** Fuselage drag area Cd*A [m^2]. */
  dragArea: number;
  /** Rotor-induced linear drag at hover speed [N/(m/s)]. */
  rotorDrag: number;
  /** Sphere radius for obstacle collision [m]. */
  collisionRadius: number;
  /** Height of CG above landing gear contact [m]. */
  gearHeight: number;
  sensors: SensorSpec;
  gains: ControllerGains;
  /** Failsafe landing threshold per cell under load [V]. */
  landCellVoltage: number;
  physicsRateHz: number;
  controlRateHz: number;
}

export interface WindSpec {
  /** Mean wind velocity (world ENU) [m/s]. */
  mean: Vec3;
  /** Gust std per axis [m/s]. */
  gustStd: number;
  /** Gust correlation time [s]. */
  gustTau: number;
}

export interface EnvironmentSpec {
  gravity: number;
  airDensity: number;
  wind: WindSpec;
  groundFriction: number;
  /** Planner / world bounds. */
  boundsMin: Vec3;
  boundsMax: Vec3;
}

export type Obstacle =
  | { kind: 'box'; id: string; center: Vec3; size: Vec3 }
  | { kind: 'cylinder'; id: string; base: Vec3; radius: number; height: number };

export interface CourseSpec {
  name: string;
  start: Vec3;
  goal: Vec3;
  /** Explicit waypoints (world). If empty and plan=true, path is planned start->goal. */
  waypoints: Vec3[];
  cruiseAltitude: number;
  cruiseSpeed: number;
  planPath: boolean;
  obstacles: Obstacle[];
  /** Hover duration at the end of the mission [s]. */
  hoverTime: number;
  land: boolean;
}
