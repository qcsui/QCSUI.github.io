// Agentic HiL demo — choreographed replay of a real pipeline run.
// No backend: every number/log/waveform here is real paper/synthesis data
// (see paper/main.tex, paper/digest.tex, code/fpga/vivado/*.rpt). This file
// only controls *when* that already-true content is revealed, so the page
// can either sit fully populated (default) or perform the 5-stage agent
// pipeline on demand ("Run Simulation") or on a loop ("Demo Mode").

(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Tunable timing (ms)
  // ---------------------------------------------------------------------
  const MS_PER_CHAR_LOG = 12;
  const MS_PER_CHAR_CODE = 14;
  const MS_PER_CHAR_STATUS = 18;
  const STAGE_PAUSE_MS = 500; // pause after a stage completes, before the next starts
  const RESOURCE_BAR_STAGGER_MS = 250; // gap between each resource bar animating in
  const DEMO_HOLD_MS = 6000; // how long Demo Mode holds on the finished dashboard before replaying
  const COVER_HOLD_MS = 5000; // how long Demo Mode holds on the cover before starting a run

  const TOTAL_STAGES = 5;

  // ---------------------------------------------------------------------
  // Content (source of truth for the two typed panels)
  // ---------------------------------------------------------------------
  const LOG_LINES = [
    { t: '10:31:02', text: 'Physics Agent: Parsed buck topology (Vin=24V, L=100µH, C=100µF, R=10Ω)' },
    { t: '10:31:03', text: 'Physics Agent: Derived CCM/DCM state-space model' },
    { t: '10:31:04', text: 'Physics Agent: Forward Euler discretization, Δt=50ns' },
    { t: '10:31:05', text: 'Physics Agent: Assigned Q6.26 format → model_fixed.c (Golden Reference)' },
    { t: '10:31:12', text: 'Hardware Agent: Generated solver_core.v (unrolled combinational)' },
    { t: '10:31:18', text: 'Hardware Agent: Vivado synthesis — LUT 4.28%, DSP48E1 2.7%, BRAM 0%' },
    { t: '10:31:20', text: 'Hardware Agent: t_calc < 10ns, meets Δt=50ns — PASS' },
    { t: '10:31:26', text: 'Debug Agent: RTL vs. Golden Reference RMSE, window 8.0–10.0ms' },
    { t: '10:31:28', text: 'Debug Agent: v_C mean error 16.77mV (<0.15%), i_L mean error 1.52mA' },
    { t: '10:31:29', text: 'Debug Agent: Ripple error <5.46mA (<0.05%) — waveform match PASS' },
    { t: '10:31:31', text: 'Agent: Simulation complete. Ready for integration.' },
  ];

  // Which LOG_LINES (0-based) belong to each stage, in order.
  const STAGE_LOG_INDICES = [
    [0],
    [1, 2, 3],
    [4],
    [5, 6],
    [7, 8, 9, 10],
  ];

  const CODE_LINES = [
    '// solver_core.v — Q6.26 fixed-point, flattened combinational',
    '// Waveform-Driven Hardware Agent: unrolled (no deep pipeline)',
    '// so that t_calc << Δt = 50 ns',
    '',
    'wire dcm = !pwm && (i_L[Q_W-1] || ~|i_L); // i_L <= 0',
    '',
    '// Mode-dependent state-space coefficients (DSP48E1)',
    'wire signed [Q_W-1:0] a0 = dcm ? A00_DCM : (pwm ? A00_ON : A00_OFF);',
    'wire signed [Q_W-1:0] a1 = dcm ? A01_DCM : (pwm ? A01_ON : A01_OFF);',
    'wire signed [Q_W-1:0] b0 = dcm ? 0        : (pwm ? BV0_ON : 0);',
    '',
    '// Combinational next-state (saturating add)',
    'wire signed [2*Q_W-1:0] iL_sum = a0*i_L + a1*v_C + b0;',
    'wire [Q_W-1:0] iL_next = dcm ? 0 : sat_Q6_26(iL_sum);',
    '',
    'always @(posedge clk) begin',
    '  if (rst) begin i_L <= 0; v_C <= 0; end',
    '  else begin i_L <= iL_next; v_C <= vC_next; end',
    'end',
  ];

  const CHAT_USER_LINE =
    'Design a HiL simulator for a 24V→12V asynchronous buck converter, fsw=20kHz, target Zynq-7020, Δt=50ns.';

  const CHAT_AGENT_LINES = [
    'On it — parsing the topology and target platform now.',
    'Derived the CCM/DCM state-space model and picked a Q6.26 fixed-point format.',
    'Generated solver_core.v as fully unrolled combinational logic to keep latency low.',
    'Synthesized on Vivado — 4.28% LUTs, t_calc under 10ns, well inside your 50ns step.',
    'Verified against the PLECS reference: 16.77mV steady-state error, <0.15%. Ready to integrate.',
  ];

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const stepBar = document.getElementById('step-bar');
  const steps = stepBar ? Array.from(stepBar.querySelectorAll('.llm-step')) : [];
  const checklistItems = Array.from(document.querySelectorAll('.checklist-item'));
  const checklistProgressBar = document.getElementById('checklist-progress-bar');
  const checklistProgressLabel = document.getElementById('checklist-progress-label');
  const agentChatThread = document.getElementById('agent-chat-thread');
  const logTerminal = document.getElementById('log-terminal');
  const codeOutput = document.getElementById('code-gen-output');
  const stagePanels = Array.from(document.querySelectorAll('.stage-panel'));
  const resourceBars = Array.from(document.querySelectorAll('.resource-bar-fill'));
  const runBtn = document.getElementById('run-simulation-btn');
  const runLabel = document.getElementById('run-simulation-label');
  const demoBtn = document.getElementById('demo-mode-btn');
  const demoLabel = document.getElementById('demo-mode-label');
  const coverView = document.getElementById('cover-view');
  const startWalkthroughBtn = document.getElementById('start-walkthrough-btn');
  const brandTitle = document.getElementById('brand-title');

  // Snapshot each resource bar's real target width once (from the HTML),
  // so resetAll() can zero them out and a stage can animate back to it.
  resourceBars.forEach((bar) => {
    if (!bar.dataset.targetWidth) {
      bar.dataset.targetWidth = bar.style.width || '0%';
    }
  });

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // scrollContainer (optional): kept scrolled to its bottom as `el` grows,
  // so a typing bubble/line inside a scrollable panel stays in view.
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

  function formatLogLine(line) {
    return '[' + line.t + '] ' + line.text;
  }

  async function typeLogLine(line) {
    if (!logTerminal) return;
    const li = document.createElement('li');
    logTerminal.appendChild(li);
    await typeInto(li, formatLogLine(line), MS_PER_CHAR_LOG, logTerminal);
  }

  function setStepState(stepIndex, state) {
    // state: 'pending' | 'current' | 'done'
    const li = steps[stepIndex];
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

  function setChecklistState(index, done) {
    const item = checklistItems[index];
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

  // Appends a chat bubble ('user' right-aligned blue, 'agent' left-aligned
  // neutral) and returns the inner element so the caller can type into it.
  function appendChatBubble(role) {
    if (!agentChatThread) return null;
    const row = document.createElement('div');
    row.className = role === 'user' ? 'flex justify-end' : 'flex justify-start';
    const bubble = document.createElement('div');
    bubble.className =
      role === 'user'
        ? 'bg-blue-500 text-white rounded-lg px-2 py-1 max-w-[85%]'
        : 'bg-neutral-100 rounded-lg px-2 py-1 max-w-[85%]';
    row.appendChild(bubble);
    agentChatThread.appendChild(row);
    return bubble;
  }

  function showCover() {
    if (coverView) coverView.classList.remove('view-hidden');
  }

  function hideCover() {
    if (coverView) coverView.classList.add('view-hidden');
  }

  // ---------------------------------------------------------------------
  // Reset (skeleton) / instant-final states
  // ---------------------------------------------------------------------
  function resetAll() {
    for (let i = 0; i < TOTAL_STAGES; i++) setStepState(i, i === 0 ? 'current' : 'pending');
    for (let i = 0; i < TOTAL_STAGES; i++) setChecklistState(i, false);
    setChecklistProgress(0);
    if (agentChatThread) agentChatThread.innerHTML = '';
    if (logTerminal) logTerminal.innerHTML = '';
    if (codeOutput) codeOutput.textContent = '';
    resourceBars.forEach((bar) => { bar.style.width = '0%'; });
    stagePanels.forEach((p) => p.classList.add('stage-hidden'));
  }

  function fillFinalState() {
    for (let i = 0; i < TOTAL_STAGES; i++) setStepState(i, 'done');
    for (let i = 0; i < TOTAL_STAGES; i++) setChecklistState(i, true);
    setChecklistProgress(TOTAL_STAGES);
    if (agentChatThread) {
      agentChatThread.innerHTML = '';
      appendChatBubble('user').textContent = CHAT_USER_LINE;
      CHAT_AGENT_LINES.forEach((line) => {
        appendChatBubble('agent').textContent = line;
      });
      agentChatThread.scrollTop = agentChatThread.scrollHeight;
    }
    if (logTerminal) {
      logTerminal.innerHTML = '';
      LOG_LINES.forEach((line) => {
        const li = document.createElement('li');
        li.textContent = formatLogLine(line);
        logTerminal.appendChild(li);
      });
    }
    if (codeOutput) codeOutput.textContent = CODE_LINES.join('\n');
    resourceBars.forEach((bar) => { bar.style.width = bar.dataset.targetWidth; });
    stagePanels.forEach((p) => p.classList.remove('stage-hidden'));
  }

  // ---------------------------------------------------------------------
  // Stage runner
  // ---------------------------------------------------------------------
  async function runStage(stage) {
    const idx = stage - 1;
    setStepState(idx, 'current');
    await typeInto(appendChatBubble('agent'), CHAT_AGENT_LINES[idx], MS_PER_CHAR_STATUS, agentChatThread);
    revealPanelsForStage(stage);

    if (stage === 3 && codeOutput) {
      await typeInto(codeOutput, CODE_LINES.join('\n'), MS_PER_CHAR_CODE, codeOutput.parentElement);
    }
    if (stage === 4) {
      for (const bar of resourceBars) {
        bar.style.width = bar.dataset.targetWidth;
        await wait(RESOURCE_BAR_STAGGER_MS);
      }
    }

    for (const li of STAGE_LOG_INDICES[idx]) {
      await typeLogLine(LOG_LINES[li]);
    }

    setStepState(idx, 'done');
    setChecklistState(idx, true);
    setChecklistProgress(stage);
    await wait(STAGE_PAUSE_MS);
  }

  let isPlaying = false;
  let demoModeOn = false;

  function updateControlAvailability() {
    if (runBtn) runBtn.disabled = isPlaying;
    // Allow turning Demo Mode OFF even mid-run; only block turning it ON
    // while a manual (non-demo) run is already in flight.
    if (demoBtn) demoBtn.disabled = isPlaying && !demoModeOn;
  }

  async function runPipeline() {
    if (isPlaying) return;
    isPlaying = true;
    updateControlAvailability();
    if (runLabel) runLabel.textContent = 'Running…';

    resetAll();
    await wait(300);
    await typeInto(appendChatBubble('user'), CHAT_USER_LINE, MS_PER_CHAR_STATUS, agentChatThread);
    await wait(STAGE_PAUSE_MS);
    for (let stage = 1; stage <= TOTAL_STAGES; stage++) {
      await runStage(stage);
    }

    isPlaying = false;
    if (runLabel) runLabel.textContent = 'Run Simulation';
    updateControlAvailability();
  }

  // ---------------------------------------------------------------------
  // Demo Mode loop
  // ---------------------------------------------------------------------
  async function demoLoop() {
    while (demoModeOn) {
      showCover();
      await wait(COVER_HOLD_MS);
      if (!demoModeOn) break;
      hideCover();
      await runPipeline();
      if (!demoModeOn) break;
      await wait(DEMO_HOLD_MS);
    }
    if (!isPlaying) fillFinalState();
  }

  function setDemoMode(on) {
    demoModeOn = on;
    if (demoBtn) demoBtn.classList.toggle('active', on);
    if (demoLabel) demoLabel.textContent = on ? 'Demo Mode: On' : 'Demo Mode: Off';
    updateControlAvailability();
  }

  // ---------------------------------------------------------------------
  // Button wiring
  // ---------------------------------------------------------------------
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      if (isPlaying) return;
      if (demoModeOn) setDemoMode(false); // an explicit single run takes priority
      runPipeline();
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', () => {
      if (isPlaying && !demoModeOn) return; // button is disabled in this case anyway
      const turningOn = !demoModeOn;
      setDemoMode(turningOn);
      if (turningOn && !isPlaying) demoLoop();
      if (!turningOn && !isPlaying) fillFinalState();
    });
  }

  if (startWalkthroughBtn) {
    startWalkthroughBtn.addEventListener('click', () => {
      hideCover();
      runPipeline(); // one click: cover -> live run, no second click needed
    });
  }

  if (brandTitle) {
    brandTitle.addEventListener('click', () => {
      if (isPlaying) return; // don't interrupt an animation in progress
      showCover();
    });
  }

  // ---------------------------------------------------------------------
  // Init — page loads on the cover, dashboard fully populated underneath
  // and ready the instant it's revealed.
  // ---------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', fillFinalState);
})();
