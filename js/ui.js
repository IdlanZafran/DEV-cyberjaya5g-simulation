/* =========================================================================
   ui.js - side panel, alert banners, scenario steps and event log.
   ========================================================================= */
(() => {
  const C = CJ.config;
  const W = CJ.world;
  const $ = (sel) => document.querySelector(sel);
  const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '--');
  const kmh = (ms) => `${Math.round(CJ.kmh(ms))} km/h`;
  const PHASE_SHORT = {
    NS_GREEN: ['PC G', 'g'], NS_YELLOW: ['PC Y', 'y'], ALL_RED_TO_EW: ['ALL R', 'r'],
    EW_GREEN: ['CP2 G', 'g'], EW_YELLOW: ['CP2 Y', 'y'], ALL_RED_TO_NS: ['ALL R', 'r'],
  };
  const groupName = (g) => (g === 'NS' ? 'Persiaran Ceria' : 'Jalan Cyber Point 2 / Jln Fauna 1');

  let sim = null;
  let awaitingRestore = false;
  let speedingHideTimer = null;
  let priorityHideTimer = null;
  let alarmSilenced = false;
  const dispatch = {};   // kind -> { eta, reason, arrived }
  const audio = () => CJ.audio || { beep() {}, startAlarm() {}, stopAlarm() {}, startSiren() {}, stopSiren() {}, stopAll() {} };

  function renderDispatch() {
    const lines = Object.entries(dispatch).map(([kind, d]) =>
      `${kind === 'police' ? '🚓 Police' : '🚑 Ambulance'}: ${d.arrived ? `on scene (${fmt(d.arrivedAfter)} s after impact)` : `en route, ETA ${fmt(d.eta)} s`}`);
    const any = Object.values(dispatch)[0];
    $('#alert-dispatch-title').textContent = any && any.reason.startsWith('bystander')
      ? 'Emergency services called by a bystander (no automatic alert)'
      : 'Emergency services dispatched automatically';
    $('#alert-dispatch-detail').textContent = lines.join(' · ');
    show('#alert-dispatch', lines.length > 0);
  }

  function clearDispatch() {
    for (const k of Object.keys(dispatch)) delete dispatch[k];
    show('#alert-dispatch', false);
    audio().stopSiren();
  }

  function log(cls, title, detail = '') {
    const li = document.createElement('li');
    li.innerHTML = `<time>${fmt(sim.time)}s</time><div><span class="${cls}"></span> <span class="d"></span></div>`;
    li.querySelector(`.${cls}`).textContent = title;
    li.querySelector('.d').textContent = detail;
    const list = $('#log');
    list.prepend(li);
    while (list.children.length > 120) list.lastChild.remove();
  }

  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  function markStep(key) {
    const li = [...document.querySelectorAll('#steps li')].find((el) => el.dataset.key === key && !el.classList.contains('done'));
    if (!li) return;
    li.classList.add('done');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = `t = ${fmt(sim.time)} s`;
    li.appendChild(t);
  }

  function onEvent(event, d) {
    markStep(event);
    switch (event) {
      case 'VEHICLE_MEASURED':
        if (d.violation || (d.speeding && d.color !== 'GREEN')) break; // logged via SPEEDING_DETECTED
        break;
      case 'SPEEDING_DETECTED': {
        audio().beep(2600, 90, 3);
        log('warn', 'SPEEDING DETECTED', `${d.lane} ${kmh(d.speed)} on ${d.color} → ${d.action}; box in ${fmt(d.timeToConflict)} s, clear in ${fmt(d.timeToClear)} s, ${groupName(d.protect)} green was due in ${fmt(d.untilGreen)} s`);
        $('#alert-speeding').classList.remove('resolved');
        $('#alert-speeding-detail').textContent =
          `${W.approaches[d.approach].short} lane ${d.lane.slice(1)} · ${kmh(d.speed)} (v_crit ${kmh(CJ.criticalSpeed)}) on ${d.color} · ` +
          (d.action === 'CUT_CROSS_GREEN' ? `${groupName(d.protect)} green CUT SHORT` : `${groupName(d.protect)} green delayed ≥ ${fmt(d.required)} s`) +
          ` · exit expected in ${fmt((d.window - C.exitWindowMargin) / C.exitWindowFactor)} s`;
        clearTimeout(speedingHideTimer);
        show('#alert-speeding', true);
        break;
      }
      case 'DILEMMA_ZONE_HOLD':
        log('warn', 'DILEMMA-ZONE HOLD', `${d.lane} ${kmh(d.speed)} on ${d.color} cannot stop comfortably → ${groupName(d.protect)} all-red extended as a precaution`);
        break;
      case 'PROTECTIVE_CUT':
        log('warn', 'PROTECTIVE CUT', `${groupName(d.group)} green terminated (yellow → all-red)`);
        break;
      case 'HOLD_STARTED':
        log('warn', 'CROSS TRAFFIC HELD', `${groupName(d.group)} kept on red (≥ ${fmt(d.required)} s beyond schedule)`);
        break;
      case 'SAFE_PASSAGE':
        log('ok', 'SAFE PASSAGE', `${d.lane} violator #${d.vehicleId} at exit after ${fmt(d.actual)} s (expected ${fmt(d.expected)} s)`);
        $('#alert-speeding-detail').textContent += ' · ✔ exit sensor confirmed';
        break;
      case 'VIOLATION_CANCELLED':
        log('ok', 'DRIVER STOPPED', `${d.lane} #${d.vehicleId} halted at the stop line – watch cancelled`);
        $('#alert-speeding-detail').textContent += ' · ✔ driver stopped at the line';
        break;
      case 'CROSS_TRAFFIC_RELEASED':
        log('ok', 'CROSS TRAFFIC RELEASED', `${groupName(d.group)} held ${fmt(d.heldFor)} s – ${d.reason}`);
        $('#alert-speeding').classList.add('resolved');
        $('#alert-speeding-detail').textContent += ' · ✔ cross traffic released';
        speedingHideTimer = setTimeout(() => show('#alert-speeding', false), 5000);
        break;
      case 'COLLISION_SUSPECTED':
        log('crit', 'COLLISION SUSPECTED', `${d.lane} #${d.vehicleId} not at exit after ${fmt(d.waited)} s (expected ${fmt(d.expected)} s) → ALL-RED`);
        $('#alert-collision-detail').textContent =
          `${W.approaches[d.approach].short}: vehicle expected at the Exit Sensor in ${fmt(d.expected)} s, nothing after ${fmt(d.waited)} s. All approaches flashing red – live CAM view opened (right). Emergency services dispatched.`;
        show('#alert-speeding', false);
        show('#alert-collision', true);
        alarmSilenced = false;
        audio().startAlarm();
        break;
      case 'EMERGENCY_CLEARED':
        log('ok', 'EMERGENCY CLEARED', 'wreck removed, cycle resumes');
        show('#alert-collision', false);
        audio().stopAlarm();
        clearDispatch();
        break;
      case 'WRECK_CLEARED':
        clearDispatch();
        break;
      case 'RESPONDER_DISPATCHED':
        dispatch[d.kind] = { eta: d.eta, reason: d.reason, arrived: false, at: sim.time };
        log(d.reason.startsWith('bystander') ? 'warn' : 'info', 'DISPATCH', `${d.kind} sent (${d.reason}), ETA ${fmt(d.eta)} s`);
        audio().startSiren();
        renderDispatch();
        break;
      case 'RESPONDER_ARRIVED':
        if (dispatch[d.kind]) Object.assign(dispatch[d.kind], { arrived: true, arrivedAfter: d.afterImpact });
        log('ok', 'ON SCENE', `${d.kind} arrived ${fmt(d.afterImpact)} s after impact`);
        if (Object.values(dispatch).every((x) => x.arrived)) audio().stopSiren();
        renderDispatch();
        break;
      case 'CRASH':
        log('crit', 'IMPACT', `vehicles #${d.vehicles.join(' & #')} in the conflict zone`);
        if (!d.systemEnabled) show('#alert-undetected', true);
        break;
      case 'PRIORITY_REQUESTED':
        audio().startSiren();
        log('info', 'PRIORITY REQUEST', `ambulance on ${W.approaches[d.approach].name} (5G V2X)`);
        $('#alert-priority-detail').textContent = `Ambulance on ${W.approaches[d.approach].name} – ending conflicting green safely…`;
        clearTimeout(priorityHideTimer);
        show('#alert-priority', true);
        break;
      case 'PRIORITY_GRANTED':
        log('info', 'PRIORITY GRANTED', `green wave for ${W.approaches[d.approach].short}`);
        $('#alert-priority-detail').textContent = `Green wave granted for ${W.approaches[d.approach].name}; all other approaches red.`;
        break;
      case 'PRIORITY_ENDED':
        log('info', 'PRIORITY ENDED', 'exit sensor confirmed the ambulance passed');
        $('#alert-priority-detail').textContent = 'Ambulance cleared the junction – restoring normal cycle.';
        awaitingRestore = true;
        if (!Object.keys(dispatch).length) audio().stopSiren();
        priorityHideTimer = setTimeout(() => show('#alert-priority', false), 4000);
        break;
      case 'PHASE_CHANGED':
        if (awaitingRestore && d.reason === 'timer') {
          awaitingRestore = false;
          markStep('restored');
        }
        if (d.reason !== 'timer') log('info', 'PHASE', `${d.phase} (${d.reason})`);
        break;
      default:
        break;
    }
  }

  function setScenario(def) {
    $('#caption-title').textContent = def.title;
    $('#caption-text').textContent = def.description;
    $('#steps').innerHTML = def.steps.map((s) => `<li data-key="${s.key}">${s.label}</li>`).join('');
    awaitingRestore = false;
    ['#alert-speeding', '#alert-collision', '#alert-priority', '#alert-undetected', '#alert-dispatch'].forEach((id) => show(id, false));
    for (const k of Object.keys(dispatch)) delete dispatch[k];
    audio().stopAll();
    log('info', 'SCENARIO', def.title);
  }

  function renderPhysics() {
    const trap = C.entrySensorBeforeStopLine - C.stoplineSensorBeforeStopLine;
    $('#physics').innerHTML = `
      <code>v = ${trap} m / (t_stopline − t_entry)   (+ v_spot from the dual-loop Stopline Sensor)</code>
      <code>v_crit = a(−t_r + √(t_r² + 2D/a)) = ${fmt(CJ.criticalSpeed)} m/s ≈ ${kmh(CJ.criticalSpeed)}</code>
      <code>red entry ⇔ RED, or YELLOW ∧ D/v &gt; t_yellow,left</code>
      <code>can stop ⇔ braking: v_spot²/2a ≤ D · else: v_spot ≤ v_crit</code>
      <code>violation ⇔ v &gt; v_crit ∧ ¬can stop ∧ red entry</code>
      <code>delay = max(0, t_clear + ${C.releaseBuffer} s − t_until_cross_green)</code>
      <code>exit deadline = clamp(${C.exitWindowFactor}·t_exp + ${C.exitWindowMargin} s, ${C.exitWindowMin}–${C.exitWindowMax} s)</code>
      <div class="kv">
        <span>Speed-trap baseline (Entry → Stopline)</span><b>${trap} m</b>
        <span>D = Stopline Sensor → stop line</span><b>${C.stoplineSensorBeforeStopLine} m</b>
        <span>Braking a / reaction t_r</span><b>${C.brakingDecel} m/s² / ${C.reactionTime} s</b>
        <span>Speed limit</span><b>${C.speedLimitKmh} km/h</b>
        <span>Timing G(PC) / G(CP2) / Y / AR</span><b>${C.timing.nsGreen}/${C.timing.ewGreen}/${C.timing.yellow}/${C.timing.allRed} s</b>
      </div>`;
  }

  function buildSignals() {
    $('#signals').innerHTML = Object.entries(W.approaches).map(([id, a]) =>
      `<div class="signal-row" data-approach="${id}"><i class="lamp"></i><span>${a.name}</span><span class="state">--</span></div>`).join('');
    $('#phase-bar').innerHTML = CJ.PHASES.map((p) => `<div data-phase="${p}">${PHASE_SHORT[p][0]}</div>`).join('');
  }

  function update() {
    const ctl = sim.controller;
    $('#sim-clock').textContent = `${fmt(sim.time)} s`;
    $('#sim-phase').textContent = ctl.mode === 'EMERGENCY' ? 'EMERGENCY ALL-RED' : ctl.phase.replace(/_/g, ' ');
    $('#sim-vehicles').textContent = sim.vehicles.length;

    for (const row of document.querySelectorAll('.signal-row')) {
      const sig = ctl.signalFor(row.dataset.approach);
      const lamp = row.querySelector('.lamp');
      lamp.className = `lamp ${sig.color}${sig.flashing ? ' flash' : ''}`;
      const state = row.querySelector('.state');
      const group = W.groupOf(row.dataset.approach);
      if (ctl.mode === 'EMERGENCY') { state.textContent = 'FLASH RED'; state.className = 'state'; }
      else if (sig.color === 'GREEN') { state.textContent = `GREEN ${fmt(ctl.phaseRemaining())}s`; state.className = 'state'; }
      else if (ctl.holds[group]) { state.textContent = 'HOLD'; state.className = 'state hold'; }
      else if (sig.color === 'YELLOW') { state.textContent = `YELLOW ${fmt(ctl.phaseRemaining())}s`; state.className = 'state'; }
      else { state.textContent = `RED · G in ${fmt(sig.timeToGreen)}s`; state.className = 'state'; }
    }
    for (const div of document.querySelectorAll('#phase-bar div')) {
      const active = ctl.mode !== 'EMERGENCY' && div.dataset.phase === ctl.phase;
      div.className = active ? `active ${PHASE_SHORT[ctl.phase][1]}` : '';
      if ((div.dataset.phase === 'ALL_RED_TO_EW' && ctl.holds.EW) || (div.dataset.phase === 'ALL_RED_TO_NS' && ctl.holds.NS)) div.classList.add('held');
    }
    const st = ctl.stats;
    $('#st-measured').textContent = st.measured;
    $('#st-speeding').textContent = st.speeding;
    $('#st-violations').textContent = st.violations;
    $('#st-holds').textContent = st.holds;
    $('#st-dilemma').textContent = st.dilemma ? `${st.dilemma} dilemma-zone` : '';
    $('#st-cuts').textContent = st.cuts ? `(${st.cuts} cut)` : '';
    $('#st-safe').textContent = st.safePassages;
    $('#st-collisions').textContent = st.collisions;
  }

  CJ.ui = {
    init(simulation) {
      sim = simulation;
      CJ.events.on(onEvent);
      buildSignals();
      renderPhysics();
    },
    markStep,
    setScenario,
    update,
    log,
    hideUndetected: () => show('#alert-undetected', false),
    silenceAlarm() {
      alarmSilenced = true;
      audio().stopAlarm();
      log('d', 'ALARM', 'silenced by operator (junction stays locked)');
    },
  };
})();
