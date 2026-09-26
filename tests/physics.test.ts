import test from 'node:test';
import assert from 'node:assert/strict';
import { createCar, stepCar, collide, IDLE_INPUT, angleDelta } from '../src/physics.ts';
import { sampleTrack, projectTrack, advanceCheckpoint, ROAD_HALF_WIDTH, trackLength } from '../src/track.ts';

function run(s: ReturnType<typeof createCar>, seconds: number, input = {}) {
  for (let i = 0; i < Math.round(seconds * 120); i++) stepCar(s, { ...IDLE_INPUT, ...input }, 1 / 120);
}

test('accelerates to cruise speed, coasts and brakes without reversing', () => {
  const s = createCar(); run(s, 5, { throttle: 1 });
  assert.ok(s.speed >= 40 && s.speed <= 41.01); assert.ok(s.z > 100);
  run(s, 1); assert.ok(s.speed < 35);
  run(s, 4, { throttle: -1 }); assert.equal(s.speed, 0);
});

test('stationary steering cannot move or farm drift charge', () => {
  const s = createCar(); run(s, 5, { steer: 1, drift: true });
  assert.equal(s.heading, 0); assert.equal(s.charge, 0); assert.equal(s.drifting, false);
});

test('drifting creates real slip, charge and an expiring mini-boost window', () => {
  const s = createCar(); run(s, 2, { throttle: 1 });
  run(s, 1.2, { throttle: 1, steer: 1, drift: true });
  assert.ok(s.drifting); assert.ok(Math.abs(angleDelta(s.velocityAngle, s.heading)) > 0.3);
  assert.ok(s.charge > 20);
  run(s, 1 / 120, { throttle: 1 }); assert.ok(s.miniReady > 1.7);
  run(s, 1 / 120, { throttle: 1, mini: true }); assert.ok(s.miniTime > 0.8); assert.equal(s.miniReady, 0);
  run(s, 0.65, { throttle: 1 }); assert.ok(s.speed > 42);
  run(s, 2, { throttle: 1 }); assert.equal(s.miniTime, 0);
});

test('tiny drifts do not award mini boosts; expired windows cannot trigger', () => {
  const s = createCar(); s.speed = 30;
  run(s, 0.15, { throttle: 1, steer: 1, drift: true }); run(s, 0.1, { throttle: 1 });
  assert.equal(s.miniReady, 0);
  s.miniReady = 0.1; run(s, 0.2); run(s, 1 / 120, { mini: true }); assert.equal(s.miniTime, 0);
});

test('countersteering and release restore grip progressively', () => {
  const s = createCar(); s.speed = 33;
  run(s, 1.2, { throttle: 1, steer: 1, drift: true });
  const slip = Math.abs(angleDelta(s.velocityAngle, s.heading));
  run(s, 0.45, { throttle: 1, steer: -1 });
  assert.ok(Math.abs(angleDelta(s.velocityAngle, s.heading)) < slip * 0.5);
});

test('nitro consumes one tank and cannot be retriggered during its duration', () => {
  const s = createCar(); s.speed = 41; s.tanks = 2;
  run(s, 1 / 120, { throttle: 1, nitro: true }); assert.equal(s.tanks, 1);
  run(s, 1, { throttle: 1, nitro: true }); assert.equal(s.tanks, 1); assert.ok(s.speed > 60);
  run(s, 2, { throttle: 1 }); assert.equal(s.nitroTime, 0); assert.ok(s.speed < 60);
  s.tanks = 0; run(s, 0.1, { nitro: true }); assert.equal(s.nitroTime, 0);
});

test('drift tank capacity stays bounded', () => {
  const s = createCar(); s.speed = 33;
  run(s, 20, { throttle: 1, steer: 1, drift: true });
  assert.equal(s.tanks, 2); assert.ok(s.charge >= 0 && s.charge < 100);
});

test('invalid simulation intervals do not corrupt car state', () => {
  const s = createCar(); const before = { ...s };
  for (const dt of [0, -1, NaN, Infinity, 1]) stepCar(s, IDLE_INPUT, dt);
  assert.deepEqual(s, before);
});

test('wall collision constrains position and permits a clean recovery', () => {
  const s = createCar(15, 0, Math.PI / 3); s.speed = 40;
  assert.ok(collide(s, { x: 0, z: 0, distance: 15, heading: 0 }, 8.75));
  assert.equal(s.x, 8.75); assert.ok(s.speed > 20 && s.speed < 30);
  const speed = s.speed;
  collide(s, { x: 0, z: 0, distance: 10, heading: 0 }, 8.75); assert.equal(s.speed, speed);
  run(s, 2, { throttle: 1 }); assert.ok(s.speed >= 40);
});

test('ordered checkpoints reject finish-line oscillation and skipping sectors', () => {
  let checkpoint = 1;
  for (const p of [0.99, 0.01, 0.99, 0.01, 0.75, 0.01]) checkpoint = advanceCheckpoint(p, checkpoint);
  assert.equal(checkpoint, 1);
  for (const p of [0.26, 0.51, 0.76, 0.99, 0.01]) checkpoint = advanceCheckpoint(p, checkpoint);
  assert.equal(checkpoint, 5);
});

test('track projection is continuous and width allows driving around the whole lap', () => {
  for (let i = 0; i < 100; i++) {
    const p = sampleTrack(i / 100), projection = projectTrack(p.x, p.z);
    assert.ok(projection.distance < 0.02);
  }
  assert.ok(trackLength > 900 && trackLength < 1300);
});

test('three complete laps can be driven through the production physics and checkpoints', () => {
  const start = sampleTrack(0.001), s = createCar(start.x, start.z, start.heading);
  let checkpoint = 1, laps = 0, collisions = 0, steps = 0;
  for (; steps < 120 * 200 && laps < 3; steps++) {
    const p = projectTrack(s.x, s.z);
    const aim = sampleTrack(p.progress + 14 / trackLength);
    const desired = Math.atan2(aim.x - s.x, aim.z - s.z);
    const steer = Math.max(-1, Math.min(1, angleDelta(s.heading, desired) * 2.8));
    stepCar(s, { ...IDLE_INPUT, throttle: s.speed < 29 ? 1 : 0, steer }, 1 / 120);
    const next = projectTrack(s.x, s.z);
    if (collide(s, next, ROAD_HALF_WIDTH - 1.25)) collisions++;
    checkpoint = advanceCheckpoint(next.progress, checkpoint);
    if (checkpoint === 5) { laps++; checkpoint = 1; }
    assert.ok(Number.isFinite(s.x + s.z + s.speed));
  }
  assert.equal(laps, 3, `completed ${laps} laps in ${steps / 120}s`);
  assert.ok(collisions < 10, `${collisions} wall contacts on the centerline-following route`);
});
