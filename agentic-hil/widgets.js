// Small interactive widgets for the Agentic HIL article.
//
// Everything here is computed live in the browser from the same equations the
// paper describes — no canned numbers, no pre-rendered curves:
//   - Q-format explorer: signed fixed-point range/resolution arithmetic.
//   - Buck solver: forward-Euler integration of the piecewise-linear
//     state-space model, with the DCM (diode-blocking) mode switchable so you
//     can see what a naive time-invariant model gets wrong.
//   - Latency budget: steps-per-switching-period arithmetic against t_calc.
//
// Shared colour code across every figure on this page:
//   grey  = floating-point reference        blue = fixed-point / agent RTL
//   amber = physically wrong / error        green = passing constraint

(() => {
  'use strict';

  // User-facing strings. A page can override any of these by defining
  // window.HIL_STRINGS before loading this file — that is how the Chinese
  // pages under /zh/ reuse this exact implementation. {placeholders} get
  // filled in with live computed values.
  const DEFAULT_STRINGS = {
    unitNano: 'nV / nA',
    unitMicro: 'µV / µA',
    unitMilli: 'mV / mA',
    qfOverflow: 'Overflows — clips at ±{range} V, but the startup transient reaches {peak} V',
    qfWasteful: 'Safe, but {factor}× more headroom than needed — those bits would buy resolution instead',
    qfFits: 'Fits the signal range with sensible headroom',
    buckAxis: 'time → (3 switching periods, steady state)',
    buckNegative:
      'Inductor current goes to {min} A — physically impossible. The diode would block reverse current; a time-invariant state-space model does not know that.',
    buckDcm:
      'Discontinuous conduction: the current hits zero and is held there until the switch closes again. This is the mode the agent has to detect and model.',
    buckCcm:
      'Continuous conduction: current never reaches zero, so a single state-space model per switch position is enough. Raise R or lower L to push it into DCM.',
    budgetMiss: 'Misses real time — the step is shorter than the {tcalc} ns the datapath needs.',
    budgetOk: 'Closes with {slack} ns to spare — {pct}% of the step budget used.',
  };

  const S = Object.assign({}, DEFAULT_STRINGS, window.HIL_STRINGS || {});

  function t(key, vals) {
    return String(S[key] || '').replace(/\{(\w+)\}/g, (m, k) =>
      vals && vals[k] !== undefined ? vals[k] : m
    );
  }

  const COLOR = {
    ref: '#a3a3a3',
    rtl: '#3b82f6',
    bad: '#f59e0b',
    ok: '#22c55e',
    grid: '#e5e5e5',
    axis: '#737373',
  };

  // Set up a canvas for crisp rendering on high-DPI screens; returns ctx and
  // CSS-pixel dimensions.
  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.clientWidth || 600;
    const h = Number(canvas.dataset.height || 220);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  // -------------------------------------------------------------------------
  // Widget A — Q-format explorer
  //
  // Signed fixed point, 32 bits total. `intBits` includes the sign bit, so the
  // representable range is ±2^(intBits-1) and the resolution is 2^-fracBits.
  // The signal ranges below are the peak values the buck converter actually
  // reaches during startup (see the waveform figure further down the page).
  // -------------------------------------------------------------------------
  const PEAK_VC = 22.5; // V, output-voltage overshoot at startup
  const PEAK_IL = 13.7; // A, inductor-current peak at startup

  function initQFormat() {
    const root = document.getElementById('qformat-widget');
    if (!root) return;
    const slider = root.querySelector('#qformat-slider');
    const out = {
      label: root.querySelector('#qformat-label'),
      range: root.querySelector('#qformat-range'),
      res: root.querySelector('#qformat-res'),
      verdict: root.querySelector('#qformat-verdict'),
      bar: root.querySelector('#qformat-bar'),
    };
    if (!slider) return;

    function render() {
      const intBits = Number(slider.value);
      const fracBits = 32 - intBits;
      const range = Math.pow(2, intBits - 1);
      const res = Math.pow(2, -fracBits);

      out.label.textContent = 'Q' + intBits + '.' + fracBits;
      out.range.textContent = '±' + range.toLocaleString();

      // Show resolution in whatever unit reads naturally.
      let resText;
      if (res < 1e-6) resText = (res * 1e9).toFixed(1) + ' ' + t('unitNano');
      else if (res < 1e-3) resText = (res * 1e6).toFixed(1) + ' ' + t('unitMicro');
      else resText = (res * 1e3).toFixed(2) + ' ' + t('unitMilli');
      out.res.textContent = resText;

      // Verdict: does it hold the real signal peaks, and how much is wasted?
      const needed = Math.max(PEAK_VC, PEAK_IL);
      let verdict, color;
      if (range < needed) {
        verdict = t('qfOverflow', { range: range, peak: PEAK_VC });
        color = COLOR.bad;
      } else if (range > needed * 8) {
        verdict = t('qfWasteful', { factor: Math.round(range / needed) });
        color = COLOR.axis;
      } else {
        verdict = t('qfFits');
        color = COLOR.ok;
      }
      out.verdict.textContent = verdict;
      out.verdict.style.color = color;

      // Headroom bar: signal peak vs. representable range (log-ish scale).
      const frac = Math.min(1, needed / range);
      out.bar.style.width = (frac * 100).toFixed(1) + '%';
      out.bar.style.backgroundColor = range < needed ? COLOR.bad : COLOR.rtl;
    }

    slider.addEventListener('input', render);
    render();
  }

  // -------------------------------------------------------------------------
  // Widget B — live buck solver, with the DCM mode switchable
  //
  // Piecewise-linear state space, forward Euler at dt = 50 ns:
  //   switch ON  : diL/dt = (Vin - vC)/L      dvC/dt = (iL - vC/R)/C
  //   switch OFF : diL/dt = (-vC)/L           dvC/dt = (iL - vC/R)/C
  //   DCM        : iL pinned at 0             dvC/dt = (-vC/R)/C
  // With DCM handling off, the OFF-state equations keep integrating past zero
  // and the solver invents a negative inductor current the diode would block.
  // -------------------------------------------------------------------------
  function simulateBuck(p) {
    const dt = 50e-9;
    const period = 1 / p.fsw;
    const totalTime = 3e-3; // long enough to settle into steady state
    const steps = Math.round(totalTime / dt);
    const onSteps = Math.round((period * p.D) / dt);
    const periodSteps = Math.round(period / dt);

    let iL = 0;
    let vC = 0;

    // Keep only the last few switching periods for plotting.
    const keepPeriods = 3;
    const keepSteps = periodSteps * keepPeriods;
    const startKeep = steps - keepSteps;
    const decimate = Math.max(1, Math.floor(keepSteps / 900));
    const trace = [];

    let minIL = Infinity;
    let maxIL = -Infinity;

    for (let k = 0; k < steps; k++) {
      const phase = k % periodSteps;
      const on = phase < onSteps;

      let diL;
      const dvC = (iL - vC / p.R) / p.C;

      if (on) {
        diL = (p.Vin - vC) / p.L;
      } else {
        diL = -vC / p.L;
      }

      let nextIL = iL + dt * diL;
      const nextVC = vC + dt * dvC;

      // Diode blocks reverse current: clamp when the switch is open.
      if (p.dcmAware && !on && nextIL <= 0) {
        nextIL = 0;
      }

      iL = nextIL;
      vC = nextVC;

      if (k >= startKeep && (k - startKeep) % decimate === 0) {
        trace.push([(k - startKeep) * dt, iL]);
        if (iL < minIL) minIL = iL;
        if (iL > maxIL) maxIL = iL;
      }
    }

    return { trace, minIL, maxIL, tSpan: keepSteps * dt };
  }

  function drawBuck(canvas, result, dcmAware) {
    const { ctx, w, h } = setupCanvas(canvas);
    const padL = 46;
    const padR = 10;
    const padT = 12;
    const padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    ctx.clearRect(0, 0, w, h);

    // y range, always including zero so the DCM clamp is visible.
    const yMax = Math.max(result.maxIL * 1.1, 0.5);
    const yMin = Math.min(result.minIL * 1.1, -0.2);
    const xOf = (t) => padL + (t / result.tSpan) * plotW;
    const yOf = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    // Grid + axes
    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = COLOR.axis;
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = yMin + ((yMax - yMin) * i) / ticks;
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillText(v.toFixed(1) + ' A', 4, y + 3);
    }

    // Zero line, emphasised — this is where DCM matters.
    ctx.strokeStyle = COLOR.axis;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(padL, yOf(0));
    ctx.lineTo(w - padR, yOf(0));
    ctx.stroke();

    // Shade the physically impossible region (iL < 0) when it is reached.
    if (result.minIL < -1e-6) {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.10)';
      ctx.fillRect(padL, yOf(0), plotW, Math.max(0, yOf(yMin) - yOf(0)));
    }

    // Inductor-current trace
    ctx.strokeStyle = dcmAware ? COLOR.rtl : COLOR.bad;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    result.trace.forEach((pt, i) => {
      const x = xOf(pt[0]);
      const y = yOf(pt[1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // x label
    ctx.fillStyle = COLOR.axis;
    ctx.fillText(t('buckAxis'), padL, h - 6);
  }

  function initBuckSolver() {
    const root = document.getElementById('buck-widget');
    if (!root) return;
    const canvas = root.querySelector('#buck-canvas');
    const dcmToggle = root.querySelector('#buck-dcm');
    const readout = root.querySelector('#buck-readout');
    if (!canvas) return;

    const sliders = {
      L: root.querySelector('#buck-L'),
      C: root.querySelector('#buck-C'),
      R: root.querySelector('#buck-R'),
      D: root.querySelector('#buck-D'),
    };
    const labels = {
      L: root.querySelector('#buck-L-val'),
      C: root.querySelector('#buck-C-val'),
      R: root.querySelector('#buck-R-val'),
      D: root.querySelector('#buck-D-val'),
    };

    function render() {
      const p = {
        Vin: 24,
        fsw: 20e3,
        L: Number(sliders.L.value) * 1e-6,
        C: Number(sliders.C.value) * 1e-6,
        R: Number(sliders.R.value),
        D: Number(sliders.D.value) / 100,
        dcmAware: dcmToggle.checked,
      };

      labels.L.textContent = sliders.L.value + ' µH';
      labels.C.textContent = sliders.C.value + ' µF';
      labels.R.textContent = sliders.R.value + ' Ω';
      labels.D.textContent = (p.D).toFixed(2);

      const result = simulateBuck(p);
      drawBuck(canvas, result, p.dcmAware);

      const touchesZero = result.minIL <= 1e-6;
      let msg, color;
      if (!p.dcmAware && result.minIL < -1e-3) {
        msg = t('buckNegative', { min: result.minIL.toFixed(2) });
        color = COLOR.bad;
      } else if (touchesZero) {
        msg = t('buckDcm');
        color = COLOR.ok;
      } else {
        msg = t('buckCcm');
        color = COLOR.axis;
      }
      readout.textContent = msg;
      readout.style.color = color;
    }

    Object.values(sliders).forEach((s) => s.addEventListener('input', render));
    dcmToggle.addEventListener('change', render);
    window.addEventListener('resize', render);
    render();
  }

  // -------------------------------------------------------------------------
  // Widget C — real-time budget
  //
  // For a chosen switching frequency and steps-per-period, the solver has
  // dt = 1/(fsw * steps) to finish one state update in. t_calc is the measured
  // datapath latency of the generated RTL (< 10 ns).
  // -------------------------------------------------------------------------
  const T_CALC_NS = 10;

  function initBudget() {
    const root = document.getElementById('budget-widget');
    if (!root) return;
    const fswSlider = root.querySelector('#budget-fsw');
    const stepsSlider = root.querySelector('#budget-steps');
    if (!fswSlider) return;

    const out = {
      fsw: root.querySelector('#budget-fsw-val'),
      steps: root.querySelector('#budget-steps-val'),
      dt: root.querySelector('#budget-dt'),
      bar: root.querySelector('#budget-bar'),
      fill: root.querySelector('#budget-fill'),
      verdict: root.querySelector('#budget-verdict'),
    };

    function render() {
      const fsw = Number(fswSlider.value) * 1e3;
      const stepsPerPeriod = Number(stepsSlider.value);
      const dtNs = (1 / (fsw * stepsPerPeriod)) * 1e9;

      out.fsw.textContent = fswSlider.value + ' kHz';
      out.steps.textContent = stepsSlider.value + ' steps / period';
      out.dt.textContent = dtNs < 1 ? dtNs.toFixed(2) + ' ns' : dtNs.toFixed(1) + ' ns';

      const usage = Math.min(1, T_CALC_NS / dtNs);
      out.fill.style.width = (usage * 100).toFixed(1) + '%';

      if (dtNs < T_CALC_NS) {
        out.fill.style.backgroundColor = COLOR.bad;
        out.verdict.textContent = t('budgetMiss', { tcalc: T_CALC_NS });
        out.verdict.style.color = COLOR.bad;
      } else {
        out.fill.style.backgroundColor = COLOR.ok;
        out.verdict.textContent = t('budgetOk', {
          slack: (dtNs - T_CALC_NS).toFixed(1),
          pct: (usage * 100).toFixed(0),
        });
        out.verdict.style.color = COLOR.ok;
      }
    }

    fswSlider.addEventListener('input', render);
    stepsSlider.addEventListener('input', render);
    render();
  }

  document.addEventListener('DOMContentLoaded', () => {
    initQFormat();
    initBuckSolver();
    initBudget();
  });
})();
