/* =========================================================================
   world.js - junction geometry: approaches, lanes and per-lane sensors.

   Coordinate system: metres, origin = centre of the junction,
   +x = east, +y = south (canvas convention). LEFT-HAND traffic:
     southbound (from N) uses the EAST half of Persiaran Ceria  (x > 0)
     northbound (from S) uses the WEST half                     (x < 0)
     eastbound  (from W) uses the NORTH half of the E-W road    (y < 0)
     westbound  (from E) uses the SOUTH half                    (y > 0)
   Every lane is a straight path; a vehicle's position is "s", the distance
   its FRONT bumper has travelled from the lane's spawn point.
   ========================================================================= */
(() => {
  const C = CJ.config;
  const nsHalf = C.nsMedianWidth / 2 + C.nsLanesPerDirection * C.laneWidth; // half-width of Persiaran Ceria
  const ewHalf = C.ewMedianWidth / 2 + C.ewLanesPerDirection * C.laneWidth; // half-width of the E-W road
  const W = C.worldHalfWidth;
  const H = C.worldHalfHeight;

  // The conflict zone = the junction box between the four kerb lines
  const box = { x0: -nsHalf, x1: nsHalf, y0: -ewHalf, y1: ewHalf };

  const APPROACH_INFO = {
    N: { name: 'Persiaran Ceria (southbound)', short: 'Persiaran Ceria SB', group: 'NS', dir: [0, 1] },
    S: { name: 'Persiaran Ceria (northbound)', short: 'Persiaran Ceria NB', group: 'NS', dir: [0, -1] },
    E: { name: 'Jalan Cyber Point 2 (westbound)', short: 'Jln Cyber Point 2 WB', group: 'EW', dir: [-1, 0] },
    W: { name: 'Jln Fauna 1 (eastbound)', short: 'Jln Fauna 1 EB', group: 'EW', dir: [1, 0] },
  };

  const lanes = [];
  const sensors = [];

  for (const [id, info] of Object.entries(APPROACH_INFO)) {
    const vertical = info.group === 'NS';
    const laneCount = vertical ? C.nsLanesPerDirection : C.ewLanesPerDirection;
    const median = (vertical ? C.nsMedianWidth : C.ewMedianWidth) / 2;
    const half = vertical ? H : W;                       // half-length of the path axis
    const boxHalfAlong = vertical ? ewHalf : nsHalf;     // box half-size along travel
    // Lateral side of the road for left-hand traffic
    const side = { N: 1, S: -1, E: 1, W: -1 }[id];

    for (let i = 0; i < laneCount; i++) {
      const offset = side * (median + C.laneWidth * (i + 0.5)); // i = 0 is next to the median
      const [dx, dy] = info.dir;
      const start = vertical ? [offset, -dy * half] : [-dx * half, offset];
      const length = 2 * half;
      const stopS = half - boxHalfAlong - C.stopLineSetback;
      const lane = {
        id: `${id}${i + 1}`,
        approach: id,
        group: info.group,
        index: i,
        dir: info.dir,
        start,
        length,
        heading: Math.atan2(dy, dx),
        offset,
        stopS,
        boxEntryS: half - boxHalfAlong,
        boxExitS: half + boxHalfAlong,
        entrySensorS: stopS - C.entrySensorBeforeStopLine,
        stoplineSensorS: stopS - C.stoplineSensorBeforeStopLine,
        exitSensorS: half + boxHalfAlong + C.exitSensorAfterBox,
        vehicles: [],          // ordered: index 0 = furthest along (leader)
        entryQueue: [],        // FIFO of Entry Sensor timestamps (speed trap)
        zoneQueue: [],         // FIFO of vehicles between Stopline and Exit sensors
      };
      lane.point = (s) => [lane.start[0] + dx * s, lane.start[1] + dy * s];
      lanes.push(lane);

      for (const type of ['entry', 'stopline', 'exit']) {
        sensors.push({
          id: `${lane.id}-${type}`,
          lane,
          type,
          s: lane[`${type}SensorS`],
          lastTriggerAt: -10,
          count: 0,
        });
      }
    }
  }

  // Signal-head positions (kerb side + median side, just before each stop line)
  function signalHeads() {
    const heads = [];
    for (const [id, info] of Object.entries(APPROACH_INFO)) {
      const lane0 = lanes.find((l) => l.approach === id);
      const p = lane0.point(lane0.stopS + 1.5);
      const vertical = info.group === 'NS';
      const median = (vertical ? C.nsMedianWidth : C.ewMedianWidth) / 2;
      const half = vertical ? nsHalf : ewHalf;
      const side = { N: 1, S: -1, E: 1, W: -1 }[id];
      const kerb = side * (half + 1.6);
      const mid = side * (median - 1.2);
      if (vertical) heads.push({ approach: id, x: kerb, y: p[1] }, { approach: id, x: mid, y: p[1] });
      else heads.push({ approach: id, x: p[0], y: kerb }, { approach: id, x: p[0], y: mid });
    }
    return heads;
  }

  CJ.world = {
    nsHalf,
    ewHalf,
    box,
    halfWidth: W,
    halfHeight: H,
    approaches: APPROACH_INFO,
    lanes,
    sensors,
    signalHeads: signalHeads(),
    laneById: (id) => lanes.find((l) => l.id === id),
    lanesOf: (approach) => lanes.filter((l) => l.approach === approach),
    sensorFor: (lane, type) => sensors.find((s) => s.lane === lane && s.type === type),
    groupOf: (approach) => APPROACH_INFO[approach].group,
    conflictingGroup: (group) => (group === 'NS' ? 'EW' : 'NS'),
    reset() {
      for (const lane of lanes) {
        lane.vehicles = [];
        lane.entryQueue = [];
        lane.zoneQueue = [];
      }
      for (const s of sensors) {
        s.lastTriggerAt = -10;
        s.count = 0;
      }
    },
  };
})();
