/* =========================================================================
   vehicle.js - vehicles driven by the Intelligent Driver Model (IDM).

   IDM acceleration (Treiber et al., 2000):
       a = a_max * [ 1 - (v / v0)^4 - (s* / gap)^2 ]
       s* = s0 + max(0, v*T + v*dv / (2*sqrt(a_max*b)))
   gap = distance to the leader's rear bumper (or to a virtual stopped
   obstacle 1 m before the stop line when the driver decides to stop).

   Driver decision on YELLOW (dilemma-zone model, same maths as the
   controller):  stop if  v*t_r + v^2/(2*b_brake) <= distance to the stop line.
   ========================================================================= */
(() => {
  const C = CJ.config;
  let nextId = 1;

  function pickType() {
    const types = Object.entries(C.vehicleTypes).filter(([, p]) => p.weight > 0);
    let r = Math.random();
    for (const [name, p] of types) {
      r -= p.weight;
      if (r <= 0) return name;
    }
    return 'car';
  }

  class Vehicle {
    /**
     * @param lane    lane object from CJ.world
     * @param type    key of CJ.config.vehicleTypes
     * @param opts    { s, v, behavior: 'normal'|'violator'|'ambulance', anticipates, color, scripted }
     */
    constructor(lane, type = pickType(), opts = {}) {
      const p = C.vehicleTypes[type];
      this.id = nextId++;
      this.lane = lane;
      this.type = type;
      this.behavior = opts.behavior || (type === 'violator' ? 'violator' : type === 'ambulance' ? 'ambulance' : 'normal');
      const jitter = this.behavior === 'normal' ? 0.9 + Math.random() * 0.18 : 1;
      this.params = { ...p, v0: p.v0 * jitter };
      this.length = p.length;
      this.width = p.width;
      this.color = opts.color || (type === 'bus' ? '#f59e0b' : type === 'ambulance' ? '#f8fafc' : type === 'violator' ? '#dc2626'
        : C.palette[Math.floor(Math.random() * C.palette.length)]);
      this.s = opts.s ?? 0;
      this.prevS = this.s;
      this.v = opts.v ?? Math.min(this.params.v0, 14);
      this.acc = 0;
      // Drivers who watch the countdown timer and roll up to the line expecting green
      this.anticipates = opts.anticipates ?? (this.behavior === 'normal' && Math.random() < 0.15);
      this.yellowDecision = null;
      this.crashed = false;
      this.crashAngle = 0;
      this.scripted = !!opts.scripted;
      this.measured = null;           // { speed, verdict, at } for the on-screen speed tag
      this.done = false;
    }

    get rearS() { return this.s - this.length; }

    center() { return this.lane.point(this.s - this.length / 2); }

    // Axis-aligned bounding box (all movements are straight)
    bounds() {
      const [cx, cy] = this.center();
      const vertical = this.lane.group === 'NS';
      const hx = (vertical ? this.width : this.length) / 2;
      const hy = (vertical ? this.length : this.width) / 2;
      return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
    }

    // Distance to a virtual "stop here" obstacle, or Infinity if the driver goes.
    signalGap(controller) {
      if (this.behavior === 'violator') return Infinity;   // runs the light
      const d = this.lane.stopS - this.s;
      if (d < 0.3) return Infinity;                        // already past the stop line
      const signal = controller.signalFor(this.lane.approach);

      if (signal.color === 'GREEN') {
        this.yellowDecision = null;
        return Infinity;
      }

      // Countdown-timer anticipation: keep rolling if green will come before arrival.
      if ((this.anticipates || this.behavior === 'ambulance') && signal.color === 'RED' && signal.timeToGreen != null) {
        const timeToArrive = d / Math.max(this.v, 0.5);
        if (timeToArrive >= signal.timeToGreen + 0.3) return Infinity;
      }

      const canStopComfortably = this.v * C.reactionTime + (this.v * this.v) / (2 * C.brakingDecel) <= d;
      const canStopHard = (this.v * this.v) / (2 * C.emergencyDecel) <= d - 0.5;

      if (signal.color === 'YELLOW' && !signal.flashing) {
        if (this.yellowDecision === null) this.yellowDecision = canStopComfortably ? 'stop' : 'go';
        if (this.yellowDecision === 'go') return Infinity;
      } else if (this.yellowDecision === 'go' || !canStopHard) {
        // Committed on yellow (or the light changed under us and we can't stop)
        if (!canStopHard) return Infinity;
      }
      return Math.max(0.1, d - 1.0);
    }

    // IDM acceleration toward leader / obstacle
    idm(gap, leaderSpeed) {
      const p = this.params;
      const v = this.v;
      const free = 1 - Math.pow(v / p.v0, 4);
      if (!Number.isFinite(gap)) return p.a * free;
      const dv = v - leaderSpeed;
      const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
      return p.a * (free - Math.pow(sStar / Math.max(gap, 0.1), 2));
    }

    step(dt, leader, controller, wreckGap) {
      this.prevS = this.s;
      if (this.crashed) { this.v = 0; this.acc = 0; return; }

      let gap = Infinity;
      let leaderSpeed = 0;
      if (leader) {
        gap = leader.rearS - this.s;
        leaderSpeed = leader.v;
      }
      const sigGap = this.signalGap(controller);
      if (sigGap < gap) { gap = sigGap; leaderSpeed = 0; }
      if (wreckGap < gap) { gap = wreckGap; leaderSpeed = 0; }

      let a = this.idm(gap, leaderSpeed);
      a = Math.max(-C.emergencyDecel, Math.min(this.params.a, a));
      this.acc = a;
      const v = Math.max(0, this.v + a * dt);
      this.s += (this.v + v) * 0.5 * dt;   // trapezoidal integration
      this.v = v;
      if (this.rearS > this.lane.length + 5) this.done = true;
    }
  }

  CJ.Vehicle = Vehicle;
  CJ.pickVehicleType = pickType;
})();
