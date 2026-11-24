// board.js — the chalkboard: a lightweight dark board with chalk-white
// text (no 3D, no webfont). When an Ask answer or a Practice explanation
// arrives, its steps appear one at a time, and each step is read aloud
// as it appears when Listen is on.
//
// Steps come ONLY from verified text — the Ask answer plus the source
// sentences, or a quiz item's own explanation/hint (practice.js stepsOf).
// The board never invents steps and never writes maths working.
import { speak, stopSpeaking } from './tts.js';

const STEP_GAP_MS = 900; // gap between steps when Listen is off
const STEP_SPEAK_TIMEOUT_MS = 12000; // max wait for one spoken step

export function makeBoard(root, { onListenChange } = {}) {
  const list = root.querySelector('.board-steps');
  const listenBtn = root.querySelector('.board-listen');
  const stopBtn = root.querySelector('.board-stop');
  let run = 0; // bumped to cancel an in-flight reveal
  let listen = true;

  function renderListen() {
    listenBtn.textContent = listen ? '🔊 Listen: on' : '🔇 Listen: off';
    listenBtn.setAttribute('aria-pressed', String(listen));
  }
  listenBtn.addEventListener('click', () => {
    listen = !listen;
    if (!listen) stopSpeaking();
    renderListen();
    if (onListenChange) onListenChange(listen);
  });
  stopBtn.addEventListener('click', () => stop());

  function stop() {
    run++; // invalidates the in-flight reveal loop
    stopSpeaking();
  }

  function clear() {
    stop();
    list.innerHTML = '';
    root.hidden = true;
  }

  function setListen(v) {
    listen = !!v;
    renderListen();
  }

  // steps: array of strings (already verified text). Shows them one at a
  // time; each step is spoken as it appears when Listen is on. A new
  // show() cancels the previous one.
  async function show(steps) {
    const myRun = ++run;
    stopSpeaking();
    list.innerHTML = '';
    root.hidden = false;
    for (const text of steps) {
      if (myRun !== run) return; // stopped or replaced
      const li = document.createElement('li');
      li.className = 'board-step';
      li.textContent = text;
      list.appendChild(li);
      if (listen) {
        await new Promise((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          const ok = speak(text, { onend: finish });
          if (!ok) finish();
          setTimeout(finish, STEP_SPEAK_TIMEOUT_MS);
        });
      } else {
        await new Promise((r) => setTimeout(r, STEP_GAP_MS));
      }
      if (myRun !== run) return;
    }
  }

  renderListen();
  return { show, clear, stop, setListen, getListen: () => listen };
}
