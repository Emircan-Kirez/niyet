/* Niyet - hesap fonksiyonları (arayüzden bağımsız, saf fonksiyonlar)
 * Tarayıcıda window.NiyetCalc, Node'da module.exports olarak kullanılır.
 */
(function (root) {
  'use strict';

  var VAKITLER = [
    { key: 'sabah', label: 'Sabah' },
    { key: 'ogle', label: 'Öğle' },
    { key: 'ikindi', label: 'İkindi' },
    { key: 'aksam', label: 'Akşam' },
    { key: 'yatsi', label: 'Yatsı' },
    { key: 'vitir', label: 'Vitir' }
  ];
  var KEYS = VAKITLER.map(function (v) { return v.key; });

  var GUN_AY = 30;      // 1 ay = 30 gün
  var AY_YIL = 12;      // 1 yıl = 12 ay (360 gün)
  var VAKIT_GUN = 6;    // 1 gün = 6 vakit

  /* ---------- Tarih yardımcıları (YYYY-MM-DD metni) ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function parseDate(str) {
    var p = String(str).split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }

  function toUTC(str) {
    var p = parseDate(str);
    return Date.UTC(p.y, p.m - 1, p.d);
  }

  function fromUTC(ms) {
    var dt = new Date(ms);
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  function addDays(str, n) {
    return fromUTC(toUTC(str) + n * 86400000);
  }

  function prevDay(str) { return addDays(str, -1); }

  function diffDays(a, b) { // b - a (gün)
    return Math.round((toUTC(b) - toUTC(a)) / 86400000);
  }

  function isValidDate(str) {
    if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    return fromUTC(toUTC(str)) === str;
  }

  // Yerel saate göre bugünün tarihi
  function todayStr(now) {
    var d = now || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ---------- Toplamlar ve süre ---------- */

  function emptyCounts() {
    var o = {};
    KEYS.forEach(function (k) { o[k] = 0; });
    return o;
  }

  function dayTotal(day) {
    var t = 0;
    if (!day) return t;
    KEYS.forEach(function (k) { t += (day[k] | 0); });
    return t;
  }

  function dayDone(day) { return dayTotal(day) > 0; }

  // Her vaktin toplamı: önceki toplam + günlük kayıtlar
  function perVakitTotals(data) {
    var out = emptyCounts();
    var base = (data && data.baseline) || {};
    var days = (data && data.days) || {};
    KEYS.forEach(function (k) { out[k] = base[k] | 0; });
    Object.keys(days).forEach(function (date) {
      KEYS.forEach(function (k) { out[k] += (days[date][k] | 0); });
    });
    return out;
  }

  function grandTotal(data) {
    var per = perVakitTotals(data);
    var t = 0;
    KEYS.forEach(function (k) { t += per[k]; });
    return t;
  }

  // Toplam vakit -> gün + artan vakit + yıl/ay/gün
  function duration(totalVakit) {
    var days = Math.floor(totalVakit / VAKIT_GUN);
    var rem = totalVakit - days * VAKIT_GUN;
    var yilGun = GUN_AY * AY_YIL;
    var years = Math.floor(days / yilGun);
    var left = days - years * yilGun;
    var months = Math.floor(left / GUN_AY);
    var d = left - months * GUN_AY;
    return { totalDays: days, rem: rem, years: years, months: months, days: d };
  }

  /* ---------- Seri ---------- */

  // Bugün kayıt yoksa saymaya dünden başlar.
  function currentStreak(days, today) {
    var d = dayDone(days[today]) ? today : prevDay(today);
    var n = 0;
    while (dayDone(days[d])) { n++; d = prevDay(d); }
    return n;
  }

  // Kayıtlı (kıldı sayılan) günleri sıralayıp art arda blokların en uzununu alır.
  function longestStreak(days) {
    var list = Object.keys(days).filter(function (d) { return dayDone(days[d]); }).sort();
    var best = 0, run = 0, prev = null;
    list.forEach(function (d) {
      if (prev !== null && diffDays(prev, d) === 1) run++; else run = 1;
      if (run > best) best = run;
      prev = d;
    });
    return best;
  }

  /* ---------- Yedek ve doğrulama ---------- */

  function emptyData() {
    return { version: 1, baseline: emptyCounts(), days: {}, lastBackup: null, lastPrayer: 'sabah', onboarded: false, since: null };
  }

  // Bilinmeyen/bozuk veriyi güvenli bir yapıya çevirir; geçersizse null döner.
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.days !== undefined && (typeof raw.days !== 'object' || raw.days === null || Array.isArray(raw.days))) return null;
    if (raw.baseline !== undefined && (typeof raw.baseline !== 'object' || raw.baseline === null)) return null;
    var out = emptyData();
    var ok = true;
    function num(v) {
      var n = Number(v);
      if (!isFinite(n) || n < 0 || n !== Math.floor(n) || n > 1000000) { ok = false; return 0; }
      return n;
    }
    KEYS.forEach(function (k) {
      if (raw.baseline && raw.baseline[k] !== undefined) out.baseline[k] = num(raw.baseline[k]);
    });
    var days = raw.days || {};
    Object.keys(days).forEach(function (date) {
      if (!isValidDate(date) || typeof days[date] !== 'object' || days[date] === null) { ok = false; return; }
      var rec = emptyCounts();
      KEYS.forEach(function (k) { if (days[date][k] !== undefined) rec[k] = num(days[date][k]); });
      if (dayTotal(rec) > 0) out.days[date] = rec;
    });
    if (!ok) return null;
    if (raw.lastBackup && isValidDate(raw.lastBackup)) out.lastBackup = raw.lastBackup;
    if (KEYS.indexOf(raw.lastPrayer) !== -1) out.lastPrayer = raw.lastPrayer;
    if (raw.since && isValidDate(raw.since)) out.since = raw.since;
    out.onboarded = raw.onboarded === true;
    return out;
  }

  // Yedek dosyası metnini doğrular. Başarılıysa {ok:true,data}, değilse {ok:false,error}.
  function parseBackup(text) {
    var raw;
    try { raw = JSON.parse(text); }
    catch (e) { return { ok: false, error: 'Dosya okunamadı. Bu bir Niyet yedeği değil.' }; }
    if (!raw || raw.app !== 'niyet') return { ok: false, error: 'Bu dosya bir Niyet yedeği değil. Hiçbir şey değişmedi.' };
    if (typeof raw.version === 'number' && raw.version > 1) return { ok: false, error: 'Bu yedek daha yeni bir sürümden. Hiçbir şey değişmedi.' };
    var d = sanitize(raw);
    if (!d) return { ok: false, error: 'Yedek dosyası bozuk görünüyor. Hiçbir şey değişmedi.' };
    d.onboarded = true;
    return { ok: true, data: d };
  }

  function toBackup(data) {
    var o = JSON.parse(JSON.stringify(data));
    o.app = 'niyet';
    return o;
  }

  // Yedek özeti: kaç gün kayıt, son kayıt hangi gün
  function summarize(data) {
    var list = Object.keys(data.days).sort();
    return { dayCount: list.length, lastDate: list.length ? list[list.length - 1] : null, total: grandTotal(data) };
  }

  var api = {
    VAKITLER: VAKITLER, KEYS: KEYS,
    parseDate: parseDate, addDays: addDays, prevDay: prevDay, diffDays: diffDays,
    isValidDate: isValidDate, todayStr: todayStr,
    emptyCounts: emptyCounts, dayTotal: dayTotal, dayDone: dayDone,
    perVakitTotals: perVakitTotals, grandTotal: grandTotal, duration: duration,
    currentStreak: currentStreak, longestStreak: longestStreak,
    emptyData: emptyData, sanitize: sanitize, summarize: summarize,
    parseBackup: parseBackup, toBackup: toBackup
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NiyetCalc = api;
})(typeof window !== 'undefined' ? window : this);
