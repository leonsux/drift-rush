import './style.css';
import { World } from './world.ts';
import { GameAudio } from './audio.ts';
import { createCar, stepCar, collide, angleDelta } from './physics.ts';
import { sampleTrack, projectTrack, points, ROAD_HALF_WIDTH, trackLength, advanceCheckpoint } from './track.ts';

// Apply Chinese spacing at the rendering boundary, including dynamically generated labels.
function typography(text: string) {
  return text.replace(/[—–]/g, '--').replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, '$1 $2').replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, '$1 $2');
}
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main id="game" aria-label="Drift Rush 赛车游戏">
    <div id="scene"></div><div class="vignette"></div><div id="speed-lines"></div>
    <header class="topbar">
      <a class="brand" href="#" aria-label="Drift Rush"><span class="brand-mark">//</span> DRIFT<span>RUSH</span><sup>海风环线</sup></a>
      <div class="top-actions"><span class="session-label">单人计时赛</span><button id="sound" class="icon-button" aria-label="关闭音效" title="音效开关">声音 ON</button><button id="pause" class="icon-button" aria-label="暂停比赛" title="Esc 暂停">Ⅱ</button></div>
    </header>
    <section class="race-stats" aria-label="比赛信息">
      <div class="lap-stat"><span class="eyebrow">LAP / 圈数</span><strong><span id="lap">01</span><small> / 03</small></strong></div>
      <div class="time-stat"><span class="eyebrow">TIME / 用时</span><strong id="timer">00:00.000</strong><span class="best-label">最佳纪录 <b id="best">--:--.---</b></span></div>
    </section>
    <aside class="track-card"><div class="track-title"><span>海风环线</span><small>COASTLINE</small></div><canvas id="minimap" width="440" height="380" aria-label="赛道小地图与车辆位置"></canvas><div class="track-meta"><span>${(trackLength / 1000).toFixed(2)} km</span><span>晴朗 · 海岸</span></div></aside>
    <div id="notice" role="status" aria-live="polite"></div>
    <div id="countdown" aria-live="assertive"></div>
    <div id="wrong-way" aria-hidden="true">方向相反 · 请掉头</div>
    <section class="drive-hud" aria-label="驾驶信息">
      <div class="boost-readout"><div class="boost-title"><span>氮气储备</span><span id="tank-count">01 / 02</span></div><div class="tanks"><div class="tank filled"><span>N₂</span></div><div class="tank"><span>N₂</span></div><kbd>E / CTRL</kbd></div><div class="charge-track"><div id="charge-fill"></div></div><div class="charge-label"><span id="charge-label">漂移积攒氮气</span><span id="charge-value">0%</span></div></div>
      <div id="mini-prompt" aria-hidden="true"><kbd>SPACE</kbd><span>小喷就绪</span><i></i></div>
      <div class="speedometer"><span id="drive-state">READY</span><div><strong id="speed">000</strong><span>KM/H</span></div><div class="speed-track"><i id="speed-fill"></i></div></div>
    </section>
    <footer class="controls"><span><kbd>W A S D</kbd> / <kbd>↑ ↓ ← →</kbd> 驾驶</span><span><kbd>SHIFT</kbd> 漂移</span><span><kbd>SPACE</kbd> 小喷</span><span title="WASD 驾驶时推荐使用 E，避免浏览器 Ctrl + W 快捷键"><kbd>E / CTRL</kbd> 氮气</span><span><kbd>R</kbd> 重开</span><span><kbd>ESC</kbd> 暂停</span></footer>
    <section id="overlay" class="overlay">
      <div class="start-panel">
        <div class="circuit-label"><span class="flag-grid"></span> COASTLINE CIRCUIT</div>
        <h1 id="panel-title">把弯道，<br>变成加速道。</h1>
        <p id="panel-description">海风环线 · 三圈计时挑战</p>
        <div id="start-details" class="start-details"><div><b>01</b><span>按住 <kbd>W</kbd> 加速</span></div><div><b>02</b><span>转向 + <kbd>SHIFT</kbd> 漂移集气</span></div><div><b>03</b><span>松开漂移，按 <kbd>SPACE</kbd> 小喷</span></div></div>
        <div id="results" hidden></div>
        <button id="start" class="start-button"><span>驶入赛道</span><span aria-hidden="true">↗</span></button>
        <button id="restart" class="secondary-button" hidden>重新开始</button>
        <div class="start-bottom"><span id="start-hint">按 Enter 开始</span><label class="volume">音量<input id="volume" type="range" min="0" max="100" value="45" aria-label="音效音量" /></label></div>
      </div>
      <div class="circuit-number" aria-hidden="true">01<span>THE COAST<br>IS CALLING.</span></div>
    </section>
    <div class="mobile-message">建议使用电脑键盘游玩，获得完整漂移体验。</div>
  </main>`;
const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) walker.currentNode.textContent = typography(walker.currentNode.textContent ?? '');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let world: World;
try { world = new World($('scene')); }
catch {
  $('panel-title').textContent = '暂时无法启动 3D 画面';
  $('panel-description').textContent = '请开启浏览器硬件加速，并使用支持 WebGL 2 的电脑浏览器。';
  $('start').hidden = true; $('start-details').hidden = true; $('start-hint').textContent = '';
  throw new Error('WebGL renderer unavailable');
}
const sound = new GameAudio();
const spawn = sampleTrack(0.001);
let car = createCar(spawn.x, spawn.z, spawn.heading);
world.reset(car);
type Mode = 'ready' | 'countdown' | 'racing' | 'paused' | 'finished';
let mode: Mode = 'ready', previousMode: Mode = 'racing';
let countdown = 3.5, elapsed = 0, lap = 1, nextCheckpoint = 1, lapStarted = 0;
let lapTimes: number[] = [];
let best: number | null = null;
try { const stored = Number(localStorage.getItem('drift-rush-best-v1')); if (Number.isFinite(stored) && stored > 0) best = stored; } catch { /* Gameplay works without storage. */ }
const keys = new Set<string>();
let miniPressed = false, nitroPressed = false, noticeRemaining = 0, lastCount = 4, hudTime = 0;
let accumulator = 0, lastTime = performance.now(), fps = 60;
const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}.${Math.floor(s * 1000 % 1000).toString().padStart(3, '0')}`;
$('best').textContent = best === null ? '--:--.---' : formatTime(best);

function notify(text: string, type = '') {
  $('notice').textContent = typography(text); $('notice').className = `visible ${type}`; noticeRemaining = 2;
}
function resetRace() {
  car = createCar(spawn.x, spawn.z, spawn.heading); keys.clear(); miniPressed = nitroPressed = false;
  elapsed = 0; lap = 1; nextCheckpoint = 1; lapStarted = 0; lapTimes = []; countdown = 3.5; lastCount = 4;
  accumulator = 0; mode = 'countdown'; $('overlay').classList.add('hidden'); $('countdown').textContent = '';
  $('notice').className = ''; $('wrong-way').className = ''; world.reset(car);
  void sound.start().then(() => { if (!sound.available) notify('音效暂不可用，仍可继续比赛'); });
}
function pauseRace() {
  if (mode !== 'racing' && mode !== 'countdown') return;
  previousMode = mode; mode = 'paused'; keys.clear(); miniPressed = nitroPressed = false;
  $('overlay').classList.remove('hidden'); $('panel-title').innerHTML = '歇一会儿，<br>海风还在。';
  $('panel-description').textContent = '比赛已暂停，计时与车辆状态已保留。';
  $('start-details').hidden = true; $('results').hidden = true; $('restart').hidden = false;
  $('start').querySelector('span')!.textContent = '继续比赛'; $('start-hint').textContent = '按 Esc 或 Enter 继续';
  $('countdown').textContent = '';
}
function resumeRace() {
  mode = previousMode; accumulator = 0; lastTime = performance.now(); $('overlay').classList.add('hidden'); void sound.start();
}
function finishRace() {
  mode = 'finished'; sound.cue('finish'); keys.clear();
  const isBest = best === null || elapsed < best;
  if (isBest) { best = elapsed; try { localStorage.setItem('drift-rush-best-v1', String(best)); } catch { /* Best remains available for this session. */ } }
  $('best').textContent = formatTime(best!);
  $('panel-title').innerHTML = isBest ? '新纪录，<br>漂亮过弯。' : '冲线了，<br>再快一点。';
  $('panel-description').textContent = '海风环线 · 三圈挑战完成';
  $('start-details').hidden = true; $('results').hidden = false; $('restart').hidden = true;
  $('results').innerHTML = `<strong>${formatTime(elapsed)}</strong>${lapTimes.map((t, i) => `<div><span>第 ${i + 1} 圈</span><b>${formatTime(t)}</b></div>`).join('')}`;
  $('start').querySelector('span')!.textContent = '再跑一场'; $('start-hint').textContent = '按 Enter 再次出发'; $('overlay').classList.remove('hidden');
}
$('start').addEventListener('click', () => mode === 'paused' ? resumeRace() : resetRace());
$('restart').addEventListener('click', resetRace);
$('pause').addEventListener('click', () => mode === 'paused' ? resumeRace() : pauseRace());
$('sound').addEventListener('click', () => {
  sound.muted = !sound.muted; $('sound').textContent = sound.muted ? '声音 OFF' : '声音 ON';
  $('sound').setAttribute('aria-label', sound.muted ? '开启音效' : '关闭音效'); void sound.start();
});
$<HTMLInputElement>('volume').addEventListener('input', e => { sound.volume = Number((e.target as HTMLInputElement).value) / 100; });
document.querySelector('.brand')!.addEventListener('click', e => { e.preventDefault(); pauseRace(); });
const boundKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'Space', 'KeyR', 'Escape', 'Enter']);
window.addEventListener('keydown', e => {
  if (!boundKeys.has(e.code)) return;
  if ((e.target instanceof HTMLInputElement) && mode !== 'racing' && mode !== 'countdown' && !['Escape', 'Enter'].includes(e.code)) return;
  e.preventDefault();
  if (!e.repeat) {
    if (e.code === 'Enter' && ['ready', 'finished', 'paused'].includes(mode)) { mode === 'paused' ? resumeRace() : resetRace(); return; }
    if (e.code === 'Escape') { mode === 'paused' ? resumeRace() : pauseRace(); return; }
    if (e.code === 'KeyR' && mode !== 'ready') { resetRace(); return; }
    if (mode === 'racing') {
      if (e.code === 'Space') miniPressed = true;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyE') nitroPressed = true;
    }
  }
  keys.add(e.code);
});
window.addEventListener('keyup', e => { keys.delete(e.code); if (boundKeys.has(e.code)) e.preventDefault(); });
window.addEventListener('blur', () => { keys.clear(); pauseRace(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); pauseRace(); } });
const held = (...codes: string[]) => codes.some(code => keys.has(code));

function tick(dt: number) {
  if (mode === 'countdown') {
    countdown -= dt;
    const count = Math.ceil(countdown);
    if (count !== lastCount && count <= 3 && count > 0) { lastCount = count; sound.cue('count'); }
    $('countdown').textContent = count > 3 ? '' : count > 0 ? String(count) : 'GO!';
    if (countdown <= 0) { mode = 'racing'; sound.cue('go'); notify('全油门，出发！'); }
    return;
  }
  if (mode !== 'racing') return;
  elapsed += dt;
  if (elapsed > 0.7) $('countdown').textContent = '';
  stepCar(car, {
    throttle: held('ArrowDown', 'KeyS') ? -1 : held('ArrowUp', 'KeyW') ? 1 : 0,
    steer: Number(held('ArrowLeft', 'KeyA')) - Number(held('ArrowRight', 'KeyD')),
    drift: held('ShiftLeft', 'ShiftRight'), mini: miniPressed, nitro: nitroPressed,
  }, dt);
  miniPressed = false; nitroPressed = false;
  const projection = projectTrack(car.x, car.z);
  collide(car, projection, ROAD_HALF_WIDTH - 1.25);
  if (car.event) {
    sound.cue(car.event);
    if (car.event === 'mini-ready') notify('出弯小喷 · SPACE', 'lime');
    if (car.event === 'nitro') notify('氮气加速', 'cyan');
    if (car.event === 'mini') notify('小喷加速', 'lime');
    if (car.event === 'tank') notify('氮气已充能 · E / CTRL', 'cyan');
  }
  const forward = Math.abs(angleDelta(car.velocityAngle, projection.heading)) < Math.PI / 2;
  $('wrong-way').classList.toggle('visible', !forward && car.speed > 5);
  $('wrong-way').setAttribute('aria-hidden', String(forward || car.speed <= 5));
  if (forward) nextCheckpoint = advanceCheckpoint(projection.progress, nextCheckpoint);
  if (nextCheckpoint === 5) {
    lapTimes.push(elapsed - lapStarted); lapStarted = elapsed;
    if (lap === 3) finishRace();
    else { lap++; nextCheckpoint = 1; notify(lap === 3 ? '最后一圈！' : '进入第 2 圈'); sound.cue('go'); }
  }
}

const map = $<HTMLCanvasElement>('minimap'); const ctx = map.getContext('2d')!;
const mapPoint = (x: number, z: number) => ({ x: (x + 230) * 1.06 + 34, y: (z + 180) * 0.85 + 27 });
function drawMap() {
  ctx.clearRect(0, 0, 440, 380); ctx.beginPath();
  points.forEach((p, i) => { const v = mapPoint(p.x, p.z); if (i === 0) ctx.moveTo(v.x, v.y); else ctx.lineTo(v.x, v.y); });
  ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(239,247,220,.18)'; ctx.stroke();
  ctx.lineWidth = 3; ctx.strokeStyle = '#e0eccd'; ctx.stroke();
  const start = mapPoint(spawn.x, spawn.z); ctx.fillStyle = '#d9f85c'; ctx.fillRect(start.x - 5, start.y - 5, 10, 10);
  const pos = mapPoint(car.x, car.z); ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(-car.heading);
  ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(-6, -6); ctx.lineTo(6, -6); ctx.closePath(); ctx.fillStyle = '#eaff82'; ctx.shadowColor = '#d4fc55'; ctx.shadowBlur = 14; ctx.fill(); ctx.restore();
}
function updateHud() {
  $('speed').textContent = Math.round(car.speed * 5.2).toString().padStart(3, '0');
  $('timer').textContent = formatTime(elapsed); $('lap').textContent = `0${lap}`;
  $('tank-count').textContent = `0${car.tanks} / 02`;
  document.querySelectorAll('.tank').forEach((t, i) => t.classList.toggle('filled', i < car.tanks));
  $('charge-fill').style.width = `${car.charge}%`; $('charge-value').textContent = `${Math.floor(car.charge)}%`;
  $('charge-label').textContent = car.tanks === 2 ? '氮气储备已满' : car.drifting ? '漂移集气中' : '漂移积攒氮气';
  $('mini-prompt').classList.toggle('visible', car.miniReady > 0 && mode === 'racing');
  $('mini-prompt').setAttribute('aria-hidden', String(car.miniReady <= 0 || mode !== 'racing'));
  $('mini-prompt').style.setProperty('--window', `${car.miniReady / 1.8 * 100}%`);
  $('speed-fill').style.width = `${Math.min(100, car.speed / 61 * 100)}%`;
  const boost = (car.nitroTime > 0 || car.miniTime > 0) && mode === 'racing';
  $('game').classList.toggle('boosting', boost); $('game').classList.toggle('drifting', car.drifting && mode === 'racing');
  $('drive-state').textContent = car.nitroTime > 0 ? 'NITRO BOOST' : car.miniTime > 0 ? 'MINI BOOST' : car.drifting ? 'DRIFTING' : mode === 'racing' ? 'FULL SEND' : 'READY';
  $('pause').textContent = mode === 'paused' ? '▷' : 'Ⅱ'; $('pause').setAttribute('aria-label', mode === 'paused' ? '继续比赛' : '暂停比赛');
  drawMap();
  if (import.meta.env.DEV) $('game').dataset.telemetry = JSON.stringify({ mode, elapsed, lap, nextCheckpoint, car: { ...car }, fps: Math.round(fps), drawCalls: world.drawCalls, audioAvailable: sound.available, audioState: sound.state });
}

function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.1); lastTime = now;
  fps += ((dt > 0 ? 1 / dt : 60) - fps) * 0.03;
  accumulator += dt;
  while (accumulator >= 1 / 120) { tick(1 / 120); accumulator -= 1 / 120; }
  const active = mode === 'racing';
  sound.update(car, active); world.render(car, dt, active);
  noticeRemaining -= dt;
  if (noticeRemaining <= 0) $('notice').classList.remove('visible');
  hudTime += dt; if (hudTime > 1 / 30) { updateHud(); hudTime = 0; }
  requestAnimationFrame(frame);
}
updateHud(); requestAnimationFrame(frame);

// Optional browser tool support reuses the visible pause/resume flow and cannot inject driving input.
const modelContext = (document as Document & { modelContext?: { registerTool: (tool: object, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
if (modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const state = () => ({ mode, lap, elapsed, speedKmh: Math.round(car.speed * 5.2), nitroTanks: car.tanks, miniReady: car.miniReady > 0 });
  const tools = [
    { name: 'get_race_state', title: '读取比赛状态', description: '读取当前比赛阶段、圈数、时间、车速与喷气状态。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => state() },
    { name: 'set_race_paused', title: '暂停或继续比赛', description: '与界面暂停按钮使用相同逻辑，暂停或继续已经开始的比赛。', inputSchema: { type: 'object', properties: { paused: { type: 'boolean' } }, required: ['paused'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: (input: unknown) => {
      if (!input || typeof input !== 'object' || !('paused' in input) || typeof input.paused !== 'boolean' || Object.keys(input).length !== 1) throw new Error('paused 必须是布尔值');
      if (mode === 'ready' || mode === 'finished') throw new Error('比赛尚未开始或已结束');
      if (input.paused) pauseRace(); else if (mode === 'paused') resumeRace();
      updateHud(); return state();
    } },
  ];
  for (const tool of tools) {
    try { void Promise.resolve(modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Unsupported optional capability does not affect gameplay. */ }
  }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
