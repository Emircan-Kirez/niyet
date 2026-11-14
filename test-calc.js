// Çalıştırma: node test-calc.js
const C = require('./calc.js');
const assert = require('assert');
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }
const rec = (o) => Object.assign(C.emptyCounts(), o);

t('3400 vakit = 1 yıl 6 ay 26 gün + 4 vakit', () => {
  const d = C.duration(3400);
  assert.deepStrictEqual([d.years, d.months, d.days, d.rem, d.totalDays], [1, 6, 26, 4, 566]);
});
t('tam bölünürse artan 0', () => assert.strictEqual(C.duration(3396).rem, 0));
t('toplam 0 hata vermez', () => {
  const d = C.duration(0);
  assert.deepStrictEqual([d.years, d.months, d.days, d.rem], [0, 0, 0, 0]);
});
t('360 gün = 1 yıl', () => {
  const d = C.duration(360 * 6);
  assert.deepStrictEqual([d.years, d.months, d.days], [1, 0, 0]);
});
t('29 gün + 1 gün = 1 ay', () => {
  assert.deepStrictEqual([C.duration(29 * 6).months, C.duration(30 * 6).months], [0, 1]);
});

t('toplam = baseline + günlük kayıtlar', () => {
  const data = { baseline: rec({ sabah: 100, ogle: 90 }), days: { '2026-11-10': rec({ sabah: 2, vitir: 1 }) } };
  const p = C.perVakitTotals(data);
  assert.strictEqual(p.sabah, 102); assert.strictEqual(p.ogle, 90); assert.strictEqual(p.vitir, 1);
  assert.strictEqual(C.grandTotal(data), 193);
});

const one = rec({ sabah: 1 });
function mk(dates) { const o = {}; dates.forEach(d => o[d] = one); return o; }

t('bugün kayıt yokken seri dünden sayılır', () => {
  assert.strictEqual(C.currentStreak(mk(['2026-11-09', '2026-11-10']), '2026-11-11'), 2);
});
t('bugün kayıt varsa bugün dahil', () => {
  assert.strictEqual(C.currentStreak(mk(['2026-11-10', '2026-11-11']), '2026-11-11'), 2);
});
t('dün de bugün de yoksa seri 0', () => {
  assert.strictEqual(C.currentStreak(mk(['2026-11-05']), '2026-11-11'), 0);
});
t('3 gün, boş gün, 3 gün -> 3; boşluğu doldurunca 7', () => {
  const base = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07'];
  assert.strictEqual(C.currentStreak(mk(base), '2026-11-07'), 3);
  assert.strictEqual(C.longestStreak(mk(base)), 3);
  const filled = base.concat('2026-11-04');
  assert.strictEqual(C.currentStreak(mk(filled), '2026-11-07'), 7);
  assert.strictEqual(C.longestStreak(mk(filled)), 7);
});
t('gün toplamı 0 olunca kayıtsız sayılır', () => {
  const days = mk(['2026-11-01', '2026-11-02', '2026-11-03']);
  days['2026-11-02'] = rec({});
  assert.strictEqual(C.longestStreak(days), 1);
});
t('en uzun seri silinince kısalır', () => {
  const d = mk(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  assert.strictEqual(C.longestStreak(d), 4);
  delete d['2026-11-03'];
  assert.strictEqual(C.longestStreak(d), 2);
});
t('yıl sınırı: 31 Aralık -> 1 Ocak seriyi bozmaz', () => {
  assert.strictEqual(C.longestStreak(mk(['2026-12-30', '2026-12-31', '2027-01-01'])), 3);
});
t('şubat 28/29 sınırı', () => {
  assert.strictEqual(C.longestStreak(mk(['2027-02-27', '2027-02-28', '2027-03-01'])), 3);
  assert.strictEqual(C.longestStreak(mk(['2028-02-28', '2028-02-29', '2028-03-01'])), 3);
});
t('yaz saati geçişi (Mart/Ekim) tarih farkını kaydırmaz', () => {
  assert.strictEqual(C.diffDays('2026-03-28', '2026-03-30'), 2);
  assert.strictEqual(C.diffDays('2026-10-24', '2026-10-26'), 2);
  assert.strictEqual(C.addDays('2026-10-25', 1), '2026-10-26');
});
t('isValidDate', () => {
  assert.ok(C.isValidDate('2026-02-28')); assert.ok(!C.isValidDate('2026-02-30'));
  assert.ok(!C.isValidDate('11-11-2026')); assert.ok(!C.isValidDate(null));
});

t('sanitize: geçerli yedek aynen geçer', () => {
  const src = { version: 1, baseline: rec({ sabah: 5 }), days: { '2026-11-10': rec({ ogle: 2 }) }, lastBackup: '2026-11-08', lastPrayer: 'yatsi', onboarded: true, since: '2026-11-01' };
  const s = C.sanitize(JSON.parse(JSON.stringify(src)));
  assert.deepStrictEqual(s, src);
});
t('sanitize: bozuk dosyalar reddedilir', () => {
  assert.strictEqual(C.sanitize(null), null);
  assert.strictEqual(C.sanitize([]), null);
  assert.strictEqual(C.sanitize({ days: 'x' }), null);
  assert.strictEqual(C.sanitize({ days: { 'bozuk': {} } }), null);
  assert.strictEqual(C.sanitize({ days: { '2026-11-10': { sabah: -3 } } }), null);
  assert.strictEqual(C.sanitize({ baseline: { sabah: 'abc' } }), null);
  assert.strictEqual(C.sanitize({ baseline: { sabah: 2.5 } }), null);
});
t('sanitize: boş obje geçerli (boş veri)', () => assert.ok(C.sanitize({})));
t('summarize', () => {
  const s = C.summarize({ baseline: C.emptyCounts(), days: { '2026-11-03': one, '2026-11-01': one } });
  assert.deepStrictEqual([s.dayCount, s.lastDate, s.total], [2, '2026-11-03', 2]);
});

t('parseBackup: gidiş-dönüş', () => {
  const d = C.emptyData(); d.baseline.sabah = 7; d.days['2026-11-10'] = rec({ ogle: 3 });
  const r = C.parseBackup(JSON.stringify(C.toBackup(d)));
  assert.ok(r.ok); assert.strictEqual(r.data.baseline.sabah, 7); assert.strictEqual(r.data.days['2026-11-10'].ogle, 3);
});
t('parseBackup: alakasız/bozuk dosyalar reddedilir', () => {
  assert.ok(!C.parseBackup('merhaba').ok);
  assert.ok(!C.parseBackup('{"foo":1}').ok);
  assert.ok(!C.parseBackup('[]').ok);
  assert.ok(!C.parseBackup('{"app":"niyet","days":{"2026-13-40":{"sabah":1}}}').ok);
  assert.ok(!C.parseBackup('{"app":"niyet","version":9}').ok);
});

// Performans: 10 yıl
t('10 yıllık veri hesabı hızlı', () => {
  const days = {}; let d = '2017-01-01';
  for (let i = 0; i < 3650; i++) { days[d] = rec({ sabah: 1, ogle: 1 }); d = C.addDays(d, 1); }
  const t0 = Date.now();
  C.grandTotal({ baseline: C.emptyCounts(), days }); C.longestStreak(days); C.currentStreak(days, C.prevDay(d));
  assert.ok(Date.now() - t0 < 100, 'çok yavaş');
});

console.log('\n' + n + ' test geçti');
