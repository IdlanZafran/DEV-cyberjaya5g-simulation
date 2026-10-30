/* =========================================================================
   controller.js - the same anti-collision logic as the ESP32 firmware,
   scaled up to four approaches and every lane.

   Phases (two-phase plan, straight-through movements):
     NS_GREEN -> NS_YELLOW -> ALL_RED_TO_EW -> EW_GREEN -> EW_YELLOW -> ALL_RED_TO_NS
   NS = Persiaran Ceria, EW = Jalan Cyber Point 2 / Jln Fauna 1.

   Per lane:  Entry Sensor --30 m-- Stopline Sensor --40 m-- stop line ... box ... Exit Sensor
     v           = 30 m / (t_stopline - t_entry)          (time-of-flight, as on the prototype)
     v_spot      = spot speed from the Stopline Sensor's dual loop (2 m apart)
     red entry?  = light RED, or YELLOW and (40 m / v) > yellow time left
     can stop?   = decelerating (v_spot < 0.95 v): v_spot^2 / 2a <= 40 m   (already braking, no reaction time)
                   otherwise:                     v_spot <= v_crit
     violation   = v > v_crit AND NOT can-stop AND red entry predicted
                   (v_spot filters out drivers who are already braking: their
                    30 m average is still high but they will stop in time)
     t_clear     = (distance to far edge of box + 5 m car) / v
     delay       = max(0, t_clear + buffer - time until conflicting green)
     exit window = clamp(expected * 1.6 + 1 s, 3 s, 12 s)
   ========================================================================= */
(() => {
  const C = CJ.config;
  const W = CJ.world;
  const PHASES = ['NS_GREEN', 'NS_YELLOW', 'ALL_RED_TO_EW', 'EW_GREEN', 'EW_YELLOW', 'ALL_RED_TO_NS'];
  const NOMINAL_VEHICLE_LENGTH = 5;

  // Tiny event bus shared by the controller, scenarios and UI
  const listeners = [];
  CJ.events = {
    on: (fn) => listeners.push(fn),
    emit: (event, data = {}) => listeners.forEach((fn) => fn(event, data)),
  };

  class JunctionController {
    constructor() {
      this.systemEnabled = true;
      this.timing = { ...C.timing };
      this.reset(0);
    }

    reset(t) {
      this.mode = 'AUTO';
      this.phase = 'NS_GREEN';
      this.phaseStart = t;
      this.holds = { NS: null, EW: null };
      this.tracks = [];
      this.priority = null;
      this.emergency = null;
      this.time = t;
      this.stats = { measured: 0, speeding: 0, violations: 0, holds: 0, cuts: 0, safePassages: 0, collisions: 0, priorities: 0, dilemma: 0 };
    }

    // ---- Signal state ----------------------------------------------------
    duration(phase) {
      if (phase === 'NS_GREEN') return this.timing.nsGreen;
      if (phase === 'EW_GREEN') return this.timing.ewGreen;
      if (phase.endsWith('YELLOW')) return this.timing.yellow;
      return this.timing.allRed;
    }

    phaseRemaining(t = this.time) { return Math.max(0, this.duration(this.phase) - (t - this.phaseStart)); }

    colorFor(group) {
      if (this.mode === 'EMERGENCY') return 'RED';
      if (this.phase === `${group}_GREEN`) return 'GREEN';
      if (this.phase === `${group}_YELLOW`) return 'YELLOW';
      return 'RED';
    }

    // What a driver sees: colour, flashing, and the countdown to green (null = "HOLD")
    signalFor(approach) {
      const group = W.groupOf(approach);
      return { color: this.colorFor(group), flashing: this.mode === 'EMERGENCY', timeToGreen: this.timeToGreen(group) };
    }

    // Scheduled time until `group` gets green (ignores holds unless asked)
    timeToGreen(group, ignoreHolds = false) {
      if (this.mode === 'EMERGENCY') return null;
      if (this.colorFor(group) === 'GREEN') return 0;
      if (!ignoreHolds && this.holds[group]) return null;
      let idx = PHASES.indexOf(this.phase);
      let total = this.phaseRemaining();
      for (let i = 0; i < PHASES.length; i++) {
        idx = (idx + 1) % PHASES.length;
        if (PHASES[idx] === `${group}_GREEN`) return total;
        total += this.duration(PHASES[idx]);
      }
      return total;
    }

    enterPhase(phase, reason) {
      this.phase = phase;
      this.phaseStart = this.time;
      CJ.events.emit('PHASE_CHANGED', { phase, reason });
    }

    forcePhase(phase, remaining) {
      this.phase = phase;
      this.phaseStart = this.time - (this.duration(phase) - remaining);
    }

    // ---- Sensor input ------------------------------------------------------
    // Vehicles cannot overtake inside a lane, so plain FIFO counting pairs
    // detections exactly: entryQueue holds Entry timestamps of vehicles between
    // Entry and Stopline; zoneQueue holds vehicles between Stopline and Exit.
    onSensor(sensor, vehicle, t, spotSpeed) {
      const lane = sensor.lane;
      if (sensor.type === 'entry') {
        lane.entryQueue.push(t);
        if (lane.entryQueue.length > 40) lane.entryQueue.shift();
      } else if (sensor.type === 'stopline') {
        const tEntry = lane.entryQueue.shift();
        lane.zoneQueue.push(vehicle.id);
        if (tEntry === undefined || tEntry === null) return;   // unknown entry time
        const transit = t - tEntry;
        if (transit <= 0 || transit > 20) return;   // queued / stopped vehicle
        const speed = C.entrySensorBeforeStopLine - C.stoplineSensorBeforeStopLine;
        this.evaluate(lane, vehicle, speed / transit, spotSpeed ?? speed / transit, t);
      } else if (sensor.type === 'exit') {
        this.onExit(sensor, vehicle, t);
      }
    }

    evaluate(lane, vehicle, v, spotSpeed, t) {
      this.stats.measured++;
      const group = lane.group;
      const color = this.colorFor(group);
      const distToLine = C.stoplineSensorBeforeStopLine;
      const timeToLine = distToLine / v;
      const yellowLeft = color === 'YELLOW' ? this.phaseRemaining(t) : 0;
      const redEntry = color === 'RED' || (color === 'YELLOW' && timeToLine > yellowLeft);
      const speeding = v > CJ.criticalSpeed;
      const decelerating = spotSpeed < v * 0.95;
      const braking = decelerating
        ? (spotSpeed * spotSpeed) / (2 * C.brakingDecel) <= distToLine
        : spotSpeed <= CJ.criticalSpeed;
      if (speeding) this.stats.speeding++;
      const armed = this.systemEnabled && this.mode === 'AUTO' && vehicle.behavior !== 'ambulance';
      const violation = armed && speeding && !braking && redEntry;

      vehicle.measured = { speed: v, verdict: violation ? 'violation' : speeding && !braking ? 'speeding' : 'ok', at: t };
      CJ.events.emit('VEHICLE_MEASURED', { lane: lane.id, vehicleId: vehicle.id, speed: v, spotSpeed, color, speeding, braking, violation });
      if (!violation) return;

      // Same protective action either way; only the reporting differs:
      //  - above the posted limit  -> SPEEDING_DETECTED (alert + buzzer)
      //  - legal speed but caught in the dilemma zone -> quiet precautionary hold
      const overLimit = CJ.kmh(v) > C.speedLimitKmh;
      if (overLimit) this.stats.violations++;
      else this.stats.dilemma++;
      const protect = W.conflictingGroup(group);
      const tConflict = (lane.boxEntryS - lane.stoplineSensorS) / v;
      const tClear = (lane.boxExitS - lane.stoplineSensorS + NOMINAL_VEHICLE_LENGTH) / v;
      const untilGreen = this.timeToGreen(protect, true);
      const crossGreenNow = this.colorFor(protect) === 'GREEN';
      const required = Math.max(0, tClear + C.releaseBuffer - untilGreen);

      if (crossGreenNow) {
        this.stats.cuts++;
        this.enterPhase(`${protect}_YELLOW`, 'protective cut');
        CJ.events.emit('PROTECTIVE_CUT', { group: protect, lane: lane.id, vehicleId: vehicle.id });
      }
      const minHold = crossGreenNow ? tClear + C.releaseBuffer : required;
      if (!this.holds[protect]) {
        this.holds[protect] = { start: t, minUntil: t + minHold, releaseAt: null };
        this.stats.holds++;
        CJ.events.emit('HOLD_STARTED', { group: protect, required, untilGreen });
      } else {
        this.holds[protect].minUntil = Math.max(this.holds[protect].minUntil, t + minHold);
        this.holds[protect].releaseAt = null;
      }

      const exitSensor = W.sensorFor(lane, 'exit');
      const expected = (lane.exitSensorS - lane.stoplineSensorS) / v;
      const window = Math.min(C.exitWindowMax, Math.max(C.exitWindowMin, expected * C.exitWindowFactor + C.exitWindowMargin));
      this.tracks.push({ vehicleId: vehicle.id, lane, exitSensorId: exitSensor.id, speed: v, start: t, expected, deadline: t + window, protect });

      CJ.events.emit(overLimit ? 'SPEEDING_DETECTED' : 'DILEMMA_ZONE_HOLD', {
        lane: lane.id, approach: lane.approach, vehicleId: vehicle.id, speed: v, color,
        timeToConflict: tConflict, timeToClear: tClear, untilGreen, required, protect,
        action: crossGreenNow ? 'CUT_CROSS_GREEN' : 'DELAY_CROSS_TRAFFIC', window,
      });
    }

    onExit(sensor, vehicle, t) {
      const token = sensor.lane.zoneQueue.shift();   // the vehicle that just left the zone
      if (this.priority && this.priority.vehicleId === vehicle.id) {
        CJ.events.emit('PRIORITY_ENDED', { approach: this.priority.approach, vehicleId: vehicle.id });
        const greenPhase = `${this.priority.group}_GREEN`;
        this.priority = null;
        if (this.phase === greenPhase) this.phaseStart = t - Math.max(0, this.duration(greenPhase) - 4);
      }
      const idx = this.tracks.findIndex((tr) => tr.exitSensorId === sensor.id && tr.vehicleId === token);
      if (idx < 0) return;
      const [track] = this.tracks.splice(idx, 1);
      this.stats.safePassages++;
      CJ.events.emit('SAFE_PASSAGE', { lane: track.lane.id, vehicleId: track.vehicleId, actual: t - track.start, expected: track.expected });
      this.scheduleRelease(track.protect, t);
    }

    // Stop-bar presence detector: a tracked vehicle came to a halt before the
    // stop line -> the driver did stop after all, cancel the watch.
    onStoppedAtStopBar(track, t) {
      this.tracks = this.tracks.filter((tr) => tr !== track);
      CJ.events.emit('VIOLATION_CANCELLED', { lane: track.lane.id, vehicleId: track.vehicleId, reason: 'driver stopped at the stop line' });
      const hold = this.holds[track.protect];
      if (hold) hold.minUntil = t;
      this.scheduleRelease(track.protect, t);
    }

    scheduleRelease(group, t) {
      const hold = this.holds[group];
      if (hold && !this.tracks.some((tr) => tr.protect === group)) hold.releaseAt = t + C.releaseBuffer;
    }

    requestPriority(vehicle) {
      if (this.mode !== 'AUTO') return;
      this.priority = { vehicleId: vehicle.id, approach: vehicle.lane.approach, group: vehicle.lane.group, since: this.time };
      this.stats.priorities++;
      CJ.events.emit('PRIORITY_REQUESTED', { approach: vehicle.lane.approach, vehicleId: vehicle.id });
    }

    resetEmergency() {
      this.mode = 'AUTO';
      this.emergency = null;
      this.tracks = [];
      this.holds = { NS: null, EW: null };
      this.enterPhase('ALL_RED_TO_NS', 'emergency reset');
      CJ.events.emit('EMERGENCY_CLEARED');
    }

    // ---- Main update ---------------------------------------------------------
    update(t) {
      this.time = t;
      if (this.mode === 'EMERGENCY') return;

      // Watchdog: violator not seen by its Exit Sensor in time -> collision suspected
      const late = this.tracks.find((tr) => t >= tr.deadline);
      if (late) {
        this.stats.collisions++;
        this.mode = 'EMERGENCY';
        this.emergency = { since: t, track: late };
        this.holds = { NS: null, EW: null };
        this.priority = null;
        this.tracks = [];
        CJ.events.emit('COLLISION_SUSPECTED', { lane: late.lane.id, approach: late.lane.approach, vehicleId: late.vehicleId, expected: late.expected, waited: t - late.start });
        return;
      }

      // Release holds
      for (const group of ['NS', 'EW']) {
        const hold = this.holds[group];
        if (!hold) continue;
        const exitOk = hold.releaseAt !== null && t >= hold.releaseAt && t >= hold.minUntil;
        if (exitOk || t - hold.start > C.maxHold) {
          this.holds[group] = null;
          CJ.events.emit('CROSS_TRAFFIC_RELEASED', { group, heldFor: t - hold.start, reason: exitOk ? 'violator cleared' : 'safety cap' });
        }
      }

      // Safety override: a held group must never show green
      for (const group of ['NS', 'EW']) {
        if (this.holds[group] && this.colorFor(group) === 'GREEN') {
          this.enterPhase(`${group}_YELLOW`, 'protective cut');
          return;
        }
      }

      const elapsed = t - this.phaseStart;

      // Emergency-vehicle preemption
      if (this.priority) {
        const target = `${this.priority.group}_GREEN`;
        const other = W.conflictingGroup(this.priority.group);
        if (this.phase === target) return;
        if (this.phase === `${other}_GREEN`) { this.enterPhase(`${other}_YELLOW`, 'emergency vehicle preemption'); return; }
        if (this.phase.endsWith('YELLOW')) {
          if (elapsed >= this.timing.yellow) this.enterPhase(PHASES[(PHASES.indexOf(this.phase) + 1) % 6], 'emergency vehicle preemption');
          return;
        }
        if (elapsed >= this.timing.allRed && !this.holds[this.priority.group]) {
          this.enterPhase(target, 'emergency vehicle preemption');
          CJ.events.emit('PRIORITY_GRANTED', { approach: this.priority.approach });
        }
        return;
      }

      if (elapsed < this.duration(this.phase)) return;
      // PREDICTIVE DELAY: keep all-red while the next group is protected
      if (this.phase === 'ALL_RED_TO_EW' && this.holds.EW) return;
      if (this.phase === 'ALL_RED_TO_NS' && this.holds.NS) return;
      this.enterPhase(PHASES[(PHASES.indexOf(this.phase) + 1) % 6], 'timer');
    }
  }

  CJ.JunctionController = JunctionController;
  CJ.PHASES = PHASES;
})();
