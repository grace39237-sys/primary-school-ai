// board.js — the chalkboard: a lightweight dark board with chalk-white
// text (no 3D, no webfont). When an Ask answer or a Practice explanation
// arrives, its steps appear one at a time, silently.
//
// Voice plays ONLY when the child taps the Listen button: it reads the
// steps currently on the board, one at a time. Nothing is spoken
// automatically when an answer appears (v2.1 — Won, 2026-11-24).
//
// Steps come ONLY from verified text — the Ask answer plus the source
// sentences, or a quiz item's own explanation/hint (practice.js stepsOf).
// The board never invents steps and never writes maths working.
//
// Display side strips markdown markers (v2.4): the quiz data writes
// "**___**" and "**cold**", so every step is cleaned before it is shown
// — the data itself is untouched.
import { speak, stopSpeaking } from './tts.js';
import { stripMarkdown } from './textutil.js';

const STEP_GAP_MS = 900; // gap between steps while they appear
const STEP_SPEAK_TIMEOUT_MS = 12000; // max wait for one spoken step

export function makeBoard(root) {
  const list = root.querySelector('.board-steps');
  const listenBtn = root.querySelector('.board-listen');
  const stopBtn = root.querySelector('.board-stop');
  let run = 0; // bumped to cancel an in-flight reveal
  let speakRun = 0; // bumped to cancel in-flight reading
  let revealDone = Promise.resolve(); // resolves when the current reveal ends

  listenBtn.addEventListener('click', () => { speakSteps(); });
  stopBtn.addEventListener('click', () => stop());

  function stop() {
    run++; // invalidates the in-flight reveal loop
    speakRun++; // invalidates the in-flight reading loop
    stopSpeaking();
  }

  function clear() {
    stop();
    list.innerHTML = '';
    root.hidden = true;
  }

  // steps: array of strings (already verified text). Shows them one at a
  // time, silently. A new show() cancels the previous one. Returns a
  // promise that resolves when the reveal finishes.
  function show(steps) {
    const myRun = ++run;
    stopSpeaking();
    list.innerHTML = '';
    root.hidden = false;
    revealDone = (async () => {
      for (const text of steps) {
        if (myRun !== run) return; // stopped or replaced
        const li = document.createElement('li');
        li.className = 'board-step';
        li.textContent = stripMarkdown(text);
        list.appendChild(li);
        await new Promise((r) => setTimeout(r, STEP_GAP_MS));
        if (myRun !== run) return;
      }
    })();
    return revealDone;
  }

  // Read the steps currently on the board, one at a time. Only runs when
  // the child taps Listen. Waits for the reveal to finish first, so a
  // tap mid-reveal still reads every step.
  async function speakSteps() {
    const mySpeak = ++speakRun;
    stopSpeaking();
    await revealDone;
    if (mySpeak !== speakRun) return;
    const items = [...list.querySelectorAll('.board-step')].map((li) => li.textContent);
    for (const text of items) {
      if (mySpeak !== speakRun) return;
      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        const ok = speak(text, { onend: finish });
        if (!ok) finish();
        setTimeout(finish, STEP_SPEAK_TIMEOUT_MS);
      });
      if (mySpeak !== speakRun) return;
    }
  }

  return { show, clear, stop, speakSteps };
}
