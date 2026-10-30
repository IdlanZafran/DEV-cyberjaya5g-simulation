/* =========================================================================
   main.js - wires everything together and runs the fixed-step loop.
   Physics runs at 60 Hz simulated time, independent of the display rate,
   so results are the same at every playback speed.
   ========================================================================= */
(() => {
  const STEP = 1 / 60;
  const $ = (sel) => document.querySelector(sel);

  const canvas = $('#sim-canvas');
  const sim = new CJ.Simulation();
  const renderer = new CJ.Renderer(canvas);
  CJ.ui.init(sim);
  CJ.sim = sim;            // handy for debugging in the console
  CJ.renderer = renderer;

  let paused = false;
  let speed = 1;
  let accumulator = 0;
  let lastFrame = performance.now();
  let uiTimer = 0;

  function loadScenario(name) {
    const def = CJ.scenarios[name];
    if (!def) return;
    CJ.ui.setScenario(def);
    def.setup(sim);
    sim.density = sim.density * Number($('#density').value);
    document.querySelectorAll('.scenario-btn').forEach((b) => b.classList.toggle('active', b.dataset.scenario === name));
  }

  function frame(now) {
    const realDt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!paused) {
      accumulator += realDt * speed;
      let steps = 0;
      while (accumulator >= STEP && steps < 40) {
        sim.step(STEP);
        accumulator -= STEP;
        steps++;
      }
    }
    renderer.render(sim);
    uiTimer += realDt;
    if (uiTimer > 0.1) {
      uiTimer = 0;
      CJ.ui.update();
    }
    requestAnimationFrame(frame);
  }

  // ---- controls ----------------------------------------------------------------
  document.querySelectorAll('.scenario-btn').forEach((btn) => btn.addEventListener('click', () => loadScenario(btn.dataset.scenario)));

  $('#system-enabled').addEventListener('change', (ev) => {
    sim.controller.systemEnabled = ev.target.checked;
    $('#system-state').textContent = ev.target.checked ? 'ON' : 'OFF';
    CJ.ui.log(ev.target.checked ? 'ok' : 'crit', 'SYSTEM', ev.target.checked ? 'anti-collision logic enabled' : 'anti-collision logic DISABLED');
  });

  $('#btn-pause').addEventListener('click', () => {
    paused = !paused;
    $('#btn-pause').textContent = paused ? '▶ Play' : '⏸ Pause';
    CJ.audio.pause(paused);
  });
  document.querySelectorAll('#speed-buttons button').forEach((btn) => btn.addEventListener('click', () => {
    speed = Number(btn.dataset.speed);
    document.querySelectorAll('#speed-buttons button').forEach((b) => b.classList.toggle('active', b === btn));
  }));
  $('#density').addEventListener('input', (ev) => {
    const v = Number(ev.target.value);
    $('#density-value').textContent = `${v.toFixed(1)}×`;
    sim.density = v;
  });
  $('#show-sensors').addEventListener('change', (ev) => { renderer.options.sensors = ev.target.checked; });
  $('#show-labels').addEventListener('change', (ev) => { renderer.options.labels = ev.target.checked; });

  $('#btn-spawn-violator').addEventListener('click', () => {
    // pick the approach whose light is currently red, choose its emptiest lane
    const redLanes = CJ.world.lanes.filter((l) => sim.controller.signalFor(l.approach).color !== 'GREEN');
    const pool = redLanes.length ? redLanes : CJ.world.lanes;
    const lane = pool.sort((a, b) => a.vehicles.length - b.vehicles.length)[0];
    const last = lane.vehicles[lane.vehicles.length - 1];
    if (last && last.rearS < 30) return CJ.ui.log('d', 'SPAWN', 'lane entrance busy, try again');
    sim.spawn(lane, 'violator', { s: 0, v: CJ.config.vehicleTypes.violator.v0 });
    CJ.ui.log('warn', 'SPAWN', `red-light runner on ${lane.id} (${CJ.world.approaches[lane.approach].short})`);
  });

  $('#btn-reset-emergency').addEventListener('click', () => {
    sim.clearWrecks();
    sim.controller.resetEmergency();
  });
  $('#btn-silence').addEventListener('click', () => CJ.ui.silenceAlarm());
  $('#btn-sound').addEventListener('click', () => {
    CJ.audio.setEnabled(!CJ.audio.enabled);
    $('#btn-sound').textContent = CJ.audio.enabled ? '🔊 Sound on' : '🔇 Sound off';
  });
  $('#btn-clear-wreck').addEventListener('click', () => {
    sim.clearWrecks();
    CJ.ui.hideUndetected();
  });

  // ---- camera: zoom / pan --------------------------------------------------------
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    renderer.zoomAt(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX - rect.left, ev.clientY - rect.top);
  }, { passive: false });
  let drag = null;
  canvas.addEventListener('pointerdown', (ev) => { drag = { x: ev.clientX, y: ev.clientY }; canvas.setPointerCapture(ev.pointerId); });
  canvas.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    renderer.pan(ev.clientX - drag.x, ev.clientY - drag.y);
    drag = { x: ev.clientX, y: ev.clientY };
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('dblclick', () => renderer.fit());
  $('#btn-zoom-in').addEventListener('click', () => renderer.zoomAt(1.3, renderer.width / 2, renderer.height / 2));
  $('#btn-zoom-out').addEventListener('click', () => renderer.zoomAt(1 / 1.3, renderer.width / 2, renderer.height / 2));
  $('#btn-zoom-fit').addEventListener('click', () => renderer.fit());
  $('#btn-zoom-box').addEventListener('click', () => {
    renderer.camera = { x: 0, y: 0, scale: Math.min(renderer.width / 90, renderer.height / 65) };
  });

  new ResizeObserver(() => { renderer.resize(); }).observe(canvas);
  document.addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'INPUT') return;
    if (ev.key === ' ') { ev.preventDefault(); $('#btn-pause').click(); }
    const map = { 1: 'normal', 2: 'nearMiss', 3: 'collision', 4: 'emergency' };
    if (map[ev.key]) loadScenario(map[ev.key]);
  });

  loadScenario('normal');
  requestAnimationFrame(frame);
})();
