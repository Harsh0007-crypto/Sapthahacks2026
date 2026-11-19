import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MiniMascot } from './Mascot2D';

function detectWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * "Fixie" 3D scene: original mascot built from primitives, orbiting spreadsheet
 * chips and a light particle field.
 *  - looks toward the cursor
 *  - reacts to scroll velocity
 *  - blinks, bobs, waves
 *  - celebrates on window event "datafix:celebrate"
 * variant: 'hero' | 'cta'
 */
export default function MascotScene({ variant = 'hero', className = '' }) {
  const mountRef = useRef(null);
  const [supported] = useState(detectWebGL);

  useEffect(() => {
    if (!supported) return undefined;
    const mount = mountRef.current;
    if (!mount) return undefined;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobile = window.innerWidth < 720;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.75));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.1, variant === 'cta' ? 7.8 : 8.1);

    // Lighting
    scene.add(new THREE.AmbientLight(0xaecbff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 4, 5);
    scene.add(key);
    const rim = new THREE.PointLight(0x22d3ee, 18, 14);
    rim.position.set(-3.5, 1.5, 2.5);
    scene.add(rim);
    const violet = new THREE.PointLight(0x8b5cf6, 16, 14);
    violet.position.set(3.5, -1.2, 2);
    scene.add(violet);

    // ── Mascot ─────────────────────────────────────────────
    const rig = new THREE.Group();
    const baseY = variant === 'cta' ? -0.18 : -0.12;
    rig.position.y = baseY;
    scene.add(rig);

    const bot = new THREE.Group();
    const head = new THREE.Group();
    bot.add(head);

    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xeaf4ff,
      roughness: 0.28,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.15,
    });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x0a1430, roughness: 0.12, metalness: 0.65 });
    const glowCyan = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
    const earMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.7, roughness: 0.3 });
    const violetMat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 1.4 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), bodyMat);
    body.scale.set(1, 1.08, 0.92);
    head.add(body);

    const visor = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), visorMat);
    visor.scale.set(0.78, 0.5, 0.42);
    visor.position.set(0, 0.12, 0.58);
    head.add(visor);

    const eyeGeo = new THREE.CapsuleGeometry(0.07, 0.13, 6, 12);
    const eyeL = new THREE.Mesh(eyeGeo, glowCyan);
    const eyeR = new THREE.Mesh(eyeGeo, glowCyan);
    eyeL.position.set(-0.26, 0.17, 0.99);
    eyeR.position.set(0.26, 0.17, 0.99);
    head.add(eyeL, eyeR);

    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 8, 24, Math.PI), glowCyan);
    smile.rotation.z = Math.PI;
    smile.position.set(0, 0.01, 0.99);
    head.add(smile);

    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.4, 10),
      new THREE.MeshStandardMaterial({ color: 0xb7c6ee, roughness: 0.4 })
    );
    antenna.position.y = 1.25;
    head.add(antenna);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), violetMat);
    bulb.position.y = 1.5;
    head.add(bulb);

    const earGeo = new THREE.SphereGeometry(0.17, 20, 16);
    const earL = new THREE.Mesh(earGeo, earMat);
    const earR = new THREE.Mesh(earGeo, earMat);
    earL.scale.set(0.6, 1, 1);
    earR.scale.set(0.6, 1, 1);
    earL.position.set(-1.0, 0.1, 0);
    earR.position.set(1.0, 0.1, 0);
    head.add(earL, earR);

    const armGeo = new THREE.CapsuleGeometry(0.08, 0.28, 6, 10);
    const armL = new THREE.Mesh(armGeo, bodyMat);
    const armR = new THREE.Mesh(armGeo, bodyMat);
    armL.position.set(-1.05, -0.55, 0.25);
    armR.position.set(1.05, -0.55, 0.25);
    armL.rotation.z = 0.5;
    armR.rotation.z = -0.5;
    bot.add(armL, armR);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.95, 0.022, 8, 72),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.6 })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -1.5;
    rig.add(halo);

    const botScale = variant === 'cta' ? 1.06 : 0.98;
    bot.scale.setScalar(botScale);
    rig.add(bot);

    // ── Orbiting spreadsheet chips (messy → tidy palette) ──
    const chipColors = [0xfbbf24, 0xfb7185, 0x22d3ee, 0x3b82f6, 0xa78bfa, 0xe6efff];
    const chipCount = isMobile ? 8 : 14;
    const chips = [];
    for (let i = 0; i < chipCount; i += 1) {
      const color = chipColors[i % chipColors.length];
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.58, 0.28, 0.05),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.28,
          roughness: 0.45,
          metalness: 0.1,
        })
      );
      chips.push({
        mesh,
        radius: 1.95 + (i % 5) * 0.22,
        speed: 0.18 + (i % 4) * 0.05,
        phase: (i / chipCount) * Math.PI * 2,
        y: -1.05 + ((i * 37) % 100) / 100 * 2.25,
        tilt: ((i * 13) % 10) / 10 - 0.5,
      });
      rig.add(mesh);
    }

    // ── Particles ─────────────────────────────────────────
    const pCount = isMobile ? 120 : 260;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i += 1) {
      const r = 2.6 + Math.random() * 2.8;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pPos[i * 3 + 1] = r * Math.cos(ph) * 0.65;
      pPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) - 1;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        color: 0x67e8f9,
        size: 0.035,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    rig.add(particles);

    // ── Interaction state ─────────────────────────────────
    const pointer = { x: 0, y: 0 };
    const look = { x: 0, y: 0 };
    let celebrate = 0;
    let hovered = false;
    let hoverEnergy = 0;
    let lastScroll = window.scrollY;
    let scrollVel = 0;
    let visible = true;
    let nextBlink = 2.5;
    let blinkT = 0;

    const onPointer = (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onCelebrate = () => {
      celebrate = 1.4;
    };
    const onEnter = () => {
      hovered = true;
    };
    const onLeave = () => {
      hovered = false;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('datafix:celebrate', onCelebrate);
    mount.addEventListener('pointerenter', onEnter);
    mount.addEventListener('pointerleave', onLeave);

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      const aspect = w / h;
      renderer.setSize(w, h, false);
      camera.aspect = aspect;

      // Guarantee full horizontal + vertical clearance for Fixie's antenna, jump, and orbiting chips
      const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const requiredHalfH = variant === 'cta' ? 2.65 : 2.55;
      const requiredHalfW = 3.35;
      const zForH = requiredHalfH / tanHalfFov;
      const zForW = requiredHalfW / (tanHalfFov * Math.max(aspect, 0.55));
      camera.position.z = Math.min(13.2, Math.max(zForH, zForW));

      // On wide desktop hero, nudge Fixie slightly right inside the wider unclipped stage;
      // on narrow mobile hero, lower slightly so speech bubbles never touch the antenna tip
      if (variant === 'hero' && window.innerWidth > 960) {
        rig.position.x = 0.55;
        rig.position.y = baseY;
      } else {
        rig.position.x = 0;
        rig.position.y = variant === 'hero' && window.innerWidth <= 560 ? -0.34 : baseY;
      }

      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0.01 }
    );
    io.observe(mount);

    const clock = new THREE.Clock();
    let raf = 0;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible && !reduced) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;

      const sy = window.scrollY;
      scrollVel = scrollVel * 0.9 + (sy - lastScroll) * 0.0009;
      lastScroll = sy;

      // look toward cursor (head + eyes)
      look.x += (pointer.x - look.x) * 0.07;
      look.y += (pointer.y - look.y) * 0.07;
      head.rotation.y = look.x * 0.55;
      head.rotation.x = look.y * 0.28;
      eyeL.position.x = -0.26 + look.x * 0.05;
      eyeR.position.x = 0.26 + look.x * 0.05;

      // hover energy & idle bob + scroll reaction
      hoverEnergy += ((hovered ? 1 : 0) - hoverEnergy) * 0.08;
      bot.position.y = Math.sin(t * 1.25) * 0.1 + hoverEnergy * 0.14;
      bot.scale.setScalar(botScale * (1 + hoverEnergy * 0.045));
      bot.rotation.z = Math.sin(t * 0.8) * 0.03 + THREE.MathUtils.clamp(scrollVel, -0.25, 0.25);
      halo.scale.setScalar(1 + Math.sin(t * 1.25) * 0.04 + hoverEnergy * 0.08);
      bulb.material.emissiveIntensity = 1.1 + Math.sin(t * 3) * 0.4 + hoverEnergy * 0.8;

      // blink
      if (t > nextBlink) {
        blinkT = 0.16;
        nextBlink = t + 2.5 + Math.random() * 2.5;
      }
      let eyeScaleY = 1 + hoverEnergy * 0.12;
      if (blinkT > 0) {
        blinkT -= dt;
        eyeScaleY = Math.max(0.1, Math.abs(blinkT / 0.16 - 0.5) * 2);
      }

      // arm wave + hover greeting + celebration
      const wave = Math.sin(t * 1.6) * 0.08;
      if (celebrate > 0) {
        celebrate = Math.max(0, celebrate - dt);
        const k = celebrate / 1.4;
        const progress = 1 - k;
        const jump = Math.abs(Math.sin(progress * Math.PI * 2)) * 0.52 * Math.sin(progress * Math.PI);
        bot.position.y += jump;
        bot.rotation.y = progress * Math.PI * 2;
        armL.rotation.z = 2.35 + Math.sin(t * 16) * 0.22;
        armR.rotation.z = -2.35 - Math.sin(t * 16) * 0.22;
        eyeScaleY = 0.58;
      } else {
        bot.rotation.y += (0 - bot.rotation.y) * 0.14;
        const targetArmL = 0.5 + wave;
        const targetArmR = hovered
          ? -2.1 + Math.sin(t * 9.5) * 0.28
          : -0.5 - wave;
        armL.rotation.z += (targetArmL - armL.rotation.z) * 0.14;
        armR.rotation.z += (targetArmR - armR.rotation.z) * 0.14;
      }
      eyeL.scale.y = eyeScaleY;
      eyeR.scale.y = eyeScaleY;

      // orbiting chips
      for (let i = 0; i < chips.length; i += 1) {
        const c = chips[i];
        const a = c.phase + t * c.speed;
        c.mesh.position.set(
          Math.cos(a) * c.radius,
          c.y + Math.sin(t * 0.9 + c.phase) * 0.18,
          Math.sin(a) * c.radius * 0.55 - 0.4
        );
        c.mesh.rotation.set(c.tilt + t * 0.2, a * 0.6, c.tilt * 0.8);
      }

      particles.rotation.y = t * 0.03;
      camera.position.x += ((look.x * 0.28) - camera.position.x) * 0.04;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };

    if (reduced) {
      // single static frame, no continuous animation
      frame();
      cancelAnimationFrame(raf);
    } else {
      frame();
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('datafix:celebrate', onCelebrate);
      mount.removeEventListener('pointerenter', onEnter);
      mount.removeEventListener('pointerleave', onLeave);
      ro.disconnect();
      io.disconnect();
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [supported, variant]);

  if (!supported) {
    return (
      <div className={`lp-scene lp-scene--fallback ${className}`}>
        <MiniMascot size={220} mood="idle" />
      </div>
    );
  }

  return <div ref={mountRef} className={`lp-scene ${className}`} aria-hidden="true" />;
}
