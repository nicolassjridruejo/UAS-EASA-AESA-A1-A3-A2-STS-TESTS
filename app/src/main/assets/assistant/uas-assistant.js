/*
 * UAS Dragonfly Assistant v0.1
 * Offline-first study assistant for the UAS/EASA/AESA exam app.
 * No network calls, no model download, no external dependencies.
 */
(function () {
  'use strict';

  const VERSION = '0.1.0';
  const STORAGE_KEY = 'uas_dragonfly_assistant_v1';
  const FRAME_SIZE = 96;
  const FRAME_COUNT = 6;
  const DEFAULT_CONFIG = {
    language: 'es',
    maxEvents: 500,
    maxConversationTurns: 10,
    minAttemptsForKnownTopic: 3,
    masteryPriorAlpha: 2,
    masteryPriorBeta: 2,
    readiness: {
      targetMastery: 0.78,
      targetCoverage: 0.80,
      targetRecentTest: 0.80
    },
    recommendationWeights: {
      masteryRisk: 0.62,
      duePressure: 0.23,
      errorStreak: 0.15
    },
    animations: {
      idle: { file: 'idle.webp', fallback: 'idle.png', fps: 8, loop: true },
      scan: { file: 'scan.webp', fallback: 'scan.png', fps: 5, loop: true },
      explain: { file: 'explain.webp', fallback: 'explain.png', fps: 5, loop: true },
      celebrate: { file: 'celebrate.webp', fallback: 'celebrate.png', fps: 8, loop: true }
    }
  };

  function now() { return Date.now(); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function safeNum(x, fallback = 0) { const n = Number(x); return Number.isFinite(n) ? n : fallback; }
  function dateKey(ts) { return new Date(ts).toISOString().slice(0, 10); }
  function normalizeText(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñü\s/-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function tokens(s) {
    return normalizeText(s).split(' ').filter(t => t.length > 1 && !STOPWORDS.has(t));
  }
  const STOPWORDS = new Set(['de','la','el','los','las','un','una','unos','unas','y','o','que','en','a','por','para','con','me','mi','mis','se','es','son','del','al','lo','como','ya','muy','mas','menos','esto','esta','este','estos','estas']);

  function deepMerge(base, extra) {
    if (!extra || typeof extra !== 'object') return base;
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const [k, v] of Object.entries(extra)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], v);
      } else out[k] = v;
    }
    return out;
  }

  class TinyStore {
    constructor(key) { this.key = key; }
    load() {
      try {
        const raw = localStorage.getItem(this.key);
        return raw ? JSON.parse(raw) : null;
      } catch (_) { return null; }
    }
    save(value) {
      try {
        localStorage.setItem(this.key, JSON.stringify(value));
        return true;
      } catch (_) { return false; }
    }
    clear() {
      try { localStorage.removeItem(this.key); } catch (_) {}
    }
  }

  function blankState(cfg) {
    return {
      version: 1,
      engineVersion: VERSION,
      createdAt: now(),
      updatedAt: now(),
      firstSeenDay: dateKey(now()),
      lastSeenAt: now(),
      currentCourse: null,
      currentTopic: null,
      registeredTopics: {},
      topics: {},
      questions: {},
      tests: [],
      events: [],
      conversation: [],
      counters: { sessions: 1, opens: 0 },
      preferences: { muted: false, compact: false, motion: 'auto' },
      configShadow: {
        masteryPriorAlpha: cfg.masteryPriorAlpha,
        masteryPriorBeta: cfg.masteryPriorBeta
      }
    };
  }

  function topicKey(course, topic) {
    return `${normalizeText(course || 'general')}::${normalizeText(topic || 'general')}`;
  }

  function topicLabel(t) {
    return t.topic || t.key || 'Tema';
  }

  function betaStats(t) {
    const a = Math.max(0.001, safeNum(t.alpha, 2));
    const b = Math.max(0.001, safeNum(t.beta, 2));
    const mean = a / (a + b);
    const variance = (a * b) / (((a + b) ** 2) * (a + b + 1));
    const sd = Math.sqrt(variance);
    // Conservative mastery estimate: posterior mean minus 0.6 SD.
    const conservative = clamp(mean - 0.6 * sd, 0, 1);
    return { mean, variance, sd, conservative };
  }

  function sm2Update(qstate, quality, timestamp) {
    const q = clamp(Math.round(safeNum(quality, 3)), 0, 5);
    let ease = safeNum(qstate.ease, 2.5);
    let reps = safeNum(qstate.repetitions, 0);
    let interval = safeNum(qstate.interval, 0);

    if (q < 3) {
      reps = 0;
      interval = 1;
      qstate.lapses = safeNum(qstate.lapses, 0) + 1;
    } else {
      reps += 1;
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 6;
      else interval = Math.max(1, Math.round(interval * ease));
    }

    ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    ease = Math.max(1.3, ease);

    qstate.ease = ease;
    qstate.repetitions = reps;
    qstate.interval = interval;
    qstate.lastSeen = timestamp;
    qstate.dueAt = timestamp + interval * 86400000;
    return qstate;
  }

  class SearchIndex {
    constructor() { this.docs = []; this.df = new Map(); this.avgdl = 1; }
    setDocuments(docs) {
      this.docs = (docs || []).map((d, i) => {
        const text = [d.title, d.text, Array.isArray(d.tags) ? d.tags.join(' ') : d.tags].filter(Boolean).join(' ');
        const ts = tokens(text);
        const tf = new Map();
        ts.forEach(x => tf.set(x, (tf.get(x) || 0) + 1));
        return { ...d, _i: i, _tokens: ts, _tf: tf };
      });
      this.df.clear();
      for (const d of this.docs) {
        for (const term of new Set(d._tokens)) this.df.set(term, (this.df.get(term) || 0) + 1);
      }
      this.avgdl = this.docs.length ? this.docs.reduce((s, d) => s + d._tokens.length, 0) / this.docs.length : 1;
    }
    search(query, limit = 4) {
      const q = tokens(query);
      if (!q.length || !this.docs.length) return [];
      const N = this.docs.length, k1 = 1.2, b = 0.75;
      const scored = [];
      for (const d of this.docs) {
        let score = 0;
        for (const term of q) {
          let tf = d._tf.get(term) || 0;
          let df = this.df.get(term) || 0;
          if (!tf && term.length >= 4) {
            // Very small typo/prefix fallback; no external fuzzy-search runtime needed.
            for (const [candidate, ctf] of d._tf) {
              if (candidate.startsWith(term) || term.startsWith(candidate)) { tf = ctf * 0.75; df = this.df.get(candidate) || 1; break; }
            }
          }
          if (!tf) continue;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          const denom = tf + k1 * (1 - b + b * d._tokens.length / this.avgdl);
          score += idf * (tf * (k1 + 1)) / denom;
        }
        if (score > 0) scored.push({ score, doc: d });
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(x => ({ score: x.score, ...x.doc }));
    }
  }

  class SpriteAnimator {
    constructor(canvas, assetBase, config) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.ctx.imageSmoothingEnabled = false;
      this.assetBase = assetBase;
      this.config = config;
      this.images = new Map();
      this.state = 'idle';
      this.frame = 0;
      this.lastFrame = 0;
      this.running = false;
      this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    async loadState(name) {
      if (this.images.has(name)) return this.images.get(name);
      const meta = this.config.animations[name] || this.config.animations.idle;
      const img = new Image();
      const load = (src) => new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src; });
      try { await load(new URL(`assets/${meta.file}`, this.assetBase).href); }
      catch (_) { await load(new URL(`assets/${meta.fallback}`, this.assetBase).href); }
      this.images.set(name, img);
      return img;
    }
    async setState(name) {
      this.state = this.config.animations[name] ? name : 'idle';
      this.frame = 0;
      this.lastFrame = performance.now();
      await this.loadState(this.state);
      this.draw();
    }
    async start() {
      if (this.running) return;
      this.running = true;
      await this.setState('idle');
      requestAnimationFrame(t => this.tick(t));
    }
    stop() { this.running = false; }
    tick(t) {
      if (!this.running) return;
      const meta = this.config.animations[this.state] || this.config.animations.idle;
      const frameMs = 1000 / Math.max(1, meta.fps || 6);
      if (!this.reduced && t - this.lastFrame >= frameMs) {
        this.frame = (this.frame + 1) % FRAME_COUNT;
        this.lastFrame = t;
        this.draw();
      }
      requestAnimationFrame(tt => this.tick(tt));
    }
    draw() {
      const img = this.images.get(this.state);
      if (!img) return;
      this.ctx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.drawImage(img, this.frame * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE, 0, 0, FRAME_SIZE, FRAME_SIZE);
    }
  }

  const INTENTS = [
    { id: 'progress', phrases: ['progreso','como voy','cuanto llevo','porcentaje','avance','estadisticas'] },
    { id: 'next', phrases: ['que estudio','que hago ahora','siguiente','recomiendame','recomendar','por donde sigo'] },
    { id: 'weak', phrases: ['en que fallo','fallos','debil','peor tema','puntos debiles','que se me da peor'] },
    { id: 'review', phrases: ['repasar','repaso','que toca','pendiente','vencido','repetir'] },
    { id: 'ready', phrases: ['estoy listo','estoy preparada','estoy preparado','puedo examinarme','listo para examen','preparado para examen'] },
    { id: 'errors', phrases: ['mis errores','por que fallo','explicame mis errores','errores recientes'] },
    { id: 'help', phrases: ['ayuda','que puedes hacer','comandos','opciones'] }
  ];

  function scoreIntent(text) {
    const n = normalizeText(text);
    let best = { id: 'search', score: 0 };
    for (const intent of INTENTS) {
      let s = 0;
      for (const p of intent.phrases) {
        const np = normalizeText(p);
        if (n.includes(np)) s += np.includes(' ') ? 3 : 2;
        else {
          const pt = tokens(np), nt = new Set(tokens(n));
          s += pt.filter(t => nt.has(t)).length * 0.7;
        }
      }
      if (s > best.score) best = { id: intent.id, score: s };
    }
    return best.score >= 1.4 ? best.id : 'search';
  }

  class AssistantEngine {
    constructor(config, assetBase) {
      this.config = deepMerge(DEFAULT_CONFIG, config || {});
      this.assetBase = assetBase;
      this.store = new TinyStore(this.config.storageKey || STORAGE_KEY);
      this.state = this.store.load() || blankState(this.config);
      this.state.engineVersion = VERSION;
      this.search = new SearchIndex();
      this.ui = null;
      this.animator = null;
      this.callbacks = { onNavigate: null, getSnapshot: null };
      this._saveTimer = null;
      this._boundEvents = [];
    }

    init(options = {}) {
      this.callbacks.onNavigate = options.onNavigate || null;
      this.callbacks.getSnapshot = options.getSnapshot || null;
      if (Array.isArray(options.topics)) this.registerTopics(options.topics);
      if (Array.isArray(options.documents)) this.indexDocuments(options.documents);
      this.mountUI(options.mount);
      this.bindEvents();
      this.state.counters.opens = safeNum(this.state.counters.opens, 0) + 1;
      this.state.lastSeenAt = now();
      this.persistSoon();
      return this;
    }

    mountUI(mount) {
      if (document.getElementById('uasd-root')) return;
      const root = document.createElement('div');
      root.id = 'uasd-root';
      root.className = 'uasd-root uasd-state-idle';
      root.innerHTML = `
        <div class="uasd-panel" role="dialog" aria-label="Asistente de estudio" aria-hidden="true">
          <div class="uasd-panel-head">
            <div><strong>Asistente UAS</strong><span class="uasd-subtitle">local · sin conexión</span></div>
            <button class="uasd-close" type="button" aria-label="Cerrar">×</button>
          </div>
          <div class="uasd-summary"></div>
          <div class="uasd-actions">
            <button data-q="next">Qué estudio ahora</button>
            <button data-q="weak">Mis puntos débiles</button>
            <button data-q="review">Qué debo repasar</button>
          </div>
          <div class="uasd-chat" aria-live="polite"></div>
          <form class="uasd-form">
            <input class="uasd-input" autocomplete="off" placeholder="Pregunta por tu progreso o el temario…" aria-label="Pregunta al asistente">
            <button class="uasd-send" type="submit" aria-label="Enviar">↗</button>
          </form>
          <div class="uasd-foot">Memoria guardada solo en este dispositivo.</div>
        </div>
        <button class="uasd-orb" type="button" aria-label="Abrir asistente de estudio">
          <span class="uasd-glow"></span>
          <canvas class="uasd-sprite" width="96" height="96" aria-hidden="true"></canvas>
          <span class="uasd-badge" hidden></span>
        </button>
      `;
      (mount ? document.querySelector(mount) : document.body).appendChild(root);
      this.ui = {
        root,
        panel: root.querySelector('.uasd-panel'),
        orb: root.querySelector('.uasd-orb'),
        canvas: root.querySelector('.uasd-sprite'),
        chat: root.querySelector('.uasd-chat'),
        input: root.querySelector('.uasd-input'),
        form: root.querySelector('.uasd-form'),
        summary: root.querySelector('.uasd-summary'),
        badge: root.querySelector('.uasd-badge')
      };
      this.animator = new SpriteAnimator(this.ui.canvas, this.assetBase, this.config);
      this.animator.start();
      this.ui.orb.addEventListener('click', () => this.togglePanel());
      root.querySelector('.uasd-close').addEventListener('click', () => this.closePanel());
      this.ui.form.addEventListener('submit', e => {
        e.preventDefault();
        const q = this.ui.input.value.trim();
        if (!q) return;
        this.ui.input.value = '';
        this.ask(q, { render: true });
      });
      root.querySelectorAll('[data-q]').forEach(btn => btn.addEventListener('click', () => {
        const map = { next: '¿Qué estudio ahora?', weak: '¿Cuáles son mis puntos débiles?', review: '¿Qué debo repasar?' };
        this.ask(map[btn.dataset.q], { render: true });
      }));
      this.renderSummary();
    }

    bindEvents() {
      const bindings = {
        'uas:answer': e => this.recordAnswer(e.detail || {}),
        'uas:test-complete': e => this.recordTest(e.detail || {}),
        'uas:topic-view': e => this.recordTopicView(e.detail || {}),
        'uas:course-change': e => this.setCourse((e.detail || {}).course),
        'uas:assistant-ask': e => this.ask((e.detail || {}).text || '', { render: true }),
        'uas:assistant-open': () => this.openPanel()
      };
      for (const [name, fn] of Object.entries(bindings)) {
        window.addEventListener(name, fn);
        this._boundEvents.push([name, fn]);
      }
    }

    destroy() {
      this._boundEvents.forEach(([n, fn]) => window.removeEventListener(n, fn));
      this._boundEvents = [];
      if (this.animator) this.animator.stop();
      if (this.ui && this.ui.root) this.ui.root.remove();
      this.ui = null;
    }

    registerTopics(list) {
      for (const raw of list) {
        const course = raw.course || raw.exam || 'General';
        const topic = raw.topic || raw.name || raw.title;
        if (!topic) continue;
        const key = topicKey(course, topic);
        this.state.registeredTopics[key] = { key, course, topic, weight: safeNum(raw.weight, 1), anchor: raw.anchor || null };
        this.ensureTopic(course, topic);
      }
      this.persistSoon();
    }

    ensureTopic(course, topic) {
      const key = topicKey(course, topic);
      if (!this.state.topics[key]) {
        this.state.topics[key] = {
          key, course: course || 'General', topic: topic || 'General',
          alpha: this.config.masteryPriorAlpha,
          beta: this.config.masteryPriorBeta,
          attempts: 0, correct: 0, wrong: 0,
          streakCorrect: 0, streakWrong: 0,
          lastSeen: null, avgResponseMs: 0
        };
      }
      return this.state.topics[key];
    }

    recordAnswer(detail) {
      const ts = safeNum(detail.timestamp, now());
      const course = detail.course || this.state.currentCourse || 'General';
      const topic = detail.topic || detail.module || 'General';
      const correct = !!detail.correct;
      const t = this.ensureTopic(course, topic);
      t.attempts += 1;
      t.lastSeen = ts;
      if (correct) {
        t.alpha += 1; t.correct += 1; t.streakCorrect += 1; t.streakWrong = 0;
      } else {
        t.beta += 1; t.wrong += 1; t.streakWrong += 1; t.streakCorrect = 0;
      }
      if (detail.responseMs != null) {
        const ms = clamp(safeNum(detail.responseMs, 0), 0, 300000);
        t.avgResponseMs = t.avgResponseMs ? (t.avgResponseMs * 0.85 + ms * 0.15) : ms;
      }
      this.state.currentCourse = course;
      this.state.currentTopic = topic;

      const qid = detail.questionId || detail.id;
      if (qid != null) {
        const qkey = `${normalizeText(course)}::${String(qid)}`;
        const qstate = this.state.questions[qkey] || { id: String(qid), course, topic, ease: 2.5, repetitions: 0, interval: 0, dueAt: ts, lapses: 0 };
        qstate.topic = topic;
        qstate.correct = safeNum(qstate.correct, 0) + (correct ? 1 : 0);
        qstate.wrong = safeNum(qstate.wrong, 0) + (correct ? 0 : 1);
        const quality = detail.quality != null ? detail.quality : (correct ? 4 : 2);
        sm2Update(qstate, quality, ts);
        this.state.questions[qkey] = qstate;
      }

      this.pushEvent({ type: 'answer', ts, course, topic, correct, questionId: qid || null });
      this.persistSoon();
      this.renderSummary();

      if (!correct && t.streakWrong >= 2) {
        this.animate('scan', 'diagnostic', 2100);
        this.notify(`Detecto varios fallos seguidos en ${topic}. Puedo enseñarte el patrón y qué conviene repasar.`, 'warn');
      } else if (!correct) {
        this.animate('scan', 'error', 900);
      } else if (t.streakCorrect >= 4) {
        this.animate('celebrate', 'success', 1300);
      } else {
        this.animate('idle', 'success', 650);
      }
      return this.getTopic(course, topic);
    }

    recordTest(detail) {
      const ts = safeNum(detail.timestamp, now());
      const course = detail.course || this.state.currentCourse || 'General';
      const scoreRaw = detail.score != null ? safeNum(detail.score, 0) : (detail.correct != null && detail.total ? detail.correct / detail.total : 0);
      const score = scoreRaw > 1 ? scoreRaw / 100 : scoreRaw;
      const test = { ts, course, score: clamp(score, 0, 1), correct: detail.correct ?? null, total: detail.total ?? null, mode: detail.mode || 'test' };
      this.state.tests.push(test);
      this.state.tests = this.state.tests.slice(-40);
      this.state.currentCourse = course;
      this.pushEvent({ type: 'test', ...test });
      this.persistSoon();
      this.renderSummary();
      if (score >= 0.8) {
        this.animate('celebrate', 'celebrate', 2400);
        this.notify(`Buen simulacro: ${Math.round(score * 100)} %. Voy actualizando tu estimación de preparación.`, 'good');
      } else {
        this.animate('scan', 'diagnostic', 2200);
        const next = this.recommendNext(course);
        this.notify(next ? `Simulacro al ${Math.round(score * 100)} %. El mejor siguiente objetivo es ${next.topic}.` : `Simulacro al ${Math.round(score * 100)} %.`, 'warn');
      }
      return this.getReadiness(course);
    }

    recordTopicView(detail) {
      const course = detail.course || this.state.currentCourse || 'General';
      const topic = detail.topic || detail.module || 'General';
      const t = this.ensureTopic(course, topic);
      t.lastSeen = now();
      this.state.currentCourse = course;
      this.state.currentTopic = topic;
      this.pushEvent({ type: 'topic-view', ts: now(), course, topic });
      this.persistSoon();
    }

    setCourse(course) {
      if (!course) return;
      this.state.currentCourse = course;
      this.pushEvent({ type: 'course-change', ts: now(), course });
      this.persistSoon();
      this.renderSummary();
    }

    getTopic(course, topic) {
      const t = this.ensureTopic(course, topic);
      return { ...t, mastery: betaStats(t) };
    }

    getTopicRows(course) {
      return Object.values(this.state.topics)
        .filter(t => !course || normalizeText(t.course) === normalizeText(course))
        .map(t => {
          const mastery = betaStats(t);
          const due = this.getDueQuestions(t.course, t.topic).length;
          const qcount = Object.values(this.state.questions).filter(q => normalizeText(q.course) === normalizeText(t.course) && normalizeText(q.topic) === normalizeText(t.topic)).length;
          const duePressure = qcount ? due / qcount : 0;
          const streak = clamp(t.streakWrong / 3, 0, 1);
          const w = this.config.recommendationWeights;
          const risk = clamp(w.masteryRisk * (1 - mastery.conservative) + w.duePressure * duePressure + w.errorStreak * streak, 0, 1);
          return { ...t, mastery, due, qcount, duePressure, risk };
        });
    }

    recommendNext(course) {
      const rows = this.getTopicRows(course || this.state.currentCourse);
      if (!rows.length) return null;
      return rows.sort((a, b) => b.risk - a.risk || a.attempts - b.attempts)[0];
    }

    getWeakTopics(course, limit = 3) {
      return this.getTopicRows(course || this.state.currentCourse)
        .filter(t => t.attempts > 0)
        .sort((a, b) => b.risk - a.risk)
        .slice(0, limit);
    }

    getDueQuestions(course, topic) {
      const ts = now();
      return Object.values(this.state.questions).filter(q =>
        (!course || normalizeText(q.course) === normalizeText(course)) &&
        (!topic || normalizeText(q.topic) === normalizeText(topic)) &&
        safeNum(q.dueAt, 0) <= ts
      );
    }

    getReadiness(course) {
      const c = course || this.state.currentCourse;
      const rows = this.getTopicRows(c);
      if (!rows.length) return { score: 0, mastery: 0, coverage: 0, recentTest: null, knownTopics: 0, totalTopics: 0 };
      const registered = Object.values(this.state.registeredTopics).filter(t => !c || normalizeText(t.course) === normalizeText(c));
      const denom = registered.length || rows.length;
      const known = rows.filter(t => t.attempts >= this.config.minAttemptsForKnownTopic).length;
      const coverage = clamp(known / Math.max(1, denom), 0, 1);
      const weighted = rows.reduce((acc, t) => {
        const weight = Math.min(8, Math.max(1, t.attempts));
        acc.sum += t.mastery.conservative * weight;
        acc.weight += weight;
        return acc;
      }, { sum: 0, weight: 0 });
      const mastery = weighted.weight ? weighted.sum / weighted.weight : 0;
      const recentTests = this.state.tests.filter(t => !c || normalizeText(t.course) === normalizeText(c)).slice(-3);
      const recentTest = recentTests.length ? recentTests.reduce((s, t) => s + t.score, 0) / recentTests.length : null;
      const score = recentTest == null ? 0.70 * mastery + 0.30 * coverage : 0.50 * mastery + 0.25 * coverage + 0.25 * recentTest;
      return { score: clamp(score, 0, 1), mastery, coverage, recentTest, knownTopics: known, totalTopics: denom };
    }

    getProgress(course) {
      const c = course || this.state.currentCourse;
      const rows = this.getTopicRows(c);
      const attempts = rows.reduce((s, t) => s + t.attempts, 0);
      const correct = rows.reduce((s, t) => s + t.correct, 0);
      const r = this.getReadiness(c);
      return { course: c, attempts, correct, accuracy: attempts ? correct / attempts : 0, ...r };
    }

    indexDocuments(docs) {
      this.search.setDocuments(docs || []);
      return this.search.docs.length;
    }

    ask(text, options = {}) {
      const q = String(text || '').trim();
      if (!q) return { intent: 'none', text: '' };
      const intent = scoreIntent(q);
      const answer = this.answerIntent(intent, q);
      this.rememberConversation(q, answer.text, intent, answer.meta);
      if (options.render && this.ui) {
        this.addChat('user', q);
        this.addChat('assistant', answer.text, answer.actions);
        this.animate(answer.animation || (intent === 'search' ? 'explain' : 'scan'), intent === 'search' ? 'explain' : 'thinking', 1700);
      }
      return { intent, ...answer };
    }

    answerIntent(intent, query) {
      const course = this.state.currentCourse;
      if (intent === 'progress') {
        const p = this.getProgress(course);
        if (!p.attempts) return { text: 'Aún no tengo suficientes respuestas registradas. En cuanto la app me envíe tus aciertos y fallos empezaré a estimar tu dominio por tema.', animation: 'scan' };
        const testPart = p.recentTest == null ? '' : ` Tus últimos simulacros promedian ${Math.round(p.recentTest * 100)} %.`;
        return { text: `${course ? course + ': ' : ''}${p.attempts} respuestas registradas, ${Math.round(p.accuracy * 100)} % de acierto. Cobertura estimada ${Math.round(p.coverage * 100)} % y dominio conservador ${Math.round(p.mastery * 100)} %.${testPart}`, animation: 'scan', meta: p };
      }
      if (intent === 'next') {
        const r = this.recommendNext(course);
        if (!r) return { text: 'Todavía no tengo datos suficientes para priorizar un tema. Haz unas preguntas y podré ordenar el repaso.', animation: 'scan' };
        const reason = r.streakWrong >= 2 ? 'porque acumulas varios fallos recientes' : r.due > 0 ? `porque tienes ${r.due} preguntas que ya toca revisar` : 'porque combina menor dominio estimado y mayor incertidumbre';
        return { text: `Yo seguiría por «${r.topic}»: ${reason}. Dominio conservador estimado: ${Math.round(r.mastery.conservative * 100)} %.`, animation: 'explain', meta: r };
      }
      if (intent === 'weak' || intent === 'errors') {
        const rows = this.getWeakTopics(course, 3);
        if (!rows.length) return { text: 'Aún no tengo fallos suficientes para detectar un patrón por tema.', animation: 'scan' };
        const list = rows.map((r, i) => `${i + 1}) ${r.topic} (${Math.round(r.mastery.conservative * 100)} % estimado${r.streakWrong ? `, racha de ${r.streakWrong} fallos` : ''})`).join(' · ');
        return { text: `Ahora mismo los temas con más riesgo son: ${list}.`, animation: 'scan', meta: rows };
      }
      if (intent === 'review') {
        const due = this.getDueQuestions(course);
        if (!due.length) return { text: 'No tengo preguntas vencidas en el plan de repaso. Puedes avanzar al tema que te recomiendo o hacer un simulacro.', animation: 'explain' };
        const count = new Map();
        due.forEach(q => count.set(q.topic, (count.get(q.topic) || 0) + 1));
        const top = [...count.entries()].sort((a,b) => b[1]-a[1]).slice(0,3).map(([t,n]) => `${t}: ${n}`).join(' · ');
        return { text: `Tienes ${due.length} preguntas que ya toca revisar. Prioridad: ${top}.`, animation: 'explain', meta: { due: due.length } };
      }
      if (intent === 'ready') {
        const r = this.getReadiness(course);
        if (!r.totalTopics) return { text: 'Todavía no puedo estimar preparación: necesito datos de varios temas y, idealmente, algún simulacro.', animation: 'scan' };
        const test = r.recentTest == null ? 'sin simulacros recientes' : `simulacros ${Math.round(r.recentTest * 100)} %`;
        const label = r.score >= 0.80 && r.coverage >= 0.75 ? 'vas cerca de una zona sólida de preparación' : r.score >= 0.65 ? 'vas en progreso, pero aún hay huecos relevantes' : 'todavía hay bastante margen de mejora';
        return { text: `Mi estimación local es ${Math.round(r.score * 100)} %: ${label}. Cobertura ${Math.round(r.coverage * 100)} %, dominio ${Math.round(r.mastery * 100)} %, ${test}. No es una predicción oficial de aprobado.`, animation: r.score >= 0.8 ? 'celebrate' : 'scan', meta: r };
      }
      if (intent === 'help') {
        return { text: 'Puedo seguir tu progreso, detectar puntos débiles, decidir qué estudiar después, programar repasos de preguntas y buscar dentro del contenido local que la app me entregue. Todo funciona sin conexión.', animation: 'explain' };
      }

      const found = this.search.search(query, 3);
      if (found.length) {
        const top = found[0];
        const excerpt = String(top.text || '').replace(/\s+/g, ' ').trim().slice(0, 260);
        const actions = top.anchor ? [{ label: 'Abrir tema', action: () => this.navigate(top) }] : [];
        return { text: `He encontrado esto en el temario local: «${top.title || 'Tema'}». ${excerpt}${excerpt.length >= 260 ? '…' : ''}`, animation: 'explain', actions, meta: { results: found.map(x => ({ id: x.id, title: x.title, score: x.score })) } };
      }
      return { text: 'No encuentro una respuesta fiable en el contenido local que tengo indexado. Sí puedo responder sobre tu progreso, errores, repasos y qué estudiar después.', animation: 'explain' };
    }

    navigate(doc) {
      if (typeof this.callbacks.onNavigate === 'function') return this.callbacks.onNavigate(doc);
      if (doc.anchor) {
        const el = document.querySelector(doc.anchor);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    rememberConversation(user, assistant, intent, meta) {
      this.state.conversation.push({ ts: now(), user: user.slice(0, 500), assistant: assistant.slice(0, 1200), intent, topic: this.state.currentTopic || null, meta: meta || null });
      this.state.conversation = this.state.conversation.slice(-this.config.maxConversationTurns);
      this.persistSoon();
    }

    pushEvent(ev) {
      this.state.events.push(ev);
      this.state.events = this.state.events.slice(-this.config.maxEvents);
      this.state.updatedAt = now();
    }

    persistSoon() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => {
        this.state.updatedAt = now();
        this.store.save(this.state);
      }, 80);
    }

    exportMemory() { return JSON.parse(JSON.stringify(this.state)); }
    importMemory(data) {
      if (!data || typeof data !== 'object' || data.version !== 1) throw new Error('Formato de memoria no compatible');
      this.state = data;
      this.persistSoon();
      this.renderSummary();
    }
    clearMemory() {
      this.store.clear();
      this.state = blankState(this.config);
      this.renderSummary();
    }

    openPanel() {
      if (!this.ui) return;
      this.ui.panel.classList.add('is-open');
      this.ui.panel.setAttribute('aria-hidden', 'false');
      this.renderSummary();
      this.animate('explain', 'explain', 1200);
      setTimeout(() => this.ui && this.ui.input.focus(), 120);
    }
    closePanel() {
      if (!this.ui) return;
      this.ui.panel.classList.remove('is-open');
      this.ui.panel.setAttribute('aria-hidden', 'true');
      this.animate('idle', 'idle', 1);
    }
    togglePanel() {
      if (!this.ui) return;
      this.ui.panel.classList.contains('is-open') ? this.closePanel() : this.openPanel();
    }

    animate(sprite, motion, duration = 1200) {
      if (!this.ui) return;
      if (this.animator) this.animator.setState(sprite);
      this.ui.root.className = `uasd-root uasd-state-${motion}`;
      clearTimeout(this._animTimer);
      if (duration > 1) {
        this._animTimer = setTimeout(() => {
          if (!this.ui) return;
          this.ui.root.className = 'uasd-root uasd-state-idle';
          if (this.animator) this.animator.setState('idle');
        }, duration);
      }
    }

    notify(text, kind = 'info') {
      if (!this.ui) return;
      this.ui.badge.textContent = '!';
      this.ui.badge.hidden = false;
      this.ui.orb.classList.add('has-note');
      this.ui.orb.title = text;
      if (this.ui.panel.classList.contains('is-open')) this.addChat('assistant', text);
      else {
        const n = document.createElement('button');
        n.className = `uasd-toast uasd-toast-${kind}`;
        n.type = 'button';
        n.textContent = text;
        n.addEventListener('click', () => { n.remove(); this.openPanel(); });
        this.ui.root.appendChild(n);
        setTimeout(() => n.remove(), 5200);
      }
    }

    addChat(role, text, actions) {
      if (!this.ui) return;
      const msg = document.createElement('div');
      msg.className = `uasd-msg uasd-msg-${role}`;
      const p = document.createElement('div');
      p.textContent = text;
      msg.appendChild(p);
      if (Array.isArray(actions) && actions.length) {
        const bar = document.createElement('div');
        bar.className = 'uasd-msg-actions';
        actions.forEach(a => {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = a.label;
          b.addEventListener('click', a.action);
          bar.appendChild(b);
        });
        msg.appendChild(bar);
      }
      this.ui.chat.appendChild(msg);
      this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
    }

    renderSummary() {
      if (!this.ui) return;
      const p = this.getProgress(this.state.currentCourse);
      if (!p.attempts) {
        this.ui.summary.innerHTML = `<span class="uasd-kicker">Esperando datos</span><strong>Empieza un test para que pueda aprender de tu progreso.</strong>`;
        return;
      }
      const next = this.recommendNext(this.state.currentCourse);
      this.ui.summary.innerHTML = `
        <span class="uasd-kicker">${this.escape(this.state.currentCourse || 'Progreso')}</span>
        <strong>${Math.round(p.score * 100)} % preparación local</strong>
        <div class="uasd-meter"><i style="width:${Math.round(p.score * 100)}%"></i></div>
        <small>${p.attempts} respuestas · ${Math.round(p.accuracy * 100)} % acierto${next ? ` · siguiente: ${this.escape(next.topic)}` : ''}</small>
      `;
    }

    escape(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
  }

  let instance = null;
  const currentScript = document.currentScript;
  const assetBase = currentScript && currentScript.src ? new URL('.', currentScript.src) : new URL('./assistant/', location.href);

  const publicAPI = {
    version: VERSION,
    init(options = {}) {
      if (instance) return instance;
      instance = new AssistantEngine(options.config || {}, assetBase).init(options);
      return instance;
    },
    get instance() { return instance; },
    recordAnswer(detail) { return instance && instance.recordAnswer(detail); },
    recordTest(detail) { return instance && instance.recordTest(detail); },
    recordTopicView(detail) { return instance && instance.recordTopicView(detail); },
    setCourse(course) { return instance && instance.setCourse(course); },
    registerTopics(list) { return instance && instance.registerTopics(list); },
    indexDocuments(docs) { return instance && instance.indexDocuments(docs); },
    ask(text, opts) { return instance && instance.ask(text, opts); },
    getProgress(course) { return instance && instance.getProgress(course); },
    getReadiness(course) { return instance && instance.getReadiness(course); },
    recommendNext(course) { return instance && instance.recommendNext(course); },
    exportMemory() { return instance && instance.exportMemory(); },
    importMemory(data) { return instance && instance.importMemory(data); },
    clearMemory() { return instance && instance.clearMemory(); },
    open() { return instance && instance.openPanel(); },
    close() { return instance && instance.closePanel(); }
  };

  window.UASAssistant = publicAPI;
})();
