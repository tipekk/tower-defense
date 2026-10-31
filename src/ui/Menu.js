// src/ui/Menu.js -- Bastion Grid main menu (agent A).
// Owns the #menu markup in index.html: persisted state, screen switching,
// Basic/Zombie mode switch (+ one-time Zombie warning), mock leaderboard,
// difficulty, nickname "login", settings, keyboard. The 3D figures on the
// stage come from ./MenuStage.js (optional -- the menu works without it).
//
//   initMenu({ onPlay(state), stage? }) -> { getState(), close() }

const LS_KEY = 'bastionGrid.menu.v1';
const LS_NO_WARN = 'bastionGrid.zombieWarn.off';
const SS_WARNED = 'bastionGrid.zombieWarn.shown';
const NICK_MAX = 20;
const SCREENS = ['home', 'leaderboard', 'difficulty', 'login', 'settings'];

const DEFAULT_STATE = {
  mode: 'basic',
  difficulty: 'normal',
  nickname: '',
  stars: 0,
  gears: 0,
  settings: { music: 70, sfx: 80, haptics: true, reduceMotion: false },
};

const COPY = {
  basic: {
    tagline: 'Tower defense z mosadze a smaltu',
    kicker: 'Denná dielňa',
    title: 'Mosadzná légia',
    lead: 'Hodinárove hračky pochodujú na tvoj bastión. Postav veže, nechaj pružiny dobehnúť a ubráň dielňu.',
    hint: '<kbd>Enter</kbd> spustí hru',
    daily: 'Denná výzva',
  },
  zombie: {
    tagline: 'Čo zhnilo, to sa vracia',
    kicker: 'Nočný močiar',
    title: 'Zombie légia',
    lead: 'Tie isté hračky, prerastené hubou. Liečia sa, delia a vstávajú. Spáľ ich skôr, než zakorenia.',
    hint: '<kbd>Enter</kbd> spustí hru. Svetlo si nechaj zapnuté.',
    daily: 'Nočná výzva',
  },
};

const DIFFICULTY = {
  calm: { label: 'Pokojná' },
  normal: { label: 'Normálna' },
  brutal: { label: 'Brutálna', locked: true },
};

// Mock leaderboard: names per mode, scores scaled per tab.
const LB_NAMES = {
  basic: ['Kľúčník', 'MosadznáMia', 'Pružinka', 'TikTak42', 'HodinárJano', 'Zubáčik', 'Smaltovaná', 'Navíjač_Peťo', 'CvakCvak', 'Kukučka'],
  zombie: ['Hubár', 'SpóraX', 'Plesnivec', 'PacientNula', 'Močiarka', 'Hniloba7', 'Klíčok', 'Podhubník', 'Rašelina', 'ZelenýDym'],
};
const LB_BASE = { basic: 48210, zombie: 31640 };
const LB_TAB_SCALE = { day: 1, week: 6.4, campaign: 21.7 };
const LB_ME_RANK = { day: 248, week: 1312, campaign: 4807 };

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const s = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...s,
      mode: s.mode === 'zombie' ? 'zombie' : 'basic',
      difficulty: DIFFICULTY[s.difficulty] && !DIFFICULTY[s.difficulty].locked ? s.difficulty : 'normal',
      nickname: typeof s.nickname === 'string' ? s.nickname.slice(0, NICK_MAX) : '',
      settings: { ...DEFAULT_STATE.settings, ...(s.settings || {}) },
    };
  } catch (e) {
    return structuredClone(DEFAULT_STATE);
  }
}
function saveState(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* private mode etc. */ }
}
function lsGet(store, key) { try { return store.getItem(key); } catch (e) { return null; } }
function lsSet(store, key, v) { try { store.setItem(key, v); } catch (e) { /* ignore */ } }

const fmt = (n) => Math.round(n).toLocaleString('sk-SK');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GUEST_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4"/></svg>';

export function initMenu({ onPlay, stage: stageArg } = {}) {
  const root = document.getElementById('menu');
  if (!root) throw new Error('initMenu: #menu not found');
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.from(root.querySelectorAll(sel));

  const state = loadState();
  let stage = stageArg || null;
  let lbTab = 'day';
  let closed = false;
  let lastOpener = null;

  document.documentElement.classList.add('menu-open');

  // ---- mode ------------------------------------------------------------
  function applyMode(mode, { persist = true } = {}) {
    state.mode = mode;
    root.dataset.mode = mode;
    document.documentElement.dataset.mode = mode;
    $$('.mode-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
    const c = COPY[mode];
    $('.menu-tagline').textContent = c.tagline;
    $('.menu-kicker').textContent = c.kicker;
    $('.menu-title').textContent = c.title;
    $('.menu-lead').textContent = c.lead;
    $('.menu-hint').innerHTML = c.hint;
    const daily = $('.menu-cta [data-open="daily"]');
    if (daily) daily.textContent = c.daily;
    renderLeaderboard();
    if (stage && stage.setMode) { try { stage.setMode(mode); } catch (e) { console.warn('[menu] stage.setMode', e); } }
    if (persist) saveState(state);
  }

  const dialog = $('.menu-dialog');
  function openWarning() {
    dialog.hidden = false;
    dialog.querySelector('.dialog-check input').checked = false;
    requestAnimationFrame(() => dialog.querySelector('[data-act="ok"]').focus());
  }
  function closeWarning(accept) {
    if (dialog.hidden) return;
    if (dialog.querySelector('.dialog-check input').checked) lsSet(localStorage, LS_NO_WARN, '1');
    dialog.hidden = true;
    if (!accept) applyMode('basic');
    $(`.mode-opt[data-mode="${state.mode}"]`)?.focus();
  }
  function requestMode(mode) {
    if (mode === state.mode) return;
    applyMode(mode);
    if (mode === 'zombie' && !lsGet(localStorage, LS_NO_WARN) && !lsGet(sessionStorage, SS_WARNED)) {
      lsSet(sessionStorage, SS_WARNED, '1');
      openWarning();
    }
  }
  $$('.mode-opt').forEach((b) => b.addEventListener('click', () => requestMode(b.dataset.mode)));
  $('.mode-switch').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      requestMode(e.key === 'ArrowRight' ? 'zombie' : 'basic');
      $(`.mode-opt[data-mode="${state.mode}"]`).focus();
    }
  });
  dialog.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) closeWarning(act === 'ok');
    else if (e.target === dialog) closeWarning(false);
  });

  // ---- screens ----------------------------------------------------------
  function show(screen, opener) {
    if (!SCREENS.includes(screen)) screen = 'home';
    root.dataset.screen = screen;
    $$('.menu-nav .menu-item[data-open], .menu-account').forEach((b) =>
      b.setAttribute('aria-expanded', String(b.dataset.open === screen)));
    $$('.menu-panel').forEach((p) => {
      const on = p.dataset.screen === screen;
      p.inert = !on;
      p.setAttribute('aria-hidden', String(!on));
    });
    if (stage && stage.relayout) { try { stage.relayout(); } catch (e) { /* ignore */ } }
    if (screen === 'home') {
      if (lastOpener && document.contains(lastOpener)) lastOpener.focus({ preventScroll: true });
      lastOpener = null;
    } else {
      if (opener) lastOpener = opener;
      const panel = $(`.menu-panel[data-screen="${screen}"]`);
      panel.scrollTop = 0;
      const focusEl = screen === 'login' ? panel.querySelector('.field-input') : panel.querySelector('.panel-back');
      // wait a frame so visibility flips before focusing
      requestAnimationFrame(() => focusEl?.focus({ preventScroll: true }));
    }
  }
  root.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open]');
    if (opener && root.contains(opener) && !opener.disabled) {
      let target = opener.dataset.open;
      if (target === 'daily') { lbTab = 'day'; renderLeaderboard(); target = 'leaderboard'; }
      // tapping the already-open item toggles it closed
      show(root.dataset.screen === target && opener.dataset.open !== 'daily' ? 'home' : target, opener);
      return;
    }
    if (e.target.closest('.panel-back')) { show('home'); return; }
    if (e.target === $('.menu-main') && root.dataset.screen !== 'home') show('home'); // scrim / empty area
  });

  // ---- leaderboard -------------------------------------------------------
  function renderLeaderboard() {
    const list = $('.lb-list');
    if (!list) return;
    const names = LB_NAMES[state.mode];
    const top = LB_BASE[state.mode] * LB_TAB_SCALE[lbTab];
    const rows = names.map((n, i) => {
      const score = top * Math.pow(0.915, i) - i * 37;
      return `<li class="lb-row${i < 3 ? ' is-top' : ''}"><span class="lb-rank">${i + 1}</span><span class="lb-name">${esc(n)}</span><span class="lb-score">${fmt(score)}</span></li>`;
    });
    const meName = state.nickname || 'Ty (hosť)';
    const meScore = state.stars > 0 ? fmt(top * 0.08) : '0';
    rows.push('<li class="lb-gap" aria-hidden="true">···</li>');
    rows.push(`<li class="lb-row is-me"><span class="lb-rank">${state.stars > 0 ? LB_ME_RANK[lbTab] : '—'}</span><span class="lb-name">${esc(meName)}</span><span class="lb-score">${meScore}</span></li>`);
    list.innerHTML = rows.join('');
    $$('.tab').forEach((t) => {
      const on = t.dataset.tab === lbTab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    const v = $('.menu-item[data-open="leaderboard"] .menu-item-value');
    if (v) v.textContent = state.stars > 0 ? `#${LB_ME_RANK.day}` : '#—';
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => { lbTab = t.dataset.tab; renderLeaderboard(); }));

  // ---- difficulty --------------------------------------------------------
  function renderDifficulty() {
    $$('.choice').forEach((c) => {
      const key = c.dataset.difficulty;
      const on = key === state.difficulty;
      c.classList.toggle('is-selected', on);
      c.classList.toggle('is-locked', !!DIFFICULTY[key]?.locked);
      c.setAttribute('aria-checked', String(on));
    });
    const v = $('.menu-item[data-open="difficulty"] .menu-item-value');
    if (v) v.textContent = DIFFICULTY[state.difficulty].label;
  }
  $$('.choice').forEach((c) => c.addEventListener('click', () => {
    const key = c.dataset.difficulty;
    if (!DIFFICULTY[key] || DIFFICULTY[key].locked) {
      c.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 240 });
      return;
    }
    state.difficulty = key;
    saveState(state);
    renderDifficulty();
    setTimeout(() => { if (root.dataset.screen === 'difficulty') show('home'); }, 220);
  }));

  // ---- account (nickname) -----------------------------------------------
  const form = $('.menu-panel[data-screen="login"] .form');
  const input = form.querySelector('.field-input');
  const counter = form.querySelector('.field-count');
  input.maxLength = NICK_MAX;
  function renderAccount() {
    const nick = state.nickname;
    const avatar = $('.menu-avatar');
    if (nick) avatar.textContent = nick.trim().charAt(0).toLocaleUpperCase('sk');
    else avatar.innerHTML = GUEST_SVG;
    $('.menu-account-name').textContent = nick || 'Prihlásiť';
    $('.menu-account').setAttribute('aria-label', nick ? `Prezývka: ${nick}` : 'Prihlásiť sa prezývkou');
    input.value = nick;
    counter.textContent = `${input.value.length}/${NICK_MAX}`;
    form.querySelector('[type="submit"]').textContent = nick ? 'Zmeniť prezývku' : 'Uložiť prezývku';
    renderLeaderboard();
  }
  input.addEventListener('input', () => {
    if (input.value.length > NICK_MAX) input.value = input.value.slice(0, NICK_MAX);
    counter.textContent = `${input.value.length}/${NICK_MAX}`;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nick = input.value.replace(/\s+/g, ' ').trim().slice(0, NICK_MAX);
    if (!nick) { input.focus(); input.animate?.([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 200 }); return; }
    state.nickname = nick;
    saveState(state);
    renderAccount();
    show('home');
  });
  form.querySelector('[data-act="guest"]').addEventListener('click', () => {
    state.nickname = '';
    saveState(state);
    renderAccount();
    play();
  });

  // ---- settings -----------------------------------------------------------
  function paintRange(r) { r.style.setProperty('--fill', `${((r.value - r.min) / (r.max - r.min)) * 100}%`); }
  function renderSettings() {
    $$('.setting-list input').forEach((el) => {
      const v = state.settings[el.name];
      if (el.type === 'checkbox') el.checked = !!v;
      else { el.value = v; paintRange(el); }
      const out = $(`.setting-value[data-for="${el.name}"]`);
      if (out) out.textContent = el.value;
    });
    root.classList.toggle('reduce-motion', !!state.settings.reduceMotion);
  }
  $$('.setting-list input').forEach((el) => el.addEventListener('input', () => {
    state.settings[el.name] = el.type === 'checkbox' ? el.checked : Number(el.value);
    if (el.type !== 'checkbox') paintRange(el);
    const out = $(`.setting-value[data-for="${el.name}"]`);
    if (out) out.textContent = el.value;
    if (el.name === 'reduceMotion') root.classList.toggle('reduce-motion', el.checked);
    if (el.name === 'haptics' && el.checked) navigator.vibrate?.(12);
    saveState(state);
  }));

  // ---- stats ------------------------------------------------------------------
  $$('[data-stat]').forEach((b) => { b.textContent = fmt(state[b.dataset.stat] || 0); });

  // ---- play ---------------------------------------------------------------------
  function getState() { return structuredClone(state); }
  function play() {
    if (closed) return;
    closed = true;
    saveState(state);
    root.classList.add('is-leaving');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onVis);
    try { onPlay && onPlay(getState()); } catch (e) { console.error('[menu] onPlay failed', e); }
    // game render loop skips frames while html.menu-open; drop it now so the
    // scene is drawn underneath the fading menu (the menu still covers it).
    document.documentElement.classList.remove('menu-open');
    const done = () => {
      root.style.display = 'none';
      document.documentElement.classList.remove('menu-open');
      if (stage && stage.destroy) { try { stage.destroy(); } catch (e) { console.warn('[menu] stage.destroy', e); } }
      stage = null;
    };
    const reduce = state.settings.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(done, reduce ? 0 : 440);
  }
  $('#menuPlay').addEventListener('click', play);

  // ---- keyboard ---------------------------------------------------------------
  // Capture phase on document: runs before the game's window keydown handlers,
  // and swallows every key while the menu is open so Space/F/P/WASD etc. never
  // reach the (paused) game underneath.
  function onKey(e) {
    if (closed) return;
    const t = e.target;
    const inField = t && (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range');
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!dialog.hidden) closeWarning(false);
      else if (root.dataset.screen !== 'home') show('home');
      return;
    }
    if (e.key === 'Enter' && !e.isComposing) {
      // Enter = Hrať on the home screen (focused buttons there still answer
      // to Space). In panels/dialog/text field Enter keeps its native meaning.
      if (!dialog.hidden || inField || root.dataset.screen !== 'home') return;
      // Focus on another control (mode switch, nav item, account, ...):
      // let Enter activate that control natively.
      const a = document.activeElement;
      if (a && a !== document.body && a !== root && a !== $('#menuPlay') && root.contains(a)
        && a.matches('button, input, select, textarea, a[href], [tabindex]')) return;
      e.preventDefault();
      play();
    }
  }
  document.addEventListener('keydown', onKey, true);

  function onVis() {
    if (!stage) return;
    try { document.hidden ? stage.pause && stage.pause() : stage.resume && stage.resume(); } catch (e) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', onVis);

  // ---- optional 3D stage --------------------------------------------------------
  if (!stage) {
    const el = root.querySelector('#menuStage');
    import('./MenuStage.js')
      .then(async (m) => {
        if (closed || !m || typeof m.mountMenuStage !== 'function') return;
        const s = await m.mountMenuStage(el, state.mode);
        if (closed) { s && s.destroy && s.destroy(); return; }
        stage = s || null;
        if (stage && stage.setMode) stage.setMode(state.mode);
      })
      .catch((e) => { console.info('[menu] MenuStage unavailable, menu runs without 3D figures.', e && e.message); });
  }

  // ---- initial paint --------------------------------------------------------------
  applyMode(state.mode, { persist: false });
  renderDifficulty();
  renderAccount();
  renderSettings();
  show('home');

  return { getState, close: play };
}
