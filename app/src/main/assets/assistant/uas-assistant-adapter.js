/*
 * Aula UAS integration adapter for UAS Dragonfly Assistant v0.1.
 * The trainer supplies window.UAS_ASSISTANT_BOOTSTRAP with topics, documents
 * and getSnapshot. This file adds no network calls or external dependencies.
 */
(function () {
  'use strict';
  if (!window.UASAssistant || window.UASAssistant.instance) return;

  const options = window.UAS_ASSISTANT_BOOTSTRAP || {};
  const assistant = window.UASAssistant.init(options);

  function normal(value) {
    return String(value || '').toLocaleLowerCase('es').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñü\s/-]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // Imports cumulative app statistics only when the assistant has not already
  // received those answers through its live uas:answer event contract.
  function syncProgress(snapshot) {
    const answers = Array.isArray(snapshot && snapshot.answers) ? snapshot.answers : [];
    if (!answers.length || !assistant || !assistant.state) return 0;
    let imported = 0;
    const notify = assistant.notify;
    const animate = assistant.animate;
    const renderSummary = assistant.renderSummary;
    assistant.notify = function () {};
    assistant.animate = function () {};
    assistant.renderSummary = function () {};
    try {
      for (const row of answers) {
        if (!row || row.questionId == null || !row.course || !row.topic) continue;
        const saved = assistant.state.questions[`${normal(row.course)}::${String(row.questionId)}`] || {};
        const haveCorrect = Number(saved.correct) || 0;
        const haveWrong = Number(saved.wrong) || 0;
        const wantCorrect = Math.max(0, Number(row.correct) || 0);
        const wantWrong = Math.max(0, Number(row.wrong) || 0);
        for (let i = haveCorrect; i < wantCorrect; i += 1) {
          assistant.recordAnswer({ course: row.course, topic: row.topic, questionId: row.questionId, correct: true, quality: 4 });
          imported += 1;
        }
        for (let i = haveWrong; i < wantWrong; i += 1) {
          assistant.recordAnswer({ course: row.course, topic: row.topic, questionId: row.questionId, correct: false, quality: 2 });
          imported += 1;
        }
      }
    } finally {
      assistant.notify = notify;
      assistant.animate = animate;
      assistant.renderSummary = renderSummary;
      assistant.renderSummary();
      assistant.persistSoon();
    }
    return imported;
  }

  function restoreProgress(saved) {
    if (!saved || typeof saved !== 'object' || !saved.topics || !saved.questions) return false;
    assistant.state = saved;
    assistant.persistSoon();
    assistant.renderSummary();
    return true;
  }

  window.UAS_ASSISTANT_SYNC_PROGRESS = syncProgress;
  window.UAS_ASSISTANT_EXPORT_PROGRESS = function () { return assistant.state; };
  window.UAS_ASSISTANT_RESTORE_PROGRESS = restoreProgress;
  window.__uasAssistant = assistant;
  if (typeof options.getSnapshot === 'function') {
    try { syncProgress(options.getSnapshot()); } catch (_) { /* legacy progress remains usable */ }
  }
})();
