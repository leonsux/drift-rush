import { CatmullRomCurve3, Vector3 } from 'three';

export const ROAD_HALF_WIDTH = 10;
export const TRACK_SAMPLES = 720;
export const curve = new CatmullRomCurve3([
  [0, 0], [0, 95], [-45, 165], [-135, 172], [-207, 110],
  [-212, 28], [-146, -22], [-159, -90], [-114, -152],
  [-26, -168], [61, -133], [84, -62], [39, -25],
].map(([x, z]) => new Vector3(x, 0, z)), true, 'centripetal');
export const points = curve.getSpacedPoints(TRACK_SAMPLES);
export const trackLength = curve.getLength();

export function sampleTrack(progress: number) {
  const t = ((progress % 1) + 1) % 1;
  const p = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t).normalize();
  return { x: p.x, z: p.z, heading: Math.atan2(tangent.x, tangent.z), nx: tangent.z, nz: -tangent.x };
}

export function projectTrack(x: number, z: number) {
  let best = Infinity;
  let index = 0;
  let fraction = 0;
  let px = 0;
  let pz = 0;
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const qx = a.x + t * dx, qz = a.z + t * dz;
    const d = (x - qx) ** 2 + (z - qz) ** 2;
    if (d < best) { best = d; index = i; fraction = t; px = qx; pz = qz; }
  }
  const a = points[index], b = points[index + 1];
  const angle = Math.atan2(b.x - a.x, b.z - a.z);
  return { x: px, z: pz, distance: Math.sqrt(best), heading: angle, progress: (index + fraction) / TRACK_SAMPLES };
}

// Ordered sectors prevent shortcuts, reversing across the line, or repeated line crossings from counting laps.
export function advanceCheckpoint(progress: number, next: number): number {
  if (next < 4 && progress >= next / 4 && progress < next / 4 + 0.12) return next + 1;
  if (next === 4 && progress >= 0.008 && progress < 0.12) return 5;
  return next;
}
