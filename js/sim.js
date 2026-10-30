/* =========================================================================
   sim.js - simulation engine: spawning, vehicle physics, sensors, crashes.
   ========================================================================= */
(() => {
  const C = CJ.config;
  const W = CJ.world;
  const MAX_VEHICLES = 240;

  // Police car / ambulance sent to a crash. Drives a fixed path (contraflow on
  // the empty outbound lanes, since the junction is locked on all-red) and
  // stops next to the wreck. Not part of lane traffic.
  class Responder {
    constructor(kind, start, dir, targetAlong, speed, reason) {
      this.id = `R-${kind}`;
      this.kind = kind;
      this.type = kind;
      this.behavior = kind;            // 'police' | 'ambulance' (renderer draws lights + sirens)
      this.isResponder = true;
      this.length = kind === 'police' ? 4.8 : 6.2;
      this.width = kind === 'police' ? 1.9 : 2.2;
      this.color = kind === 'police' ? '#1e3a8a' : '#f8fafc';
      this.start = start;
      this.dir = dir;
      this.lane = { heading: Math.atan2(dir[1], dir[0]) };
      this.s = 0;
      this.target = targetAlong;
      this.vmax = speed;
      this.v = speed;
      this.acc = 0;
      this.crashAngle = 0;
      this.crashed = false;
      this.measured = null;
      this.arrived = false;
      this.reason = reason;
    }

    center() {
      const s = this.s - this.length / 2;
      return [this.start[0] + this.dir[0] * s, this.start[1] + this.dir[1] * s];
    }

    step(dt, sim) {
      if (this.arrived) return;
      const d = this.target - this.s;
      if (d <= 0.3) {
        this.arrived = true;
        this.v = 0;
        this.acc = 0;
        CJ.events.emit('RESPONDER_ARRIVED', { kind: this.kind, afterImpact: sim.lastCrash ? sim.time - sim.lastCrash.at : null });
        return;
      }
      // brake smoothly to stop exactly at the target: v <= sqrt(2 b d)
      const v = Math.max(0.5, Math.min(this.vmax, Math.sqrt(2 * 4 * d), this.v + 3 * dt));
      this.acc = (v - this.v) / dt;
      this.s += ((this.v + v) / 2) * dt;
      this.v = v;
    }
  }

  class Simulation {
    constructor() {
      this.controller = new CJ.JunctionController();
      this.time = 0;
      this.density = 1;
      this.particles = [];
      this.blockedLanes = {};
      this.scheduled = [];
      this.crashCount = 0;
      this.lastCrash = null;
      this.responders = [];
      this.dispatched = false;

      // Automatic dispatch: the controller detected the collision (Exit Sensor
      // timeout). Without the system, help only comes after a bystander calls.
      CJ.events.on((event) => {
        if (event === 'COLLISION_SUSPECTED') this.dispatchResponders('automatic (exit-sensor timeout alert)', 0);
        if (event === 'CRASH' && !this.controller.systemEnabled) {
          const crashAt = this.time;
          this.schedule(25, () => {
            if (this.lastCrash && this.lastCrash.at === crashAt) this.dispatchResponders('bystander phone call', 0);
          });
        }
      });
    }

    dispatchResponders(reason, delay) {
      if (this.dispatched) return;
      this.dispatched = true;
      const crash = this.lastCrash || { x: 0, y: 0 };
      const W2 = W.halfWidth;
      const H2 = W.halfHeight;
      // Police from the east, contraflow on the (empty) eastbound lane next to the median
      const policeY = W.laneById('W1').offset;
      const policeStartX = W2 + 15;
      const policeStopX = Math.max(W.box.x0 + 3, crash.x + 7);
      // Ambulance from the north, contraflow on the (empty) northbound lane next to the median
      const ambX = W.laneById('S1').offset;
      const ambStartY = -H2 - 15;
      const ambStopY = Math.min(W.box.y1 - 3, crash.y - 5);
      const units = [
        { kind: 'police', delay: delay + 2, start: [policeStartX, policeY], dir: [-1, 0], target: policeStartX - policeStopX, speed: 22 },
        { kind: 'ambulance', delay: delay + 4, start: [ambX, ambStartY], dir: [0, 1], target: ambStopY - ambStartY, speed: 20 },
      ];
      for (const u of units) {
        const eta = u.delay + u.target / u.speed + 2;
        CJ.events.emit('RESPONDER_DISPATCHED', { kind: u.kind, eta, reason });
        this.schedule(u.delay, () => {
          if (!this.dispatched) return;   // wreck cleared in the meantime
          this.responders.push(new Responder(u.kind, u.start, u.dir, u.target, u.speed, reason));
        });
      }
    }

    get vehicles() { return W.lanes.flatMap((l) => l.vehicles); }

    reset({ density = 1 } = {}) {
      W.reset();
      this.particles = [];
      this.scheduled = [];
      this.blockedLanes = {};
      this.lastCrash = null;
      this.responders = [];
      this.dispatched = false;
      this.density = density;
      const enabled = this.controller.systemEnabled;
      this.controller.reset(this.time);
      this.controller.systemEnabled = enabled;
    }

    schedule(delay, fn) { this.scheduled.push({ at: this.time + delay, fn }); }

    blockLane(laneId, seconds) { this.blockedLanes[laneId] = this.time + seconds; }

    // Insert a vehicle keeping lane.vehicles sorted by s (descending = leader first)
    spawn(laneOrId, type, opts = {}) {
      const lane = typeof laneOrId === 'string' ? W.laneById(laneOrId) : laneOrId;
      const vehicle = new CJ.Vehicle(lane, type, opts);
      const list = lane.vehicles;
      let i = 0;
      while (i < list.length && list[i].s > vehicle.s) i++;
      list.splice(i, 0, vehicle);
      vehicle.prevS = vehicle.s;
      // A vehicle placed between sensors (scenario scripts) must still appear in
      // the FIFO counters at the right position, so the pairing stays correct.
      const ahead = list.slice(0, i);
      if (vehicle.s > lane.entrySensorS && vehicle.s < lane.stoplineSensorS) {
        const k = ahead.filter((v) => v.s > lane.entrySensorS && v.s < lane.stoplineSensorS).length;
        lane.entryQueue.splice(k, 0, null);   // entry time unknown -> no speed measurement
      } else if (vehicle.s >= lane.stoplineSensorS && vehicle.s < lane.exitSensorS) {
        const k = ahead.filter((v) => v.s >= lane.stoplineSensorS && v.s < lane.exitSensorS).length;
        lane.zoneQueue.splice(k, 0, vehicle.id);
      }
      return vehicle;
    }

    clearLane(laneId) { W.laneById(laneId).vehicles = []; }

    // ---- one fixed time step ----------------------------------------------
    step(dt) {
      this.time += dt;
      const t = this.time;

      // Scenario scripts
      if (this.scheduled.length) {
        const due = this.scheduled.filter((s) => s.at <= t);
        this.scheduled = this.scheduled.filter((s) => s.at > t);
        due.forEach((s) => s.fn());
      }

      this.spawnTraffic(dt);
      this.controller.update(t);

      const wrecks = this.vehicles.filter((v) => v.crashed);
      for (const lane of W.lanes) {
        const list = lane.vehicles;
        for (let i = 0; i < list.length; i++) {
          const vehicle = list[i];
          const wreckGap = wrecks.length ? this.gapToWreck(vehicle, wrecks) : Infinity;
          vehicle.step(dt, i > 0 ? list[i - 1] : null, this.controller, wreckGap);
          this.checkSensors(vehicle, dt);
        }
        lane.vehicles = list.filter((v) => !v.done);
      }

      for (const r of this.responders) r.step(dt, this);
      this.detectCollisions();
      this.checkStopBars();
      this.updateParticles(dt);
    }

    // Stop-bar presence detectors: tell the controller when a watched vehicle
    // has come to rest before its stop line (i.e. it did stop after all).
    checkStopBars() {
      for (const track of [...this.controller.tracks]) {
        const vehicle = track.lane.vehicles.find((v) => v.id === track.vehicleId);
        if (vehicle && !vehicle.crashed && vehicle.v < 0.3 && vehicle.s <= track.lane.stopS + 0.5) {
          this.controller.onStoppedAtStopBar(track, this.time);
        }
      }
    }

    spawnTraffic(dt) {
      if (this.density <= 0) return;
      let total = 0;
      for (const lane of W.lanes) total += lane.vehicles.length;
      if (total >= MAX_VEHICLES) return;
      for (const lane of W.lanes) {
        if (this.blockedLanes[lane.id] && this.blockedLanes[lane.id] > this.time) continue;
        const rate = C.spawnRatePerLane * this.density * (lane.group === 'NS' ? 1.15 : 0.9);
        if (Math.random() > rate * dt) continue;
        const last = lane.vehicles[lane.vehicles.length - 1];
        if (last && last.rearS < C.minSpawnGap) continue;
        const v0 = last ? Math.min(12, last.v + 2) : 12 + Math.random() * 3;
        this.spawn(lane, undefined, { s: 0, v: v0 });
      }
    }

    // Drivers brake for a crashed vehicle blocking their path in another lane.
    gapToWreck(vehicle, wrecks) {
      if (vehicle.crashed) return Infinity;
      const lane = vehicle.lane;
      const [dx, dy] = lane.dir;
      const vertical = lane.group === 'NS';
      const lo = lane.offset - vehicle.width / 2 - 0.4;
      const hi = lane.offset + vehicle.width / 2 + 0.4;
      let best = Infinity;
      for (const w of wrecks) {
        if (w.lane === lane) continue;   // handled by normal car-following
        const b = w.bounds();
        const latLo = vertical ? b.x0 : b.y0;
        const latHi = vertical ? b.x1 : b.y1;
        if (latHi < lo || latLo > hi) continue;
        // nearest edge of the wreck measured along this lane's path
        const corners = [[b.x0, b.y0], [b.x1, b.y1]];
        const along = Math.min(...corners.map(([x, y]) => (x - lane.start[0]) * dx + (y - lane.start[1]) * dy));
        const gap = along - vehicle.s;
        if (gap > -1 && gap < best) best = Math.max(0.1, gap);
      }
      return best < 80 ? best : Infinity;
    }

    checkSensors(vehicle, dt) {
      if (vehicle.s <= vehicle.prevS) return;
      for (const type of ['entry', 'stopline', 'exit']) {
        const sPos = vehicle.lane[`${type}SensorS`];
        if (vehicle.prevS < sPos && vehicle.s >= sPos) {
          // interpolate the exact crossing time inside this step
          const frac = (vehicle.s - sPos) / (vehicle.s - vehicle.prevS);
          const tCross = this.time - dt * frac;
          const sensor = W.sensorFor(vehicle.lane, type);
          sensor.lastTriggerAt = this.time;
          sensor.count++;
          // the Stopline Sensor is a dual loop -> it also reports spot speed
          this.controller.onSensor(sensor, vehicle, tCross, vehicle.v);
        }
      }
    }

    detectCollisions() {
      const box = W.box;
      const margin = 4;
      const near = this.vehicles.filter((v) => {
        const [x, y] = v.center();
        return x > box.x0 - margin - 8 && x < box.x1 + margin + 8 && y > box.y0 - margin - 8 && y < box.y1 + margin + 8;
      });
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const a = near[i];
          const b = near[j];
          if (a.lane.group === b.lane.group) continue;
          if (a.crashed && b.crashed) continue;
          const A = a.bounds();
          const B = b.bounds();
          if (A.x0 < B.x1 && A.x1 > B.x0 && A.y0 < B.y1 && A.y1 > B.y0) this.crash(a, b, A, B);
        }
      }
    }

    crash(a, b, A, B) {
      const impactSpeed = Math.max(a.v, b.v);
      for (const v of [a, b]) {
        if (!v.crashed) v.crashAngle = (Math.random() - 0.5) * 0.9;
        v.crashed = true;
        v.v = 0;
      }
      const x = (Math.max(A.x0, B.x0) + Math.min(A.x1, B.x1)) / 2;
      const y = (Math.max(A.y0, B.y0) + Math.min(A.y1, B.y1)) / 2;
      for (let i = 0; i < 40; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * impactSpeed * 0.6;
        this.particles.push({
          x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          life: 1 + Math.random() * 1.5, max: 2.5,
          kind: i < 18 ? 'spark' : 'debris', size: 0.2 + Math.random() * 0.5,
          color: i < 18 ? '#fde047' : [a.color, b.color, '#94a3b8'][i % 3],
        });
      }
      this.crashCount++;
      this.lastCrash = { x, y, at: this.time };
      CJ.events.emit('CRASH', { vehicles: [a.id, b.id], x, y, systemEnabled: this.controller.systemEnabled });
    }

    updateParticles(dt) {
      // smoke from wrecks
      if (this.lastCrash && Math.random() < dt * 6) {
        this.particles.push({
          x: this.lastCrash.x + (Math.random() - 0.5) * 2, y: this.lastCrash.y + (Math.random() - 0.5) * 2,
          vx: 0.6 + Math.random() * 0.4, vy: -0.5 - Math.random() * 0.4, life: 3, max: 3, kind: 'smoke', size: 1.5, color: '#6b7280',
        });
      }
      for (const p of this.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const drag = p.kind === 'smoke' ? 0.995 : 0.92;
        p.vx *= drag;
        p.vy *= drag;
        if (p.kind === 'smoke') p.size += dt * 0.7;
        p.life -= dt;
      }
      this.particles = this.particles.filter((p) => p.life > 0 && (p.kind !== 'debris' || p.life > 0));
      // debris stays on the road as long as the wreck is there
      for (const p of this.particles) if (p.kind === 'debris' && p.life < 0.3 && this.lastCrash) p.life = 0.3, p.vx = 0, p.vy = 0;
    }

    clearWrecks() {
      for (const lane of W.lanes) lane.vehicles = lane.vehicles.filter((v) => !v.crashed);
      this.particles = [];
      this.lastCrash = null;
      this.responders = [];
      this.dispatched = false;
      CJ.events.emit('WRECK_CLEARED');
    }
  }

  CJ.Simulation = Simulation;
})();
