import * as THREE from 'three';
import { points, sampleTrack, TRACK_SAMPLES, ROAD_HALF_WIDTH } from './track.ts';
import type { CarState } from './physics.ts';

const mat = (color: string | number, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.2, 1500);
  private readonly car = new THREE.Group();
  private readonly body = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private flames: THREE.Mesh[] = [];
  private water: THREE.ShaderMaterial;
  private cameraTarget = new THREE.Vector3();
  private cameraPosition = new THREE.Vector3();
  private marks: THREE.InstancedMesh;
  private markIndex = 0;
  private markTime = 0;
  private particles: THREE.Points;
  private particlePositions = new Float32Array(160 * 3);
  private particleLife = new Float32Array(160);
  private particleIndex = 0;
  private particleTick = 0;
  private dummy = new THREE.Object3D();
  private impact = 0;
  private elapsed = 0;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '海风环线 3D 赛车画面');
    this.scene.background = new THREE.Color('#a4d9df');
    this.scene.fog = new THREE.Fog('#b6e0df', 220, 700);
    this.scene.add(new THREE.HemisphereLight('#e2fbff', '#688359', 2.6));
    const sun = new THREE.DirectionalLight('#fff1cf', 3.2);
    sun.position.set(-70, 140, 65); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, near: 1, far: 450 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.1;
    sun.target.position.set(-60, 0, 0); this.scene.add(sun, sun.target);

    this.water = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec3 p; void main(){p=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 p; uniform float time;
        void main(){float wave=sin(p.x*.14+time*.5)*sin(p.y*.19-time*.65);
          float glint=pow(max(0.,sin(p.x*.21+p.y*.34+time*.4)),24.)*.12;
          vec3 c=mix(vec3(.09,.57,.62),vec3(.24,.77,.76),wave*.24+.5)+glint;
          gl_FragColor=vec4(c,1.);}`,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), this.water);
    sea.rotation.x = -Math.PI / 2; sea.position.y = -4.5; this.scene.add(sea);
    this.buildTrack();
    this.buildScenery();
    this.buildCar();

    this.marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.27, 0.8), new THREE.MeshBasicMaterial({ color: '#172c32', transparent: true, opacity: 0.35, depthWrite: false }), 1200);
    this.marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dummy.scale.setScalar(0);
    for (let i = 0; i < 1200; i++) { this.dummy.updateMatrix(); this.marks.setMatrixAt(i, this.dummy.matrix); }
    this.marks.frustumCulled = false; this.scene.add(this.marks);
    const particleGeo = new THREE.BufferGeometry();
    this.particlePositions.fill(-999);
    particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d')!; const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255,245,212,.7)'); gradient.addColorStop(1, 'rgba(255,245,212,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32);
    this.particles = new THREE.Points(particleGeo, new THREE.PointsMaterial({ size: 2, map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0.5, depthWrite: false }));
    this.particles.frustumCulled = false; this.scene.add(this.particles);
    window.addEventListener('resize', () => this.resize()); this.resize();
  }

  private ribbon(inner: number, outer: number, y: number, material: THREE.Material, alternating = false) {
    const vertices: number[] = [], colors: number[] = [], indices: number[] = [];
    for (let i = 0; i <= TRACK_SAMPLES; i++) {
      const p = points[i]; const next = points[(i + 1) % TRACK_SAMPLES];
      const prev = points[(i - 1 + TRACK_SAMPLES) % TRACK_SAMPLES];
      const tangent = next.clone().sub(prev).normalize();
      for (const offset of [inner, outer]) vertices.push(p.x + tangent.z * offset, y, p.z - tangent.x * offset);
      const color = new THREE.Color(Math.floor(i / 5) % 2 ? '#eae9d5' : '#e57650');
      for (let j = 0; j < 2; j++) colors.push(color.r, color.g, color.b);
      if (i < TRACK_SAMPLES) { const k = i * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices); geo.computeVertexNormals();
    if (alternating) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, material); mesh.receiveShadow = true; this.scene.add(mesh); return mesh;
  }

  private buildTrack() {
    this.ribbon(-27, 27, -0.9, mat('#e5ce99'));
    this.ribbon(-18, 18, -0.08, mat('#91b66c'));
    this.ribbon(-ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0, mat('#465963'));
    const curb = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    this.ribbon(-10.8, -9.8, 0.025, curb, true); this.ribbon(9.8, 10.8, 0.025, curb, true);
    this.ribbon(-9.6, -9.45, 0.035, mat('#d4dcd4')); this.ribbon(9.45, 9.6, 0.035, mat('#d4dcd4'));
    const stripeMat = mat('#d0d5c3');
    const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.015, 2.4), stripeMat, 125);
    for (let i = 0; i < 125; i++) {
      const p = sampleTrack(i / 125); this.dummy.position.set(p.x, 0.03, p.z); this.dummy.rotation.set(0, p.heading, 0); this.dummy.scale.setScalar(1); this.dummy.updateMatrix(); dashes.setMatrixAt(i, this.dummy.matrix);
    }
    this.scene.add(dashes);
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.65, 3.1), mat('#f3edce'), TRACK_SAMPLES * 2);
    const railColor = new THREE.Color();
    for (let i = 0; i < TRACK_SAMPLES; i++) {
      const p = sampleTrack(i / TRACK_SAMPLES);
      for (let side = 0; side < 2; side++) {
        const offset = (side ? 1 : -1) * 11.1;
        this.dummy.position.set(p.x + p.nx * offset, 0.42, p.z + p.nz * offset);
        this.dummy.rotation.set(0, p.heading, 0); this.dummy.updateMatrix();
        rails.setMatrixAt(i * 2 + side, this.dummy.matrix);
        rails.setColorAt(i * 2 + side, railColor.set(Math.floor(i / 12) % 2 ? '#edf1d8' : '#76b9a6'));
      }
    }
    rails.receiveShadow = true; this.scene.add(rails);
    const start = sampleTrack(0.008);
    const gate = new THREE.Group(); gate.position.set(start.x, 0, start.z); gate.rotation.y = start.heading;
    const steel = mat('#183a42'), cream = mat('#f5f1db');
    for (const x of [-11.9, 11.9]) this.box(gate, [0.55, 8, 0.55], [x, 4, 0], steel);
    this.box(gate, [24.6, 1.9, 0.65], [0, 8, 0], steel);
    const sign = this.textSign('DRIFT RUSH', '#e7fb8b', '#193a42', 1024, 128);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(18, 1.7), sign); banner.position.set(0, 8, -0.34); banner.rotation.y = Math.PI; gate.add(banner);
    for (let i = 0; i < 20; i++) for (let j = 0; j < 2; j++) this.box(gate, [1, 0.015, 0.65], [i - 9.5, 0.04, j * 0.65 - 0.65], (i + j) % 2 ? cream : steel);
    this.scene.add(gate);
    for (const [t, label] of [[0.19, '01 / COAST'], [0.45, '02 / PALMS'], [0.68, '03 / LAGOON']] as const) {
      const p = sampleTrack(t); const board = new THREE.Group(); board.position.set(p.x - p.nx * 14, 0, p.z - p.nz * 14); board.rotation.y = p.heading + Math.PI;
      this.box(board, [0.25, 4, 0.25], [0, 2, 0], steel);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), this.textSign(label, '#193a42', '#e6f49f', 512, 128)); panel.position.y = 4.3; board.add(panel); this.scene.add(board);
    }
  }

  private box(parent: THREE.Object3D, size: number[], pos: number[], material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), material);
    mesh.position.set(...pos as [number, number, number]); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }

  private textSign(text: string, ink: string, background: string, width: number, height: number) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    ctx.font = `900 ${height * 0.58}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = ink; ctx.fillText(text, width / 2, height / 2 + 3);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  }

  private buildScenery() {
    const greens = [mat('#439574'), mat('#5ca47b'), mat('#398669')]; const trunkMat = mat('#ae8960');
    const palm = (x: number, z: number, scale: number, seed: number) => {
      const g = new THREE.Group(); g.position.set(x, -0.3, z); g.scale.setScalar(scale);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.42, 6.7, 6), trunkMat); trunk.position.set(0.3, 3.2, 0); trunk.rotation.z = -0.1; trunk.castShadow = true; g.add(trunk);
      for (let i = 0; i < 7; i++) {
        const leafShape = new THREE.Shape(); leafShape.moveTo(0, 0); leafShape.quadraticCurveTo(1.2, 1.4, 4.5, 0); leafShape.quadraticCurveTo(1.5, -1.1, 0, 0);
        const leaf = new THREE.Mesh(new THREE.ShapeGeometry(leafShape), greens[i % 3]); leaf.material.side = THREE.DoubleSide;
        leaf.rotation.set(-Math.PI / 2 + 0.15, 0, i * Math.PI * 2 / 7 + seed); leaf.position.set(0.65, 6.4 - i * 0.035, 0); leaf.castShadow = true; g.add(leaf);
      }
      this.scene.add(g);
    };
    for (let i = 0; i < 46; i++) {
      const p = sampleTrack((i + 0.4) / 46); const offset = (i % 3 === 0 ? -1 : 1) * (17 + Math.sin(i * 13) * 3);
      palm(p.x + p.nx * offset, p.z + p.nz * offset, 0.9 + (Math.sin(i * 7) + 1) * 0.35, i);
    }
    const island = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.15, 6, 48), mat('#81aa71'));
    island.scale.set(53, 1, 102); island.position.set(-93, -4, 32); island.receiveShadow = true; this.scene.add(island);
    const rockMat = mat('#b5b9a0');
    for (let i = 0; i < 18; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rockMat);
      rock.position.set(-95 + Math.sin(i * 6.23) * 37, -1, 25 + Math.cos(i * 3.2) * 65);
      rock.scale.set(8 + i % 4 * 4, 10 + i % 5 * 7, 9 + i % 3 * 7); rock.rotation.y = i; rock.castShadow = true; this.scene.add(rock);
    }
    const white = mat('#f8edd5'), red = mat('#d56846'), navy = mat('#25494d');
    const lighthouse = new THREE.Group(); lighthouse.position.set(54, -2, 52);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(16, 21, 7, 12), mat('#c4b791')); base.position.y = -1; lighthouse.add(base);
    for (let i = 0; i < 5; i++) {
      const section = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - i * 0.2, 2.8 - i * 0.2, 4, 12), i % 2 ? red : white); section.position.y = 4 + i * 4; section.castShadow = true; lighthouse.add(section);
    }
    const top = new THREE.Mesh(new THREE.ConeGeometry(3.2, 2.6, 12), navy); top.position.y = 25; lighthouse.add(top);
    this.box(lighthouse, [3, 2, 3], [0, 22.5, 0], mat('#bee6d8')); this.scene.add(lighthouse);
    for (let i = 0; i < 9; i++) {
      const p = sampleTrack(0.065 + i * 0.013); const g = new THREE.Group(); g.position.set(p.x - p.nx * 22, 0, p.z - p.nz * 22); g.rotation.y = p.heading;
      this.box(g, [6, 2.8 + i % 3, 5], [0, 1.4 + i % 3 / 2, 0], i % 2 ? white : mat('#eaa372'));
      this.box(g, [6.7, 0.28, 5.7], [0, 2.9 + i % 3, 0], mat('#517b75'));
      this.box(g, [0.1, 1.5, 2.3], [3.06, 1.6, 0], navy); this.scene.add(g);
    }
    const cloudMat = new THREE.MeshBasicMaterial({ color: '#e5f0df', fog: true });
    for (let i = 0; i < 15; i++) {
      const g = new THREE.Group(); g.position.set(Math.sin(i * 2.4) * 480, 65 + i % 4 * 16, Math.cos(i * 2.4) * 480);
      for (let j = 0; j < 4; j++) { const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), cloudMat); puff.position.x = j * 15; puff.scale.set(22, 8 + j % 2 * 4, 12); g.add(puff); }
      this.scene.add(g);
    }
    // Sailboats give the open sea scale without loading external assets.
    for (let i = 0; i < 5; i++) {
      const boat = new THREE.Group(); boat.position.set(125 + i * 32, -3.5, -110 + i * 64); boat.rotation.y = i * 0.7;
      this.box(boat, [2.5, 1, 8], [0, 0, 0], white); this.box(boat, [0.12, 10, 0.12], [0, 5, 0], navy);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 0, 0, 9.5, 0, 0, 1, 5.5], 3)); geo.computeVertexNormals();
      const sail = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#fff5d7', side: THREE.DoubleSide })); boat.add(sail); this.scene.add(boat);
    }
  }

  private buildCar() {
    const cream = mat('#f2edda', 0.35), dark = mat('#17333b', 0.36), orange = mat('#ee7952', 0.4);
    const rubber = mat('#17282c'); const metal = mat('#b8c7bb', 0.35);
    this.car.add(this.body); this.scene.add(this.car);
    this.box(this.body, [2.12, 0.46, 4.15], [0, 0.69, 0], cream);
    this.box(this.body, [2.28, 0.25, 3.65], [0, 0.44, 0], dark);
    const hood = this.box(this.body, [1.95, 0.28, 1.4], [0, 0.95, 1.2], cream); hood.rotation.x = 0.10;
    this.box(this.body, [0.35, 0.016, 1.45], [-0.42, 1.11, 1.2], orange);
    const cabinGeo = new THREE.BufferGeometry();
    cabinGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -.86, .87, -1.32, .86, .87, -1.32, .86, .87, .83, -.86, .87, .83,
      -.7, 1.45, -.91, .7, 1.45, -.91, .7, 1.45, .12, -.7, 1.45, .12,
    ], 3));
    cabinGeo.setIndex([0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0,4,7,6,4,6,5]); cabinGeo.computeVertexNormals();
    const cabin = new THREE.Mesh(cabinGeo, dark); cabin.castShadow = true; this.body.add(cabin);
    this.box(this.body, [1.45, 0.10, 1.07], [0, 1.46, -0.4], cream);
    this.box(this.body, [0.35, 0.02, 1.08], [-0.42, 1.52, -0.4], orange);
    for (const x of [-1.12, 1.12]) for (const z of [-1.26, 1.3]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.33, 16), rubber); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.46, z); wheel.castShadow = true; this.car.add(wheel); this.wheels.push(wheel);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.345, 8), metal); rim.rotation.z = Math.PI / 2; rim.position.copy(wheel.position); this.car.add(rim);
    }
    for (const x of [-0.78, 0.78]) {
      this.box(this.body, [0.57, 0.12, 0.08], [x, 0.77, 2.09], new THREE.MeshBasicMaterial({ color: '#fff4c8' }));
      this.box(this.body, [0.6, 0.13, 0.08], [x, 0.79, -2.09], new THREE.MeshBasicMaterial({ color: '#f26942' }));
      this.box(this.body, [0.12, 0.5, 0.17], [x, 1.03, -1.67], dark);
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.35, 10), dark); exhaust.rotation.x = Math.PI / 2; exhaust.position.set(x, 0.47, -2.1); this.body.add(exhaust);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2, 9), new THREE.MeshBasicMaterial({ color: '#8af5e9', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.rotation.x = -Math.PI / 2; flame.position.set(x, 0.5, -3); flame.visible = false; this.body.add(flame); this.flames.push(flame);
    }
    this.box(this.body, [2.45, 0.15, 0.52], [0, 1.3, -1.78], dark);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.24), this.textSign('RUSH 01', '#183940', '#e7ebdb', 256, 80)); plate.position.set(0, 0.64, -2.09); plate.rotation.y = Math.PI; this.body.add(plate);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  reset(s: CarState) {
    const forward = new THREE.Vector3(Math.sin(s.heading), 0, Math.cos(s.heading));
    this.cameraPosition.set(s.x, 6.2, s.z).addScaledVector(forward, -11.8);
    this.cameraTarget.set(s.x, 1.4, s.z).addScaledVector(forward, 11);
    this.camera.position.copy(this.cameraPosition); this.camera.lookAt(this.cameraTarget);
  }

  render(s: CarState, dt: number, active: boolean) {
    this.elapsed += dt; this.water.uniforms.time.value = this.elapsed;
    this.car.position.set(s.x, 0.07, s.z); this.car.rotation.y = s.heading;
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, -s.steer * s.speed / 61 * 0.07, 1 - Math.exp(-8 * dt));
    this.body.rotation.x = Math.sin(this.elapsed * 28) * s.speed / 61 * 0.007;
    for (const wheel of this.wheels) wheel.rotation.x += s.speed * dt / 0.46;
    const boost = s.nitroTime > 0 || s.miniTime > 0;
    this.flames.forEach((f, i) => { f.visible = active && boost; f.scale.set(1, (s.nitroTime > 0 ? 1.4 : 0.8) + Math.sin(this.elapsed * 70 + i) * 0.25, 1); });
    if (s.event === 'collision') this.impact = 0.2;
    this.impact = Math.max(0, this.impact - dt);
    const angle = s.velocityAngle + Math.atan2(Math.sin(s.heading - s.velocityAngle), Math.cos(s.heading - s.velocityAngle)) * 0.3;
    const forward = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const desired = new THREE.Vector3(s.x, 5.9 + s.speed / 61 * 0.9, s.z).addScaledVector(forward, -11.8 - s.speed / 61 * 2);
    this.cameraPosition.lerp(desired, 1 - Math.exp(-6 * dt));
    this.cameraTarget.lerp(new THREE.Vector3(s.x, 1.2, s.z).addScaledVector(forward, 12), 1 - Math.exp(-10 * dt));
    this.camera.position.copy(this.cameraPosition);
    if (!this.reducedMotion && this.impact > 0) this.camera.position.x += Math.sin(this.elapsed * 90) * this.impact;
    this.camera.lookAt(this.cameraTarget);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 58 + (this.reducedMotion ? 0 : s.speed / 61 * 8 + (boost ? 5 : 0)), 1 - Math.exp(-3 * dt));
    this.camera.updateProjectionMatrix();
    this.effects(s, dt, active);
    this.renderer.render(this.scene, this.camera);
  }

  private effects(s: CarState, dt: number, active: boolean) {
    this.markTime += dt; this.particleTick += dt;
    if (active && s.drifting && this.markTime > 0.022) {
      this.markTime = 0;
      for (const side of [-1, 1]) {
        const x = s.x + Math.cos(s.heading) * side - Math.sin(s.heading) * 1.3;
        const z = s.z - Math.sin(s.heading) * side - Math.cos(s.heading) * 1.3;
        this.dummy.position.set(x, 0.046, z); this.dummy.rotation.set(-Math.PI / 2, 0, -s.velocityAngle); this.dummy.scale.setScalar(1); this.dummy.updateMatrix();
        this.marks.setMatrixAt(this.markIndex++ % 1200, this.dummy.matrix);
        if (this.particleTick > 0.035) {
          const i = this.particleIndex++ % 160; this.particlePositions.set([x, 0.4, z], i * 3); this.particleLife[i] = 1;
        }
      }
      this.marks.instanceMatrix.needsUpdate = true;
      if (this.particleTick > 0.035) this.particleTick = 0;
    }
    for (let i = 0; i < 160; i++) {
      if (this.particleLife[i] > 0) { this.particleLife[i] -= dt; this.particlePositions[i * 3 + 1] += dt * 1.8; this.particlePositions[i * 3] += dt * 0.5; }
      else this.particlePositions[i * 3 + 1] = -999;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }

  get drawCalls() { return this.renderer.info.render.calls; }
}
