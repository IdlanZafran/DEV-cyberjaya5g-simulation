/* =========================================================================
   config.js - real-world dimensions and tuning of the simulated junction
   Persiaran Ceria  x  Jalan Cyber Point 2 / Jln Fauna 1, Cyberjaya.
   All distances in metres, speeds in m/s, times in seconds.
   ========================================================================= */
window.CJ = window.CJ || {};

CJ.config = {
  // ---- Road geometry (left-hand traffic, Malaysia) ---------------------
  laneWidth: 3.5,
  nsLanesPerDirection: 3,     // Persiaran Ceria (north-south)
  nsMedianWidth: 6,
  ewLanesPerDirection: 2,     // Jalan Cyber Point 2 (east) / Jln Fauna 1 (west)
  ewMedianWidth: 4,
  crosswalkWidth: 4,
  stopLineSetback: 6,         // box edge -> stop line (gap + crosswalk + gap)
  worldHalfWidth: 220,
  worldHalfHeight: 160,

  // ---- Sensor positions per lane (distance BEFORE the stop line) ----------
  entrySensorBeforeStopLine: 70,    // Entry Sensor
  stoplineSensorBeforeStopLine: 40, // Stopline Sensor  -> speed trap baseline = 30 m
  exitSensorAfterBox: 16,           // Exit Sensor, past the far crosswalk

  // ---- Driver / braking model ------------------------------------------
  // Safe-stop test:   v * t_r + v^2 / (2a)  <=  D
  // Critical speed:   v_crit = a * ( -t_r + sqrt(t_r^2 + 2D/a) )
  brakingDecel: 3.4,          // m/s^2, comfortable (AASHTO design value)
  reactionTime: 1.0,          // s
  emergencyDecel: 7.5,        // m/s^2, hard braking limit
  speedLimitKmh: 60,

  // ---- Conflict-zone watchdog -------------------------------------------
  exitWindowFactor: 1.6,      // deadline = expected * factor + margin
  exitWindowMargin: 1.0,
  exitWindowMin: 3.0,
  exitWindowMax: 12.0,
  releaseBuffer: 1.5,         // extra all-red after the violator exits
  maxHold: 20,                // safety cap on a protective hold

  // ---- Signal plan (fixed time, two phases) ----------------------------
  // Yellow follows the ITE rule  Y = t_r + v/(2a) = 1 + 16.7/6.8 ≈ 3.5 s -> 4 s at 60 km/h
  timing: { nsGreen: 20, ewGreen: 15, yellow: 4, allRed: 2 },

  // ---- Traffic ---------------------------------------------------------
  spawnRatePerLane: 0.11,     // vehicles per second per lane (normal flow)
  minSpawnGap: 22,            // m between consecutive spawns in a lane

  // ---- Vehicle classes (IDM parameters) -----------------------------------
  vehicleTypes: {
    car:        { length: 4.5, width: 1.8, v0: 16.7, a: 1.6, b: 2.0, T: 1.3, s0: 2.0, weight: 0.68 },
    suv:        { length: 4.9, width: 1.95, v0: 16.0, a: 1.5, b: 2.0, T: 1.4, s0: 2.0, weight: 0.17 },
    bus:        { length: 12.0, width: 2.5, v0: 13.9, a: 1.0, b: 1.6, T: 1.6, s0: 2.5, weight: 0.05 },
    motorcycle: { length: 2.1, width: 0.8, v0: 17.5, a: 2.4, b: 2.5, T: 1.0, s0: 1.5, weight: 0.10 },
    violator:   { length: 4.6, width: 1.85, v0: 26.4, a: 3.0, b: 3.0, T: 0.8, s0: 1.5, weight: 0 },
    ambulance:  { length: 6.2, width: 2.2, v0: 22.0, a: 2.2, b: 2.5, T: 1.0, s0: 2.0, weight: 0 },
  },
  palette: ['#e5e7eb', '#d1d5db', '#9ca3af', '#4b5563', '#1f2937', '#111827', '#f3f4f6', '#b91c1c',
    '#1d4ed8', '#0f766e', '#a16207', '#7c3aed', '#be123c', '#334155', '#94a3b8', '#e2e8f0'],
};

// Derived constant: the critical (can-no-longer-stop) speed at the Stopline Sensor.
CJ.criticalSpeed = (() => {
  const { brakingDecel: a, reactionTime: tr, stoplineSensorBeforeStopLine: D } = CJ.config;
  return a * (-tr + Math.sqrt(tr * tr + (2 * D) / a));
})();

CJ.kmh = (ms) => ms * 3.6;
