import { m3Diag, v3 } from './math';
import type { Mat3, Vec3 } from './math';
import type {
  BatterySpec,
  ControllerGains,
  CourseSpec,
  DroneParams,
  EnvironmentSpec,
  MotorSpec,
  PropSpec,
  RotorSpec,
  SensorSpec,
} from './types';
import { findBattery, findMotor, findProp } from './propulsion-catalog';

export const PHYSICAL = {
  gravity: 9.80665,
  airDensitySeaLevel: 1.225,
} as const;

/** Rotor layout rules used by both the simulator presets and the airframe generator. */
export const LAYOUT_RULES = {
  /** Minimum gap between adjacent prop disks [m]. */
  propGap: 0.01,
} as const;

export const SENSORS_MICRO: SensorSpec = {
  gyroStd: 0.01,
  gyroBiasWalk: 0.0005,
  accelStd: 0.15,
  accelBias: 0.05,
  posStd: 0.02,
  posRateHz: 50,
  posDriftWalk: 0.003,
  altStd: 0.01,
  altRateHz: 50,
  yawStd: 0.02,
  voltStd: 0.01,
};

export const SENSORS_GNSS: SensorSpec = {
  ...SENSORS_MICRO,
  posStd: 0.05,
  posRateHz: 10,
  posDriftWalk: 0.01,
  altStd: 0.05,
  altRateHz: 25,
};

/**
 * Consumer GNSS (u-blox M10 class) + magnetometer + barometer, typical open-sky values:
 * ~1 m CEP slowly wandering position error, baro drift of a few decimetres.
 */
export const SENSORS_GNSS_M10: SensorSpec = {
  ...SENSORS_MICRO,
  posStd: 0.3,
  posRateHz: 10,
  posDriftWalk: 0,
  posBiasStd: 1.0,
  posBiasTau: 60,
  altStd: 0.15,
  altRateHz: 25,
  altBiasStd: 0.3,
  altBiasTau: 120,
  yawStd: 0.05,
};

export const GAINS_DEFAULT: ControllerGains = {
  posP: v3(1.2, 1.2, 1.5),
  velP: v3(2.8, 2.8, 5),
  velI: v3(0.8, 0.8, 2),
  velD: v3(0.05, 0.05, 0.05),
  attP: v3(7, 7, 3),
  rateP: v3(16, 16, 8),
  rateI: v3(10, 10, 3),
  rateD: v3(0.25, 0.25, 0),
  rateDCutoffHz: 30,
  maxTiltRad: (35 * Math.PI) / 180,
  maxHorizSpeed: 1.5,
  maxVertSpeed: 1.0,
  maxHorizAccel: 4,
  maxRate: v3(4, 4, 2),
  velIntLimit: 3,
  rateIntLimit: 30,
};

/** Minimum arm length (hub distance from center) so adjacent props of an N-rotor star don't overlap. */
export const minArmLength = (n: number, propDiameter: number, gap: number = LAYOUT_RULES.propGap): number =>
  (propDiameter + gap) / (2 * Math.sin(Math.PI / n));

/**
 * Star layout rotors (quad-X, hexa-X, octo-X). Rotor 0 is front-right, indices increase counter-clockwise
 * (seen from above). Adjacent rotors counter-rotate; rotor 0 spins CCW (PX4 quad-X convention).
 */
export const starRotors = (
  n: number,
  armLength: number,
  motor: MotorSpec,
  prop: PropSpec,
  hubHeight = 0.01,
): RotorSpec[] => {
  const rotors: RotorSpec[] = [];
  for (let i = 0; i < n; i++) {
    // start at front-right (-45 deg for quad), walk counter-clockwise
    const angle = -Math.PI / 2 + Math.PI / n + (2 * Math.PI * i) / n;
    const position: Vec3 = v3(armLength * Math.cos(angle), armLength * Math.sin(angle), hubHeight);
    // front-right spins CCW (+1), then alternate
    const spin: 1 | -1 = i % 2 === 0 ? 1 : -1;
    rotors.push({ position, spin, motor, prop });
  }
  return rotors;
};

interface MultirotorOptions {
  name: string;
  rotorCount: number;
  motorId: string;
  propId: string;
  batteryId: string;
  mass: number;
  inertia: Mat3;
  armLength?: number;
  sensors?: SensorSpec;
  gains?: ControllerGains;
  dragArea?: number;
  rotorDrag?: number;
  gearHeight?: number;
}

export const buildMultirotor = (o: MultirotorOptions): DroneParams => {
  const motor = findMotor(o.motorId);
  const prop = findProp(o.propId);
  const battery: BatterySpec = findBattery(o.batteryId);
  const arm = o.armLength ?? minArmLength(o.rotorCount, prop.diameter);
  return {
    name: o.name,
    mass: o.mass,
    inertia: o.inertia,
    rotors: starRotors(o.rotorCount, arm, motor, prop),
    battery,
    dragArea: o.dragArea ?? 0.004,
    rotorDrag: o.rotorDrag ?? 0.02 * o.mass * 10,
    collisionRadius: arm + prop.diameter / 2,
    gearHeight: o.gearHeight ?? 0.015,
    sensors: o.sensors ?? SENSORS_MICRO,
    gains: o.gains ?? GAINS_DEFAULT,
    landCellVoltage: 3.3,
    physicsRateHz: 1000,
    controlRateHz: 500,
  };
};

/** Class A reference: ~65 g micro quad, brushed 8520 motors, 65 mm props, 1S 600 mAh. */
export const PRESET_MICRO_QUAD = (): DroneParams =>
  buildMultirotor({
    name: 'Class A 参照機（マイクロ・クアッド 8520/65mm/1S）',
    rotorCount: 4,
    motorId: 'coreless-0820',
    propId: 'prop-65',
    batteryId: 'lipo-1s-600',
    mass: 0.065,
    inertia: m3Diag(4.0e-5, 4.0e-5, 7.0e-5),
    dragArea: 0.0025,
  });

/** Hexa variant to exercise generic N-rotor allocation. */
export const PRESET_MICRO_HEXA = (): DroneParams =>
  buildMultirotor({
    name: 'マイクロ・ヘキサ 716/46mm/1S',
    rotorCount: 6,
    motorId: 'coreless-0716',
    propId: 'prop-46',
    batteryId: 'lipo-1s-600',
    mass: 0.06,
    inertia: m3Diag(4.5e-5, 4.5e-5, 8.0e-5),
    dragArea: 0.0025,
  });

/** Class B reference: 250-class brushless quad (off-the-shelf ESC), 3S. */
export const PRESET_250_QUAD = (): DroneParams =>
  buildMultirotor({
    name: 'Class B 参照機（250級ブラシレス 2204/5045/3S）',
    rotorCount: 4,
    motorId: 'bl-2204-2300',
    propId: 'prop-5045',
    batteryId: 'lipo-3s-1300',
    mass: 0.6,
    inertia: m3Diag(2.5e-3, 2.5e-3, 4.5e-3),
    sensors: SENSORS_GNSS,
    dragArea: 0.012,
    gearHeight: 0.03,
  });

export const DRONE_PRESETS: Record<string, () => DroneParams> = {
  'micro-quad': PRESET_MICRO_QUAD,
  'micro-hexa': PRESET_MICRO_HEXA,
  '250-quad': PRESET_250_QUAD,
};

export const ENV_CALM = (): EnvironmentSpec => ({
  gravity: PHYSICAL.gravity,
  airDensity: PHYSICAL.airDensitySeaLevel,
  wind: { mean: v3(0, 0, 0), gustStd: 0, gustTau: 1.5 },
  groundFriction: 0.6,
  boundsMin: v3(-6, -4, 0),
  boundsMax: v3(6, 4, 3.5),
});

export const ENV_WINDY = (): EnvironmentSpec => ({
  ...ENV_CALM(),
  wind: { mean: v3(3, 0, 0), gustStd: 1, gustTau: 1.5 },
});

export const COURSE_HOVER = (): CourseSpec => ({
  name: 'ホバリング 1 m',
  start: v3(0, 0, 0),
  goal: v3(0, 0, 0),
  waypoints: [],
  cruiseAltitude: 1,
  cruiseSpeed: 0.8,
  planPath: false,
  obstacles: [],
  hoverTime: 10,
  land: false,
});

export const COURSE_SQUARE = (): CourseSpec => ({
  name: '正方形コース 2 m',
  start: v3(0, 0, 0),
  goal: v3(0, 0, 0),
  waypoints: [v3(1, -1, 1), v3(1, 1, 1), v3(-1, 1, 1), v3(-1, -1, 1), v3(1, -1, 1)],
  cruiseAltitude: 1,
  cruiseSpeed: 0.8,
  planPath: false,
  obstacles: [],
  hoverTime: 2,
  land: true,
});

export const COURSE_OBSTACLES = (): CourseSpec => ({
  name: '障害物コース',
  start: v3(-4.5, -2, 0),
  goal: v3(4.5, 2, 0),
  waypoints: [],
  cruiseAltitude: 1.2,
  cruiseSpeed: 1.0,
  planPath: true,
  obstacles: [
    // wall with a doorway in the middle
    { kind: 'box', id: 'wall-a', center: v3(-1.5, -2.25, 1.5), size: v3(0.2, 3.5, 3) },
    { kind: 'box', id: 'wall-b', center: v3(-1.5, 2.75, 1.5), size: v3(0.2, 2.5, 3) },
    // pillars
    { kind: 'cylinder', id: 'pillar-1', base: v3(1, -1, 0), radius: 0.3, height: 3 },
    { kind: 'cylinder', id: 'pillar-2', base: v3(2.2, 1.2, 0), radius: 0.35, height: 3 },
    { kind: 'cylinder', id: 'pillar-3', base: v3(0.5, 2.2, 0), radius: 0.25, height: 3 },
    // low table the drone may fly over
    { kind: 'box', id: 'table', center: v3(3.3, -0.2, 0.4), size: v3(1.2, 1.4, 0.8) },
    // hanging beam
    { kind: 'box', id: 'beam', center: v3(-3.3, 0, 2.6), size: v3(0.3, 8, 0.4) },
  ],
  hoverTime: 2,
  land: true,
});

export const COURSE_PRESETS: Record<string, () => CourseSpec> = {
  hover: COURSE_HOVER,
  square: COURSE_SQUARE,
  obstacles: COURSE_OBSTACLES,
};

/** Path planner defaults. */
export const PLANNER_DEFAULTS = {
  resolution: 0.1,
  /** Extra clearance added to the vehicle collision radius [m]. */
  safetyMargin: 0.2,
  floor: 0.4,
  ceilingMargin: 0.4,
} as const;

/** Mission sequencing defaults. */
export const MISSION_DEFAULTS = {
  armDelay: 0.5,
  takeoffSpeed: 0.5,
  landSpeed: 0.35,
  arriveTolerance: 0.1,
  landedHoldTime: 0.4,
  failsafeHoldTime: 1.0,
  followerAccel: 1.2,
  cornerSpeedFactor: 0.35,
  maxTrackingError: 0.35,
  crashImpactSpeed: 2.0,
  crashTiltRad: (60 * Math.PI) / 180,
  logRateHz: 50,
} as const;

/** Open field for GNSS flight tests (80 m x 80 m, 30 m ceiling). */
export const ENV_OUTDOOR = (): EnvironmentSpec => ({
  ...ENV_CALM(),
  wind: { mean: v3(3, 0, 0), gustStd: 1, gustTau: 3 },
  boundsMin: v3(-40, -40, 0),
  boundsMax: v3(40, 40, 30),
});

export const COURSE_OUTDOOR_HOVER = (): CourseSpec => ({
  name: '屋外ホバリング 5 m（GNSS）',
  start: v3(0, 0, 0),
  goal: v3(0, 0, 0),
  waypoints: [],
  cruiseAltitude: 5,
  cruiseSpeed: 1.5,
  planPath: false,
  obstacles: [],
  hoverTime: 30,
  land: true,
  maxTrackingError: 2.5,
});

export const COURSE_OUTDOOR_SQUARE = (): CourseSpec => ({
  name: '屋外 20 m 四方（GNSS）',
  start: v3(0, 0, 0),
  goal: v3(0, 0, 0),
  waypoints: [v3(10, -10, 5), v3(10, 10, 5), v3(-10, 10, 5), v3(-10, -10, 5), v3(10, -10, 5)],
  cruiseAltitude: 5,
  cruiseSpeed: 1.5,
  planPath: false,
  obstacles: [],
  hoverTime: 3,
  land: true,
  maxTrackingError: 2.5,
});

/** GNSS + compass module for the outdoor study (external, plugged into the variant-B GNSS port). */
export const GNSS_MODULE = { name: 'GNSS＋コンパス モジュール（u-blox M10 系）', massG: 5.0, size: [20, 20, 6] as [number, number, number] } as const;
