/* =========================================================================
   scenarios.js - scripted demonstrations.

   Timing of the scripted vehicles is computed from the geometry so the
   critical moments always line up, whatever the lane lengths are.
   Each scenario lists "steps" that the UI ticks off as events arrive.
   ========================================================================= */
(() => {
  const C = CJ.config;
  const W = CJ.world;

  // Front-bumper path position at which a vehicle's CENTRE crosses a lateral line
  function sAtCentreCrossing(lane, coordinate, vehicleLength) {
    const [dx, dy] = lane.dir;
    const along = dx !== 0 ? (coordinate - lane.start[0]) / dx : (coordinate - lane.start[1]) / dy;
    return along + vehicleLength / 2;
  }

  /**
   * Places a cross vehicle so its centre reaches the violator's path at the same
   * moment the violator's centre reaches the cross vehicle's lane.
   */
  function timeCrossVehicle(sim, violator, violatorLaneId, crossLaneId, crossSpeed, opts = {}) {
    const vLane = W.laneById(violatorLaneId);
    const cLane = W.laneById(crossLaneId);
    const vType = C.vehicleTypes.violator;
    const cType = C.vehicleTypes.car;
    const vFront = sAtCentreCrossing(vLane, cLane.offset, vType.length);   // violator centre on cross lane line
    const tMeet = (vFront - violator.s) / violator.v;
    const cFront = sAtCentreCrossing(cLane, vLane.offset, cType.length);
    const cSpawn = cFront - crossSpeed * tMeet;
    const car = sim.spawn(cLane, 'car', { s: cSpawn, v: crossSpeed, ...opts });
    car.params.v0 = crossSpeed;   // cruise at exactly this speed
    return { car, tMeet };
  }

  CJ.scenarios = {
    // ---------------------------------------------------------------------
    normal: {
      title: 'Normal Flow',
      description: 'Fixed-time two-phase plan. Every driver obeys the signals; drivers decide to stop or go on yellow using the dilemma-zone rule.',
      steps: [
        { key: 'PHASE_CHANGED', label: 'Signals cycle Persiaran Ceria ↔ Jalan Cyber Point 2' },
        { key: 'VEHICLE_MEASURED', label: 'Every lane measures speed (Entry → Stopline)' },
        { key: 'quiet', label: 'No violations → no alerts' },
      ],
      setup(sim) {
        sim.reset({ density: 1 });
        sim.controller.forcePhase('NS_GREEN', 12);
        // pre-fill so the screen is not empty
        for (const lane of W.lanes) {
          for (let s = lane.stopS - 120; s < lane.stopS - 10; s += 30 + Math.random() * 25) {
            if (s > 5) sim.spawn(lane, undefined, { s, v: 10 });
          }
        }
        // after one full signal cycle with no violations, tick the last step
        const cycle = C.timing.nsGreen + C.timing.ewGreen + 2 * (C.timing.yellow + C.timing.allRed);
        sim.schedule(cycle, () => { if (sim.controller.stats.violations === 0) CJ.ui.markStep('quiet'); });
      },
    },

    // ---------------------------------------------------------------------
    nearMiss: {
      title: 'Near-Miss (protected)',
      description: 'A speeding car on Persiaran Ceria southbound runs the red. The Stopline Sensor predicts it, the cross traffic is held on red, the Exit Sensor confirms it left, then the cross traffic is released. Turn the system OFF to see what would have happened.',
      steps: [
        { key: 'spawn', label: 'Speeding car approaches Persiaran Ceria as it turns red' },
        { key: 'SPEEDING_DETECTED', label: 'Stopline Sensor: red-light run predicted' },
        { key: 'HOLD_STARTED', label: 'Jalan Cyber Point 2 / Jln Fauna 1 held on red' },
        { key: 'SAFE_PASSAGE', label: 'Exit Sensor confirms the car left the conflict zone' },
        { key: 'CROSS_TRAFFIC_RELEASED', label: 'Cross traffic released safely' },
      ],
      setup(sim) {
        sim.reset({ density: 0.45 });
        const ctl = sim.controller;
        ctl.forcePhase('NS_YELLOW', 1.2);
        ['N2', 'E1', 'S2'].forEach((id) => sim.blockLane(id, 25));

        // Violator reaches its Stopline Sensor 2.2 s from now (during all-red)
        const lane = W.laneById('N2');
        const v = C.vehicleTypes.violator.v0;
        const violator = sim.spawn(lane, 'violator', { s: lane.stoplineSensorS - v * 2.2, v });

        // Cross traffic: queued cars plus one "countdown-timer" driver who rolls up
        // expecting green right after the all-red.
        for (const id of ['E2', 'W1', 'W2']) {
          const l = W.laneById(id);
          for (let k = 0; k < 3; k++) sim.spawn(l, 'car', { s: l.stopS - 1.5 - k * 7.5, v: 0 });
        }
        const { car } = timeCrossVehicle(sim, violator, 'N2', 'E1', 14, { anticipates: true });
        car.scenarioRole = 'cross';
        violator.scenarioRole = 'violator';
        CJ.ui.markStep('spawn');
      },
    },

    // ---------------------------------------------------------------------
    collision: {
      title: 'Collision',
      description: 'Cross traffic already has green when a speeding car runs the red. The system cuts the cross green, but a car already committed to the junction is hit. The violator never reaches its Exit Sensor → timeout → CRITICAL alert and all-red lockdown.',
      steps: [
        { key: 'spawn', label: 'Jalan Cyber Point 2 traffic flowing on green' },
        { key: 'SPEEDING_DETECTED', label: 'Speeding car runs the red on Persiaran Ceria' },
        { key: 'PROTECTIVE_CUT', label: 'Protective cut: cross green terminated' },
        { key: 'CRASH', label: 'Impact inside the conflict zone' },
        { key: 'COLLISION_SUSPECTED', label: 'Exit Sensor timeout → CRITICAL alert, all-red' },
      ],
      setup(sim) {
        sim.reset({ density: 0.5 });
        const ctl = sim.controller;
        ctl.forcePhase('EW_GREEN', 8);
        ['N2', 'E1'].forEach((id) => sim.blockLane(id, 30));

        const lane = W.laneById('N2');
        const v = C.vehicleTypes.violator.v0;
        const violator = sim.spawn(lane, 'violator', { s: lane.stoplineSensorS - v * 2.0, v });
        const { car } = timeCrossVehicle(sim, violator, 'N2', 'E1', 14);
        car.scenarioRole = 'cross';
        violator.scenarioRole = 'violator';
        // some other cross traffic flowing
        for (const id of ['E2', 'W1', 'W2']) {
          const l = W.laneById(id);
          sim.spawn(l, 'car', { s: l.stopS - 25 - Math.random() * 40, v: 13 });
        }
        CJ.ui.markStep('spawn');
      },
    },

    // ---------------------------------------------------------------------
    emergency: {
      title: 'Emergency Vehicle Priority',
      description: 'An ambulance heading north on Persiaran Ceria broadcasts a priority request over 5G V2X. The controller safely ends the conflicting green (yellow → all-red), gives Persiaran Ceria a green wave, and restores the normal cycle once the Exit Sensor confirms the ambulance has passed.',
      steps: [
        { key: 'PRIORITY_REQUESTED', label: 'Ambulance sends 5G V2X priority request (~160 m out)' },
        { key: 'PHASE_CHANGED', label: 'Conflicting green ended safely (yellow → all-red)' },
        { key: 'PRIORITY_GRANTED', label: 'Green wave for Persiaran Ceria northbound' },
        { key: 'PRIORITY_ENDED', label: 'Exit Sensor confirms ambulance cleared' },
        { key: 'restored', label: 'Normal signal cycle restored' },
      ],
      setup(sim) {
        sim.reset({ density: 0.8 });
        sim.controller.forcePhase('EW_GREEN', 12);
        sim.blockLane('S1', 30);
        for (const lane of W.lanes) {
          if (lane.id === 'S1') continue;
          for (let s = lane.stopS - 100; s < lane.stopS - 10; s += 35 + Math.random() * 25) {
            if (s > 5) sim.spawn(lane, undefined, { s, v: lane.group === 'EW' ? 12 : 0 });
          }
        }
        const ambulance = sim.spawn('S1', 'ambulance', { s: 0, v: 20 });
        ambulance.scenarioRole = 'ambulance';
        sim.controller.requestPriority(ambulance);
      },
    },
  };
})();
