// Booth build: the dashboard itself comes from /agentic-hil/script.js, which
// also owns the topology data. This file adds only what a booth screen needs,
// a cover and an unattended loop, so there is no second copy of the numbers.

(() => {
  'use strict';

  const COVER_HOLD_MS = 5000;
  const RESULT_HOLD_MS = 6000;

  const coverView = document.getElementById('cover-view');
  const startBtn = document.getElementById('start-walkthrough-btn');

  // The toolbar markup is shared with the article, which has no booth
  // controls, so the kiosk adds its own two buttons at runtime.
  function addToolbarButton(label) {
    const toolbar = document.querySelector('#dashboard-view header');
    if (!toolbar) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'bg-neutral-100 border border-black/5 px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 h-8 text-xs ml-1.5';
    btn.textContent = label;
    toolbar.appendChild(btn);
    return btn;
  }

  const demoBtn = addToolbarButton('Demo Mode: Off');
  const coverBtn = addToolbarButton('Cover');

  const dash = () => window.HiLDashboard;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const showCover = () => coverView && coverView.classList.remove('view-hidden');
  const hideCover = () => coverView && coverView.classList.add('view-hidden');

  let demoModeOn = false;

  function setDemoMode(on) {
    demoModeOn = on;
    if (demoBtn) {
      demoBtn.classList.toggle('active', on);
      demoBtn.textContent = on ? 'Demo Mode: On' : 'Demo Mode: Off';
    }
  }

  // Cycle cover -> run -> hold, alternating topology each pass so a booth
  // screen shows both validated converters without anyone touching it.
  async function demoLoop() {
    const keys = dash() ? dash().topologies() : ['buck'];
    let i = 0;
    while (demoModeOn) {
      const key = keys[i % keys.length];
      i += 1;
      if (dash()) dash().apply(key);
      const select = document.getElementById('topology-select');
      if (select) select.value = key;
      showCover();
      await wait(COVER_HOLD_MS);
      if (!demoModeOn) break;
      hideCover();
      if (dash()) await dash().run();
      if (!demoModeOn) break;
      await wait(RESULT_HOLD_MS);
    }
    if (dash() && !dash().isPlaying()) dash().reset();
  }

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      hideCover();
      if (dash()) dash().run();
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', () => {
      const turningOn = !demoModeOn;
      setDemoMode(turningOn);
      if (turningOn) demoLoop();
      else if (dash() && !dash().isPlaying()) dash().reset();
    });
  }

  if (coverBtn) {
    coverBtn.addEventListener('click', () => {
      if (dash() && dash().isPlaying()) return;
      showCover();
    });
  }
})();
