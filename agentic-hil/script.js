// Agentic HiL — embedded dashboard for the article.
//
// No backend. Every number, log line and waveform below is real data from the
// camera-ready paper (final/main.tex) and the synthesis reports it cites. This
// file only controls *when* that already-true content is revealed, and which
// of the two validated topologies is on screen.
//
// Trimmed from the standalone kiosk build (./kiosk/script.js): no full-screen
// cover, no unattended Demo Mode loop. "Run Simulation" is the only trigger.

(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Tunable timing (ms)
  // ---------------------------------------------------------------------
  const MS_PER_CHAR_LOG = 12;
  const MS_PER_CHAR_CODE = 14;
  const MS_PER_CHAR_STATUS = 18;
  const STAGE_PAUSE_MS = 500;
  const RESOURCE_BAR_STAGGER_MS = 250;

  const TOTAL_STAGES = 5;

  // ---------------------------------------------------------------------
  // The two validated topologies.
  //
  // Buck:  final/main.tex, "Buck Converter", Q7.17, tab:buck_quant.
  // Boost: final/main.tex, "Boost Converter (CCM)", Q9.15, tab:boost_quant.
  //
  // Percentages are against the Zynq-7020 (53,200 LUTs / 106,400 FFs /
  // 220 DSP48E1 / 140 BRAM) exactly as the paper reports them.
  // ---------------------------------------------------------------------
  const TOPOLOGIES = {
    buck: {
      topologyImage: '/agentic-hil/buck_circuit_plecs.png',
      topologyAlt: 'Buck converter topology (PLECS)',
      topologyTags: ['Diode-rectified Buck', 'CCM + DCM', 'f_sw 20 kHz'],
      controlTags: ['D = 0.5', 'f_sw 20 kHz', 'CCM/DCM auto-detect'],
      scopeImage: '/agentic-hil/buck_scope_ss.png',
      scopeAlt: 'Buck steady state measured on the Zynq-7020 board through the DAC',
      scopeTags: ['v_C steady state 12.926 V', 'RTL error 4.87 mV (<0.04%)'],
      params: [
        ['Input Voltage', '24 V'],
        ['Inductance L', '100 µH'],
        ['Capacitance C', '100 µF'],
        ['Load Resistance', '10 Ω'],
        ['Switching Freq.', '20 kHz (D = 0.5)'],
        ['Conduction Mode', 'CCM / DCM'],
        ['Target Platform', 'Zynq-7020'],
        ['Time Step (Δt)', '50 ns'],
        ['Fixed-Point Format', 'Q7.17 (24-bit, ±64 V)'],
      ],
      resources: [
        ['LUT', '156 (core 128)', '53,200', '0.29%'],
        ['FF', '264 (core 187)', '106,400', '0.25%'],
        ['BRAM', '0', '140', '0%'],
        ['DSP48E1', '3', '220', '1.4%'],
      ],
      resourceNote: 'Pipeline latency 22.2 ns · critical path 5.6 ns · Δt = 50 ns',
      metrics: [
        ['Δt (step size)', '50 ns'],
        ['Pipeline latency', '22.2 ns'],
        ['Critical path', '5.6 ns'],
        ['Fixed-point', 'Q7.17'],
      ],
      comparison: [
        ['v_C steady state', 'PLECS', '12.92615 V', '0.19 mV'],
        ['RTL vs. reference', 'Q7.17 RTL', '—', '4.87 mV'],
        ['Format sweep', '20–32 bit', 'Q7.17', '1 DSP'],
      ],
      mathNote:
        'DCM clamp (diode blocks when i_L ≤ 0): switches to a third topological mode, i_L held at zero.',
      chatUser:
        'Design a HiL simulator for a 24V→12V diode-rectified buck converter, fsw=20kHz, target Zynq-7020, Δt=50ns.',
      chatAgent: [
        'On it, parsing the topology and target platform now.',
        'Derived the CCM/DCM state-space model and swept the Q-format. Q7.17 holds the startup inrush without saturating.',
        'Generated solver_core.v and let the timing loop pick the pipeline depth it actually needed.',
        'Synthesized on Vivado: 156 LUTs, 3 DSP48E1, critical path 5.6 ns.',
        'Verified against the PLECS reference: 4.87 mV steady-state error, under 0.04%. Ready to integrate.',
      ],
      logLines: [
        { t: '10:31:02', text: 'Physics Agent: Parsed buck topology (Vin=24V, L=100uH, C=100uF, R=10ohm)' },
        { t: '10:31:03', text: 'Physics Agent: Derived CCM/DCM state-space model' },
        { t: '10:31:04', text: 'Physics Agent: Forward Euler discretization, dt=50ns' },
        { t: '10:31:05', text: 'Physics Agent: Q-format sweep 20/24/28/32-bit -> selected Q7.17 (4.87 mV, 1 DSP)' },
        { t: '10:31:12', text: 'Hardware Agent: Generated solver_core.v' },
        { t: '10:31:18', text: 'Hardware Agent: Vivado synthesis, 156 LUTs (0.29%), 3 DSP48E1 (1.4%), 0 BRAM' },
        { t: '10:31:20', text: 'Hardware Agent: pipeline latency 22.2ns, critical path 5.6ns, timing met' },
        { t: '10:31:26', text: 'Debug Agent: RTL vs. Golden Reference, steady-state window' },
        { t: '10:31:28', text: 'Debug Agent: v_C 12.92615V, RTL error 4.87mV (<0.04%)' },
        { t: '10:31:29', text: 'Debug Agent: SS+FE / SS+BE / ADC+MNA agree to 0.19mV, cross-validation PASS' },
        { t: '10:31:31', text: 'Agent: Simulation complete. Ready for integration.' },
      ],
      codeLines: [
        '// buck_solver.v - Q7.17 fixed-point (24-bit, range +/-64)',
        '// Step size h = 50 ns, three modes: ON / OFF / DCM',
        '',
        'wire dcm = !pwm && (iL[23] || !(|iL));   // diode blocks when iL <= 0',
        '',
        '// Mode-dependent state-space coefficients (DSP48E1)',
        'wire signed [23:0] a0 = dcm ? A00_DCM : (pwm ? A00_ON : A00_OFF);',
        'wire signed [23:0] a1 = dcm ? A01_DCM : (pwm ? A01_ON : A01_OFF);',
        'wire signed [23:0] b0 = dcm ? 0        : (pwm ? BV0_ON : 0);',
        '',
        '// Saturating update, Q7.17 -> bits [40:17]',
        "wire [23:0] iL_n = dcm ? 24'd0 : sat_q7_17(sum0);",
        '',
        'always @(posedge clk or negedge rst_n) begin',
        '  if (!rst_n) begin iL <= 0; vC <= 0; end',
        '  else if (en) begin iL <= iL_n; vC <= vC_n; end',
        'end',
      ],
    },

    boost: {
      // No PLECS screenshot matching the published parameters exists yet, so
      // this panel shows a parameter card rather than a mismatched picture.
      topologyImage: null,
      topologyAlt: '',
      topologyTags: ['Boost', 'CCM', 'f_sw 20 kHz'],
      controlTags: ['D = 0.5', 'f_sw 20 kHz', 'CCM'],
      scopeImage: '/agentic-hil/boost_scope_ss.png',
      scopeAlt: 'Boost steady state measured on the Zynq-7020 board through the DAC',
      scopeTags: ['v_C steady state 201.94 V', 'scope mean 201 V / 21.3 A'],
      params: [
        ['Input Voltage', '100 V'],
        ['Inductance L', '1 mH'],
        ['Capacitance C', '470 µF'],
        ['Load Resistance', '20 Ω'],
        ['Switching Freq.', '20 kHz (D = 0.5)'],
        ['Conduction Mode', 'CCM'],
        ['Target Platform', 'Zynq-7020'],
        ['Time Step (Δt)', '50 ns'],
        ['Fixed-Point Format', 'Q9.15 (24-bit, ±256 V)'],
      ],
      resources: [
        ['LUT', '61', '53,200', '0.11%'],
        ['FF', '57', '106,400', '0.05%'],
        ['BRAM', '0', '140', '0%'],
        ['DSP48E1', '0', '220', '0%'],
      ],
      resourceNote: 'Single-cycle datapath · critical path 5.56 ns · Δt = 50 ns',
      metrics: [
        ['Δt (step size)', '50 ns'],
        ['Datapath', 'single-cycle'],
        ['Critical path', '5.56 ns'],
        ['Fixed-point', 'Q9.15'],
      ],
      comparison: [
        ['v_C steady state', 'PLECS', '201.9448 V', '2.98 mV'],
        ['RTL vs. reference', 'Q9.15 RTL', '—', '7.45 mV'],
        ['Format sweep', '22–32 bit', 'Q9.15', '1 DSP'],
      ],
      mathNote:
        'Continuous conduction throughout, so no DCM clamp is needed. What stresses the solver here is the underdamped L-C resonance: zeta is about 0.036 and tau about 18.8 ms.',
      chatUser:
        'Now a 100V→200V boost converter in CCM: L=1mH, C=470µF, R=20Ω, fsw=20kHz, same Zynq-7020 target.',
      chatAgent: [
        'Reading the boost topology. This one stays in continuous conduction, so no DCM mode is needed.',
        'Derived the CCM state-space model. The underdamped L-C resonance is the hard part here, not mode switching.',
        'Q-format sweep selects Q9.15, whose ±256 V range covers the 200 V output.',
        'Synthesized: 61 LUTs, zero DSP slices, critical path 5.56 ns, single-cycle.',
        'Matches PLECS at 201.9448 V, cross-validated to 2.98 mV across all three formulations.',
      ],
      logLines: [
        { t: '10:42:01', text: 'Physics Agent: Parsed boost topology (Vin=100V, L=1mH, C=470uF, R=20ohm)' },
        { t: '10:42:02', text: 'Physics Agent: CCM throughout, single mode pair, no DCM clamp required' },
        { t: '10:42:03', text: 'Physics Agent: Underdamped L-C, zeta=0.036, tau=18.8ms, long-horizon drift is the risk' },
        { t: '10:42:05', text: 'Physics Agent: Q-format sweep 22/24/28/32-bit -> selected Q9.15 (7.45 mV, 1 DSP)' },
        { t: '10:42:11', text: 'Hardware Agent: Generated boost_solver.v, single-cycle datapath' },
        { t: '10:42:17', text: 'Hardware Agent: Vivado synthesis, 61 LUTs (0.11%), 0 DSP48E1, 0 BRAM' },
        { t: '10:42:19', text: 'Hardware Agent: critical path 5.56ns, timing met with no pipelining' },
        { t: '10:42:24', text: 'Debug Agent: RTL vs. Golden Reference, steady-state window' },
        { t: '10:42:26', text: 'Debug Agent: v_C 201.9448V, RTL error 7.45mV' },
        { t: '10:42:27', text: 'Debug Agent: SS+FE / SS+BE / ADC+MNA agree to 2.98mV, cross-validation PASS' },
        { t: '10:42:29', text: 'Agent: Simulation complete. Ready for integration.' },
      ],
      codeLines: [
        '// boost_solver.v - Q9.15 states (24-bit, range +/-256)',
        '// CCM only: two modes, no DCM clamp needed',
        '',
        '// ON  (switch closed): diL/dt = Vin/L,       dvC/dt = -vC/(R*C)',
        '// OFF (diode conducts): diL/dt = (Vin-vC)/L, dvC/dt = (iL - vC/R)/C',
        '',
        'wire signed [23:0] a0 = pwm ? A00_ON : A00_OFF;',
        'wire signed [23:0] a1 = pwm ? A01_ON : A01_OFF;',
        'wire signed [23:0] b0 = pwm ? BV0_ON : BV0_OFF;',
        '',
        '// Cross-coupling preserved: h/L = 5e-5 stays representable',
        'wire signed [47:0] sum0 = a0*iL + a1*vC + b0;',
        '',
        'always @(posedge clk or negedge rst_n) begin',
        '  if (!rst_n) begin iL <= 0; vC <= 0; end',
        '  else if (en) begin iL <= sat_q9_15(sum0); vC <= vC_n; end',
        'end',
      ],
    },
  };

  const STAGE_LOG_INDICES = [[0], [1, 2, 3], [4], [5, 6], [7, 8, 9, 10]];

  let active = TOPOLOGIES.buck;

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const stepBar = $('step-bar');
  const steps = stepBar ? Array.from(stepBar.querySelectorAll('.llm-step')) : [];
  const checklistItems = Array.from(document.querySelectorAll('.checklist-item'));
  const checklistProgressBar = $('checklist-progress-bar');
  const checklistProgressLabel = $('checklist-progress-label');
  const agentChatThread = $('agent-chat-thread');
  const logTerminal = $('log-terminal');
  const codeOutput = $('code-gen-output');
  const stagePanels = Array.from(document.querySelectorAll('.stage-panel'));
  const runBtn = $('run-simulation-btn');
  const runLabel = $('run-simulation-label');
  const topologySelect = $('topology-select');

  // Panels rewritten by applyTopology()
  const topologyFigure = $('topology-figure');
  const topologyTags = $('topology-tags');
  const controlTags = $('control-tags');
  const designList = $('design-summary-list');
  const resourceList = $('resource-list');
  const resourceNote = $('resource-note');
  const scopeFigure = $('scope-figure');
  const scopeTags = $('scope-tags');
  const metricsList = $('metrics-list');
  const comparisonBody = $('comparison-body');
  const mathNote = $('math-note');

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function kvRow(cells) {
    const li = document.createElement('li');
    li.className = 'grid grid-cols-2';
    cells.forEach((c, i) => {
      const s = document.createElement('span');
      if (i === 0) s.className = 'opacity-70';
      s.textContent = c;
      li.appendChild(s);
    });
    return li;
  }

  function tag(text) {
    const s = document.createElement('span');
    s.className = 'bg-neutral-100 p-1 rounded-md';
    s.textContent = text;
    return s;
  }

  // scrollContainer: kept pinned to the bottom as `el` grows, so the line
  // being typed inside a scrollable panel stays visible.
  async function typeInto(el, text, msPerChar, scrollContainer) {
    if (!el) return;
    el.textContent = '';
    el.classList.add('typing-caret');
    for (let i = 0; i < text.length; i++) {
      el.textContent += text[i];
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      const jitter = msPerChar + (Math.random() * msPerChar * 0.6 - msPerChar * 0.3);
      await wait(jitter);
    }
    el.classList.remove('typing-caret');
    if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }

  const formatLogLine = (l) => '[' + l.t + '] ' + l.text;

  async function typeLogLine(line) {
    if (!logTerminal) return;
    const li = document.createElement('li');
    logTerminal.appendChild(li);
    await typeInto(li, formatLogLine(line), MS_PER_CHAR_LOG, logTerminal);
  }

  function setStepState(i, state) {
    const li = steps[i];
    if (!li) return;
    li.classList.remove('done', 'current');
    const tick = li.querySelector('.step-tick');
    if (state === 'done') {
      li.classList.add('done');
      if (tick) tick.classList.remove('invisible');
    } else {
      if (state === 'current') li.classList.add('current');
      if (tick) tick.classList.add('invisible');
    }
  }

  function setChecklistState(i, done) {
    const item = checklistItems[i];
    const tick = item && item.querySelector('.checklist-tick');
    if (tick) tick.classList.toggle('pending', !done);
  }

  function setChecklistProgress(n) {
    const pct = Math.round((n / TOTAL_STAGES) * 100);
    if (checklistProgressBar) checklistProgressBar.style.width = pct + '%';
    if (checklistProgressLabel) checklistProgressLabel.textContent = n + '/' + TOTAL_STAGES;
  }

  function revealPanelsForStage(stage) {
    stagePanels
      .filter((p) => Number(p.dataset.stage) === stage)
      .forEach((p) => p.classList.remove('stage-hidden'));
  }

  function appendChatBubble(role) {
    if (!agentChatThread) return null;
    const rowEl = document.createElement('div');
    rowEl.className = role === 'user' ? 'flex justify-end' : 'flex justify-start';
    const bubble = document.createElement('div');
    bubble.className =
      role === 'user'
        ? 'bg-blue-500 text-white rounded-lg px-2 py-1 max-w-[85%]'
        : 'bg-neutral-100 rounded-lg px-2 py-1 max-w-[85%]';
    rowEl.appendChild(bubble);
    agentChatThread.appendChild(rowEl);
    return bubble;
  }

  const resourceBars = () => Array.from(document.querySelectorAll('.resource-bar-fill'));

  // ---------------------------------------------------------------------
  // Topology switching: rewrite the static panels, then repaint.
  // ---------------------------------------------------------------------
  function applyTopology(key) {
    active = TOPOLOGIES[key] || TOPOLOGIES.buck;

    if (topologyFigure) {
      topologyFigure.textContent = '';
      if (active.topologyImage) {
        const img = document.createElement('img');
        img.src = active.topologyImage;
        img.alt = active.topologyAlt;
        img.className = 'w-full h-full object-contain object-top';
        topologyFigure.appendChild(img);
      } else {
        const card = document.createElement('div');
        card.className =
          'w-full flex flex-col justify-center gap-1 px-2 py-1 text-[0.7rem] text-neutral-600';
        active.params.slice(0, 5).forEach(([k, v]) => {
          const line = document.createElement('div');
          line.className = 'flex justify-between gap-2';
          const a = document.createElement('span');
          a.className = 'opacity-70';
          a.textContent = k;
          const b = document.createElement('span');
          b.textContent = v;
          line.append(a, b);
          card.appendChild(line);
        });
        topologyFigure.appendChild(card);
      }
    }

    if (topologyTags) {
      topologyTags.textContent = '';
      active.topologyTags.forEach((t) => topologyTags.appendChild(tag(t)));
    }
    if (controlTags) {
      controlTags.textContent = '';
      active.controlTags.forEach((t) => controlTags.appendChild(tag(t)));
    }
    if (designList) {
      designList.textContent = '';
      active.params.forEach((p) => designList.appendChild(kvRow(p)));
    }

    if (resourceList) {
      resourceList.textContent = '';
      active.resources.forEach(([name, used, total, pct]) => {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between gap-2 w-full';
        const label = document.createElement('span');
        label.className = 'flex-[0.22]';
        label.textContent = name;
        const wrap = document.createElement('div');
        wrap.className = 'flex flex-1 items-center justify-between gap-2';
        const track = document.createElement('div');
        track.className = 'flex-1 h-1.5 rounded-full bg-black/10 overflow-hidden';
        const fill = document.createElement('div');
        fill.className =
          'h-full rounded-full bg-green-400 transition-all duration-300 resource-bar-fill';
        // At true scale these bars are invisible (0.29% of a Zynq-7020), so a
        // non-zero row gets a small visible floor. The printed number next to
        // it stays exact.
        const numeric = parseFloat(pct) || 0;
        fill.style.width = (numeric > 0 ? Math.max(numeric, 1.5) : 0) + '%';
        fill.dataset.targetWidth = fill.style.width;
        track.appendChild(fill);
        const val = document.createElement('span');
        val.className = 'whitespace-nowrap';
        val.textContent = pct + ' (' + used + ' / ' + total + ')';
        wrap.append(track, val);
        li.append(label, wrap);
        resourceList.appendChild(li);
      });
    }
    if (resourceNote) resourceNote.textContent = active.resourceNote;

    if (scopeFigure) {
      scopeFigure.textContent = '';
      const img = document.createElement('img');
      img.src = active.scopeImage;
      img.alt = active.scopeAlt;
      img.className = 'w-full h-full object-contain object-top';
      scopeFigure.appendChild(img);
    }
    if (scopeTags) {
      scopeTags.textContent = '';
      active.scopeTags.forEach((t) => scopeTags.appendChild(tag(t)));
    }
    if (metricsList) {
      metricsList.textContent = '';
      active.metrics.forEach((m) => metricsList.appendChild(kvRow(m)));
    }

    if (comparisonBody) {
      comparisonBody.textContent = '';
      active.comparison.forEach((cells, i) => {
        const tr = document.createElement('tr');
        tr.className =
          i < active.comparison.length - 1
            ? 'border-black/5 border-b text-[0.65rem] *:p-1'
            : 'text-[0.65rem] *:p-1';
        cells.forEach((c) => {
          const td = document.createElement('td');
          td.textContent = c;
          tr.appendChild(td);
        });
        comparisonBody.appendChild(tr);
      });
    }

    if (mathNote) mathNote.textContent = active.mathNote;

    fillFinalState();
  }

  // ---------------------------------------------------------------------
  // Reset / instant-final states
  // ---------------------------------------------------------------------
  function resetAll() {
    for (let i = 0; i < TOTAL_STAGES; i++) setStepState(i, i === 0 ? 'current' : 'pending');
    for (let i = 0; i < TOTAL_STAGES; i++) setChecklistState(i, false);
    setChecklistProgress(0);
    if (agentChatThread) agentChatThread.textContent = '';
    if (logTerminal) logTerminal.textContent = '';
    if (codeOutput) codeOutput.textContent = '';
    resourceBars().forEach((b) => { b.style.width = '0%'; });
    stagePanels.forEach((p) => p.classList.add('stage-hidden'));
  }

  function fillFinalState() {
    for (let i = 0; i < TOTAL_STAGES; i++) setStepState(i, 'done');
    for (let i = 0; i < TOTAL_STAGES; i++) setChecklistState(i, true);
    setChecklistProgress(TOTAL_STAGES);

    if (agentChatThread) {
      agentChatThread.textContent = '';
      appendChatBubble('user').textContent = active.chatUser;
      active.chatAgent.forEach((line) => {
        appendChatBubble('agent').textContent = line;
      });
      agentChatThread.scrollTop = agentChatThread.scrollHeight;
    }
    if (logTerminal) {
      logTerminal.textContent = '';
      active.logLines.forEach((line) => {
        const li = document.createElement('li');
        li.textContent = formatLogLine(line);
        logTerminal.appendChild(li);
      });
    }
    if (codeOutput) codeOutput.textContent = active.codeLines.join('\n');
    resourceBars().forEach((b) => { b.style.width = b.dataset.targetWidth; });
    stagePanels.forEach((p) => p.classList.remove('stage-hidden'));
  }

  // ---------------------------------------------------------------------
  // Stage runner
  // ---------------------------------------------------------------------
  async function runStage(stage) {
    const idx = stage - 1;
    setStepState(idx, 'current');
    await typeInto(appendChatBubble('agent'), active.chatAgent[idx], MS_PER_CHAR_STATUS, agentChatThread);
    revealPanelsForStage(stage);

    if (stage === 3 && codeOutput) {
      await typeInto(codeOutput, active.codeLines.join('\n'), MS_PER_CHAR_CODE, codeOutput.parentElement);
    }
    if (stage === 4) {
      for (const bar of resourceBars()) {
        bar.style.width = bar.dataset.targetWidth;
        await wait(RESOURCE_BAR_STAGGER_MS);
      }
    }

    for (const li of STAGE_LOG_INDICES[idx]) {
      await typeLogLine(active.logLines[li]);
    }

    setStepState(idx, 'done');
    setChecklistState(idx, true);
    setChecklistProgress(stage);
    await wait(STAGE_PAUSE_MS);
  }

  let isPlaying = false;

  async function runPipeline() {
    if (isPlaying) return;
    isPlaying = true;
    if (runBtn) runBtn.disabled = true;
    if (topologySelect) topologySelect.disabled = true;
    if (runLabel) runLabel.textContent = 'Running…';

    resetAll();
    await wait(300);
    await typeInto(appendChatBubble('user'), active.chatUser, MS_PER_CHAR_STATUS, agentChatThread);
    await wait(STAGE_PAUSE_MS);
    for (let stage = 1; stage <= TOTAL_STAGES; stage++) await runStage(stage);

    isPlaying = false;
    if (runBtn) runBtn.disabled = false;
    if (topologySelect) topologySelect.disabled = false;
    if (runLabel) runLabel.textContent = 'Run Simulation';
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      if (!isPlaying) runPipeline();
    });
  }

  if (topologySelect) {
    topologySelect.addEventListener('change', () => {
      if (!isPlaying) applyTopology(topologySelect.value);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyTopology(topologySelect ? topologySelect.value : 'buck');
  });

  // The kiosk build reuses this dashboard verbatim and only adds its own
  // cover screen and unattended loop on top, so the pieces it needs are
  // exposed here rather than maintained as a second copy of the data.
  window.HiLDashboard = {
    run: runPipeline,
    apply: applyTopology,
    reset: fillFinalState,
    isPlaying: () => isPlaying,
    topologies: () => Object.keys(TOPOLOGIES),
  };
})();
