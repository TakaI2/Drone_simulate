/** Hooks exposed in capture mode (`?capture=1`) so scripts can render deterministic video frames. */

export interface CaptureViewportApi {
  /** Place the camera on a sphere around the current orbit target (degrees; distance in scene units). */
  orbit: (azimuthDeg: number, elevationDeg: number, distance?: number) => void;
  distance: () => number;
  /** Render now and return the canvas as a JPEG data URL. */
  frame: (quality?: number) => string;
}

export interface CaptureSimApi {
  /** Duration of the recorded flight [s]. */
  duration: () => number;
  /** Pose the recorded flight at time t and advance the follow camera by dt (simulated seconds). */
  step: (t: number, dt: number) => void;
  setCamera: (mode: 'free' | 'orbit' | 'chase' | 'top', distance?: number) => void;
}

export type CaptureWindow = Window & { __ddsViewport?: CaptureViewportApi; __ddsSim?: CaptureSimApi };

export const captureEnabled = (): boolean => new URLSearchParams(location.search).has('capture');
