"use strict";

const NS = "http://www.w3.org/2000/svg";
const COLORS = { E: "#17303b", R: "#ad5a2a", L: "#7c4cac", C: "#087f83", I: "#d94b3d" };
const PLOT_BASELINE = Object.freeze({ E: 10, R: 20, L: .1, C: 100e-6 });
const plotConfigCache = new Map();
const CIRCUITS = {
  "RC-charge": {
    title: "RC直列回路の充電", mode: "SWITCH ON", parts: ["R", "C"], source: true,
    note: "スイッチを入れた直後に最大だった電流が、充電とともに減少します。",
    formula: "i = (E/R)e<sup>−t/RC</sup>", sub: "E = vR + vC　（vRは減少、vCは増加）"
  },
  "RC-discharge": {
    title: "RC直列回路の放電", mode: "SOURCE REMOVED", parts: ["R", "C"], source: false,
    note: "初めにEまで充電したコンデンサーが、抵抗を通して放電します。",
    formula: "vC = Ee<sup>−t/RC</sup>", sub: "0 = vR + vC　（電流は充電時と逆向き）"
  },
  "RL-rise": {
    title: "RL直列回路の電流の立ち上がり", mode: "SWITCH ON", parts: ["R", "L"], source: true,
    note: "コイルの自己誘導により、電流は0からE/Rへ徐々に近づきます。",
    formula: "i = (E/R)(1 − e<sup>−tR/L</sup>)", sub: "E = vR + vL　（vLは減少、vRは増加）"
  },
  "RL-decay": {
    title: "RL直列回路の電流の減衰", mode: "SOURCE REMOVED", parts: ["R", "L"], source: false,
    note: "定常電流E/Rを流した後に電源を外すと、コイルは同じ向きの電流を保とうとします。",
    formula: "i = (E/R)e<sup>−tR/L</sup>", sub: "0 = vR + vL　（コイルの電圧は極性が反転）"
  },
  "RLC-step": {
    title: "RLC直列回路の過渡応答", mode: "SWITCH ON", parts: ["R", "L", "C"], source: true,
    note: "Rの大きさにより、振動しながら整う場合と、振動せず整う場合があります。",
    formula: "L(di/dt) + Ri + q/C = E", sub: "初期条件：q = 0、i = 0"
  },
  "RLC-free": {
    title: "RLC直列回路の自由応答", mode: "SOURCE REMOVED", parts: ["R", "L", "C"], source: false,
    note: "CをEまで充電して電源を外すと、蓄えたエネルギーはRで失われながら移り変わります。",
    formula: "L(di/dt) + Ri + q/C = 0", sub: "初期条件：vC = E、i = 0"
  }
};

const ui = {
  circuit: document.getElementById("circuit-select"), source: document.getElementById("source-range"),
  resistance: document.getElementById("resistance-range"), inductance: document.getElementById("inductance-range"),
  capacitance: document.getElementById("capacitance-range"), time: document.getElementById("time-range"),
  speed: document.getElementById("speed-select"), play: document.getElementById("play-button"), restart: document.getElementById("switch-button"),
  circuitLayer: document.getElementById("circuit-layer"), dynamicLayer: document.getElementById("dynamic-layer"),
  waveGrid: document.getElementById("wave-grid"), waveLines: document.getElementById("wave-lines"), waveCursor: document.getElementById("wave-cursor"),
  stateValues: document.getElementById("state-values"), instant: document.getElementById("instant-strip")
};

let progress = 0;
let running = false;
let hasStarted = false;
let switchClosing = false;
let switchElapsed = 0;
let switchProgress = 0;
let lastTime = performance.now();
let lastPaintTime = 0;

function svg(tag, attrs = {}, text = "") {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  if (text) el.textContent = text;
  return el;
}

function params() {
  return {
    key: ui.circuit.value,
    circuit: CIRCUITS[ui.circuit.value],
    E: Number(ui.source.value),
    R: Number(ui.resistance.value),
    L: Number(ui.inductance.value) / 1000,
    C: Number(ui.capacitance.value) / 1e6
  };
}

function responseClass(p) {
  const alpha = p.R / (2 * p.L);
  const omega0 = 1 / Math.sqrt(p.L * p.C);
  if (Math.abs(alpha - omega0) / omega0 < 1e-7) return "critical";
  return alpha < omega0 ? "under" : "over";
}

function timeWindow(p) {
  if (p.key.startsWith("RC")) return 5 * p.R * p.C;
  if (p.key.startsWith("RL")) return 5 * p.L / p.R;
  const alpha = p.R / (2 * p.L);
  const omega0 = 1 / Math.sqrt(p.L * p.C);
  if (alpha < omega0) {
    const wd = Math.sqrt(omega0 * omega0 - alpha * alpha);
    return Math.min(6 / Math.max(alpha, omega0 * .012), 8 * 2 * Math.PI / wd);
  }
  if (Math.abs(alpha - omega0) / omega0 < 1e-7) return 6 / alpha;
  const slowRoot = -alpha + Math.sqrt(alpha * alpha - omega0 * omega0);
  return 6 / Math.abs(slowRoot);
}

function rlcHomogeneous(p, t) {
  const alpha = p.R / (2 * p.L);
  const omega0 = 1 / Math.sqrt(p.L * p.C);
  const kind = responseClass(p);
  if (kind === "under") {
    const wd = Math.sqrt(omega0 * omega0 - alpha * alpha);
    const decay = Math.exp(-alpha * t);
    return {
      h: decay * (Math.cos(wd * t) + alpha / wd * Math.sin(wd * t)),
      iFree: -p.E / (p.L * wd) * decay * Math.sin(wd * t)
    };
  }
  if (kind === "critical") {
    const decay = Math.exp(-alpha * t);
    return { h: decay * (1 + alpha * t), iFree: -p.E / p.L * t * decay };
  }
  const root = Math.sqrt(alpha * alpha - omega0 * omega0);
  const s1 = -alpha + root;
  const s2 = -alpha - root;
  const denominator = s1 - s2;
  return {
    h: (-s2 * Math.exp(s1 * t) + s1 * Math.exp(s2 * t)) / denominator,
    iFree: p.E / p.L * (Math.exp(s2 * t) - Math.exp(s1 * t)) / denominator
  };
}

function calculateAt(p, t) {
  let i = 0;
  let vR = 0;
  let vL = null;
  let vC = null;
  let transferredCharge = 0;
  let timeConstant = null;
  let response = null;

  if (p.key === "RC-charge") {
    timeConstant = p.R * p.C;
    const decay = Math.exp(-t / timeConstant);
    i = p.E / p.R * decay;
    vR = p.E * decay;
    vC = p.E * (1 - decay);
    transferredCharge = p.C * vC;
  } else if (p.key === "RC-discharge") {
    timeConstant = p.R * p.C;
    const decay = Math.exp(-t / timeConstant);
    i = -p.E / p.R * decay;
    vR = p.R * i;
    vC = p.E * decay;
    transferredCharge = p.C * (vC - p.E);
  } else if (p.key === "RL-rise") {
    timeConstant = p.L / p.R;
    const decay = Math.exp(-t / timeConstant);
    i = p.E / p.R * (1 - decay);
    vR = p.R * i;
    vL = p.E * decay;
    transferredCharge = p.E / p.R * (t - timeConstant * (1 - decay));
  } else if (p.key === "RL-decay") {
    timeConstant = p.L / p.R;
    const decay = Math.exp(-t / timeConstant);
    i = p.E / p.R * decay;
    vR = p.R * i;
    vL = -vR;
    transferredCharge = p.E / p.R * timeConstant * (1 - decay);
  } else {
    const homogeneous = rlcHomogeneous(p, t);
    response = responseClass(p);
    if (p.key === "RLC-step") {
      vC = p.E * (1 - homogeneous.h);
      i = -homogeneous.iFree;
      transferredCharge = p.C * vC;
      vR = p.R * i;
      vL = p.E - vR - vC;
    } else {
      vC = p.E * homogeneous.h;
      i = homogeneous.iFree;
      transferredCharge = p.C * (vC - p.E);
      vR = p.R * i;
      vL = -vR - vC;
    }
  }

  const voltages = { R: vR };
  if (vL !== null) voltages.L = vL;
  if (vC !== null) voltages.C = vC;
  if (p.circuit.source) voltages.E = p.E;
  const energy = {};
  if (vC !== null) energy.C = .5 * p.C * vC * vC;
  if (vL !== null) energy.L = .5 * p.L * i * i;
  return { p, t, i, voltages, energy, transferredCharge, timeConstant, response };
}

function settingNumber(value) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function engineering(value, unit) {
  if (!Number.isFinite(value)) return `∞ ${unit}`;
  const a = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(2)} k${unit}`;
  if (a > 0 && a < .001) return `${sign}${(a * 1e6).toFixed(2)} μ${unit}`;
  if (a > 0 && a < 1) return `${sign}${(a * 1000).toFixed(2)} m${unit}`;
  return `${sign}${a.toFixed(a >= 10 ? 1 : 2)} ${unit}`;
}

function signed(value, unit) {
  const a = Math.abs(value);
  const prefix = a < 1e-10 ? "" : value > 0 ? "+" : "−";
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return `${prefix}${a.toFixed(digits)} ${unit}`;
}

function valueFor(part, p) {
  if (part === "R") return `${p.R} Ω`;
  if (part === "L") return `${settingNumber(p.L * 1000)} mH`;
  return `${settingNumber(p.C * 1e6)} μF`;
}

function drawBattery(group, x, y1, y2, p) {
  const cy = (y1 + y2) / 2;
  const plateGap = 19;
  group.append(svg("path", { d: `M${x} ${y1} V${cy - plateGap} M${x} ${cy + plateGap} V${y2}`, class: "wire" }));
  group.append(svg("line", { x1: x - 43, y1: cy - plateGap, x2: x + 43, y2: cy - plateGap, class: "battery" }));
  group.append(svg("line", { x1: x - 25, y1: cy + plateGap, x2: x + 25, y2: cy + plateGap, class: "battery" }));
  group.append(svg("text", { x: x - 62, y: cy - 28, class: "polarity-label" }, "+"));
  group.append(svg("text", { x: x - 62, y: cy + 37, class: "polarity-label" }, "−"));
  group.append(svg("text", { x: x - 68, y: cy + 8, class: "component-label" }, "E"));
  group.append(svg("text", { x: x - 68, y: cy + 76, class: "component-value" }, `${p.E} V`));
}

function drawSwitch(group, sourcePresent) {
  const closingAmount = sourcePresent ? switchProgress : 1;
  const angle = -(1 - closingAmount) * Math.PI / 4;
  const bladeEndX = 205 + 70 * Math.cos(angle);
  const bladeEndY = 110 + 70 * Math.sin(angle);
  group.append(svg("circle", { cx: 205, cy: 110, r: 7, class: "terminal" }));
  group.append(svg("circle", { cx: 275, cy: 110, r: 7, class: "terminal" }));
  group.append(svg("line", { x1: 205, y1: 110, x2: bladeEndX, y2: bladeEndY, class: "switch-blade" }));
  const label = sourcePresent ? (closingAmount >= 1 ? "t = 0" : "スイッチを閉じる") : "電源を外して閉じる";
  group.append(svg("text", { x: 240, y: 47, class: "switch-label" }, label));
}

function drawHorizontalPart(group, part, cx, y, p) {
  group.append(svg("path", { d: `M${cx - 66} ${y} H${cx - 48} M${cx + 48} ${y} H${cx + 66}`, class: "wire" }));
  if (part === "R") {
    group.append(svg("rect", { x: cx - 48, y: y - 18, width: 96, height: 36, class: "resistor" }));
  } else if (part === "L") {
    group.append(svg("path", { d: `M${cx - 48} ${y} C${cx - 41} ${y - 30},${cx - 20} ${y - 30},${cx - 14} ${y} C${cx - 7} ${y - 30},${cx + 14} ${y - 30},${cx + 20} ${y} C${cx + 27} ${y - 30},${cx + 43} ${y - 30},${cx + 48} ${y}`, class: "inductor" }));
  } else {
    group.append(svg("line", { x1: cx - 11, y1: y - 34, x2: cx - 11, y2: y + 34, class: "capacitor" }));
    group.append(svg("line", { x1: cx + 11, y1: y - 34, x2: cx + 11, y2: y + 34, class: "capacitor" }));
    group.append(svg("path", { d: `M${cx - 48} ${y} H${cx - 11} M${cx + 11} ${y} H${cx + 48}`, class: "wire" }));
  }
  group.append(svg("text", { x: cx, y: y + 60, class: "component-label" }, part));
  group.append(svg("text", { x: cx, y: y + 96, class: "component-value element-value" }, valueFor(part, p)));
}

function partPositions(parts) {
  return parts.length === 2 ? [455, 690] : [380, 560, 740];
}

function drawStatic(result) {
  const { p } = result;
  const parts = p.circuit.parts;
  const xs = partPositions(parts);
  const group = ui.circuitLayer;
  group.replaceChildren();
  if (p.circuit.source) drawBattery(group, 135, 110, 410, p);
  else {
    group.append(svg("path", { d: "M135 110 V410", class: "wire" }));
    group.append(svg("text", { x: 135, y: 246, class: "component-value" }, "電源なし"));
    group.append(svg("text", { x: 135, y: 270, class: "component-value" }, "初期状態あり"));
  }
  group.append(svg("path", { d: "M135 110 H205 M275 110 H314 M806 110 H810 V410 H135", class: "wire" }));
  drawSwitch(group, p.circuit.source);
  const segments = [`M314 110 H${xs[0] - 66}`];
  for (let i = 0; i < xs.length - 1; i += 1) segments.push(`M${xs[i] + 66} 110 H${xs[i + 1] - 66}`);
  segments.push(`M${xs[xs.length - 1] + 66} 110 H806`);
  group.append(svg("path", { d: segments.join(" "), class: "wire" }));
  parts.forEach((part, i) => drawHorizontalPart(group, part, xs[i], 110, p));
}

function trianglePoints(cx, cy, orientation, value, scaleMax) {
  const ratio = Math.min(1, Math.abs(value) / Math.max(scaleMax, 1e-9));
  const length = 18 + 104 * ratio;
  const halfBase = length * Math.tan(Math.PI / 12);
  const sign = value >= 0 ? 1 : -1;
  if (orientation === "horizontal") {
    const apexX = cx + sign * length / 2;
    const baseX = cx - sign * length / 2;
    return `${apexX},${cy} ${baseX},${cy - halfBase} ${baseX},${cy + halfBase}`;
  }
  const apexY = cy + sign * length / 2;
  const baseY = cy - sign * length / 2;
  return `${cx},${apexY} ${cx - halfBase},${baseY} ${cx + halfBase},${baseY}`;
}

function addTriangle(group, cx, cy, orientation, value, maxV, label) {
  if (Math.abs(value) < maxV * .006) return;
  group.append(svg("polygon", { points: trianglePoints(cx, cy, orientation, value, maxV), class: "voltage-triangle" }));
  group.append(svg("text", { x: cx, y: orientation === "horizontal" ? cy - 43 : cy + 4, class: "voltage-label" }, `${label} ${signed(value, "V")}`));
}

function pointOnPolyline(points, distance) {
  const lengths = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const length = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    lengths.push(length); total += length;
  }
  let remaining = ((distance % total) + total) % total;
  for (let i = 0; i < lengths.length; i += 1) {
    if (remaining <= lengths[i]) {
      const ratio = remaining / lengths[i];
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * ratio, points[i][1] + (points[i + 1][1] - points[i][1]) * ratio];
    }
    remaining -= lengths[i];
  }
  return points[points.length - 1];
}

function addCurrentParticles(group, points, offset, spacing = 42) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  const count = Math.max(1, Math.floor(total / spacing));
  const actualSpacing = total / count;
  for (let i = 0; i < count; i += 1) {
    const [cx, cy] = pointOnPolyline(points, i * actualSpacing + offset);
    group.append(svg("circle", { cx, cy, r: 6, class: "current-particle" }));
  }
}

function sampleResults(p, end, count = 241) {
  return Array.from({ length: count }, (_, index) => calculateAt(p, end * index / (count - 1)));
}

function plotConfig(key) {
  if (plotConfigCache.has(key)) return plotConfigCache.get(key);
  const p = { key, circuit: CIRCUITS[key], ...PLOT_BASELINE };
  const end = timeWindow(p);
  const samples = sampleResults(p, end, 361);
  const maxV = Math.max(p.E, ...samples.flatMap(result => Object.values(result.voltages).map(Math.abs)), 1e-9) * 1.08;
  const maxI = Math.max(...samples.map(result => Math.abs(result.i)), p.E / p.R * .02, 1e-12) * 1.08;
  const config = Object.freeze({ end, maxV, maxI });
  plotConfigCache.set(key, config);
  return config;
}

function drawDynamic(result, scales) {
  const { p } = result;
  const group = ui.dynamicLayer;
  group.replaceChildren();
  const xs = partPositions(p.circuit.parts);
  if (hasStarted && progress > 0) {
    p.circuit.parts.forEach((part, index) => addTriangle(group, xs[index], 110, "horizontal", result.voltages[part], scales.maxV, `v${part}`));
    if (p.circuit.source) addTriangle(group, 135, 260, "vertical", p.E, scales.maxV, "E");
  }
  const offset = 700 * result.transferredCharge / (scales.maxI * scales.end);
  const loop = [[135, 110], [810, 110], [810, 410], [135, 410], [135, 110]];
  addCurrentParticles(group, loop, offset);
  group.append(svg("text", { x: 720, y: 385, class: "current-label" }, `i = ${signed(result.i, "A")}`));
}

function niceAxisTick(maximum) {
  if (!Number.isFinite(maximum) || maximum <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(maximum));
  const normalized = maximum / base;
  let factor = 1;
  for (const candidate of [1, 2, 5, 10]) if (candidate <= normalized + 1e-12) factor = candidate;
  return factor * base;
}

function integerAxisValue(value, unit) {
  const absolute = Math.abs(value);
  const scales = [[1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "μ"], [1e-9, "n"]];
  for (const [scale, prefix] of scales) if (absolute >= scale - scale * 1e-12) return `${Math.round(absolute / scale)} ${prefix}${unit}`;
  return `${absolute.toExponential(0)} ${unit}`;
}

function addYAxisTicks(group, x, centerY, radius, maximum, unit) {
  const tick = niceAxisTick(maximum);
  for (const sign of [1, -1]) {
    const y = centerY - sign * tick / maximum * radius;
    if (y < centerY - radius - 1 || y > centerY + radius + 1) continue;
    group.append(svg("line", { x1: x - 6, y1: y, x2: x + 6, y2: y, class: "axis-tick-mark" }));
    group.append(svg("text", { x: x - 10, y: y + 6, class: "axis-tick-label" }, `${sign > 0 ? "+" : "−"}${integerAxisValue(tick, unit)}`));
  }
}

function pathFor(values, left, center, width, halfHeight, maximum, visibleProgress) {
  const scaledIndex = Math.max(0, Math.min(values.length - 1, visibleProgress * (values.length - 1)));
  const wholeIndex = Math.floor(scaledIndex);
  const points = values.slice(0, wholeIndex + 1).map((value, index) => ({ value, index }));
  const fraction = scaledIndex - wholeIndex;
  if (fraction > 1e-9 && wholeIndex < values.length - 1) {
    points.push({ value: values[wholeIndex] + (values[wholeIndex + 1] - values[wholeIndex]) * fraction, index: scaledIndex });
  }
  return points.map(({ value, index }) => {
    const x = left + width * index / (values.length - 1);
    const y = center - value / maximum * halfHeight;
    return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function renderWaves(result, scales) {
  const p = result.p;
  const samples = sampleResults(p, scales.end);
  const left = 105, right = 970, width = right - left;
  const vCenter = 145, iCenter = 375, halfHeight = 90;
  ui.waveGrid.replaceChildren(); ui.waveLines.replaceChildren(); ui.waveCursor.replaceChildren();
  const end = scales.end;
  const definitions = svg("defs");
  const voltageClip = svg("clipPath", { id: "voltage-plot-clip" });
  voltageClip.append(svg("rect", { x: left, y: vCenter - halfHeight, width, height: halfHeight * 2 }));
  const currentClip = svg("clipPath", { id: "current-plot-clip" });
  currentClip.append(svg("rect", { x: left, y: iCenter - halfHeight, width, height: halfHeight * 2 }));
  definitions.append(voltageClip, currentClip);
  ui.waveLines.append(definitions);
  for (let index = 0; index <= 4; index += 1) {
    const x = left + width * index / 4;
    ui.waveGrid.append(svg("line", { x1: x, y1: 30, x2: x, y2: 465, class: "grid-line" }));
    ui.waveGrid.append(svg("text", { x, y: 490, class: "wave-label", "text-anchor": "middle" }, formatTime(end * index / 4)));
  }
  [vCenter, iCenter].forEach(y => ui.waveGrid.append(svg("line", { x1: left, y1: y, x2: right, y2: y, class: "axis-line" })));
  ui.waveGrid.append(svg("text", { x: left + 8, y: 38, class: "wave-label axis-title" }, "電圧 V"));
  ui.waveGrid.append(svg("text", { x: left + 8, y: 268, class: "wave-label axis-title" }, "電流 A"));
  addYAxisTicks(ui.waveGrid, left, vCenter, halfHeight, scales.maxV, "V");
  addYAxisTicks(ui.waveGrid, left, iCenter, halfHeight, scales.maxI, "A");

  const voltageNames = p.circuit.source ? ["E", ...p.circuit.parts] : [...p.circuit.parts];
  voltageNames.forEach(name => {
    const values = samples.map(sample => name === "E" ? p.E : sample.voltages[name]);
    ui.waveLines.append(svg("path", { d: pathFor(values, left, vCenter, width, halfHeight, scales.maxV, progress), class: "wave-path", stroke: COLORS[name], "clip-path": "url(#voltage-plot-clip)" }));
  });
  ui.waveLines.append(svg("path", { d: pathFor(samples.map(sample => sample.i), left, iCenter, width, halfHeight, scales.maxI, progress), class: "wave-path", stroke: COLORS.I, "clip-path": "url(#current-plot-clip)" }));

  if (hasStarted) {
    const cursorX = left + width * progress;
    ui.waveCursor.append(svg("line", { x1: cursorX, y1: 30, x2: cursorX, y2: 465, class: "cursor-line" }));
    voltageNames.forEach(name => {
      const value = name === "E" ? p.E : result.voltages[name];
      ui.waveCursor.append(svg("circle", { cx: cursorX, cy: vCenter - value / scales.maxV * halfHeight, r: 5, fill: COLORS[name], class: "cursor-dot" }));
    });
    ui.waveCursor.append(svg("circle", { cx: cursorX, cy: iCenter - result.i / scales.maxI * halfHeight, r: 5, fill: COLORS.I, class: "cursor-dot" }));
  }
  const legends = [...voltageNames.map(name => [name === "E" ? "E" : `v${name}`, COLORS[name]]), ["i", COLORS.I]];
  document.getElementById("wave-legend").innerHTML = legends.map(([name, color]) => `<span style="color:${color}"><i></i>${name}</span>`).join("");
}

function formatTime(seconds) {
  if (seconds >= 1) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
  if (seconds >= .001) return `${(seconds * 1000).toFixed(seconds >= .1 ? 0 : 2)} ms`;
  return `${(seconds * 1e6).toFixed(1)} μs`;
}

function updateText(result) {
  const { p } = result;
  document.getElementById("circuit-title").textContent = p.circuit.title;
  document.getElementById("mode-kicker").textContent = p.circuit.mode;
  document.getElementById("circuit-note").textContent = p.circuit.note;
  document.getElementById("source-label").textContent = p.circuit.source ? "直流電源 E" : "初期状態を作る電圧 E";
  document.getElementById("source-out").textContent = `${p.E} V`;
  document.getElementById("resistance-out").textContent = `${p.R} Ω`;
  document.getElementById("inductance-out").textContent = `${settingNumber(p.L * 1000)} mH`;
  document.getElementById("capacitance-out").textContent = `${settingNumber(p.C * 1e6)} μF`;
  document.getElementById("time-out").textContent = formatTime(result.t);
  document.getElementById("inductance-control").classList.toggle("is-unused", !p.circuit.parts.includes("L"));
  document.getElementById("capacitance-control").classList.toggle("is-unused", !p.circuit.parts.includes("C"));
  document.getElementById("formula-main").innerHTML = p.circuit.formula;
  document.getElementById("formula-sub").textContent = p.circuit.sub;

  let characteristicLabel = "時定数 τ";
  let characteristicValue = result.timeConstant ? formatTime(result.timeConstant) : "";
  if (result.response) {
    characteristicLabel = "応答の種類";
    characteristicValue = result.response === "under" ? "減衰振動" : result.response === "critical" ? "臨界減衰" : "過減衰";
  }
  const totalEnergy = Object.values(result.energy).reduce((sum, value) => sum + value, 0);
  const values = [
    [characteristicLabel, characteristicValue],
    ["経過時間 t", formatTime(result.t)],
    ["電流 i", engineering(result.i, "A")],
    ["蓄えられたエネルギー", p.circuit.parts.includes("L") || p.circuit.parts.includes("C") ? engineering(totalEnergy, "J") : "—"]
  ];
  ui.stateValues.innerHTML = values.map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`).join("");
  const voltageBits = p.circuit.parts.map(part => `<span class="voltage-value">v${part} = <b>${signed(result.voltages[part], "V")}</b></span>`).join("");
  ui.instant.innerHTML = `<span>t = <b>${formatTime(result.t)}</b></span><span class="current-value">i = <b>${signed(result.i, "A")}</b></span>${voltageBits}`;
}

function render(rebuild = false) {
  const p = params();
  const scales = plotConfig(p.key);
  const end = scales.end;
  const calculated = calculateAt(p, progress * end);
  const result = hasStarted ? calculated : { ...calculated, i: 0, transferredCharge: 0 };
  if (rebuild) drawStatic(result);
  drawDynamic(result, scales);
  renderWaves(result, scales);
  updateText(result);
}

function restart() {
  progress = 0;
  ui.time.value = "0";
  running = false;
  hasStarted = false;
  switchClosing = false;
  switchElapsed = 0;
  switchProgress = params().circuit.source ? 0 : 1;
  ui.play.disabled = false;
  ui.play.textContent = "▶ 再生";
  ui.play.classList.add("primary");
  lastTime = performance.now();
  render(true);
}

[ui.circuit, ui.source, ui.resistance, ui.inductance, ui.capacitance].forEach(control => control.addEventListener("input", () => {
  progress = 0;
  ui.time.value = "0";
  running = false;
  hasStarted = false;
  switchClosing = false;
  switchElapsed = 0;
  switchProgress = params().circuit.source ? 0 : 1;
  ui.play.disabled = false;
  ui.play.textContent = "▶ 再生";
  ui.play.classList.add("primary");
  render(true);
}));
ui.time.addEventListener("input", () => {
  progress = Number(ui.time.value) / 1000;
  running = false;
  switchClosing = false;
  switchElapsed = 0;
  hasStarted = progress > 0;
  switchProgress = progress > 0 || !params().circuit.source ? 1 : 0;
  ui.play.disabled = false;
  ui.play.textContent = "▶ 再生";
  ui.play.classList.add("primary");
  render(true);
});
ui.play.addEventListener("click", () => {
  if (switchClosing) return;
  const p = params();
  if (progress >= 1) {
    progress = 0;
    ui.time.value = "0";
    hasStarted = false;
    switchProgress = p.circuit.source ? 0 : 1;
    render(true);
  }
  if (running) {
    running = false;
    ui.play.textContent = "▶ 再生";
    ui.play.classList.add("primary");
  } else if (!hasStarted && p.circuit.source && switchProgress < 1) {
    switchClosing = true;
    switchElapsed = 0;
    ui.play.disabled = true;
    ui.play.textContent = "スイッチを閉じています…";
    ui.play.classList.remove("primary");
  } else {
    hasStarted = true;
    running = true;
    ui.play.textContent = "❚❚ 一時停止";
    ui.play.classList.remove("primary");
  }
  lastTime = performance.now();
});
ui.restart.addEventListener("click", restart);

function animate(now) {
  const dt = Math.min(.05, (now - lastTime) / 1000);
  lastTime = now;
  if (switchClosing) {
    switchElapsed += dt;
    const rawProgress = Math.min(1, switchElapsed / 1);
    switchProgress = rawProgress * rawProgress * (3 - 2 * rawProgress);
    let justClosed = false;
    if (rawProgress >= 1) {
      switchProgress = 1;
      switchClosing = false;
      hasStarted = true;
      running = true;
      justClosed = true;
      ui.play.disabled = false;
      ui.play.textContent = "❚❚ 一時停止";
      lastTime = now;
    }
    if (justClosed || now - lastPaintTime >= 1000 / 30) {
      lastPaintTime = now;
      render(true);
    }
  } else if (running) {
    progress += dt * .1 * Number(ui.speed.value);
    if (progress >= 1) {
      progress = 1;
      running = false;
      ui.play.textContent = "▶ もう一度再生";
      ui.play.classList.add("primary");
    }
    if (now - lastPaintTime >= 1000 / 30) {
      lastPaintTime = now;
      ui.time.value = String(Math.round(progress * 1000));
      render(false);
    }
  }
  requestAnimationFrame(animate);
}

render(true);
requestAnimationFrame(animate);
