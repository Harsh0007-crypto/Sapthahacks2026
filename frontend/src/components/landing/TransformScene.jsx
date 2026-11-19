import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

function detectWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * Scroll-driven transformation: scattered "messy" points reorganize into a tidy
 * spreadsheet grid. progressRef.current (0..1) is written by GSAP ScrollTrigger.
 */
export default function TransformScene({ progressRef }) {
  const mountRef = useRef(null);
  const [supported] = useState(detectWebGL);

  useEffect(() => {
    if (!supported) return undefined;
    const mount = mountRef.current;
    if (!mount) return undefined;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobile = window.innerWidth < 720;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.6));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 10);

    const COLS = 8;
    const ROWS = isMobile ? 6 : 8;
    const PER_CELL = isMobile ? 8 : 14;
    const N = COLS * ROWS * PER_CELL;

    const messy = new Float32Array(N * 3);
    const clean = new Float32Array(N * 3);
    const cMess = new Float32Array(N * 3);
    const cClean = new Float32Array(N * 3);
    const delay = new Float32Array(N);
    const swirl = new Float32Array(N);
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);

    const messyPalette = [
      new THREE.Color(0xfbbf24),
      new THREE.Color(0xfb7185),
      new THREE.Color(0xa78bfa),
      new THREE.Color(0x94a3c4),
      new THREE.Color(0x22d3ee),
    ];
    const cleanCyan = new THREE.Color(0x67e8f9);
    const cleanBlue = new THREE.Color(0x60a5fa);
    const cleanHeader = new THREE.Color(0xc4b5fd);

    const cellW = isMobile ? 0.76 : 1.06;
    const cellH = isMobile ? 0.54 : 0.52;
    const startX = -((COLS - 1) * cellW) / 2;
    const centerY = isMobile ? -0.35 : -0.45;
    const startY = ((ROWS - 1) * cellH) / 2 + centerY;

    let idx = 0;
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        for (let k = 0; k < PER_CELL; k += 1) {
          const i = idx;
          idx += 1;
          messy[i * 3] = (Math.random() - 0.5) * 15;
          messy[i * 3 + 1] = (Math.random() - 0.5) * 8;
          messy[i * 3 + 2] = (Math.random() - 0.5) * 7;

          const frac = k / (PER_CELL - 1);
          clean[i * 3] = startX + c * cellW + (frac - 0.5) * (cellW * 0.62);
          clean[i * 3 + 1] = startY - r * cellH + (r === 0 ? 0 : 0);
          clean[i * 3 + 2] = 0;

          const mc = messyPalette[Math.floor(Math.random() * messyPalette.length)];
          cMess[i * 3] = mc.r;
          cMess[i * 3 + 1] = mc.g;
          cMess[i * 3 + 2] = mc.b;
          const cc = r === 0 ? cleanHeader : (c + r) % 3 === 0 ? cleanBlue : cleanCyan;
          cClean[i * 3] = cc.r;
          cClean[i * 3 + 1] = cc.g;
          cClean[i * 3 + 2] = cc.b;

          delay[i] = Math.random() * 0.4;
          swirl[i] = (Math.random() - 0.5) * 3.2;
        }
      }
    }
    positions.set(messy);
    colors.set(cMess);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const tex = makeDotTexture();
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: isMobile ? 0.2 : 0.17,
        map: tex,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      })
    );
    scene.add(points);

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.z = (w / h) < 0.8 ? 14.6 : 10.8;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let visible = true;
    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
      },
      { threshold: 0.01 }
    );
    io.observe(mount);

    const smooth = (x) => x * x * (3 - 2 * x);
    let shown = progressRef.current;
    let raf = 0;
    const clock = new THREE.Clock();

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible && !reduced) return;
      const t = clock.getElapsedTime();
      shown += (progressRef.current - shown) * 0.12;
      const p = shown;

      for (let i = 0; i < N; i += 1) {
        const local = Math.min(1, Math.max(0, (p * 1.45 - delay[i]) / 0.7));
        const e = smooth(local);
        const arc = Math.sin(local * Math.PI) * swirl[i];
        const wobble = (1 - e) * 0.12;
        const ix = i * 3;
        positions[ix] = messy[ix] + (clean[ix] - messy[ix]) * e + arc * 0.5 + Math.sin(t * 1.1 + i) * wobble;
        positions[ix + 1] = messy[ix + 1] + (clean[ix + 1] - messy[ix + 1]) * e + Math.cos(t * 0.9 + i) * wobble;
        positions[ix + 2] = messy[ix + 2] + (clean[ix + 2] - messy[ix + 2]) * e + arc * 0.3;
        colors[ix] = cMess[ix] + (cClean[ix] - cMess[ix]) * e;
        colors[ix + 1] = cMess[ix + 1] + (cClean[ix + 1] - cMess[ix + 1]) * e;
        colors[ix + 2] = cMess[ix + 2] + (cClean[ix + 2] - cMess[ix + 2]) * e;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;

      points.rotation.y = (1 - smooth(Math.min(1, p * 1.3))) * (0.55 + Math.sin(t * 0.3) * 0.12);
      points.rotation.x = (1 - smooth(Math.min(1, p * 1.3))) * 0.18;
      camera.position.y = (1 - p) * 0.6;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    frame();
    if (reduced) cancelAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      geo.dispose();
      tex.dispose();
      points.material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [supported, progressRef]);

  if (!supported) return <div className="lp-scene lp-scene--grid-fallback" aria-hidden="true" />;
  return <div ref={mountRef} className="lp-scene" aria-hidden="true" />;
}
