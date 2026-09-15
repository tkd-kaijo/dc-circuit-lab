"use strict";

const NS = "http://www.w3.org/2000/svg";
const P = Object.freeze({ E: 9, rb: 10, rc: 35, L: 1 });
const I_INF = P.E / (P.rb + P.rc);
const TAU = P.L / (P.rb + P.rc);
const CHARGE_END = 5 * TAU;
const COLORS = { current: "#dd403a", voltage: "#147ab1" };
const PARTICLE_VISUAL_SPEED = 0.25;

const ui = {
  sequence: document.getElementById("sequence-button"),
  switchButton: document.getElementById("switch-button"),
  pause: document.getElementById("pause-button"),
  reset: document.getElementById("reset-button"),
  speed: document.getElementById("speed-select"),
  stageNumber: document.getElementById("stage-number"),
  stageKicker: document.getElementById("stage-kicker"),
  stageTitle: document.getElementById("stage-title"),
  stageNote: document.getElementById("stage-note"),
  staticLayer: document.getElementById("static-layer"),
  dynamicLayer: document.getElementById("dynamic-layer"),
  time: document.getElementById("time-value"),
  current: document.getElementById("current-value"),
  voltage: document.getElementById("voltage-value"),
  emf: document.getElementById("emf-value"),
  energy: document.getElementById("energy-value"),
  lampMeter: document.getElementById("lamp-meter"),
  lampState: document.getElementById("lamp-state"),
  brightness: document.getElementById("brightness-value"),
  equationMain: document.getElementById("equation-main"),
  equationNote: document.getElementById("equation-note"),
  dischargeScale: document.getElementById("discharge-scale")
};

const sim = {
  mode: "idle",
  running: false,
  tOn: 0,
  tOff: 0,
  current: 0,
  openCurrent: I_INF,
  onOffset: 0,
  offOffset: 0,
  lastFrame: performance.now()
};

function svg(tag, attrs = {}, text = "") {
  const node = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text) node.textContent = text;
  return node;
}

function neonVoltage(current) {
  if (current <= 0) return 80;
  return 80 + 23 * Math.pow(Math.min(current, 0.3) / 0.2, 0.6);
}

function chargeAt(t) {
  const e = Math.exp(-Math.max(0, t) / TAU);
  const current = I_INF * (1 - e);
  const vAB = P.E - P.rb * current;
  const induced = P.E * e;
  return { current, vAB, induced };
}

function stepDischarge(current, dt) {
  let value = current;
  let remaining = dt;
  const maxStep = 0.00001;
  while (remaining > 0 && value > 0) {
    const h = Math.min(maxStep, remaining);
    const k1 = -(neonVoltage(value) + P.rc * value) / P.L;
    const midpoint = Math.max(0, value + .5 * h * k1);
    const k2 = -(neonVoltage(midpoint) + P.rc * midpoint) / P.L;
    value = Math.max(0, value + h * k2);
    remaining -= h;
  }
  return value;
}

function makeDischargeCurve(startCurrent = I_INF) {
  const points = [{ t: 0, i: startCurrent, v: -neonVoltage(startCurrent) }];
  let t = 0;
  let current = startCurrent;
  const dt = 0.000002;
  while (current > 0.00002 && t < 0.02) {
    current = stepDischarge(current, dt);
    t += dt;
    points.push({ t, i: current, v: current > 0 ? -neonVoltage(current) : 0 });
  }
  points.push({ t, i: 0, v: 0 });
  return points;
}

const dischargeCurve = makeDischargeCurve();
const DISCHARGE_END = dischargeCurve.at(-1).t;

function fmtTime(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  if (Math.abs(seconds) < .01) return `${(seconds * 1000).toFixed(2)} ms`;
  return `${(seconds * 1000).toFixed(0)} ms`;
}

function signed(value, digits = 1) {
  const clean = Math.abs(value) < 0.00005 ? 0 : value;
  return `${clean < 0 ? "−" : "+"}${Math.abs(clean).toFixed(digits)}`;
}

function drawStaticCircuit() {
  const g = ui.staticLayer;
  g.replaceChildren();
  g.append(svg("path", { d: "M100 92 H220 M292 92 H350", class: "wire" }));
  g.append(svg("path", { d: "M350 92 H760 M760 92 V136 M760 344 V410 H100", class: "wire" }));
  g.append(svg("path", { d: "M100 92 V205 M100 315 V410", class: "wire" }));
  g.append(svg("line", { x1: 220, y1: 92, x2: 284, y2: 92, class: "switch-blade open", id: "switch-blade" }));
  g.append(svg("circle", { cx: 220, cy: 92, r: 8, class: "terminal" }));
  g.append(svg("circle", { cx: 292, cy: 92, r: 8, class: "terminal" }));
  g.append(svg("text", { x: 256, y: 57, class: "component-label" }, "スイッチ"));

  g.append(svg("rect", { x: 350, y: 68, width: 112, height: 48, rx: 3, class: "component" }));
  g.append(svg("text", { x: 406, y: 58, class: "component-label" }, "内部抵抗"));
  g.append(svg("text", { x: 406, y: 98, class: "component-value" }, "10 Ω"));

  g.append(svg("line", { x1: 66, y1: 246, x2: 134, y2: 246, class: "battery-plate" }));
  g.append(svg("line", { x1: 78, y1: 268, x2: 122, y2: 268, class: "battery-plate" }));
  g.append(svg("path", { d: "M100 205 V246 M100 268 V315", class: "wire" }));
  g.append(svg("text", { x: 45, y: 258, class: "component-label" }, "電池"));
  g.append(svg("text", { x: 45, y: 280, class: "component-value" }, "9.0 V"));
  g.append(svg("text", { x: 151, y: 252, class: "polarity" }, "+"));
  g.append(svg("text", { x: 151, y: 276, class: "polarity" }, "−"));

  g.append(svg("path", { d: "M580 92 V156 M580 344 V410", class: "wire" }));
  g.append(svg("path", { d: "M580 156 C535 166 535 196 580 206 C535 216 535 246 580 256 C535 266 535 296 580 306 C535 316 535 334 580 344", class: "coil" }));
  g.append(svg("text", { x: 500, y: 232, class: "component-label" }, "コイル"));
  g.append(svg("text", { x: 486, y: 270, class: "component-value" }, "L = 1.0 H"));
  g.append(svg("text", { x: 486, y: 296, class: "component-value" }, "r = 35 Ω"));

  g.append(svg("circle", { cx: 580, cy: 92, r: 7, class: "terminal" }));
  g.append(svg("circle", { cx: 580, cy: 410, r: 7, class: "terminal" }));
  g.append(svg("text", { x: 580, y: 68, class: "node-label" }, "A"));
  g.append(svg("text", { x: 580, y: 445, class: "node-label" }, "B"));

  const lamp = svg("g", { id: "lamp-group" });
  lamp.append(svg("circle", { cx: 760, cy: 240, r: 65, class: "lamp-glow", id: "lamp-aura" }));
  lamp.append(svg("circle", { cx: 760, cy: 240, r: 54, class: "lamp-symbol" }));
  lamp.append(svg("path", { d: "M735 222 H785 M735 258 H785", class: "lamp-electrode" }));
  lamp.append(svg("path", { d: "M760 136 V222 M760 258 V344", class: "wire" }));
  lamp.append(svg("text", { x: 760, y: 329, class: "component-label" }, "ネオンランプ"));
  lamp.append(svg("text", { x: 760, y: 357, class: "component-value" }, "約80 V以上で点灯"));
  g.append(lamp);
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

function pointOnPath(points, distance) {
  const total = pathLength(points);
  let d = ((distance % total) + total) % total;
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    const segment = Math.hypot(x2 - x1, y2 - y1);
    if (d <= segment) {
      const ratio = segment ? d / segment : 0;
      return [x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio];
    }
    d -= segment;
  }
  return points.at(-1);
}

function addParticles(group, points, offset) {
  const total = pathLength(points);
  const count = Math.max(4, Math.floor(total / 57));
  for (let n = 0; n < count; n += 1) {
    const [cx, cy] = pointOnPath(points, offset + n * total / count);
    group.append(svg("circle", { cx, cy, r: 6.5, class: "current-particle" }));
  }
}

function trianglePoints(cx, cy, orientation, value, scaleMax) {
  const ratio = Math.min(1, Math.abs(value) / Math.max(scaleMax, .001));
  const visualRatio = Math.pow(ratio, 0.42);
  const length = 112 * visualRatio;
  const halfBase = Math.max(4, length * Math.tan(Math.PI / 12));
  const sign = value >= 0 ? 1 : -1;
  if (orientation === "vertical") {
    const apexY = cy + sign * length / 2;
    const baseY = cy - sign * length / 2;
    return `${cx},${apexY} ${cx - halfBase},${baseY} ${cx + halfBase},${baseY}`;
  }
  const apexX = cx + sign * length / 2;
  const baseX = cx - sign * length / 2;
  return `${apexX},${cy} ${baseX},${cy - halfBase} ${baseX},${cy + halfBase}`;
}

function addTriangle(group, cx, cy, orientation, value, max, label, labelX, labelY) {
  if (Math.abs(value) < .05) return;
  group.append(svg("polygon", { points: trianglePoints(cx, cy, orientation, value, max), class: "voltage-triangle" }));
  group.append(svg("text", { x: labelX ?? cx, y: labelY ?? cy - 48, class: "voltage-label" }, `${label} ${signed(value)} V`));
}

function instantaneousValues() {
  if (sim.mode === "idle") return { current: 0, vAB: 0, induced: 0, lamp: false };
  if (sim.mode === "charging") return { ...chargeAt(sim.tOn), lamp: false };
  if (sim.mode === "steady") return { current: I_INF, vAB: P.E - P.rb * I_INF, induced: 0, lamp: false };
  if (sim.mode === "discharging" && sim.current > 0) {
    const vLamp = neonVoltage(sim.current);
    return { current: sim.current, vAB: -vLamp, induced: vLamp + P.rc * sim.current, lamp: true };
  }
  return { current: 0, vAB: 0, induced: 0, lamp: false };
}

function renderCircuit(values) {
  const g = ui.dynamicLayer;
  g.replaceChildren();
  const switchClosed = sim.mode === "charging" || sim.mode === "steady";
  document.getElementById("switch-blade").classList.toggle("open", !switchClosed);

  const lamp = document.getElementById("lamp-group");
  lamp.classList.toggle("lamp-lit", values.lamp);
  const brightness = values.lamp ? Math.max(0, Math.min(1, values.current / sim.openCurrent)) : 0;
  document.getElementById("lamp-aura").setAttribute("opacity", String(.08 + .72 * brightness));

  addTriangle(g, 100, 257, "vertical", P.E, 12, "E", 177, 205);
  if (switchClosed) addTriangle(g, 406, 92, "horizontal", P.rb * values.current, 2.2, "vᵣ", 406, 151);
  addTriangle(g, 580, 250, "vertical", values.vAB, 110, "V_AB", 654, 255);
  addTriangle(g, 760, 240, "vertical", values.vAB, 110, "V_AB", 850, 246);

  if (values.current > .0001) {
    if (switchClosed) {
      const loop = [[100,410],[100,92],[580,92],[580,410],[100,410]];
      addParticles(g, loop, sim.onOffset);
      g.append(svg("text", { x: 470, y: 132, class: "current-arrow-label" }, `i = ${values.current.toFixed(3)} A →`));
    } else if (values.lamp) {
      const loop = [[580,92],[580,410],[760,410],[760,92],[580,92]];
      addParticles(g, loop, sim.offOffset);
      g.append(svg("text", { x: 620, y: 445, class: "current-arrow-label" }, `i = ${values.current.toFixed(3)} A →`));
      g.append(svg("text", { x: 785, y: 118, class: "current-arrow-label" }, "ランプでは B → A"));
    }
  }
}

const stageCopy = {
  idle: ["0", "観察前", "スイッチは開いています", "「一連の現象を再生」または「スイッチを入れる」を押してください。"],
  charging: ["1", "SWITCH ON", "コイル電流がゆっくり増える", "自己誘導が電流の増加を妨げます。端子電圧は9.0 Vから7.0 Vへ下がり、80 Vに届かないのでランプは点灯しません。"],
  steady: ["2", "STEADY STATE", "十分時間が経ち、電流が一定", "コイルの誘導起電力は0 V。ここで「スイッチを切る」を押すと、遮断直後の過渡現象を観察できます。"],
  discharging: ["3", "SWITCH OFF", "コイルが電流を保ち、ランプが点灯", "コイル電流は同じ向きを保ち、ネオンランプではBからAへ流れます。V_ABの極性は投入時と逆になります。"],
  done: ["4", "TRANSIENT COMPLETE", "磁場のエネルギーを使い切りました", "電流が0になり、ネオンランプは消灯します。現象は約2 msの短い時間です。"]
};

function renderText(values) {
  const [number, kicker, title, note] = stageCopy[sim.mode];
  ui.stageNumber.textContent = number;
  ui.stageKicker.textContent = kicker;
  ui.stageTitle.textContent = title;
  ui.stageNote.textContent = note;
  ui.current.textContent = `${values.current.toFixed(3)} A`;
  ui.voltage.textContent = `${signed(values.vAB)} V`;
  ui.emf.textContent = `${Math.abs(values.induced).toFixed(1)} V`;
  ui.energy.textContent = `${(.5 * P.L * values.current ** 2).toFixed(3)} J`;
  ui.time.textContent = sim.mode === "charging" || sim.mode === "steady" ? fmtTime(sim.tOn) : sim.mode === "discharging" || sim.mode === "done" ? fmtTime(sim.tOff) : "—";

  const brightness = values.lamp ? Math.round(100 * values.current / Math.max(sim.openCurrent, .0001)) : 0;
  ui.lampMeter.classList.toggle("lit", values.lamp);
  ui.lampState.textContent = values.lamp ? "点灯" : "消灯";
  ui.brightness.textContent = `明るさ ${brightness}%`;

  if (sim.mode === "charging") {
    ui.equationMain.textContent = "i = 0.200(1 − e^(−t/22.2 ms))";
    ui.equationNote.textContent = "時定数 τ = L/(10 Ω + 35 Ω) = 22.2 ms";
  } else if (sim.mode === "steady") {
    ui.equationMain.textContent = "i = E/(10 Ω + 35 Ω) = 0.200 A";
    ui.equationNote.textContent = "di/dt = 0 なので、誘導起電力は0 Vです。";
  } else if (sim.mode === "discharging") {
    ui.equationMain.textContent = "L(di/dt) = −(35i + V_neon)";
    ui.equationNote.textContent = "磁場のエネルギーがランプの発光とコイルの発熱に変わります。";
  } else if (sim.mode === "done") {
    ui.equationMain.textContent = "i = 0,  U = ½Li² = 0";
    ui.equationNote.textContent = "過渡現象が終わり、回路に蓄えられた磁気エネルギーはありません。";
  } else {
    ui.equationMain.textContent = "i = 0";
    ui.equationNote.textContent = "スイッチが開いていて、電流は流れません。";
  }

  ui.switchButton.textContent = sim.mode === "charging" || sim.mode === "steady" ? "スイッチを切る" : "スイッチを入れる";
  ui.switchButton.disabled = sim.mode === "discharging";
  ui.pause.disabled = !sim.running && sim.mode !== "charging" && sim.mode !== "discharging";
  ui.pause.textContent = sim.running ? "一時停止" : (sim.mode === "charging" || sim.mode === "discharging" ? "再開" : "一時停止");
}

function graphScales(width = 560, height = 230) {
  return { left: 52, right: width - 20, top: 24, bottom: height - 38 };
}

function linePath(points, xFn, yFn) {
  return points.map((p, i) => `${i ? "L" : "M"}${xFn(p).toFixed(2)} ${yFn(p).toFixed(2)}`).join(" ");
}

function drawAxes(svgEl, xLabels, leftLabel, rightLabel) {
  const grid = svgEl.querySelector(".grid-layer");
  grid.replaceChildren();
  const s = graphScales();
  for (let n = 0; n <= 4; n += 1) {
    const y = s.top + (s.bottom - s.top) * n / 4;
    grid.append(svg("line", { x1: s.left, y1: y, x2: s.right, y2: y, class: "graph-grid" }));
  }
  xLabels.forEach((label, n) => {
    const x = s.left + (s.right - s.left) * n / (xLabels.length - 1);
    grid.append(svg("line", { x1: x, y1: s.top, x2: x, y2: s.bottom, class: "graph-grid" }));
    grid.append(svg("text", { x, y: s.bottom + 20, class: "graph-text", "text-anchor": "middle" }, label));
  });
  grid.append(svg("line", { x1: s.left, y1: s.top, x2: s.left, y2: s.bottom, class: "graph-axis" }));
  grid.append(svg("line", { x1: s.left, y1: s.bottom, x2: s.right, y2: s.bottom, class: "graph-axis" }));
  grid.append(svg("text", { x: s.left, y: 15, class: "graph-label", fill: COLORS.current }, leftLabel));
  grid.append(svg("text", { x: s.right, y: 15, class: "graph-label", fill: COLORS.voltage, "text-anchor": "end" }, rightLabel));
  grid.append(svg("text", { x: s.right, y: s.bottom + 33, class: "graph-text", "text-anchor": "end" }, "時刻"));
}

function drawGraphs() {
  const chargeSvg = document.getElementById("charge-graph");
  drawAxes(chargeSvg, ["0", "τ", "2τ", "3τ", "4τ", "5τ"], "i  0〜0.20 A", "V_AB  0〜10 V");
  const s = graphScales();
  const chargePoints = Array.from({ length: 121 }, (_, n) => ({ t: CHARGE_END * n / 120, ...chargeAt(CHARGE_END * n / 120) }));
  const xCharge = p => s.left + (s.right - s.left) * p.t / CHARGE_END;
  const yCurrent = p => s.bottom - (s.bottom - s.top) * p.current / I_INF;
  const yVoltageCharge = p => s.bottom - (s.bottom - s.top) * p.vAB / 10;
  const plot1 = chargeSvg.querySelector(".plot-layer");
  plot1.replaceChildren(
    svg("path", { d: linePath(chargePoints, xCharge, yCurrent), class: "current-line" }),
    svg("path", { d: linePath(chargePoints, xCharge, yVoltageCharge), class: "voltage-line" })
  );

  const dischargeSvg = document.getElementById("discharge-graph");
  const endMs = DISCHARGE_END * 1000;
  ui.dischargeScale.textContent = `時間軸：0〜${endMs.toFixed(1)} ms`;
  drawAxes(dischargeSvg, ["0", `${(endMs/4).toFixed(1)}`, `${(endMs/2).toFixed(1)}`, `${(3*endMs/4).toFixed(1)}`, `${endMs.toFixed(1)} ms`], "i  0〜0.20 A", "|V_AB|  0〜110 V");
  const xOff = p => s.left + (s.right - s.left) * p.t / DISCHARGE_END;
  const yOffCurrent = p => s.bottom - (s.bottom - s.top) * p.i / I_INF;
  const yOffVoltage = p => s.bottom - (s.bottom - s.top) * Math.abs(p.v) / 110;
  const yThreshold = s.bottom - (s.bottom - s.top) * 80 / 110;
  const plot2 = dischargeSvg.querySelector(".plot-layer");
  plot2.replaceChildren(
    svg("line", { x1: s.left, y1: yThreshold, x2: s.right, y2: yThreshold, class: "threshold-line" }),
    svg("text", { x: s.right - 4, y: yThreshold - 6, class: "graph-text", "text-anchor": "end" }, "点灯電圧 80 V"),
    svg("path", { d: linePath(dischargeCurve, xOff, yOffCurrent), class: "current-line" }),
    svg("path", { d: linePath(dischargeCurve, xOff, yOffVoltage), class: "voltage-line" })
  );
}

function drawCursor(svgEl, progress, currentRatio, voltageRatio) {
  const layer = svgEl.querySelector(".cursor-layer");
  layer.replaceChildren();
  if (progress < 0 || progress > 1) return;
  const s = graphScales();
  const x = s.left + (s.right - s.left) * progress;
  const yi = s.bottom - (s.bottom - s.top) * Math.max(0, Math.min(1, currentRatio));
  const yv = s.bottom - (s.bottom - s.top) * Math.max(0, Math.min(1, voltageRatio));
  layer.append(svg("line", { x1: x, y1: s.top, x2: x, y2: s.bottom, class: "cursor-line" }));
  layer.append(svg("circle", { cx: x, cy: yi, r: 6, class: "cursor-dot-current" }));
  layer.append(svg("circle", { cx: x, cy: yv, r: 6, class: "cursor-dot-voltage" }));
}

function render() {
  const values = instantaneousValues();
  renderCircuit(values);
  renderText(values);
  drawCursor(document.getElementById("charge-graph"), (sim.mode === "idle") ? -1 : Math.min(1, sim.tOn / CHARGE_END), values.current / I_INF, Math.max(0, values.vAB) / 10);
  drawCursor(document.getElementById("discharge-graph"), (sim.mode === "discharging" || sim.mode === "done") ? Math.min(1, sim.tOff / DISCHARGE_END) : -1, values.current / I_INF, Math.abs(values.vAB) / 110);
}

function beginCharge() {
  sim.mode = "charging";
  sim.running = true;
  sim.tOn = 0;
  sim.tOff = 0;
  sim.current = 0;
  sim.onOffset = 0;
  sim.offOffset = 0;
  render();
}

function openSwitch() {
  if (sim.mode !== "charging" && sim.mode !== "steady") return;
  const values = instantaneousValues();
  sim.openCurrent = values.current;
  if (sim.openCurrent < .0001) {
    sim.mode = "done";
    sim.running = false;
  } else {
    sim.mode = "discharging";
    sim.current = sim.openCurrent;
    sim.tOff = 0;
    sim.running = true;
  }
  render();
}

function reset() {
  Object.assign(sim, { mode: "idle", running: false, tOn: 0, tOff: 0, current: 0, openCurrent: I_INF, onOffset: 0, offOffset: 0 });
  render();
}

function update(dtReal) {
  const speed = Number(ui.speed.value);
  if (!sim.running) return;

  if (sim.mode === "charging") {
    sim.tOn = Math.min(CHARGE_END, sim.tOn + dtReal * speed * .04);
    sim.current = chargeAt(sim.tOn).current;
    sim.onOffset += dtReal * speed * PARTICLE_VISUAL_SPEED * 755 * sim.current / I_INF;
    if (sim.tOn >= CHARGE_END) {
      sim.mode = "steady";
      sim.current = I_INF;
      sim.running = true;
    }
  } else if (sim.mode === "steady") {
    sim.onOffset += dtReal * speed * PARTICLE_VISUAL_SPEED * 755;
  } else if (sim.mode === "discharging") {
    const dtPhysical = dtReal * speed * .001;
    sim.current = stepDischarge(sim.current, dtPhysical);
    sim.tOff += dtPhysical;
    sim.offOffset += dtReal * speed * PARTICLE_VISUAL_SPEED * 755 * sim.current / Math.max(sim.openCurrent, .0001);
    if (sim.current <= .00002 || sim.tOff >= .02) {
      sim.current = 0;
      sim.mode = "done";
      sim.running = false;
    }
  }
}

function frame(now) {
  const dt = Math.min(.05, (now - sim.lastFrame) / 1000);
  sim.lastFrame = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

ui.sequence.addEventListener("click", beginCharge);
ui.switchButton.addEventListener("click", () => {
  if (sim.mode === "charging" || sim.mode === "steady") openSwitch();
  else beginCharge();
});
ui.pause.addEventListener("click", () => { sim.running = !sim.running; render(); });
ui.reset.addEventListener("click", reset);

drawStaticCircuit();
drawGraphs();
reset();
requestAnimationFrame(frame);

window.neonLabDebug = Object.freeze({
  constants: { ...P, I_INF, TAU, CHARGE_END, DISCHARGE_END },
  neonVoltage,
  chargeAt,
  makeDischargeCurve,
  snapshot: () => ({ ...sim, values: instantaneousValues() })
});
