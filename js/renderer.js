/* =========================================================================
   renderer.js - draws the junction on an HTML canvas (world units = metres).

   The scenery is a stylised version of the satellite view of
   Persiaran Ceria x Jalan Cyber Point 2 / Jln Fauna 1: fenced field (NW),
   office block + shoplots + car park (NE), data-centre building (SW),
   large warehouse roofs (SE), corner slip-lane islands, zebra crossings,
   a planted median on Persiaran Ceria and roadside trees.
   ========================================================================= */
(() => {
  const C = CJ.config;
  const W = CJ.world;
  const nsH = W.nsHalf;
  const ewH = W.ewHalf;
  const nsMed = C.nsMedianWidth / 2;
  const ewMed = C.ewMedianWidth / 2;
  const SET = C.stopLineSetback;
  const SLIP_R = 30;

  const COLORS = {
    grass: '#8a9a6a', grassDark: '#7a8a5c', asphalt: '#55595f', asphaltLight: '#62666c',
    marking: '#eef2f6', kerb: '#c9ccc4', median: '#a9a796', island: '#c8c5b6',
    entry: '#22d3ee', stopline: '#f59e0b', exit: '#4ade80',
  };

  // ---- deterministic scenery ------------------------------------------------
  function seeded(seed) {
    let a = seed;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = seeded(2026);

  const scenery = {
    fields: [
      { x0: -214, y0: -157, x1: -50, y1: -42, color: '#8fa069', fence: true, label: 'Open field' },
    ],
    lots: [
      { x0: 118, y0: -93, x1: 218, y1: -50, rows: 3 },
      { x0: 52, y0: 33, x1: 218, y1: 52, rows: 1 },
      { x0: -112, y0: 28, x1: -44, y1: 42, rows: 1 },
    ],
    buildings: [
      { x0: -124, y0: -146, x1: -106, y1: -128, roof: '#a8adb3' },
      { x0: -100, y0: -146, x1: -82, y1: -126, roof: '#9ea4ab' },
      { x0: 50, y0: -158, x1: 106, y1: -100, roof: '#8f959c', ridges: 6, label: 'Office complex' },
      { x0: 120, y0: -158, x1: 218, y1: -104, roof: '#b9b3a6', units: 8, label: 'Shoplots' },
      { x0: -112, y0: 50, x1: -44, y1: 158, roof: '#d9d6cf', ridges: 10, label: 'Data centre' },
      { x0: -214, y0: 44, x1: -150, y1: 112, roof: '#a0a6ad', label: '' },
      { x0: 54, y0: 64, x1: 172, y1: 158, roof: '#e9e7e3', ridges: 14, label: 'Warehouse' },
      { x0: 180, y0: 64, x1: 218, y1: 158, roof: '#d8d5d0', ridges: 5 },
    ],
    trees: [],
    parked: [],
  };

  // Roadside trees (avoid roads, slip lanes and buildings)
  function freeSpot(x, y, r) {
    if (Math.abs(x) < nsH + 2.5 + r || Math.abs(y) < ewH + 2.5 + r) return false;
    if (Math.abs(x) < nsH + SLIP_R + 6 && Math.abs(y) < ewH + SLIP_R + 6) return false;
    for (const b of [...scenery.buildings, ...scenery.lots]) {
      if (x > b.x0 - r && x < b.x1 + r && y > b.y0 - r && y < b.y1 + r) return false;
    }
    return true;
  }
  for (let y = -158; y < 160; y += 8 + rnd() * 4) {
    for (const side of [-1, 1]) {
      const x = side * (nsH + 5 + rnd() * 3);
      if (freeSpot(x, y, 2)) scenery.trees.push({ x, y, r: 2.4 + rnd() * 1.6 });
    }
  }
  for (let x = -218; x < 220; x += 9 + rnd() * 5) {
    for (const side of [-1, 1]) {
      const y = side * (ewH + 5 + rnd() * 3);
      if (freeSpot(x, y, 2)) scenery.trees.push({ x, y, r: 2.2 + rnd() * 1.5 });
    }
  }
  for (let i = 0; i < 70; i++) { // tree belt NE of the junction (dense in the satellite view)
    const x = 18 + rnd() * 26;
    const y = -158 + rnd() * 118;
    if (freeSpot(x, y, 2.5)) scenery.trees.push({ x, y, r: 2.6 + rnd() * 1.8 });
  }
  const medianTrees = [];
  for (let y = ewH + SET + 12; y < 160; y += 11) medianTrees.push({ x: 0, y, r: 2.3 });
  for (let y = -(ewH + SET + 40); y > -160; y -= 14) medianTrees.push({ x: 0, y, r: 2.0 });
  for (const lot of scenery.lots) {
    const rows = lot.rows;
    for (let r = 0; r < rows; r++) {
      const y = lot.y0 + 3 + r * ((lot.y1 - lot.y0 - 6) / Math.max(1, rows - 1 || 1));
      for (let x = lot.x0 + 2; x < lot.x1 - 3; x += 2.7) {
        if (rnd() < 0.72) scenery.parked.push({ x, y, color: C.palette[Math.floor(rnd() * C.palette.length)] });
      }
    }
  }

  // ---- helpers ---------------------------------------------------------------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function line(ctx, x0, y0, x1, y1) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // ---- static layers ------------------------------------------------------------
  function drawGround(ctx) {
    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(-600, -500, 1200, 1000);
    // texture patches
    ctx.fillStyle = COLORS.grassDark;
    for (let i = 0; i < 30; i++) {
      const x = -210 + ((i * 97) % 420);
      const y = -150 + ((i * 53) % 300);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.ellipse(x, y, 14 + (i % 5) * 4, 8 + (i % 3) * 4, i, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const f of scenery.fields) {
      ctx.fillStyle = f.color;
      ctx.fillRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
      if (f.fence) {
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 0.6;
        ctx.setLineDash([1.5, 1.5]);
        ctx.strokeRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
        ctx.setLineDash([]);
      }
    }
    for (const lot of scenery.lots) {
      ctx.fillStyle = '#6d7076';
      ctx.fillRect(lot.x0, lot.y0, lot.x1 - lot.x0, lot.y1 - lot.y0);
    }
    for (const p of scenery.parked) {
      ctx.fillStyle = p.color;
      rr(ctx, p.x, p.y - 2.2, 1.8, 4.4, 0.4);
      ctx.fill();
    }
    for (const b of scenery.buildings) {
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.fillRect(b.x0 + 2, b.y0 + 2, b.x1 - b.x0, b.y1 - b.y0);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.strokeStyle = 'rgba(0,0,0,.18)';
      ctx.lineWidth = 0.4;
      if (b.ridges) {
        const step = (b.x1 - b.x0) / b.ridges;
        for (let i = 1; i < b.ridges; i++) line(ctx, b.x0 + i * step, b.y0, b.x0 + i * step, b.y1);
      }
      if (b.units) {
        const step = (b.x1 - b.x0) / b.units;
        for (let i = 1; i < b.units; i++) line(ctx, b.x0 + i * step, b.y0, b.x0 + i * step, b.y1);
        line(ctx, b.x0, (b.y0 + b.y1) / 2, b.x1, (b.y0 + b.y1) / 2);
      }
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    }
  }

  function drawTrees(ctx, list) {
    for (const t of list) {
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath(); ctx.arc(t.x + 0.8, t.y + 0.8, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f5f2c';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#557a3a';
      ctx.beginPath(); ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.25, t.r * 0.55, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawRoads(ctx) {
    // corner slip lanes (left-turn bypasses) with triangular islands
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const kx = sx * nsH;
        const ky = sy * ewH;
        const cx = sx * (nsH + SLIP_R);
        const cy = sy * (ewH + SLIP_R);
        // The slip lane is the band r = R .. R+5.5 m outside a circle of radius R
        // tangent to both kerbs; the island is what is left towards the corner.
        const aRoadNS = Math.atan2(0, -sx);       // tangent point on the N-S kerb
        const aRoadEW = Math.atan2(-sy, 0);       // tangent point on the E-W kerb
        const ccw = sx * sy < 0;                  // take the short arc facing the corner
        ctx.fillStyle = COLORS.asphalt;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(kx, cy);
        ctx.arc(cx, cy, SLIP_R, aRoadNS, aRoadEW, ccw);
        ctx.closePath();
        ctx.fill();
        const r2 = SLIP_R + 5.5;
        const q = Math.sqrt(r2 * r2 - SLIP_R * SLIP_R);
        ctx.fillStyle = COLORS.island;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(cx - sx * SLIP_R, cy - sy * q);
        ctx.arc(cx, cy, r2, Math.atan2(-sy * q, -sx * SLIP_R), Math.atan2(-sy * SLIP_R, -sx * q), ccw);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = COLORS.kerb;
        ctx.lineWidth = 0.35;
        ctx.stroke();
        // hatch on the island
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,.55)';
        ctx.lineWidth = 0.35;
        for (let d = -40; d < 40; d += 2.2) line(ctx, kx + d, ky - 30, kx + d + 30 * sx * sy, ky + 30);
        ctx.restore();
      }
    }

    // main carriageways
    ctx.fillStyle = COLORS.asphalt;
    ctx.fillRect(-nsH, -500, nsH * 2, 1000);
    ctx.fillRect(-600, -ewH, 1200, ewH * 2);

    // kerbs
    ctx.strokeStyle = COLORS.kerb;
    ctx.lineWidth = 0.35;
    for (const sy of [-1, 1]) {
      line(ctx, -nsH, sy * (ewH + SLIP_R), -nsH, sy * 500);
      line(ctx, nsH, sy * (ewH + SLIP_R), nsH, sy * 500);
    }
    for (const sx of [-1, 1]) {
      line(ctx, sx * (nsH + SLIP_R), -ewH, sx * 600, -ewH);
      line(ctx, sx * (nsH + SLIP_R), ewH, sx * 600, ewH);
    }

    // raised medians (stop at the crosswalks)
    const nsMedStart = ewH + SET - 0.5;
    const ewMedStart = nsH + SET - 0.5;
    for (const sy of [-1, 1]) {
      ctx.fillStyle = COLORS.kerb;
      rr(ctx, -nsMed, sy > 0 ? nsMedStart : -500, nsMed * 2, 500 - nsMedStart, 1.5);
      ctx.fill();
      ctx.fillStyle = '#7d9156';
      ctx.fillRect(-nsMed + 0.5, sy > 0 ? nsMedStart + 1.5 : -500, nsMed * 2 - 1, 500 - nsMedStart - 1.5);
    }
    for (const sx of [-1, 1]) {
      ctx.fillStyle = COLORS.kerb;
      rr(ctx, sx > 0 ? ewMedStart : -600, -ewMed, 600 - ewMedStart, ewMed * 2, 1.2);
      ctx.fill();
      ctx.fillStyle = '#7d9156';
      ctx.fillRect(sx > 0 ? ewMedStart + 1.2 : -600, -ewMed + 0.5, 600 - ewMedStart - 1.2, ewMed * 2 - 1);
    }
  }

  function drawMarkings(ctx) {
    ctx.strokeStyle = COLORS.marking;
    ctx.lineWidth = 0.15;
    const L = C.laneWidth;

    // lane dividers: dashed far away, solid on the 30 m before each stop line
    for (const sy of [-1, 1]) {
      const yNear = sy * (ewH + SET);
      for (let k = 1; k < C.nsLanesPerDirection; k++) {
        for (const sx of [-1, 1]) {
          const x = sx * (nsMed + k * L);
          const inbound = (sy < 0 && sx > 0) || (sy > 0 && sx < 0);
          ctx.setLineDash([3, 6]);
          line(ctx, x, yNear + sy * (inbound ? 30 : 0), x, sy * 500);
          ctx.setLineDash([]);
          if (inbound) line(ctx, x, yNear, x, yNear + sy * 30);
        }
      }
      // edge lines
      for (const sx of [-1, 1]) {
        line(ctx, sx * (nsMed + 0.25), yNear, sx * (nsMed + 0.25), sy * 500);
        line(ctx, sx * (nsH - 0.3), yNear, sx * (nsH - 0.3), sy * 500);
      }
    }
    for (const sx of [-1, 1]) {
      const xNear = sx * (nsH + SET);
      for (let k = 1; k < C.ewLanesPerDirection; k++) {
        for (const sy of [-1, 1]) {
          const y = sy * (ewMed + k * L);
          const inbound = (sx > 0 && sy > 0) || (sx < 0 && sy < 0);
          ctx.setLineDash([3, 6]);
          line(ctx, xNear + sx * (inbound ? 30 : 0), y, sx * 600, y);
          ctx.setLineDash([]);
          if (inbound) line(ctx, xNear, y, xNear + sx * 30, y);
        }
      }
      for (const sy of [-1, 1]) {
        line(ctx, xNear, sy * (ewMed + 0.25), sx * 600, sy * (ewMed + 0.25));
        line(ctx, xNear, sy * (ewH - 0.3), sx * 600, sy * (ewH - 0.3));
      }
    }

    // zebra crossings
    ctx.fillStyle = COLORS.marking;
    for (const sy of [-1, 1]) {
      const y0 = sy > 0 ? ewH + 1 : -(ewH + 1 + C.crosswalkWidth);
      for (let x = -nsH + 0.6; x < nsH - 0.4; x += 1.1) ctx.fillRect(x, y0, 0.55, C.crosswalkWidth);
    }
    for (const sx of [-1, 1]) {
      const x0 = sx > 0 ? nsH + 1 : -(nsH + 1 + C.crosswalkWidth);
      for (let y = -ewH + 0.6; y < ewH - 0.4; y += 1.1) ctx.fillRect(x0, y, C.crosswalkWidth, 0.55);
    }

    // stop lines (inbound halves only)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(nsMed, -(ewH + SET) - 0.25, nsH - nsMed, 0.5);    // N approach (southbound, x>0)
    ctx.fillRect(-nsH, ewH + SET - 0.25, nsH - nsMed, 0.5);         // S approach (northbound, x<0)
    ctx.fillRect(nsH + SET - 0.25, ewMed, 0.5, ewH - ewMed);        // E approach (westbound, y>0)
    ctx.fillRect(-(nsH + SET) - 0.25, -ewH, 0.5, ewH - ewMed);      // W approach (eastbound, y<0)

    // straight-ahead arrows
    for (const lane of W.lanes) {
      for (const ds of [14, 48]) {
        const [x, y] = lane.point(lane.stopS - ds);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(lane.heading);
        ctx.beginPath();
        ctx.moveTo(2.4, 0); ctx.lineTo(0.6, -0.9); ctx.lineTo(0.6, -0.3); ctx.lineTo(-2.6, -0.3);
        ctx.lineTo(-2.6, 0.3); ctx.lineTo(0.6, 0.3); ctx.lineTo(0.6, 0.9); ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawLabels(ctx) {
    ctx.save();
    ctx.font = '600 4.2px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = (text, x, y, rot) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = 'rgba(15,23,42,.85)';
      ctx.strokeText(text, 0, 0);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    label('Persiaran Ceria', 0, -100, -Math.PI / 2);
    label('Persiaran Ceria', 0, 110, -Math.PI / 2);
    label('Jalan Cyber Point 2', 120, 0, 0);
    label('Jln Fauna 1', -120, 0, 0);
    ctx.font = '500 3.4px "Segoe UI", sans-serif';
    for (const b of [...scenery.buildings, ...scenery.fields]) {
      if (!b.label) continue;
      ctx.fillStyle = 'rgba(15,23,42,.65)';
      ctx.fillText(b.label, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    }
    ctx.restore();
  }

  // ---- dynamic layers -----------------------------------------------------------
  function drawSensors(ctx, sim) {
    const t = sim.time;
    for (const sensor of W.sensors) {
      const lane = sensor.lane;
      const [x, y] = lane.point(sensor.s);
      const color = COLORS[sensor.type];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(lane.heading);
      const hot = t - sensor.lastTriggerAt < 0.45;
      ctx.lineWidth = 0.3;
      ctx.strokeStyle = color;
      ctx.globalAlpha = hot ? 1 : 0.75;
      ctx.strokeRect(-0.8, -(C.laneWidth - 0.9) / 2, 1.6, C.laneWidth - 0.9);
      if (hot) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.65;
        ctx.fillRect(-0.8, -(C.laneWidth - 0.9) / 2, 1.6, C.laneWidth - 0.9);
      }
      ctx.restore();
    }
  }

  // "Data sent" indicator: a small wireless icon rises from a sensor loop each
  // time it detects a vehicle (the detection is transmitted to the controller).
  const SIGNAL_ICON_SECONDS = 1.1;
  // Labels are sized for ~13 px on screen regardless of zoom (set in drawWorld)
  let labelUnit = 1;
  function drawSensorSignals(ctx, sim, scale) {
    const t = sim.time;
    const u = Math.max(0.9, 4.5 / scale);          // icon unit in metres (stays readable when zoomed out)
    for (const sensor of W.sensors) {
      const age = t - sensor.lastTriggerAt;
      if (age < 0 || age > SIGNAL_ICON_SECONDS) continue;
      const [x, y] = sensor.lane.point(sensor.s);
      const color = COLORS[sensor.type];
      const alpha = 1 - age / SIGNAL_ICON_SECONDS;
      const cy = y - u * (1.2 + age * 2.2);          // drifts upward while fading
      ctx.save();
      ctx.globalAlpha = alpha;
      // dark badge behind the icon for contrast on any background
      ctx.fillStyle = 'rgba(15,23,42,.8)';
      ctx.beginPath(); ctx.arc(x, cy - u * 0.9, u * 2.1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineCap = 'round';
      ctx.lineWidth = u * 0.32;
      // arcs appear one after another (0.12 s apart) like a transmitting signal
      for (let k = 1; k <= 3; k++) {
        if (age < (k - 1) * 0.12) break;
        ctx.beginPath();
        ctx.arc(x, cy, u * 0.55 * k, -Math.PI * 0.78, -Math.PI * 0.22);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, cy, u * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawConflictZone(ctx, sim) {
    const ctl = sim.controller;
    const box = W.box;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    if (ctl.mode === 'EMERGENCY') {
      ctx.fillStyle = `rgba(239,68,68,${0.25 + 0.25 * pulse})`;
      ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      ctx.strokeStyle = '#ef4444';
    } else if (ctl.tracks.length) {
      ctx.fillStyle = `rgba(245,158,11,${0.15 + 0.2 * pulse})`;
      ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      ctx.strokeStyle = '#f59e0b';
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
    }
    ctx.lineWidth = 0.35;
    ctx.setLineDash([1.2, 1.2]);
    ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    ctx.setLineDash([]);

    // predicted path + countdown for each tracked violator
    for (const track of ctl.tracks) {
      const vehicle = track.lane.vehicles.find((v) => v.id === track.vehicleId);
      const [ex, ey] = track.lane.point(track.lane.exitSensorS);
      const from = vehicle ? vehicle.center() : track.lane.point(track.lane.stoplineSensorS);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([1.5, 1]);
      line(ctx, from[0], from[1], ex, ey);
      ctx.setLineDash([]);
      const left = Math.max(0, track.deadline - sim.time);
      ctx.beginPath();
      ctx.arc(ex, ey, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15,23,42,.85)';
      ctx.fill();
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(ex, ey, 2.6, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / (track.deadline - track.start));
      ctx.stroke();
      ctx.fillStyle = '#fde68a';
      ctx.font = '700 1.9px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(left.toFixed(1), ex, ey);
    }
  }

  function drawSignalHeads(ctx, sim) {
    const blink = Math.floor(performance.now() / 500) % 2 === 0;
    for (const head of W.signalHeads) {
      const sig = sim.controller.signalFor(head.approach);
      const lit = !sig.flashing || blink;
      ctx.fillStyle = '#111827';
      ctx.beginPath(); ctx.arc(head.x, head.y, 1.35, 0, Math.PI * 2); ctx.fill();
      const color = sig.color === 'GREEN' ? '#22c55e' : sig.color === 'YELLOW' ? '#f59e0b' : '#ef4444';
      if (lit) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(head.x, head.y, 0.95, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // "HOLD" marker for protected approaches
      if (sig.timeToGreen === null && sim.controller.mode === 'AUTO' && sim.controller.holds[W.groupOf(head.approach)]) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = '700 1.6px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('HOLD', head.x, head.y - 2.2);
      }
    }
  }

  function drawVehicle(ctx, v, t) {
    const [cx, cy] = v.center();
    const L = v.length;
    const Wd = v.width;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(v.lane.heading + v.crashAngle);

    const emergencyVehicle = v.behavior === 'ambulance' || v.behavior === 'police';
    if (emergencyVehicle && !(v.isResponder && v.arrived)) {        // siren rings while driving
      for (let k = 0; k < 2; k++) {
        const ph = ((t * 1.2 + k * 0.5) % 1);
        ctx.strokeStyle = v.behavior === 'police' ? `rgba(239,68,68,${0.55 * (1 - ph)})` : `rgba(59,130,246,${0.6 * (1 - ph)})`;
        ctx.lineWidth = 0.4;
        ctx.beginPath(); ctx.arc(0, 0, 3 + ph * 14, 0, Math.PI * 2); ctx.stroke();
      }
    }
    const tracked = v.measured && v.measured.verdict === 'violation';
    if (tracked || v.behavior === 'violator') {
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 18;
    }
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    rr(ctx, -L / 2 + 0.25, -Wd / 2 + 0.25, L, Wd, 0.5);
    ctx.fill();
    ctx.fillStyle = v.crashed ? shade(v.color) : v.color;
    rr(ctx, -L / 2, -Wd / 2, L, Wd, v.type === 'motorcycle' ? 0.35 : 0.6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 0.08;
    ctx.stroke();

    if (v.type === 'motorcycle') {
      ctx.fillStyle = '#111827';
      ctx.beginPath(); ctx.arc(-0.1, 0, 0.42, 0, Math.PI * 2); ctx.fill();
    } else if (v.type === 'bus') {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(L / 2 - 1.1, -Wd / 2 + 0.25, 0.7, Wd - 0.5);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fillRect(-L / 2 + 0.8, -0.15, L - 2.5, 0.3);
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(L * 0.12, -Wd / 2 + 0.2, L * 0.17, Wd - 0.4);   // windscreen
      ctx.fillRect(-L * 0.38, -Wd / 2 + 0.25, L * 0.1, Wd - 0.5);  // rear window
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.fillRect(-L * 0.26, -Wd / 2 + 0.3, L * 0.36, Wd - 0.6);  // roof shine
    }
    if (emergencyVehicle) {
      if (v.behavior === 'police') {          // white side stripes on a blue body
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(-L / 2 + 0.3, -Wd / 2, L - 0.6, 0.25);
        ctx.fillRect(-L / 2 + 0.3, Wd / 2 - 0.25, L - 0.6, 0.25);
      } else {
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(-L / 2, -0.18, L, 0.36);
      }
      const on = Math.floor(t * 6) % 2 === 0;
      ctx.fillStyle = on ? '#ef4444' : '#3b82f6';
      ctx.fillRect(L * 0.02, -Wd / 2 + 0.15, 0.5, Wd / 2 - 0.15);
      ctx.fillStyle = on ? '#3b82f6' : '#ef4444';
      ctx.fillRect(L * 0.02, 0, 0.5, Wd / 2 - 0.15);
    }
    // brake lights
    if (!v.crashed && (v.acc < -0.9 || v.v < 0.3)) {
      ctx.fillStyle = '#ff2d2d';
      ctx.fillRect(-L / 2 - 0.05, -Wd / 2 + 0.1, 0.25, 0.35);
      ctx.fillRect(-L / 2 - 0.05, Wd / 2 - 0.45, 0.25, 0.35);
    }
    ctx.restore();

    // speed tag (for a few seconds after measurement)
    if (v.measured && t - v.measured.at < 4 && v.measured.verdict !== 'ok') {
      drawTag(ctx, `${Math.round(CJ.kmh(v.measured.speed))} km/h`, cx, cy - Wd - 1.2,
        v.measured.verdict === 'violation' ? 'rgba(185,28,28,.92)' : 'rgba(180,83,9,.9)');
    }
    // responder tag
    if (v.isResponder) {
      drawTag(ctx, `${v.kind === 'police' ? 'POLICE' : 'AMBULANCE'}${v.arrived ? ' · ON SCENE' : ''}`, cx, cy - v.length / 2 - 0.8,
        v.kind === 'police' ? 'rgba(30,58,138,.92)' : 'rgba(185,28,28,.92)');
    }
  }

  // Pill-shaped label whose bottom edge sits at (cx, bottomY), zoom-independent size
  function drawTag(ctx, text, cx, bottomY, background) {
    const fs = 11 * labelUnit;
    ctx.font = `700 ${fs}px Consolas, monospace`;
    const w = ctx.measureText(text).width + fs * 0.8;
    const h = fs * 1.45;
    ctx.fillStyle = background;
    rr(ctx, cx - w / 2, bottomY - h, w, h, h * 0.3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, bottomY - h / 2);
  }

  function shade(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) * 0.55;
    const g = ((n >> 8) & 255) * 0.55;
    const b = (n & 255) * 0.55;
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  function drawParticles(ctx, sim) {
    for (const p of sim.particles) {
      ctx.globalAlpha = p.kind === 'debris' ? 1 : Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      if (p.kind === 'smoke') {
        ctx.globalAlpha *= 0.28;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- public renderer ------------------------------------------------------------
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.camera = { x: 0, y: 0, scale: 3 };
      this.options = { sensors: true, labels: true };
      this.cctvCanvas = document.createElement('canvas');
      this.cctvCanvas.width = 360;
      this.cctvCanvas.height = 240;
      this.resize();
      this.fit();
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = this.canvas;
      this.width = w;
      this.height = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.dpr = dpr;
    }

    fit() {
      this.camera = { x: 0, y: 0, scale: Math.min(this.width / 300, this.height / 215) };
    }

    zoomAt(factor, sx, sy) {
      const cam = this.camera;
      const wx = cam.x + (sx - this.width / 2) / cam.scale;
      const wy = cam.y + (sy - this.height / 2) / cam.scale;
      cam.scale = Math.max(1.2, Math.min(40, cam.scale * factor));
      cam.x = wx - (sx - this.width / 2) / cam.scale;
      cam.y = wy - (sy - this.height / 2) / cam.scale;
    }

    pan(dx, dy) {
      this.camera.x -= dx / this.camera.scale;
      this.camera.y -= dy / this.camera.scale;
    }

    drawWorld(ctx, sim, cam, w, h, dpr, { cctv = false } = {}) {
      ctx.setTransform(cam.scale * dpr, 0, 0, cam.scale * dpr, (w / 2 - cam.x * cam.scale) * dpr, (h / 2 - cam.y * cam.scale) * dpr);
      labelUnit = 1 / cam.scale;   // 1 screen px in metres
      drawGround(ctx);
      drawRoads(ctx);
      drawMarkings(ctx);
      drawTrees(ctx, medianTrees);
      if (this.options.sensors && !cctv) drawSensors(ctx, sim);
      if (!cctv) drawConflictZone(ctx, sim);
      const t = sim.time;
      for (const lane of W.lanes) for (const v of lane.vehicles) drawVehicle(ctx, v, t);
      for (const r of sim.responders || []) drawVehicle(ctx, r, t);
      drawParticles(ctx, sim);
      drawTrees(ctx, scenery.trees);
      drawSignalHeads(ctx, sim);
      if (this.options.labels && !cctv) drawLabels(ctx);
      if (this.options.sensors && !cctv) drawSensorSignals(ctx, sim, cam.scale);
    }

    render(sim) {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawWorld(ctx, sim, this.camera, this.width, this.height, this.dpr);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawCompass(ctx);
      if (sim.controller.mode === 'EMERGENCY') this.drawCctv(ctx, sim);
    }

    drawCompass(ctx) {
      // bottom-right, left of the zoom buttons
      const x = 28;
      const y = this.height - 64;
      ctx.save();
      ctx.translate(this.width - 220, -6);
      ctx.fillStyle = 'rgba(15,23,42,.75)';
      rr(ctx, 10, y - 22, 150, 64, 8);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x, y + 2); ctx.lineTo(x - 7, y + 6); ctx.closePath(); ctx.fill();
      ctx.font = '700 11px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('N', x, y + 20);
      // scale bar: 50 m
      const px = 50 * this.camera.scale;
      const bx = 50;
      ctx.fillRect(bx, y + 4, px > 100 ? 100 : px, 3);
      const label = px > 100 ? `${Math.round(100 / this.camera.scale)} m` : '50 m';
      ctx.textAlign = 'left';
      ctx.font = '11px Segoe UI, sans-serif';
      ctx.fillText(label, bx, y - 4);
      ctx.fillText('Left-hand traffic', bx, y + 24);
      ctx.restore();
    }

    // Picture-in-picture "CAM" view of the conflict zone during an emergency
    drawCctv(ctx, sim) {
      const cw = this.cctvCanvas.width;
      const ch = this.cctvCanvas.height;
      const cctx = this.cctvCanvas.getContext('2d');
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.clearRect(0, 0, cw, ch);
      const crash = sim.lastCrash;
      const cam = { x: crash ? crash.x * 0.6 : 0, y: crash ? crash.y * 0.6 : 0, scale: Math.min(cw / 40, ch / 27) };
      this.drawWorld(cctx, sim, cam, cw, ch, 1, { cctv: true });

      const scale = Math.min(1, (this.width - 28) / cw);
      const w = cw * scale;
      const h = ch * scale;
      const x = this.width - w - 14;
      const y = Math.min(150, this.height - h - 120);
      ctx.save();
      ctx.filter = 'grayscale(1) contrast(1.25) brightness(1.05)';
      ctx.drawImage(this.cctvCanvas, x, y, w, h);
      ctx.filter = 'none';
      // noise + scanlines
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      for (let i = 0; i < 160; i++) ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 1.5, 1.5);
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      for (let yy = 0; yy < h; yy += 3) ctx.fillRect(x, y + yy, w, 1);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(x, y, w, 20);
      ctx.fillStyle = '#fff';
      ctx.font = '700 11px Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('CAM-01 · CONFLICT ZONE', x + 6, y + 14);
      if (Math.floor(performance.now() / 500) % 2) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(x + w - 40, y + 10, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.fillText('REC', x + w - 32, y + 14);
      const stamp = `T+${sim.time.toFixed(1)}s`;
      ctx.fillText(stamp, x + 6, y + h - 7);
      ctx.restore();
    }
  }

  CJ.Renderer = Renderer;
})();
