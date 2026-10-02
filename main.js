(() => {
  'use strict';

  // Every photo in the images/ folder. Add new files here.
  const IMAGES = [
    'gallery-1.jpg', 'gallery-2.jpg', 'gallery-3.jpg', 'gallery-4.jpg',
    'gallery-5.jpg', 'gallery-6.jpg', 'gallery-7.jpg', 'gallery-8.jpg',
    'gallery-9.jpg', 'gallery-10.jpeg', 'gallery-11.jpeg', 'gallery-12.jpeg',
    'gallery-13.jpeg', 'gallery-14.jpeg', 'gallery-15.jpeg', 'gallery-16.jpeg',
    'gallery-17.jpeg', 'gallery-18.jpeg', 'gallery-19.jpeg', 'gallery-20.jpeg',
    'gallery-21.jpeg', 'gallery-22.jpeg', 'gallery-23.jpeg', 'gallery-24.jpeg',
    'gallery-25.jpeg', 'gallery-26.jpeg', 'gallery-27.jpeg', 'gallery-28.jpeg',
    'gallery-29.jpeg', 'gallery-30.jpeg', 'gallery-31.jpeg', 'gallery-32.jpeg',
  ].map((name) => `images/${name}`);

  const CONFIG = {
    baseHeight: 320,      // layout units; the final on-screen size comes from the perspective
    sizeVariants: [1, 0.78, 1.16, 0.88, 1.06, 0.82, 0.96, 1.12],
    maxWidth: 2.1,        // widest photo, relative to baseHeight
    minGap: 0.32,         // minimum horizontal gap, relative to baseHeight
    rowPitch: 1.3,        // vertical distance between rows, relative to baseHeight
    jitterY: 0.05,
    fill: 0.86,           // share of the viewport height the rows occupy
    cameraBack: 0.35,     // camera offset behind the cylinder centre, relative to radius
    smoothing: 0.085,     // how quickly the rotation follows its target
    friction: 0.955,      // inertia decay per 60fps frame
    maxTilt: 5,           // degrees of vertical look following the mouse
    idleDelay: 3500,
    idleSpeed: 0.000045,  // radians per ms
  };

  const viewport = document.getElementById('viewport');
  const stage = document.getElementById('stage');
  const loader = document.getElementById('loader');
  const hint = document.getElementById('hint');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover)');

  let items = [];
  let radius = 1000;
  let perspective = 800;
  let camBack = 0;

  // Motion state (radians).
  let rotation = 0;
  let target = 0;
  let velocity = 0;
  let tilt = 0;
  let tiltTarget = 0;
  let lastInteraction = performance.now();

  // Pointer state.
  let drag = null;
  let mouse = null;
  let active = null;

  function seeded(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.draggable = false;
      img.alt = '';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function build(images) {
    const rand = seeded(7);
    items = images.filter(Boolean).map((img, i) => {
      const el = document.createElement('figure');
      el.className = 'item';
      el.appendChild(img);
      stage.appendChild(el);
      requestAnimationFrame(() => el.classList.add('loaded'));
      return {
        el,
        ratio: img.naturalWidth / img.naturalHeight,
        scale: CONFIG.sizeVariants[i % CONFIG.sizeVariants.length] * (0.94 + rand() * 0.12),
        jitter: (rand() * 2 - 1) * CONFIG.jitterY,
        angle: 0,
        y: 0,
        shade: -1,
        visible: true,
      };
    });
  }

  function layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rows = W / H < 0.8 ? 4 : 3;
    const base = CONFIG.baseHeight;

    // Size every photo by its original aspect ratio.
    for (const it of items) {
      let h = base * it.scale;
      let w = h * it.ratio;
      if (w > base * CONFIG.maxWidth) {
        w = base * CONFIG.maxWidth;
        h = w / it.ratio;
      }
      it.w = w;
      it.h = h;
    }

    // Spread photos over rows so every ring has roughly the same length.
    const ringItems = Array.from({ length: rows }, () => []);
    const ringLength = new Array(rows).fill(0);
    for (const it of items) {
      let r = 0;
      for (let k = 1; k < rows; k++) if (ringLength[k] < ringLength[r]) r = k;
      ringItems[r].push(it);
      ringLength[r] += it.w;
    }

    const gapMin = base * CONFIG.minGap;
    const circumference = Math.max(
      ...ringItems.map((list, r) => ringLength[r] + list.length * gapMin)
    );
    radius = circumference / (2 * Math.PI);
    camBack = radius * CONFIG.cameraBack;

    // Distribute each ring around the full circle, with a per-row offset.
    ringItems.forEach((list, r) => {
      const gap = (circumference - ringLength[r]) / Math.max(list.length, 1);
      const rowY = (r - (rows - 1) / 2) * base * CONFIG.rowPitch;
      let cursor = (r * 0.37 + 0.13) * (circumference / Math.max(list.length, 1));
      for (const it of list) {
        it.angle = (cursor + it.w / 2) / radius;
        it.y = rowY + it.jitter * base;
        cursor += it.w + gap;
        it.el.style.width = `${it.w}px`;
        it.el.style.height = `${it.h}px`;
        it.el.style.margin = `${-it.h / 2}px 0 0 ${-it.w / 2}px`;
        it.el.style.transform =
          `translateY(${it.y}px) rotateY(${it.angle}rad) translateZ(${-radius}px)`;
      }
    });

    // Pick the perspective so the rows fill the viewport height.
    const rowsHeight = ((rows - 1) * CONFIG.rowPitch + 1.1) * base;
    perspective = (CONFIG.fill * H * (radius + camBack)) / rowsHeight;
    viewport.style.setProperty('--perspective', `${perspective}px`);
    for (const it of items) it.shade = -1;
    render();
  }

  function render() {
    const tiltDeg = tilt * CONFIG.maxTilt;
    stage.style.transform =
      `translateZ(${perspective - camBack}px) rotateX(${tiltDeg}deg) rotateY(${rotation}rad)`;

    const halfFov = Math.atan(window.innerWidth / 2 / perspective);
    for (const it of items) {
      // Position of the photo as seen from the camera.
      const rel = it.angle + rotation;
      const x = -radius * Math.sin(rel);
      const depth = radius * Math.cos(rel) + camBack;
      const view = depth > radius * 0.05 ? Math.atan2(Math.abs(x) - it.w / 2, depth) : Infinity;
      const visible = view < halfFov * 1.05;

      if (visible !== it.visible) {
        it.visible = visible;
        it.el.classList.toggle('hidden', !visible);
      }
      if (!visible) continue;

      // Darken towards the edges for depth.
      const edge = Math.min(1, Math.max(0, (Math.atan2(Math.abs(x), depth) / halfFov - 0.35) / 0.65));
      const shade = Math.round(edge * edge * 0.8 * 100) / 100;
      if (shade !== it.shade) {
        it.shade = shade;
        it.el.style.setProperty('--shade', shade);
      }
    }
  }

  function setActive(el) {
    if (el === active) return;
    if (active) active.classList.remove('active');
    active = el;
    if (active) active.classList.add('active');
    stage.classList.toggle('focus', Boolean(active));
  }

  function itemAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('.item') : null;
  }

  function interacted() {
    lastInteraction = performance.now();
    hint.classList.add('done');
  }

  // Pointer pixels to radians: roughly keeps the front wall under the finger.
  function pxToRad(px) {
    return (px * (radius + camBack)) / (perspective * radius);
  }

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, startX: e.clientX, startY: e.clientY, t: e.timeStamp, moved: false };
    velocity = 0;
    interacted();
  });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && canHover.matches) {
      mouse = { x: e.clientX, y: e.clientY };
      tiltTarget = -((e.clientY / window.innerHeight) * 2 - 1);
    }
    if (!drag || e.pointerId !== drag.id) return;

    const dx = e.clientX - drag.x;
    const dt = Math.max(1, e.timeStamp - drag.t);
    const delta = -pxToRad(dx);
    target += delta;
    velocity = velocity * 0.6 + (delta / dt) * 0.4;
    drag.x = e.clientX;
    drag.t = e.timeStamp;

    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
      drag.moved = true;
      viewport.classList.add('dragging');
    }
    interacted();
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    // No fresh movement right before release means no throw.
    if (e.timeStamp - drag.t > 80) velocity = 0;
    // A tap on touch screens highlights a photo, since there is no hover.
    if (!drag.moved && e.pointerType !== 'mouse') {
      const el = itemAt(e.clientX, e.clientY);
      setActive(el === active ? null : el);
    }
    drag = null;
    viewport.classList.remove('dragging');
  }

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  document.documentElement.addEventListener('mouseleave', () => {
    mouse = null;
    tiltTarget = 0;
  });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    velocity += pxToRad(d) * 0.012;
    interacted();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') velocity -= 0.0016;
    else if (e.key === 'ArrowRight') velocity += 0.0016;
    else return;
    interacted();
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 100);
  });

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(64, now - last);
    last = now;
    const frames = dt / (1000 / 60);

    if (!drag) {
      target += velocity * dt;
      velocity *= Math.pow(CONFIG.friction, frames);
      if (Math.abs(velocity) < 1e-7) velocity = 0;

      // Gentle drift once the visitor stops interacting.
      if (!reduceMotion && !active && now - lastInteraction > CONFIG.idleDelay) {
        const ramp = Math.min(1, (now - lastInteraction - CONFIG.idleDelay) / 2500);
        target += CONFIG.idleSpeed * ramp * dt;
      }
    }

    rotation += (target - rotation) * (1 - Math.pow(1 - CONFIG.smoothing, frames));
    tilt += (tiltTarget - tilt) * (1 - Math.pow(1 - CONFIG.smoothing * 0.6, frames));
    render();

    // Keep hover in sync while photos move underneath a still cursor.
    if (mouse && !drag?.moved) setActive(itemAt(mouse.x, mouse.y));
    else if (!mouse && active && canHover.matches) setActive(null);

    requestAnimationFrame(tick);
  }

  Promise.all(IMAGES.map(loadImage)).then((images) => {
    build(images);
    layout();
    loader.classList.add('done');
    requestAnimationFrame((t) => {
      last = t;
      tick(t);
    });
  });
})();
