/** Referenced open-source projects (licenses verified via GitHub API on 2026-09-26). */
export interface Reference {
  name: string;
  url: string;
  license: string;
  usage: string;
}

export const REFS: Record<string, Reference> = {
  three: { name: 'three.js', url: 'https://github.com/mrdoob/three.js', license: 'MIT', usage: '3D 描画（依存として取り込み）' },
  csg: { name: 'manifold-3d', url: 'https://github.com/elalish/manifold', license: 'Apache-2.0', usage: 'フレームの多様体ブーリアン演算（依存として取り込み）' },
  px4: { name: 'PX4-Autopilot', url: 'https://github.com/PX4/PX4-Autopilot', license: 'BSD-3-Clause', usage: 'カスケード制御・推力ベクトル→姿勢・ミキサ飽和処理の構成を参考（コード流用なし）' },
  jmavsim: { name: 'jMAVSim', url: 'https://github.com/PX4/jMAVSim', license: 'BSD-3-Clause', usage: '多ロータ物理モデルの構成を参考' },
  gymPybullet: { name: 'gym-pybullet-drones', url: 'https://github.com/utiasDSL/gym-pybullet-drones', license: 'MIT', usage: '推力 ∝ ω²・地面効果・抗力モデルの考え方を参考' },
  rotorpy: { name: 'RotorPy', url: 'https://github.com/spencerfolk/rotorpy', license: 'MIT', usage: 'ロータ抗力・風モデルの考え方を参考' },
  cfSim: { name: 'crazyflie-simulation', url: 'https://github.com/bitcraze/crazyflie-simulation', license: 'MIT', usage: 'マイクロ機のパラメータ規模感を参考' },
  espDrone: { name: 'ESP-Drone', url: 'https://github.com/espressif/esp-drone', license: 'GPL-3.0', usage: 'ESP32 マイクロ機の回路構成（MOSFET 直駆動）を参考。コード流用なし。派生ファームウェアは GPL' },
  crazyflie: { name: 'Crazyflie firmware / Flow deck', url: 'https://github.com/bitcraze/crazyflie-firmware', license: 'GPL-3.0', usage: 'オプティカルフロー＋ToF による屋内位置推定の構成を参考。コード流用なし' },
  ardupilot: { name: 'ArduPilot', url: 'https://github.com/ArduPilot/ardupilot', license: 'GPL-3.0', usage: 'フェイルセーフ（低電圧着陸）の定石を参考。コード流用なし' },
  betaflight: { name: 'Betaflight', url: 'https://github.com/betaflight/betaflight', license: 'GPL-3.0', usage: '角速度ループの D 項フィルタの定石を参考。コード流用なし' },
  am32: { name: 'AM32 ESC firmware', url: 'https://github.com/am32-firmware/AM32', license: 'GPL-3.0', usage: 'Class B で市販 ESC に書き込むファームウェアとして推奨（本ツールには取り込まない）' },
  skidl: { name: 'SKiDL', url: 'https://github.com/devbisme/skidl', license: 'MIT', usage: 'コードで回路を記述しネットリストを生成する手法を参考' },
  freerouting: { name: 'Freerouting', url: 'https://github.com/freerouting/freerouting', license: 'GPL-3.0', usage: '取り込まない。外部ツールとして任意利用可能な旨を案内' },
  kicad3d: { name: 'KiCad 3D models', url: 'https://gitlab.com/kicad/libraries/kicad-packages3D', license: 'CC-BY-SA 4.0（設計物例外あり）', usage: '同梱しない。高精度モデルが必要な場合の任意参照先' },
  gerber: { name: 'Ucamco Gerber Format Specification', url: 'https://www.ucamco.com/en/gerber', license: '公開仕様', usage: 'Gerber RS-274X 出力の仕様' },
};
