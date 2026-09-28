// Step video: ONE YouTube player (IFrame API, youtube-nocookie) per recipe view / cook mode. Moving between steps
// only seeks it, so a step's clip starts instantly. Mirrors the app's RecipeVideoPlayer.tsx.
//   clipAt(recipe, i)          → {videoId, clip:{start,end}, label} | null  (step clips come with app backups: steps[i].clip)
//   createStepVideo(host, o)   → {cue(t), play(t), pause(), destroy()}; o = {initial, play, onPlaying, onClipEnd}
import { esc, icon } from '../ui.js';
import { splitSource } from '../app/recipes/source.js';
import { youtubeIdOf, normalizeClip, formatClipTime } from '../app/recipes/clipTypes.js';

export { formatClipTime };
export const thumbUrl = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const watchUrl = (id, s = 0) => `https://www.youtube.com/watch?v=${id}${s ? `&t=${Math.floor(s)}s` : ''}`;

const vidOk = (v) => typeof v === 'string' && /^[\w-]{11}$/.test(v);
export function clipOf(step) {
  const raw = step && step.clip;
  const c = normalizeClip(raw);
  return c ? { ...c, v: raw && vidOk(raw.v) ? raw.v : undefined } : null;
}
export function recipeVideoId(r) {
  for (const s of r.steps || []) { const c = clipOf(s); if (c && c.v) return c.v; }
  return youtubeIdOf(splitSource(r.notes || '').source?.url);
}
export function clipAt(r, i) {
  const c = clipOf((r.steps || [])[i]);
  const v = c ? c.v || recipeVideoId(r) : null;
  return c && v ? { videoId: v, clip: { start: c.start, end: c.end }, label: `Step ${i + 1}` } : null;
}
export const hasClips = (r) => (r.steps || []).some((_, i) => clipAt(r, i));

// ---------- the IFrame API (loaded once, on first use) ----------
let apiP = null;
function loadYT() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiP) return apiP;
  apiP = new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (e) { /* ignore */ } res(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { apiP = null; rej(new Error('offline')); };
    document.head.append(s);
    setTimeout(() => rej(new Error('timeout')), 15000);
  });
  return apiP;
}

let mounts = 0; // debug: how many players were ever created (window.__emmStepVideo)

/**
 * Mount one player in `host`. `initial` = the first target: cued ("primed": played muted to the first frame, then
 * paused, so the first tap is instant) unless `play` is true. Every later step: `play(t)` / `cue(t)` / `pause()`.
 */
export function createStepVideo(host, { initial, play: startPlaying = false, onPlaying, onClipEnd } = {}) {
  mounts++;
  const id = 'sv-' + Math.random().toString(36).slice(2, 8);
  host.innerHTML = `<div class="sv" data-status="loading">
      <div class="sv-frame"><div id="${id}"></div></div>
      <img class="sv-thumb" alt="" src="${esc(thumbUrl(initial.videoId))}">
      <button type="button" class="sv-cover sv-cue"><span class="sv-pill">${icon.play}<b></b></span></button>
      <div class="sv-cover sv-end"><button type="button" class="sv-pill" data-sv="replay">${icon.refresh}<b>Replay step</b></button><button type="button" class="sv-pill soft" data-sv="more"><b>Keep watching</b></button></div>
      <div class="sv-cover sv-none"><span>No clip for this step</span></div>
      <div class="sv-cover sv-err"><a class="sv-pill" target="_blank" rel="noopener noreferrer">${icon.play}<b>Open on YouTube</b></a></div>
      <button type="button" class="sv-sound" hidden>🔇 Tap for sound</button>
    </div>`;
  const root = host.firstElementChild;
  const $ = (s) => root.querySelector(s);
  let player = null, ready = false, destroyed = false, q = [];
  let cur = initial, S = initial.clip.start, E = initial.clip.end, VID = initial.videoId;
  let priming = false, timer = 0, lastT = -1, fb = 0;
  const setStatus = (s) => { root.dataset.status = s; };
  const label = () => { if (cur) $('.sv-cue b').textContent = `${formatClipTime(cur.clip.start)} · ${cur.clip.end - cur.clip.start}s`; };
  const run = (f) => { if (ready) { try { f(); } catch (e) { /* player gone */ } } else q.push(f); };
  const stopWatch = () => { clearInterval(timer); timer = 0; };
  const watch = () => {
    stopWatch(); lastT = -1;
    timer = setInterval(() => {
      try {
        const t = player.getCurrentTime();
        // stop at the clip's end when playback runs into it (a scrub past it doesn't count)
        if (E !== null && lastT >= 0 && lastT < E - 0.15 && t >= E - 0.15 && t - lastT < 2) {
          E = null; player.pauseVideo(); stopWatch(); setStatus('ended'); if (onClipEnd) onClipEnd(); return;
        }
        lastT = t;
      } catch (e) { /* ignore */ }
    }, 250);
  };
  const clearFb = () => { clearTimeout(fb); fb = 0; };
  // autoplay with sound can be refused (no user gesture reached the iframe): then play muted + "Tap for sound"
  const armFb = () => { clearFb(); fb = setTimeout(() => { fb = 0; try { const st = player.getPlayerState(); if (st !== 1 && st !== 3) { player.mute(); player.playVideo(); } } catch (e) { /* ignore */ } }, 1800); };
  const unprime = () => { if (priming) { priming = false; try { player.unMute(); } catch (e) { /* ignore */ } } };
  const prime = () => {
    priming = true;
    try { player.mute(); } catch (e) { /* ignore */ }
    player.seekTo(S, true); player.playVideo();
    setTimeout(() => { if (priming) { priming = false; try { player.pauseVideo(); player.seekTo(S, true); player.unMute(); } catch (e) { /* ignore */ } } }, 8000);
  };
  const api = {
    cue(t) {
      cur = t; clearFb();
      if (!t) return api.pause();
      label(); setStatus(ready ? 'cued' : 'loading');
      run(() => {
        unprime(); S = t.clip.start; E = t.clip.end;
        if (t.videoId !== VID) { VID = t.videoId; player.cueVideoById({ videoId: VID, startSeconds: S }); return; }
        const st = player.getPlayerState();
        if (st === 5 || st === -1) player.cueVideoById({ videoId: VID, startSeconds: S });
        else { player.seekTo(S, true); player.pauseVideo(); }
      });
    },
    play(t) {
      cur = t;
      if (!t) return api.pause();
      label(); if (ready) setStatus('playing');
      run(() => {
        unprime(); S = t.clip.start; E = t.clip.end;
        try { player.unMute(); } catch (e) { /* ignore */ }
        if (t.videoId !== VID) { VID = t.videoId; player.loadVideoById({ videoId: VID, startSeconds: S }); } else { player.seekTo(S, true); player.playVideo(); }
        armFb();
      });
    },
    pause() {
      cur = null; clearFb();
      if (ready) setStatus('none');
      run(() => { unprime(); player.pauseVideo(); });
    },
    destroy() { destroyed = true; clearFb(); stopWatch(); try { player && player.destroy(); } catch (e) { /* ignore */ } host.innerHTML = ''; },
    get mounts() { return mounts; },
  };
  const fail = () => {
    if (destroyed) return;
    const t = cur || initial;
    $('.sv-err a').href = watchUrl(t.videoId, t.clip.start);
    setStatus('error');
  };
  root.addEventListener('click', (e) => {
    if (e.target.closest('.sv-cue') || e.target.closest('[data-sv="replay"]')) { if (cur) api.play(cur); }
    else if (e.target.closest('[data-sv="more"]')) { setStatus('playing'); run(() => { E = null; player.playVideo(); }); }
    else if (e.target.closest('.sv-sound')) { $('.sv-sound').hidden = true; run(() => player.unMute()); }
  });
  label();
  loadYT().then((YT) => {
    if (destroyed) return;
    player = new YT.Player(id, {
      host: 'https://www.youtube-nocookie.com',
      videoId: VID,
      playerVars: { start: Math.floor(S), playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: () => {
          if (destroyed) return;
          ready = true;
          setStatus(cur ? (startPlaying ? 'playing' : 'cued') : 'none');
          const had = q.length;
          while (q.length) { try { q.shift()(); } catch (e) { /* ignore */ } }
          if (!had) { if (startPlaying) api.play(cur); else prime(); }
        },
        onStateChange: (e) => {
          const d = e.data;
          if (priming) {
            if (d === 1) { priming = false; player.pauseVideo(); player.seekTo(S, true); setTimeout(() => { try { player.unMute(); } catch (x) { /* ignore */ } }, 60); }
            return;
          }
          if (d === 1) {
            clearFb(); watch();
            if (root.dataset.status !== 'none') setStatus('playing');
            $('.sv-sound').hidden = !player.isMuted();
            if (onPlaying) onPlaying();
          } else if (d === 2 || d === 0) {
            stopWatch();
            if (d === 0 && cur) setStatus('ended');
          }
        },
        onError: fail,
      },
    });
  }).catch(fail);
  window.__emmStepVideo = { get mounts() { return mounts; }, get status() { return root.dataset.status; }, get player() { return player; } };
  return api;
}
