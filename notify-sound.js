/* Bilihan — the chime for a new message, shared by the shop and the admin.

   Browsers will not play sound on a page nobody has touched yet. So the first tap,
   click or key press anywhere on the page unlocks it: the clip is loaded then and
   played once, muted, which is what iOS Safari needs before it will play the same
   clip later from a timer. Until that first touch a chime is simply skipped -- the
   unread badge still shows, and nothing errors.

   The clip is the store's own sound, trimmed to its audible 1.5 seconds and stored as
   an 18 KB MP3 (the original was a 414 KB WAV, most of it silence). It is not
   fetched at all until the page has been touched. */
(() => {
  const SRC = 'sounds/message.mp3';
  const VOLUME = 0.7;        /* the clip peaks near full scale; this takes the edge off */
  const GAP_MS = 1500;       /* several messages landing in one poll make one chime   */
  const GESTURES = ['pointerdown', 'keydown', 'touchend'];
  let audio = null;
  let last = 0;
  let touched = false;

  function clip() {
    if (audio) return audio;
    try { audio = new Audio(SRC); audio.preload = 'auto'; } catch { audio = null; }
    return audio;
  }

  function unlock() {
    touched = true;
    const a = clip();
    GESTURES.forEach(ev => document.removeEventListener(ev, unlock, true));
    if (!a) return;
    a.muted = true;
    /* Only stopped if it is still the silent unlock: a real chime that started in
       the meantime has already unmuted it, and must be left to finish. */
    const settle = () => { if (a.muted) { a.pause(); a.currentTime = 0; a.muted = false; } };
    try {
      const p = a.play();
      if (p && p.then) p.then(settle, settle); else settle();
    } catch { settle(); }
  }
  GESTURES.forEach(ev => document.addEventListener(ev, unlock, { capture: true, passive: true }));

  function play() {
    if (!touched) return;      /* the browser would refuse it anyway */
    const now = Date.now();
    if (now - last < GAP_MS) return;
    last = now;
    const a = clip();
    if (!a) return;
    try {
      a.muted = false;
      a.volume = VOLUME;
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});   /* not allowed yet: the badge carries it */
    } catch { /* no audio on this device; the badge carries it */ }
  }

  window.BilihanChime = { play };
})();
