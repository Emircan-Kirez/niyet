/* Niyet - arayüz ve olaylar */
(function () {
  'use strict';

  var C = window.NiyetCalc;
  var STORE_KEY = 'niyet-data-v1';
  var MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  var WEEK_SHORT = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
  var MAX_ADD = 100;    // Ekle alanı üst sınırı
  var MAX_EDIT = 999;   // Takvimden düzeltmede bir vakit için üst sınır
  var MAX_BASE = 999999;
  var UNDO_MS = 8000;
  var BACKUP_DAYS = 7;

  var data;
  var storageOK = true;
  var corruptNotice = false;
  var viewMonth;          // { y, m } (m: 0-11)
  var selected = null;    // seçili gün (YYYY-MM-DD)
  var editing = false;
  var addWhen = 'today';
  var undoInfo = null;
  var undoTimer = null;
  var addStepper, detailInputs = {}, welcomeFields, settingsFields;

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { return C.todayStr(); }

  function dateLabel(str, withWeekday) {
    var p = C.parseDate(str);
    var s = p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
    if (withWeekday) {
      var wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
      s += ', ' + WEEKDAYS[wd];
    }
    return s;
  }

  function vakitLabel(key) {
    for (var i = 0; i < C.VAKITLER.length; i++) if (C.VAKITLER[i].key === key) return C.VAKITLER[i].label;
    return key;
  }

  /* ---------- Saklama ---------- */

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { storageOK = false; }
    if (!raw) return C.emptyData();
    try {
      var s = C.sanitize(JSON.parse(raw));
      if (s) return s;
    } catch (e) { /* aşağıda ele alınır */ }
    try { localStorage.setItem(STORE_KEY + '-bozuk-' + Date.now(), raw); } catch (e) { /* yoksay */ }
    corruptNotice = true;
    return C.emptyData();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      storageOK = true;
    } catch (e) {
      storageOK = false;
    }
    renderStorageWarn();
  }

  function renderStorageWarn() {
    var box = $('storage-warn');
    var msg = '';
    if (!storageOK) msg = 'Kayıtlar bu tarayıcıda saklanamıyor. Gizli sekmede olabilirsiniz; normal Chrome sekmesinde açın.';
    else if (corruptNotice) msg = 'Önceki kayıtlar okunamadı, bozuk veri ayrıca saklandı. Yedeğiniz varsa Ayarlar\'dan yükleyebilirsiniz.';
    box.textContent = msg;
    box.hidden = !msg;
  }

  /* ---------- Ekran geçişleri ---------- */

  function showScreen(name) {
    ['welcome', 'app', 'settings'].forEach(function (id) { $(id).hidden = (id !== name); });
    window.scrollTo(0, 0);
  }

  function openSettings() {
    hideToast();
    try { history.pushState({ settings: true }, ''); } catch (e) { /* yoksay */ }
    renderSettings();
    showScreen('settings');
  }

  function closeSettings() {
    if (history.state && history.state.settings) history.back();
    else { showScreen('app'); renderAll(); }
  }

  window.addEventListener('popstate', function () {
    if (data.onboarded) { showScreen('app'); renderAll(); }
  });

  /* ---------- Yardımcı arayüz parçaları ---------- */

  function makeStepper(input, min, max) {
    var wrap = document.createElement('div');
    wrap.className = 'stepper';
    var minus = document.createElement('button');
    minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', 'Azalt');
    var plus = document.createElement('button');
    plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'Artır');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = String(min);
    input.max = String(max);
    input.className = 'num-input';
    function step(delta) {
      var v = parseInt(input.value, 10);
      if (isNaN(v)) v = min;
      v = Math.max(min, Math.min(max, v + delta));
      input.value = String(v);
    }
    minus.addEventListener('click', function () { step(-1); });
    plus.addEventListener('click', function () { step(1); });
    wrap.appendChild(minus); wrap.appendChild(input); wrap.appendChild(plus);
    return wrap;
  }

  // Altı vakit için etiket + sayı alanı satırları. { key: input } döner.
  function buildFields(container, values, max, withSteppers) {
    container.textContent = '';
    var inputs = {};
    C.VAKITLER.forEach(function (v) {
      var row = document.createElement('div');
      row.className = 'edit-row';
      var label = document.createElement('span');
      label.textContent = v.label;
      var input = document.createElement('input');
      input.id = container.id + '-' + v.key;
      input.setAttribute('aria-label', v.label);
      if (withSteppers) {
        input.value = String(values[v.key] || 0);
        row.appendChild(label);
        row.appendChild(makeStepper(input, 0, max));
      } else {
        input.type = 'number';
        input.inputMode = 'numeric';
        input.min = '0';
        input.max = String(max);
        input.className = 'num-input';
        input.placeholder = '0';
        input.value = values[v.key] ? String(values[v.key]) : '';
        row.appendChild(label);
        row.appendChild(input);
      }
      container.appendChild(row);
      inputs[v.key] = input;
    });
    return inputs;
  }

  // Alanları okur; boş = 0. Geçersizse null döner.
  function readFields(inputs, max) {
    var out = {};
    for (var i = 0; i < C.KEYS.length; i++) {
      var k = C.KEYS[i];
      var txt = String(inputs[k].value).trim();
      if (txt === '') { out[k] = 0; continue; }
      if (!/^\d+$/.test(txt)) return null;
      var n = parseInt(txt, 10);
      if (n > max) return null;
      out[k] = n;
    }
    return out;
  }

  function showError(id, msg) {
    var el = $(id);
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function showMsg(msg, isErr) {
    var el = $('settings-msg');
    el.textContent = msg;
    el.className = 'msg' + (isErr ? ' err' : '');
    el.hidden = !msg;
  }

  function confirmDialog(text, yesLabel) {
    return new Promise(function (resolve) {
      var dlg = $('confirm');
      $('confirm-text').textContent = text;
      $('confirm-yes').textContent = yesLabel || 'Devam et';
      function done(v) {
        $('confirm-yes').removeEventListener('click', yes);
        $('confirm-no').removeEventListener('click', no);
        dlg.removeEventListener('cancel', no);
        if (dlg.open) dlg.close();
        resolve(v);
      }
      function yes() { done(true); }
      function no() { done(false); }
      $('confirm-yes').addEventListener('click', yes);
      $('confirm-no').addEventListener('click', no);
      dlg.addEventListener('cancel', no);
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else resolve(window.confirm(text));
    });
  }

  /* ---------- Ana ekran çizimi ---------- */

  function durText(d) {
    var p = [];
    if (d.years) p.push(d.years + ' yıl');
    if (d.months) p.push(d.months + ' ay');
    if (d.days || !p.length) p.push(d.days + ' gün');
    return p.join(' ');
  }

  function renderDuration() {
    var d = C.duration(C.grandTotal(data));
    $('dur-main').textContent = durText(d);
    var rem = $('dur-rem');
    rem.hidden = d.rem === 0;
    rem.textContent = '+ ' + d.rem + ' vakit';
    $('dur-days').textContent = 'Toplam ' + d.totalDays + ' gün';
    var per = C.perVakitTotals(data);
    C.KEYS.forEach(function (k) { $('tot-' + k).textContent = per[k]; });
  }

  function renderStreak() {
    var cur = C.currentStreak(data.days, today());
    var best = Math.max(C.longestStreak(data.days), cur);
    $('streak').textContent = 'Seri: ' + cur + ' gün · En uzun: ' + best + ' gün';
  }

  function renderBanner() {
    var ref = data.lastBackup || data.since;
    var banner = $('backup-banner');
    if (!ref) { banner.hidden = true; return; }
    var gap = C.diffDays(ref, today());
    if (gap < BACKUP_DAYS) { banner.hidden = true; return; }
    $('backup-text').textContent = data.lastBackup
      ? 'Son yedek ' + gap + ' gün önce.'
      : 'Henüz yedek alınmadı.';
    banner.hidden = false;
  }

  function renderCalendar() {
    var y = viewMonth.y, m = viewMonth.m;
    $('cal-title').textContent = MONTHS[m] + ' ' + y;
    var t = today();
    var tp = C.parseDate(t);
    $('cal-next').disabled = (y > tp.y) || (y === tp.y && m + 1 >= tp.m);

    var grid = $('cal-grid');
    grid.textContent = '';
    var first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    var offset = (first + 6) % 7; // Pazartesi = 0
    var count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (var i = 0; i < offset; i++) {
      var sp = document.createElement('div');
      sp.className = 'cal-spacer';
      grid.appendChild(sp);
    }
    for (var d = 1; d <= count; d++) {
      var ds = y + '-' + pad(m + 1) + '-' + pad(d);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = d;
      btn.dataset.date = ds;
      var done = C.dayDone(data.days[ds]);
      var cls = 'cal-cell';
      if (done) cls += ' done';
      if (ds === t) cls += ' today';
      if (ds === selected) cls += ' selected';
      btn.className = cls;
      btn.disabled = ds > t;
      btn.setAttribute('aria-label', dateLabel(ds) + (done ? ', kıldı' : ', kayıt yok') + (ds === t ? ', bugün' : ''));
      if (ds === selected) btn.setAttribute('aria-pressed', 'true');
      grid.appendChild(btn);
    }
  }

  function renderDetail() {
    var box = $('detail');
    if (!selected) { box.hidden = true; return; }
    box.hidden = false;
    $('detail-title').textContent = dateLabel(selected, true);
    $('btn-edit').hidden = editing;
    var rec = data.days[selected] || C.emptyCounts();
    var view = $('detail-view');
    var edit = $('detail-edit');
    if (editing) {
      view.hidden = true;
      edit.hidden = false;
      detailInputs = buildFields($('detail-fields'), rec, MAX_EDIT, true);
      showError('detail-error', '');
    } else {
      edit.hidden = true;
      view.hidden = false;
      view.textContent = '';
      if (!C.dayDone(rec)) {
        var e = document.createElement('p');
        e.className = 'detail-empty';
        e.textContent = 'Bu güne kayıt yok. Kalem düğmesiyle ekleyebilirsiniz.';
        view.appendChild(e);
      }
      C.VAKITLER.forEach(function (v) {
        var tile = document.createElement('div');
        tile.className = 'tile';
        tile.innerHTML = '<span class="tile-label"></span><span class="tile-num"></span>';
        tile.firstChild.textContent = v.label;
        tile.lastChild.textContent = rec[v.key];
        view.appendChild(tile);
      });
    }
  }

  function renderAdd() {
    $('add-vakit').value = data.lastPrayer;
    $('when-today').setAttribute('aria-pressed', String(addWhen === 'today'));
    $('when-yesterday').setAttribute('aria-pressed', String(addWhen === 'yesterday'));
  }

  function renderAll() {
    renderStorageWarn();
    renderBanner();
    renderDuration();
    renderStreak();
    renderAdd();
    renderCalendar();
    renderDetail();
  }

  /* ---------- Kayıt ekleme ve geri alma ---------- */

  function showToast(text) {
    $('toast-text').textContent = text;
    $('toast').hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideToast, UNDO_MS);
  }

  function hideToast() {
    clearTimeout(undoTimer);
    $('toast').hidden = true;
    undoInfo = null;
  }

  function doAdd() {
    var txt = String($('add-count').value).trim();
    var n = /^\d+$/.test(txt) ? parseInt(txt, 10) : NaN;
    if (isNaN(n) || n < 1 || n > MAX_ADD) {
      showError('add-error', '1 ile ' + MAX_ADD + ' arasında bir sayı yazın.');
      return;
    }
    showError('add-error', '');
    var key = $('add-vakit').value;
    var date = addWhen === 'today' ? today() : C.prevDay(today());
    var rec = data.days[date] ? Object.assign({}, data.days[date]) : C.emptyCounts();
    rec[key] += n;
    data.days[date] = rec;
    data.lastPrayer = key;
    save();
    undoInfo = { date: date, key: key, n: n };
    // Sonraki giriş için Bugün'e ve 1'e dön
    addWhen = 'today';
    $('add-count').value = '1';
    renderAll();
    showToast(vakitLabel(key) + ' +' + n + ' eklendi (' + (date === today() ? 'bugün' : 'dün') + ')');
  }

  function doUndo() {
    if (!undoInfo) return;
    var u = undoInfo;
    var rec = data.days[u.date];
    if (rec) {
      rec = Object.assign({}, rec);
      rec[u.key] = Math.max(0, rec[u.key] - u.n);
      if (C.dayTotal(rec) > 0) data.days[u.date] = rec; else delete data.days[u.date];
      save();
    }
    hideToast();
    renderAll();
  }

  /* ---------- Gün düzeltme ---------- */

  function saveEdit() {
    var vals = readFields(detailInputs, MAX_EDIT);
    if (!vals) { showError('detail-error', '0 ile ' + MAX_EDIT + ' arasında tam sayılar yazın.'); return; }
    if (C.dayTotal(vals) > 0) data.days[selected] = vals; else delete data.days[selected];
    save();
    editing = false;
    renderAll();
  }

  /* ---------- Ayarlar, yedek ---------- */

  function renderSettings() {
    var info = $('backup-info');
    info.textContent = data.lastBackup
      ? 'Son yedek: ' + dateLabel(data.lastBackup) + '.'
      : 'Henüz yedek alınmadı.';
    settingsFields = buildFields($('settings-fields'), data.baseline, MAX_BASE, false);
    showError('settings-error', '');
    showMsg('', false);
  }

  function downloadBackup() {
    var json = JSON.stringify(C.toBackup(data), null, 1);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'niyet-yedek-' + today() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    data.lastBackup = today();
    save();
    renderBanner();
  }

  function handleRestoreFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { showMsg('Dosya okunamadı. Hiçbir şey değişmedi.', true); };
    reader.onload = function () {
      var res = C.parseBackup(String(reader.result));
      if (!res.ok) { showMsg(res.error, true); return; }
      var s = C.summarize(res.data);
      var text = 'Bu yedekte ' + s.dayCount + ' gün kayıt var' +
        (s.lastDate ? ', son kayıt ' + dateLabel(s.lastDate) : '') +
        '. Şu anki veri silinip bunlarla değiştirilecek. Devam edilsin mi?';
      confirmDialog(text, 'Evet, yükle').then(function (ok) {
        if (!ok) { showMsg('Vazgeçildi, hiçbir şey değişmedi.', false); return; }
        data = res.data;
        selected = null; editing = false;
        save();
        renderSettings();
        showMsg('Yedek yüklendi.', false);
      });
    };
    reader.readAsText(file);
  }

  function saveBaselineFromSettings() {
    var vals = readFields(settingsFields, MAX_BASE);
    if (!vals) { showError('settings-error', 'Sadece 0 veya daha büyük tam sayılar yazın.'); return; }
    showError('settings-error', '');
    data.baseline = vals;
    save();
    showMsg('Önceki toplam kaydedildi.', false);
  }

  /* ---------- İlk açılış ---------- */

  function finishWelcome(baseline) {
    data.baseline = baseline;
    data.onboarded = true;
    data.since = today();
    save();
    startApp();
  }

  function setupWelcome() {
    welcomeFields = buildFields($('welcome-fields'), data.baseline, MAX_BASE, false);
    $('btn-start').addEventListener('click', function () {
      $('welcome-1').hidden = true;
      $('welcome-2').hidden = false;
      window.scrollTo(0, 0);
    });
    $('btn-welcome-save').addEventListener('click', function () {
      var vals = readFields(welcomeFields, MAX_BASE);
      if (!vals) { showError('welcome-error', 'Sadece 0 veya daha büyük tam sayılar yazın.'); return; }
      finishWelcome(vals);
    });
    $('btn-welcome-skip').addEventListener('click', function () { finishWelcome(C.emptyCounts()); });
  }

  /* ---------- Başlatma ---------- */

  function buildStatic() {
    var sel = $('add-vakit');
    C.VAKITLER.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.key; o.textContent = v.label;
      sel.appendChild(o);
    });
    var input = document.createElement('input');
    input.id = 'add-count';
    input.value = '1';
    input.setAttribute('aria-label', 'Kaç tane');
    $('add-stepper').appendChild(makeStepper(input, 1, MAX_ADD));

    var totals = $('totals');
    C.VAKITLER.forEach(function (v) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      var l = document.createElement('span'); l.className = 'tile-label'; l.textContent = v.label;
      var n = document.createElement('span'); n.className = 'tile-num'; n.id = 'tot-' + v.key; n.textContent = '0';
      tile.appendChild(l); tile.appendChild(n);
      totals.appendChild(tile);
    });

    var week = $('cal-week');
    WEEK_SHORT.forEach(function (w) {
      var s = document.createElement('span'); s.textContent = w; week.appendChild(s);
    });
  }

  function bindEvents() {
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-back').addEventListener('click', closeSettings);
    $('btn-backup-now').addEventListener('click', downloadBackup);

    $('when-today').addEventListener('click', function () { addWhen = 'today'; renderAdd(); });
    $('when-yesterday').addEventListener('click', function () { addWhen = 'yesterday'; renderAdd(); });
    $('add-vakit').addEventListener('change', function () { data.lastPrayer = $('add-vakit').value; save(); });
    $('btn-add').addEventListener('click', doAdd);
    $('toast-undo').addEventListener('click', doUndo);

    $('cal-prev').addEventListener('click', function () {
      viewMonth = viewMonth.m === 0 ? { y: viewMonth.y - 1, m: 11 } : { y: viewMonth.y, m: viewMonth.m - 1 };
      renderCalendar();
    });
    $('cal-next').addEventListener('click', function () {
      viewMonth = viewMonth.m === 11 ? { y: viewMonth.y + 1, m: 0 } : { y: viewMonth.y, m: viewMonth.m + 1 };
      renderCalendar();
    });
    $('cal-grid').addEventListener('click', function (e) {
      var btn = e.target.closest('.cal-cell');
      if (!btn || btn.disabled) return;
      var ds = btn.dataset.date;
      selected = (selected === ds) ? null : ds;
      editing = false;
      renderCalendar();
      renderDetail();
      if (selected) $('detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    $('btn-edit').addEventListener('click', function () { editing = true; renderDetail(); });
    $('btn-cancel').addEventListener('click', function () { editing = false; renderDetail(); });
    $('btn-save').addEventListener('click', saveEdit);
    $('btn-close').addEventListener('click', function () { selected = null; editing = false; renderCalendar(); renderDetail(); });

    $('btn-backup').addEventListener('click', function () {
      downloadBackup();
      renderSettings();
      showMsg('Yedek indirildi. Dosyayı WhatsApp ile kendinize de gönderebilirsiniz.', false);
    });
    $('btn-restore').addEventListener('click', function () { $('restore-file').click(); });
    $('restore-file').addEventListener('change', function (e) {
      handleRestoreFile(e.target.files[0]);
      e.target.value = '';
    });
    $('btn-base-save').addEventListener('click', saveBaselineFromSettings);

    // Uygulama gece yarısını aşıp açık kaldıysa tarihleri tazele
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !$('app').hidden) renderAll();
    });
  }

  function startApp() {
    var tp = C.parseDate(today());
    viewMonth = { y: tp.y, m: tp.m - 1 };
    selected = null;
    editing = false;
    showScreen('app');
    renderAll();
  }

  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    var had = !!navigator.serviceWorker.controller;
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (had && !reloading) { reloading = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').catch(function () { /* internetsiz mod olmadan da çalışır */ });
  }

  function init() {
    data = load();
    buildStatic();
    bindEvents();
    setupWelcome();
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) { /* yoksay */ }
    if (data.onboarded) startApp(); else { showScreen('welcome'); renderStorageWarn(); }
    registerWorker();
  }

  init();
})();
