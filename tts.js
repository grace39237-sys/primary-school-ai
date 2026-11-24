// tts.js — the phone's own voice (Web Speech API, speechSynthesis).
// No download, works offline. English voice, default rate.
// Used to read chalkboard steps aloud as they appear, and to read the
// Ask answer when the child taps Listen.
//
// Note: speechSynthesis needs a user gesture first on some phones — the
// Ask tap / mic tap is that gesture. If speech is blocked, speak() just
// does nothing; the board still shows the steps.
let voices = [];

function refreshVoices() {
  voices = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
}
if ('speechSynthesis' in window) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}

export function ttsSupported() {
  return 'speechSynthesis' in window;
}

function pickVoice() {
  const en = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
  return en.find((v) => v.lang.toLowerCase().startsWith('en-us'))
    || en.find((v) => v.lang.toLowerCase().startsWith('en-gb'))
    || en[0] || null;
}

// Speak one text. Cancels whatever is being spoken. Returns false when
// there is no voice support or the text is empty. onend fires when the
// utterance finishes (or never fires if speech is blocked — callers must
// use a timeout as well).
export function speak(text, { onend } = {}) {
  if (!ttsSupported() || !text) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  const v = pickVoice();
  if (v) u.voice = v;
  if (onend) u.onend = onend;
  speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking() {
  if (ttsSupported()) speechSynthesis.cancel();
}
