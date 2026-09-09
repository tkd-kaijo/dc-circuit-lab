"use strict";

const fs = require("node:fs");
const vm = require("node:vm");

class MockElement {
  constructor(value = "") {
    this.value = value;
    this.textContent = "";
    this.innerHTML = "";
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  setAttribute() {}
  replaceChildren() {}
  append() {}
  closest() { return this; }
  addEventListener() {}
}

const values = {
  "circuit-select": "RC-charge", "source-range": "10", "resistance-range": "20",
  "inductance-range": "100", "capacitance-range": "100", "time-range": "0", "speed-select": "1"
};
const elements = new Map();
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new MockElement(values[id] || ""));
    return elements.get(id);
  },
  createElementNS() { return new MockElement(); }
};
const context = { console, document, performance, requestAnimationFrame() {} };
vm.createContext(context);
const app = fs.readFileSync(`${__dirname}/app.js`, "utf8");
const checks = `
  function near(a, b, tolerance = 1e-8) { return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)); }
  for (const key of Object.keys(CIRCUITS)) {
    const p = { key, circuit: CIRCUITS[key], E: 10, R: 20, L: .1, C: 100e-6 };
    const end = timeWindow(p);
    for (const fraction of [0, .01, .1, .35, .7, 1]) {
      const result = calculateAt(p, end * fraction);
      const sum = p.circuit.parts.reduce((total, part) => total + result.voltages[part], 0);
      const target = p.circuit.source ? p.E : 0;
      if (!near(sum, target, 2e-7)) throw new Error(key + " KVL failed at " + fraction + ": " + sum + " vs " + target);
      if (!Number.isFinite(result.i)) throw new Error(key + " current is not finite");
    }
  }
  const common = { E: 10, R: 20, L: .1, C: 100e-6 };
  let p = { ...common, key: "RC-charge", circuit: CIRCUITS["RC-charge"] };
  let r0 = calculateAt(p, 0), r5 = calculateAt(p, timeWindow(p));
  if (!near(r0.i, .5) || !near(r0.voltages.C, 0) || r5.voltages.C < 9.9) throw new Error("RC charge endpoints failed");
  p = { ...common, key: "RC-discharge", circuit: CIRCUITS["RC-discharge"] };
  r0 = calculateAt(p, 0);
  if (!near(r0.i, -.5) || !near(r0.voltages.C, 10)) throw new Error("RC discharge direction failed");
  p = { ...common, key: "RL-rise", circuit: CIRCUITS["RL-rise"] };
  r0 = calculateAt(p, 0); r5 = calculateAt(p, timeWindow(p));
  if (!near(r0.i, 0) || !near(r0.voltages.L, 10) || r5.i < .49) throw new Error("RL rise endpoints failed");
  p = { ...common, key: "RL-decay", circuit: CIRCUITS["RL-decay"] };
  r0 = calculateAt(p, 0);
  if (!near(r0.i, .5) || !near(r0.voltages.L, -10)) throw new Error("RL decay polarity failed");
  if (running) throw new Error("The app must be stopped before the first play action");
  const fixedRC = plotConfig("RC-charge");
  if (!near(fixedRC.end, .01)) throw new Error("The RC plot window must stay fixed at the baseline value");
  const halfPath = pathFor([0, 1, 2, 3, 4], 0, 0, 100, 10, 4, .5);
  if (!halfPath.includes("L50.0") || halfPath.includes("L75.0")) throw new Error("Progressive waveform drawing failed");
  switchClosing = true;
  switchElapsed = 0;
  switchProgress = 0;
  hasStarted = false;
  running = false;
  progress = 0;
  lastTime = 0;
  for (let frame = 1; frame <= 20; frame += 1) animate(frame * 50);
  if (switchClosing || !hasStarted || !running || !near(switchProgress, 1) || progress !== 0) {
    throw new Error("The one-second switch closing sequence must finish before t = 0 starts");
  }
  console.log("Verified six circuits, one-second switch sequence, fixed scales, progressive traces, stopped initial state, KVL, directions, and polarity.");
`;
vm.runInContext(`${app}\n${checks}`, context, { filename: "app.js" });
