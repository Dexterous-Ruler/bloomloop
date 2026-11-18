/**
 * The drum that draws a name: a glass sphere of marbles, one per student.
 *
 * Who is drawn is decided before anything moves, by one uniform draw from the
 * operating system's random source (see teach/Draw.jsx). The drum is how the
 * room watches that result arrive: the marbles are tumbled, they settle, and
 * the one already chosen is lifted out. A drum whose physics picked the winner
 * would favour whoever happened to sit where it tends to stop, and a teacher
 * has to be able to say the pick was fair.
 *
 * The marbles are rigid bodies in ammo.js (Bullet): they collide with each
 * other properly, which is what makes a tumble look like a tumble. The glass is
 * not a mesh in the physics world - a ball leaving the sphere is simply put
 * back and reflected, which cannot tunnel. Three.js draws it.
 *
 * Both libraries are large, so both are imported on demand, and only on the
 * teacher's screen. Nothing renders unless something is moving. If WebGL or
 * the engine is unavailable the drum reports `ready: false` and the draw still
 * works without the picture.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { LEVELS } from '../lib/bloom.js';
import { gsap, reduced } from '../lib/motion.js';
import { onThemeChange, token } from '../lib/theme.js';

const R = 1;                 // drum radius, in world units
const MAX_BALLS = 120;
const G = 16;

const levelIndex = (l) => Math.max(0, LEVELS.indexOf(l));

async function load() {
  const [THREE, ammoMod, wasm] = await Promise.all([
    import('three'),
    import('ammojs3/dist/ammo.wasm.js'),
    import('ammojs3/dist/ammo.wasm.wasm?url'),
  ]);
  const factory = ammoMod.default ?? ammoMod;
  // The factory assigns to `this`, which a module leaves undefined: give it one.
  const Ammo = await factory.call({}, { locateFile: () => wasm.default });
  return { THREE, Ammo };
}

/**
 * @param balls  [{ id, level }] - who is in the drum right now
 * ref: { draw(id) -> Promise, ready }
 */
const Drum = forwardRef(function Drum({ balls, size = 320 }, ref) {
  const host = useRef(null);
  const eng = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // ---- build once ---------------------------------------------------------
  useEffect(() => {
    let dead = false;
    let cleanup = () => {};

    load().then(({ THREE, Ammo }) => {
      if (dead || !host.current) return;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(size, size, false);
      host.current.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
      camera.position.set(0, 0.15, 3.9);
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.9));
      const key = new THREE.DirectionalLight(0xffffff, 1.4);
      key.position.set(1.5, 3, 2.5);
      scene.add(key);

      // The glass: a faint body and a rim, so it reads on either theme.
      const glass = new THREE.Mesh(
        new THREE.SphereGeometry(R * 1.04, 48, 32),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.07, depthWrite: false }),
      );
      const rim = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, i) => {
          const a = (i / 96) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(a) * R * 1.07, Math.sin(a) * R * 1.07, 0);
        })),
        new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 }),
      );
      scene.add(glass, rim);

      const materials = LEVELS.map(() => new THREE.MeshLambertMaterial());
      const paint = () => {
        materials.forEach((m, i) => m.color.set(token(`--l${i + 1}`) || '#888888'));
        const ink = token('--text') || '#111111';
        glass.material.color.set(ink);
        rim.material.color.set(ink);
      };
      paint();
      const offTheme = onThemeChange(() => { paint(); renderer.render(scene, camera); });

      // physics
      const cfg = new Ammo.btDefaultCollisionConfiguration();
      const dispatcher = new Ammo.btCollisionDispatcher(cfg);
      const broadphase = new Ammo.btDbvtBroadphase();
      const solver = new Ammo.btSequentialImpulseConstraintSolver();
      const world = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, cfg);
      const gravity = new Ammo.btVector3(0, -G, 0);
      world.setGravity(gravity);
      const tmp = new Ammo.btTransform();
      const vec = new Ammo.btVector3(0, 0, 0);

      const e = {
        THREE, Ammo, renderer, scene, camera, world, gravity, tmp, vec, materials,
        items: [], r: 0.2, on: false, until: 0, held: null, geo: null,
      };

      // Keep every ball inside the sphere: put it back on the glass and take
      // the outward part of its velocity, with a little lost to the bounce.
      const contain = () => {
        const lim = R - e.r;
        e.items.forEach((it) => {
          if (it === e.held) return;
          it.body.getMotionState().getWorldTransform(tmp);
          const o = tmp.getOrigin();
          const x = o.x(); const y = o.y(); const z = o.z();
          const d = Math.hypot(x, y, z);
          if (d > lim) {
            const nx = x / d; const ny = y / d; const nz = z / d;
            o.setValue(nx * lim, ny * lim, nz * lim);
            tmp.setOrigin(o);
            it.body.setWorldTransform(tmp);
            it.body.getMotionState().setWorldTransform(tmp);
            const v = it.body.getLinearVelocity();
            const out = v.x() * nx + v.y() * ny + v.z() * nz;
            if (out > 0) {
              vec.setValue(v.x() - 1.6 * out * nx, v.y() - 1.6 * out * ny, v.z() - 1.6 * out * nz);
              it.body.setLinearVelocity(vec);
            }
          }
          it.mesh.position.set(o.x(), o.y(), o.z());
        });
      };

      const tick = (_t, deltaMs) => {
        world.stepSimulation(Math.min(deltaMs / 1000, 1 / 30), 4, 1 / 120);
        contain();
        renderer.render(scene, camera);
        if (performance.now() > e.until) { gsap.ticker.remove(tick); e.on = false; }
      };
      // Run for `ms` and then stop: nothing here renders while nothing moves.
      e.run = (ms) => {
        e.until = Math.max(e.until, performance.now() + ms);
        e.items.forEach((it) => it.body.activate(true));
        if (!e.on) { e.on = true; gsap.ticker.add(tick); }
      };
      e.setGravity = (x, y) => { gravity.setValue(x, y, 0); world.setGravity(gravity); };

      e.clear = () => {
        e.items.forEach((it) => {
          if (!it.out) world.removeRigidBody(it.body);
          scene.remove(it.mesh);
          Ammo.destroy(it.body.getMotionState()); Ammo.destroy(it.body); Ammo.destroy(it.shape);
        });
        e.items = [];
        e.geo?.dispose();
        e.held = null;
      };

      e.fill = (list) => {
        e.clear();
        const shown = list.slice(0, MAX_BALLS);
        const n = Math.max(1, shown.length);
        e.r = R * Math.min(0.2, Math.cbrt(0.14 / n));
        e.geo = new THREE.SphereGeometry(e.r, 24, 16);
        const inertia = new Ammo.btVector3(0, 0, 0);
        shown.forEach((b, i) => {
          // Start loosely stacked in the lower half so they settle, not explode.
          const a = i * 2.399963;
          const rad = Math.min(R - e.r * 1.4, 0.18 + 0.62 * Math.sqrt((i + 0.5) / n));
          const x = Math.cos(a) * rad * 0.7; const z = Math.sin(a) * rad * 0.7;
          const y = -0.55 + (i / n) * 0.9;
          const shape = new Ammo.btSphereShape(e.r);
          shape.calculateLocalInertia(1, inertia);
          tmp.setIdentity(); vec.setValue(x, y, z); tmp.setOrigin(vec);
          const info = new Ammo.btRigidBodyConstructionInfo(1, new Ammo.btDefaultMotionState(tmp), shape, inertia);
          const body = new Ammo.btRigidBody(info);
          Ammo.destroy(info);
          body.setRestitution(0.45); body.setFriction(0.35); body.setDamping(0.08, 0.3);
          world.addRigidBody(body);
          const mesh = new THREE.Mesh(e.geo, materials[levelIndex(b.level)]);
          mesh.position.set(x, y, z);
          scene.add(mesh);
          e.items.push({ id: b.id, body, shape, mesh });
        });
        Ammo.destroy(inertia);
        e.setGravity(0, -G);
        if (reduced()) { renderer.render(scene, camera); return; }
        e.run(1600);
      };

      eng.current = e;
      setReady(true);

      cleanup = () => {
        gsap.ticker.remove(tick);
        offTheme();
        e.clear();
        Ammo.destroy(world); Ammo.destroy(solver); Ammo.destroy(broadphase); Ammo.destroy(dispatcher); Ammo.destroy(cfg);
        Ammo.destroy(gravity); Ammo.destroy(tmp); Ammo.destroy(vec);
        materials.forEach((m) => m.dispose());
        glass.geometry.dispose(); glass.material.dispose(); rim.geometry.dispose(); rim.material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        eng.current = null;
      };
    }).catch(() => { if (!dead) setFailed(true); });

    return () => { dead = true; cleanup(); };
  }, [size]);

  // ---- keep the drum's contents in step with `balls` ----------------------
  const key = balls.map((b) => `${b.id}:${b.level}`).join('|');
  useEffect(() => {
    if (ready) eng.current?.fill(balls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);

  useImperativeHandle(ref, () => ({
    ready,
    /** Tumble, settle, and lift out the marble for `id`. Resolves when it is out. */
    draw(id, level) {
      const e = eng.current;
      if (!e || !ready) return Promise.resolve();
      let it = e.items.find((x) => x.id === id);
      // More students than marbles: any marble can stand in, in the right colour.
      if (!it && e.items.length) {
        it = e.items[Math.floor(Math.random() * e.items.length)];
        it.mesh.material = e.materials[levelIndex(level)];
      }
      if (!it) return Promise.resolve();

      if (reduced()) {
        e.held = it;
        it.mesh.position.set(0, 0.05, R * 1.25); it.mesh.scale.setScalar(Math.min(2.4, 0.34 / e.r));
        e.renderer.render(e.scene, e.camera);
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const spin = { a: 0 };
        e.run(5200);
        gsap.timeline({ onComplete: resolve })
          // Gravity swings round twice, which is what a turning drum does to
          // what is inside it.
          .to(spin, {
            a: Math.PI * 4, duration: 2.6, ease: 'power1.inOut',
            onUpdate: () => e.setGravity(Math.sin(spin.a) * G * 1.5, -Math.cos(spin.a) * G * 1.5),
            onComplete: () => e.setGravity(0, -G),
          })
          .add(() => {
            // Out of the physics, into the hand.
            e.held = it;
            it.out = true;
            e.world.removeRigidBody(it.body);
          }, '+=0.7')
          .to(it.mesh.position, { x: 0, y: 0.05, z: R * 1.25, duration: 0.7, ease: 'expo.out' })
          .to(it.mesh.scale, { x: Math.min(2.4, 0.34 / e.r), y: Math.min(2.4, 0.34 / e.r), z: Math.min(2.4, 0.34 / e.r), duration: 0.7, ease: 'expo.out' }, '<');
      });
    },
  }), [ready]);

  return (
    <div className="drum" style={{ width: size, height: size }} data-failed={failed ? 'true' : undefined}>
      <div ref={host} className="drum-stage" aria-hidden="true" />
      {!ready && !failed && <div className="skel drum-wait" />}
    </div>
  );
});

export default Drum;
