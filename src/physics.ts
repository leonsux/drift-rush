export interface Input { throttle: number; steer: number; drift: boolean; mini: boolean; nitro: boolean }
export interface CarState {
  x: number; z: number; heading: number; velocityAngle: number; speed: number;
  steer: number; drifting: boolean; driftDirection: number; driftTime: number;
  charge: number; tanks: number; miniReady: number; miniTime: number; nitroTime: number;
  collisionCooldown: number; event: '' | 'mini-ready' | 'mini' | 'nitro' | 'tank' | 'collision';
}
export const IDLE_INPUT: Input = { throttle: 0, steer: 0, drift: false, mini: false, nitro: false };
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export function createCar(x = 0, z = 0, heading = 0): CarState {
  return { x, z, heading, velocityAngle: heading, speed: 0, steer: 0,
    drifting: false, driftDirection: 0, driftTime: 0, charge: 0, tanks: 1,
    miniReady: 0, miniTime: 0, nitroTime: 0, collisionCooldown: 0, event: '' };
}

export function stepCar(s: CarState, input: Input, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.05) return;
  s.event = '';
  s.miniReady = Math.max(0, s.miniReady - dt);
  s.miniTime = Math.max(0, s.miniTime - dt);
  s.nitroTime = Math.max(0, s.nitroTime - dt);
  s.collisionCooldown = Math.max(0, s.collisionCooldown - dt);
  s.steer += (Math.max(-1, Math.min(1, input.steer)) - s.steer) * (1 - Math.exp(-12 * dt));
  const wantsDrift = input.drift && s.speed > 12;
  if (!s.drifting && wantsDrift && Math.abs(s.steer) > 0.25) {
    s.drifting = true; s.driftDirection = Math.sign(s.steer); s.driftTime = 0;
  }
  if (s.drifting && !wantsDrift) {
    if (s.driftTime > 0.45) { s.miniReady = 1.8; s.event = 'mini-ready'; }
    s.drifting = false; s.driftTime = 0;
  }
  if (input.mini && s.miniReady > 0) {
    s.miniTime = 0.85; s.miniReady = 0; s.event = 'mini';
  }
  if (input.nitro && s.tanks > 0 && s.nitroTime === 0) {
    s.nitroTime = 2.8; s.tanks--; s.event = 'nitro';
  }
  const boost = s.nitroTime > 0 || s.miniTime > 0;
  const maxSpeed = s.nitroTime > 0 ? 61 : s.miniTime > 0 ? 52 : s.drifting ? 33 : 41;
  const throttle = Math.max(-1, Math.min(1, input.throttle));
  const accel = throttle > 0 ? (boost ? 27 : 17) * throttle : throttle < 0 ? -34 : -7;
  s.speed = Math.max(0, s.speed + (s.speed < maxSpeed ? accel : Math.min(0, accel)) * dt);
  if (s.speed > maxSpeed) s.speed = Math.max(maxSpeed, s.speed - (boost ? 8 : 19) * dt);
  const moving = Math.min(1, s.speed / 16);
  const turn = s.drifting ? s.steer * 1.25 + s.driftDirection * 0.38 : s.steer * (1.16 - 0.23 * s.speed / 61);
  s.heading += turn * moving * dt;
  const grip = s.drifting ? 2.6 : 10;
  s.velocityAngle += angleDelta(s.velocityAngle, s.heading) * (1 - Math.exp(-grip * dt));
  if (s.drifting) {
    const slip = Math.abs(angleDelta(s.velocityAngle, s.heading));
    if (slip > 0.12) {
      s.driftTime += dt;
      if (s.tanks < 2) s.charge += dt * (16 + Math.min(slip, 0.8) * 30);
      if (s.charge >= 100) { s.charge -= 100; s.tanks++; s.event = 'tank'; }
    }
  }
  s.x += Math.sin(s.velocityAngle) * s.speed * dt;
  s.z += Math.cos(s.velocityAngle) * s.speed * dt;
}

export function collide(s: CarState, projection: { x: number; z: number; distance: number; heading: number }, limit: number) {
  if (projection.distance <= limit) return false;
  const dx = s.x - projection.x, dz = s.z - projection.z;
  s.x = projection.x + dx / projection.distance * limit;
  s.z = projection.z + dz / projection.distance * limit;
  // Only dissipate normal velocity on contact. A held steering key cannot pin the car to zero speed.
  const forward = Math.abs(angleDelta(s.velocityAngle, projection.heading)) < Math.PI / 2;
  const target = projection.heading + (forward ? 0 : Math.PI);
  if (s.collisionCooldown === 0) {
    s.speed *= 0.64; s.event = 'collision'; s.collisionCooldown = 0.45;
  }
  s.velocityAngle += angleDelta(s.velocityAngle, target) * 0.65;
  s.heading += angleDelta(s.heading, target) * 0.2;
  s.drifting = false; s.driftTime = 0;
  return true;
}
