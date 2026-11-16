const $ = id => document.getElementById(id);

let loaderTimer = setTimeout(() => fatal('timeout: no response from server'), 25000);
function hideLoader() { clearTimeout(loaderTimer); $('app-loader').classList.add('hidden'); }
function fatal(msg) {
  const l = $('app-loader');
  if (l.classList.contains('hidden')) return;
  const hint = /Failed to fetch|NetworkError|Load failed|timeout/i.test(msg)
    ? 'تعذر الاتصال بالسكريبت: تأكد أن الوصول = Anyone، وأنك عملت إصدار جديد (New version)، وأن API_URL صحيح.' : '';
  l.innerHTML = '<div class="max-w-sm text-center p-4"><p class="font-extrabold text-rose-600 mb-2">تعذر تشغيل النظام</p><p id="fm" class="text-xs text-slate-600 break-words" dir="ltr"></p><p id="fh" class="text-xs text-slate-500 mt-3"></p></div>';
  $('fm').textContent = msg; $('fh').textContent = hint;
}

const API_URL = 'https://script.google.com/macros/s/AKfycbx1otQoRprzJfcsQwu50E82sKwsquIXY8Ec3Te8zERcNJy2ZpyABYyTWyts2HFEDndg/exec';

const urlParams = new URLSearchParams(location.search);
const requestedSessionId = urlParams.get('sid');
const isStudentLink = Boolean(requestedSessionId);
const isAdminMode = urlParams.get('admin') === '1';
const appId = 'attendance-system-v3';

let sessionsList = [], counts = {}, records = [];
let selectedAdminSessionId = null, activeStudentSession = null, closeTimer = null;

async function api(body, ms = 40000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'api_error');
    return j;
  } catch (e) { if (e.name === 'AbortError') throw new Error('timeout'); throw e; }
  finally { clearTimeout(t); }
}
async function busy(btn, label, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const NO_RETRY = ['duplicate', 'closed', 'invalid_name', 'device_used', 'not_found'];

async function apiRetry(body, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await api(body); }
    catch (err) {
      if (NO_RETRY.includes(err.message) || i >= tries) throw err;
      await sleep(1000 * i + Math.random() * 2000);
    }
  }
}

async function submitWithRetry(body) {
  await sleep(Math.random() * 3000);
  let ambiguous = false;
  for (let i = 1; i <= 10; i++) {
    try { await api(body); return; }
    catch (err) {
      const m = err.message;
      if (ambiguous && (m === 'duplicate' || m === 'device_used')) return;
      if (NO_RETRY.includes(m) || i === 10) throw err;
      ambiguous = true;
      submitText.textContent = `الضغط عالي، جاري المحاولة (${i})...`;
      await sleep(1500 * i + Math.random() * 3000);
    }
  }
}

function baseUrl() { const u = new URL(location.href); u.search = ''; u.hash = ''; return u.toString(); }
function studentUrl(id) { const u = new URL(baseUrl()); u.searchParams.set('sid', id); return u.toString(); }

const lockKey = sid => `att_locked_${appId}_${sid}`;
function getSaved(sid) { try { const r = localStorage.getItem(lockKey(sid)); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveReg(sid, d) { try { localStorage.setItem(lockKey(sid), JSON.stringify(d)); } catch {} }
function getDeviceId() {
  let id = null;
  try { id = localStorage.getItem('att_device_id'); } catch {}
  if (!id) { const m = document.cookie.match(/(?:^|; )att_device_id=([^;]+)/); if (m) id = m[1]; }
  if (!id) id = 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  try { localStorage.setItem('att_device_id', id); } catch {}
  document.cookie = 'att_device_id=' + id + ';max-age=31536000;path=/;SameSite=Lax';
  return id;
}

function showToast(message, type = 'success') {
  const colors = { success: 'bg-teal-800', error: 'bg-rose-600', info: 'bg-academic-900' };
  const t = document.createElement('div');
  t.className = `pointer-events-auto px-4 py-3 rounded-2xl shadow-xl text-white text-sm font-bold fade-in max-w-md ${colors[type] || colors.info}`;
  t.textContent = message;
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    t.remove();
    if (!ok) { showToast('تعذر النسخ التلقائي', 'error'); return; }
  }
  showToast(msg || 'تم النسخ!', 'success');
}
function confirmDialog(title, message) {
  return new Promise(resolve => {
    const m = $('confirm-modal'), ok = $('confirm-ok-btn'), no = $('confirm-cancel-btn');
    $('confirm-title').textContent = title; $('confirm-message').textContent = message;
    m.classList.remove('hidden');
    const done = r => { m.classList.add('hidden'); ok.removeEventListener('click', onOk); no.removeEventListener('click', onNo); resolve(r); };
    const onOk = () => done(true), onNo = () => done(false);
    ok.addEventListener('click', onOk); no.addEventListener('click', onNo);
  });
}
function fmtTime(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return iso; }
}
const fmtHM = ms => new Date(ms).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
const normName = n => (n || '').trim().replace(/\s+/g, ' ').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const esc = s => !s ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const findSession = id => sessionsList.find(s => s.id === id);

// ===== بحث مرن: الهمزات / ة ه / ى ي / التشكيل / الأرقام / المسافات =====
const fold = n => String(n || '')
  .replace(/[\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ء/g, '')
  .replace(/ة/g, 'ه').replace(/[ىئیې]/g, 'ي').replace(/ؤ/g, 'و').replace(/ک/g, 'ك')
  .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  .toLowerCase().trim().replace(/\s+/g, ' ');
const matchName = (name, q) => {
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return true;
  const key = fold(name).replace(/ /g, '');
  return words.every(w => key.includes(w));
};

// ===== التاريخ والوقت =====
const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DOW_SHORT = ['أحد', 'اثنين', 'ثلاث', 'أربع', 'خميس', 'جمعة', 'سبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function t12(hm) { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'ص' : 'م'}`; }
function buildSessionDate(iso, hm) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DAYS[new Date(y, m - 1, d).getDay()]} ${d}/${m}/${y}` + (hm ? ` - ${t12(hm)}` : '');
}
function parseSessionDate(str) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str || '');
  if (!m) return { iso: '', hm: '' };
  const t = /(\d{1,2}):(\d{2}) (ص|م)/.exec(str || '');
  let hm = '';
  if (t) { let h = Number(t[1]) % 12; if (t[3] === 'م') h += 12; hm = `${pad(h)}:${t[2]}`; }
  return { iso: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, hm };
}
function splitSession(str) {
  const i = (str || '').indexOf(' - ');
  return i < 0 ? { date: str || '', time: '' } : { date: str.slice(0, i), time: str.slice(i + 3) };
}

// ===== منتقي التاريخ (تقويم) والوقت (ساعة) =====
const pickerModal = $('picker-modal'), pickerBox = $('picker-box');
const XBTN = '<button type="button" data-x class="w-9 h-9 rounded-full bg-slate-100 text-slate-500">✕</button>';

function openPicker(render, onClick) {
  return new Promise(resolve => {
    const close = v => { pickerModal.classList.add('hidden'); pickerModal.onclick = null; pickerBox.onclick = null; resolve(v); };
    pickerModal.onclick = e => { if (e.target === pickerModal) close(null); };
    pickerBox.onclick = e => onClick(e, close);
    render();
    pickerModal.classList.remove('hidden');
  });
}

function pickDate(initIso) {
  const base = initIso ? new Date(initIso + 'T00:00:00') : new Date();
  let vy = base.getFullYear(), vm = base.getMonth(), sel = initIso || '';
  const today = todayISO();
  const draw = () => {
    const first = new Date(vy, vm, 1).getDay(), dim = new Date(vy, vm + 1, 0).getDate();
    let cells = '<span></span>'.repeat(first);
    for (let d = 1; d <= dim; d++) {
      const iso = `${vy}-${pad(vm + 1)}-${pad(d)}`;
      cells += `<button type="button" data-d="${iso}" class="pk-day ${iso === sel ? 'on' : ''} ${iso === today ? 'today' : ''}">${d}</button>`;
    }
    pickerBox.innerHTML = `
      <div class="flex items-center justify-between mb-3"><h3 class="font-extrabold text-lg text-academic-900">اختر التاريخ</h3>${XBTN}</div>
      <div class="flex items-center justify-between mb-3">
        <button type="button" data-nav="-1" class="pk-nav">→</button>
        <div class="font-extrabold text-academic-900">${MONTHS[vm]} ${vy}</div>
        <button type="button" data-nav="1" class="pk-nav">←</button>
      </div>
      <div class="pk-grid7 mb-1">${DOW_SHORT.map(d => `<div class="pk-dow">${d}</div>`).join('')}</div>
      <div class="pk-grid7">${cells}</div>
      <div class="flex gap-3 mt-5">
        <button type="button" data-today class="btn-g flex-1 py-3">النهاردة</button>
        <button type="button" data-ok class="btn-p flex-1 py-3">تم</button>
      </div>`;
  };
  return openPicker(draw, (e, close) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-x')) return close(null);
    if (t.dataset.nav) { vm += Number(t.dataset.nav); if (vm < 0) { vm = 11; vy--; } if (vm > 11) { vm = 0; vy++; } return draw(); }
    if (t.dataset.d) { sel = t.dataset.d; return draw(); }
    if (t.hasAttribute('data-today')) return close(todayISO());
    if (t.hasAttribute('data-ok')) return close(sel || todayISO());
  });
}

function pickTime(initHM) {
  const [H0, M0] = (initHM || nowHM()).split(':').map(Number);
  let h = H0 % 12 || 12, m = M0, pm = H0 >= 12, step = 'h';
  const draw = () => {
    const cells = step === 'h'
      ? Array.from({ length: 12 }, (_, i) => i + 1).map(v => `<button type="button" data-h="${v}" class="pk-cell ${v === h ? 'on' : ''}">${v}</button>`).join('')
      : Array.from({ length: 12 }, (_, i) => i * 5).map(v => `<button type="button" data-m="${v}" class="pk-cell ${v === m ? 'on' : ''}">${pad(v)}</button>`).join('');
    pickerBox.innerHTML = `
      <div class="flex items-center justify-between"><h3 class="font-extrabold text-lg text-academic-900">اختر الوقت</h3>${XBTN}</div>
      <div class="pk-disp"><button type="button" data-step="h" class="${step === 'h' ? 'act' : ''}">${h}</button><span>:</span><button type="button" data-step="m" class="${step === 'm' ? 'act' : ''}">${pad(m)}</button></div>
      <div class="flex gap-2 mb-4"><button type="button" data-ap="0" class="pk-ap ${!pm ? 'on' : ''}">ص</button><button type="button" data-ap="1" class="pk-ap ${pm ? 'on' : ''}">م</button></div>
      <p class="text-xs font-bold text-slate-400 text-center mb-2">${step === 'h' ? 'اختار الساعة' : 'اختار الدقائق'}</p>
      <div class="pk-cells">${cells}</div>
      <div class="flex gap-3 mt-5">
        <button type="button" data-now class="btn-g flex-1 py-3">الآن</button>
        <button type="button" data-ok class="btn-p flex-1 py-3">تم</button>
      </div>`;
  };
  const result = () => `${pad((h % 12) + (pm ? 12 : 0))}:${pad(m)}`;
  return openPicker(draw, (e, close) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-x')) return close(null);
    if (t.dataset.step) { step = t.dataset.step; return draw(); }
    if (t.dataset.ap) { pm = t.dataset.ap === '1'; return draw(); }
    if (t.dataset.h) { h = Number(t.dataset.h); step = 'm'; return draw(); }
    if (t.dataset.m) { m = Number(t.dataset.m); return draw(); }
    if (t.hasAttribute('data-now')) return close(nowHM());
    if (t.hasAttribute('data-ok')) return close(result());
  });
}

// ===== Student view =====
function renderStudentView() {
  hideLoader();
  clearTimeout(closeTimer);
  $('student-mode-wrapper').classList.remove('hidden');
  const formCard = $('student-form-card'), receipt = $('student-receipt-card'), closed = $('student-closed-card'), dl = $('student-deadline');
  [formCard, receipt, closed, dl].forEach(c => c.classList.add('hidden'));
  const s = activeStudentSession;
  if (!s) {
    $('student-course-name').textContent = 'غير متاح'; $('student-session-date').textContent = '--';
    $('student-session-time-wrap').classList.add('hidden');
    $('closed-title').textContent = 'الرابط غير صحيح أو المحاضرة غير موجودة';
    $('closed-message').textContent = 'يرجى الحصول على رابط الحضور الصحيح من المحاضر.';
    closed.classList.remove('hidden'); return;
  }
  const sp = splitSession(s.sessionDate);
  $('student-course-name').textContent = s.courseName;
  $('student-session-date').textContent = sp.date;
  const tw = $('student-session-time-wrap');
  if (sp.time) { $('student-session-time').textContent = sp.time; tw.classList.remove('hidden'); } else tw.classList.add('hidden');
  document.title = `تسجيل حضور - ${s.courseName} (${s.sessionDate})`;
  const saved = getSaved(s.id);
  if (saved) {
    $('receipt-badge-text').textContent = 'تم تسجيل حضورك';
    $('receipt-name').textContent = saved.studentName;
    $('receipt-course').textContent = s.courseName;
    $('receipt-date').textContent = s.sessionDate;
    $('receipt-time').textContent = fmtTime(saved.timestamp);
    receipt.classList.remove('hidden'); return;
  }
  if (s.isOpen === false) {
    $('closed-title').textContent = 'تم إغلاق تسجيل الحضور';
    $('closed-message').textContent = `انتهى وقت التسجيل لمحاضرة "${s.courseName}".`;
    closed.classList.remove('hidden'); return;
  }
  if (s.closeAtMs) {
    dl.textContent = `⏳ التسجيل متاح حتى ${fmtHM(s.closeAtMs)}`; dl.classList.remove('hidden');
    const left = s.closeAtMs - Date.now();
    if (left > 0 && left < 2147483000) closeTimer = setTimeout(() => { activeStudentSession = { ...s, isOpen: false }; renderStudentView(); }, left + 500);
  }
  formCard.classList.remove('hidden');
}

// ===== اختيار الاسم من الكشف =====
const nameErr = $('name-error');
const submitBtn = $('submit-btn'), submitText = $('submit-btn-text');
let rosterNames = [], takenSet = new Set(), pickedIdx = null;

async function loadRoster() {
  const j = await apiRetry({ action: 'roster', sid: activeStudentSession.id });
  rosterNames = j.names || []; takenSet = new Set(j.taken || []); pickedIdx = null;
  $('picked-label').classList.add('hidden');
  renderNameList();
}
function renderNameList() {
  const q = $('student-search').value;
  $('student-clear').classList.toggle('hidden', !q);
  const box = $('name-list'), keep = box.scrollTop;
  $('student-stats').textContent = rosterNames.length ? `${takenSet.size} سجّلوا من ${rosterNames.length}` : '';
  if (!rosterNames.length) { box.innerHTML = '<div class="p-6 text-center text-sm text-slate-400">الكشف لسه ماترفعش، كلم المحاضر.</div>'; return; }
  const items = rosterNames.map((n, i) => ({ n, i })).filter(x => matchName(x.n, q));
  if (!items.length) { box.innerHTML = '<div class="p-8 text-center text-sm text-slate-400">مفيش اسم بالشكل ده، جرب تكتب جزء تاني من اسمك</div>'; return; }
  box.innerHTML = items.map(({ n, i }) => {
    const taken = takenSet.has(i), sel = i === pickedIdx;
    return `<button type="button" data-i="${i}" ${taken ? 'disabled' : ''} class="row ${taken ? 'row-taken' : sel ? 'row-sel' : ''}">
      <span class="num">${i + 1}</span>
      <span class="flex-1 text-right leading-6">${esc(n)}</span>
      ${taken ? '<span class="tag-taken">تم التسجيل</span>' : sel ? '<span class="chk">✓</span>' : '<span class="ring-empty"></span>'}</button>`;
  }).join('');
  box.scrollTop = keep;
}
$('student-search').addEventListener('input', renderNameList);
$('student-clear').addEventListener('click', () => { $('student-search').value = ''; renderNameList(); $('student-search').focus(); });
$('name-list').addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if (!b || b.disabled) return;
  pickedIdx = Number(b.dataset.i); nameErr.classList.add('hidden');
  const pl = $('picked-label');
  pl.textContent = `اخترت: ${rosterNames[pickedIdx]}`; pl.classList.remove('hidden');
  renderNameList();
});

$('attendance-form').addEventListener('submit', async e => {
  e.preventDefault();
  const s = activeStudentSession;
  if (!s || s.isOpen === false) { showToast('التسجيل مغلق لهذه المحاضرة.', 'error'); return; }
  if (getSaved(s.id)) { renderStudentView(); return; }
  if (pickedIdx === null) { nameErr.textContent = 'اختار اسمك من القائمة.'; nameErr.classList.remove('hidden'); return; }
  const name = rosterNames[pickedIdx];
  if (!await confirmDialog('تأكيد الاسم', `هل أنت متأكد أن "${name}" هو اسمك؟ مش هتقدر تسجل اسم تاني بعد التأكيد.`)) return;
  submitBtn.disabled = true; submitText.textContent = 'جاري حفظ الحضور...';
  try {
    await submitWithRetry({ action: 'addRecord', sessionId: s.id, rosterIdx: pickedIdx, studentName: name, deviceId: getDeviceId() });
    saveReg(s.id, { studentName: name, rosterIdx: pickedIdx, timestamp: new Date().toISOString() });
    showToast('تم تسجيل حضورك بنجاح!');
    renderStudentView();
  } catch (err) {
    const m = { duplicate: 'الاسم ده اتسجل قبل كدا!', closed: 'التسجيل مغلق لهذه المحاضرة.', invalid_name: 'الكشف اتحدّث، اختار اسمك تاني.',
      device_used: 'تم التسجيل من هذا الجهاز مسبقاً لهذه المحاضرة.' };
    if (err.message === 'closed') { activeStudentSession = { ...s, isOpen: false }; renderStudentView(); }
    if (err.message === 'duplicate' || err.message === 'invalid_name') loadRoster().catch(() => {});
    showToast(m[err.message] || 'حدث خطأ أثناء التسجيل، حاول مرة أخرى.', 'error');
  } finally {
    submitBtn.disabled = false; submitText.textContent = 'تأكيد وتسجيل الحضور';
  }
});

// لو الأدمن حذف تسجيل الطالب، نمسح القفل من موبايله ونرجّعله القائمة
async function verifyRegistration() {
  const s = activeStudentSession, saved = s && getSaved(s.id);
  if (!saved) return;
  try {
    const j = await api({ action: 'roster', sid: s.id });
    const names = j.names || [];
    if (!names.length) return;
    const taken = new Set(j.taken || []);
    let idx = names.findIndex(n => normName(n) === normName(saved.studentName));
    if (idx < 0 && Number.isInteger(saved.rosterIdx)) idx = saved.rosterIdx;
    if (idx < 0 || !taken.has(idx)) {
      try { localStorage.removeItem(lockKey(s.id)); } catch {}
      renderStudentView();
      if (s.isOpen !== false) loadRoster().catch(() => {});
      showToast('تم إلغاء تسجيلك، تقدر تسجل من جديد', 'info');
    }
  } catch {}
}

// ===== Admin view =====
function renderAdminView() {
  hideLoader();
  $('admin-mode-wrapper').classList.remove('hidden');
  document.title = 'لوحة تحكم الأدمن';
  const sorted = [...sessionsList].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  if (!selectedAdminSessionId || !sorted.some(s => s.id === selectedAdminSessionId)) selectedAdminSessionId = sorted[0]?.id || null;
  renderSessionsGrid(sorted);
  renderRoster();
}

function renderSessionsGrid(sorted) {
  const grid = $('sessions-grid');
  if (!sorted.length) { grid.innerHTML = '<div class="col-span-full text-center py-10 text-slate-400 text-sm card">لا توجد مواد بعد. اضغط "+ محاضرة".</div>'; return; }
  grid.innerHTML = sorted.map(s => {
    const sel = s.id === selectedAdminSessionId, id = esc(s.id);
    const expired = s.rawOpen && !s.isOpen;
    const badge = s.isOpen ? '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">● مفتوح</span>'
      : `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200">${expired ? 'انتهى الوقت' : 'مغلق'}</span>`;
    const until = s.isOpen && s.closeAtMs ? `<div class="text-[11px] font-bold text-amber-700 mt-1.5">⏳ يقفل ${fmtHM(s.closeAtMs)}</div>` : '';
    return `<div data-select-session="${id}" class="cursor-pointer rounded-3xl p-4 border-2 flex flex-col gap-3 bg-white transition shadow-sm ${sel ? 'border-teal-500 ring-4 ring-teal-100' : 'border-transparent hover:border-slate-200'}">
      <div>
        <div class="flex items-start justify-between gap-2 mb-1.5"><h3 class="font-extrabold text-base text-academic-900 leading-6">${esc(s.courseName)}</h3>${badge}</div>
        <div class="flex items-center justify-between gap-2 text-xs text-slate-500 font-semibold">
          <span>📅 ${esc(s.sessionDate)}</span>
          <span class="font-extrabold bg-slate-100 px-2.5 py-0.5 rounded-lg shrink-0">${counts[s.id] || 0} حاضر</span>
        </div>${until}
      </div>
      <div class="pt-3 border-t border-slate-100 flex gap-1.5" data-stop>
        <button data-copy-session="${id}" class="flex-1 py-2 rounded-xl bg-academic-900 hover:bg-academic-800 text-white font-bold text-xs">رابط الطلاب</button>
        <button data-qr-session="${id}" class="px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold">QR</button>
        <button data-edit-session="${id}" class="px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold">تعديل</button>
        <button data-delete-session="${id}" class="px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold">حذف</button>
      </div></div>`;
  }).join('');

  grid.querySelectorAll('[data-stop]').forEach(el => el.addEventListener('click', e => e.stopPropagation()));
  grid.querySelectorAll('[data-select-session]').forEach(c => c.addEventListener('click', async () => {
    selectedAdminSessionId = c.dataset.selectSession; await loadAdminData();
  }));
  grid.querySelectorAll('[data-copy-session]').forEach(b => b.addEventListener('click', () => copyText(studentUrl(b.dataset.copySession), 'تم نسخ رابط الطلاب!')));
  grid.querySelectorAll('[data-qr-session]').forEach(b => b.addEventListener('click', () => openQr(b.dataset.qrSession)));
  grid.querySelectorAll('[data-edit-session]').forEach(b => b.addEventListener('click', () => openSessionModal(b.dataset.editSession)));
  grid.querySelectorAll('[data-delete-session]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.deleteSession, s = findSession(id);
    if (!await confirmDialog('حذف مادة / محاضرة', `هل أنت متأكد من حذف "${s?.courseName}" وكل أسماء طلابها؟`)) return;
    try { await api({ action: 'deleteSession', id }); await loadAdminData(); showToast('تم حذف المادة', 'info'); }
    catch (err) { showToast('تعذر حذف المادة', 'error'); }
  }));
}

let rosterList = [], adminFilter = 'all';
const pillCls = on => `px-4 py-2 rounded-full text-xs font-extrabold border transition ${on ? 'bg-academic-900 text-white border-academic-900' : 'bg-white text-slate-600 border-slate-200'}`;

function buildRows() {
  const byName = new Map(), used = new Set();
  records.forEach(r => byName.set(normName(r.studentName), r));
  const rows = rosterList.map((n, i) => { const r = byName.get(normName(n)) || null; if (r) used.add(r.id); return { no: i + 1, name: n, rec: r }; });
  records.filter(r => !used.has(r.id)).forEach((r, k) => rows.push({ no: rosterList.length + k + 1, name: r.studentName, rec: r, extra: true }));
  return rows;
}

function renderRoster() {
  const cur = findSession(selectedAdminSessionId), body = $('attendance-table-body');
  document.querySelectorAll('[data-filter]').forEach(b => b.className = pillCls(b.dataset.filter === adminFilter));
  if (!cur) { $('roster-session-title').textContent = 'لم يتم اختيار مادة'; $('roster-session-sub').textContent = ''; body.innerHTML = ''; return; }
  $('roster-session-title').textContent = cur.courseName;
  $('roster-session-sub').textContent = `📅 ${cur.sessionDate}`;
  const all = buildRows(), present = all.filter(x => x.rec).length, total = all.length;
  const pct = total ? Math.round(present / total * 100) : 0;
  $('st-present').textContent = present; $('st-absent').textContent = total - present; $('st-total').textContent = total;
  $('st-bar').style.width = pct + '%'; $('st-pct').textContent = pct + '%';
  const q = $('admin-search-input').value;
  const rows = all.filter(x => (adminFilter === 'all' || (adminFilter === 'present') === !!x.rec) && matchName(x.name, q));
  if (!rows.length) { body.innerHTML = '<div class="py-12 text-center text-slate-400 font-bold">مفيش نتائج</div>'; return; }
  body.innerHTML = rows.map(x => `<div class="flex items-center gap-2 px-3 py-2.5 ${x.rec ? 'bg-emerald-50/60' : ''}">
    <span class="w-9 text-center text-xs font-extrabold text-slate-400">${x.no}</span>
    <span class="flex-1 font-bold leading-6 ${x.rec ? 'text-slate-800' : 'text-slate-500'}">${esc(x.name)}${x.extra ? ' <span class="text-[10px] text-amber-600">(يدوي)</span>' : ''}</span>
    <span class="w-12 text-center">${x.rec ? '<span class="inline-flex w-7 h-7 items-center justify-center rounded-full bg-emerald-500 text-white font-extrabold">✓</span>' : '<span class="text-slate-300">—</span>'}</span>
    <span class="hidden sm:block w-20 text-center text-[11px] font-semibold text-slate-500">${x.rec ? fmtTime(x.rec.timestamp) : ''}</span>
    <span class="w-14 text-center">${x.rec ? `<button data-del-rec="${esc(x.rec.id)}" class="text-rose-500 text-xs font-bold px-1.5 py-1 rounded-lg hover:bg-rose-50">حذف</button>`
      : `<button data-add-rec="${x.no - 1}" class="text-emerald-600 text-xs font-bold px-1.5 py-1 rounded-lg hover:bg-emerald-50">تسجيل</button>`}</span></div>`).join('');
  body.querySelectorAll('[data-del-rec]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.delRec, rec = records.find(r => r.id === id);
    if (!await confirmDialog('حذف اسم طالب', `هل تريد حذف "${rec?.studentName || ''}" من الكشف؟`)) return;
    try { await api({ action: 'deleteRecord', id }); await loadAdminData(); showToast('تم حذف الاسم', 'info'); }
    catch { showToast('حدث خطأ أثناء الحذف', 'error'); }
  }));
  body.querySelectorAll('[data-add-rec]').forEach(btn => btn.addEventListener('click', async () => {
    const name = rosterList[Number(btn.dataset.addRec)];
    if (!await confirmDialog('تسجيل حضور يدوي', `تسجيل "${name}" حاضر؟`)) return;
    try { await api({ action: 'adminAddRecord', sessionId: selectedAdminSessionId, studentName: name }); await loadAdminData(); showToast('تم التسجيل'); }
    catch { showToast('تعذر التسجيل', 'error'); }
  }));
}
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { adminFilter = b.dataset.filter; renderRoster(); }));

async function loadAdminData() {
  let j = await api({ action: 'adminList', sid: selectedAdminSessionId || '' });
  if (!selectedAdminSessionId || !j.sessions.some(x => x.id === selectedAdminSessionId)) {
    const newest = [...j.sessions].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))[0];
    selectedAdminSessionId = newest ? newest.id : null;
    if (selectedAdminSessionId) j = await api({ action: 'adminList', sid: selectedAdminSessionId });
  }
  if (!rosterList.length) { try { rosterList = (await api({ action: 'roster', sid: selectedAdminSessionId || '' })).names || []; } catch {} }
  sessionsList = j.sessions; counts = j.counts || {}; records = j.records;
  renderAdminView();
}

$('copy-student-link-header-btn').addEventListener('click', () => { if (selectedAdminSessionId) copyText(studentUrl(selectedAdminSessionId), 'تم نسخ رابط الطلاب!'); });
$('admin-search-input').addEventListener('input', renderRoster);

// ===== التصدير =====
const safeFile = s => String(s).replace(/\s+/g, '_').replace(/[\/\\:*?"<>|]/g, '-');
const exportRows = () => buildRows().map(x => [x.no, x.name, x.rec ? 'حاضر' : 'غائب', x.rec ? fmtTime(x.rec.timestamp) : '']);

$('export-excel-btn').addEventListener('click', () => {
  const cur = findSession(selectedAdminSessionId); if (!cur) return;
  if (!window.XLSX) { showToast('مكتبة Excel لم تُحمّل، تأكد من الإنترنت', 'error'); return; }
  const ws = XLSX.utils.aoa_to_sheet([['م', 'اسم الطالب', 'الحالة', 'وقت التسجيل'], ...exportRows()]);
  ws['!cols'] = [{ wch: 5 }, { wch: 44 }, { wch: 10 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'الحضور');
  const name = `حضور_${safeFile(cur.courseName)}_${safeFile(cur.sessionDate)}.xlsx`;
  XLSX.writeFile(wb, name);
  showToast(`تم تنزيل الملف: ${name}`);
});

$('export-pdf-btn').addEventListener('click', () => {
  const cur = findSession(selectedAdminSessionId); if (!cur) return;
  const w = window.open('', '_blank');
  if (!w) { showToast('المتصفح منع النافذة، اسمح بالنوافذ المنبثقة', 'error'); return; }
  const all = buildRows(), present = all.filter(x => x.rec).length;
  const rows = all.map(x => `<tr class="${x.rec ? '' : 'a'}"><td>${x.no}</td><td class="n">${esc(x.name)}</td><td>${x.rec ? '✓' : ''}</td><td>${x.rec ? fmtTime(x.rec.timestamp) : ''}</td></tr>`).join('');
  w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${esc(cur.courseName)} ${esc(cur.sessionDate)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Cairo',sans-serif;padding:20px;color:#0f2942}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:#475569;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:4px 8px;text-align:center}th{background:#e2e8f0}td.n{text-align:right}tr.a td{color:#94a3b8}tr{page-break-inside:avoid}</style></head><body>
  <h1>كشف حضور: ${esc(cur.courseName)}</h1><p>${esc(cur.sessionDate)} | حاضر: ${present} | غائب: ${all.length - present} | الإجمالي: ${all.length}</p>
  <table><thead><tr><th style="width:40px">م</th><th>اسم الطالب</th><th style="width:50px">حضور</th><th style="width:90px">الوقت</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 900);
  showToast('اختار "حفظ كملف PDF" من شاشة الطباعة', 'info');
});

$('copy-whatsapp-btn').addEventListener('click', () => {
  const cur = findSession(selectedAdminSessionId); if (!cur) return;
  const pr = buildRows().filter(x => x.rec);
  if (!pr.length) { showToast('مفيش حاضرين لسه', 'error'); return; }
  copyText(`📋 كشف حضور: ${cur.courseName}\n📅 ${cur.sessionDate}\nالحاضرين: ${pr.length}\n------------------------\n` + pr.map(x => `${x.no}. ${x.name}`).join('\n'), 'تم نسخ الحاضرين!');
});

// ===== Add student (admin) =====
const addModal = $('add-modal');
$('add-student-btn').addEventListener('click', () => {
  if (!selectedAdminSessionId) { showToast('اختار مادة الأول', 'error'); return; }
  $('add-name-input').value = ''; addModal.classList.remove('hidden'); $('add-name-input').focus();
});
$('add-cancel-btn').addEventListener('click', () => addModal.classList.add('hidden'));
$('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('add-name-input').value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  const btn = $('add-ok-btn'); btn.disabled = true;
  try {
    await api({ action: 'adminAddRecord', sessionId: selectedAdminSessionId, studentName: name });
    addModal.classList.add('hidden');
    await loadAdminData(); showToast('تمت إضافة الطالب');
  } catch (err) {
    showToast(err.message === 'duplicate' ? 'الاسم موجود بالفعل في الكشف' : 'تعذرت الإضافة', 'error');
  } finally { btn.disabled = false; }
});

// ===== Session modal =====
const sessionModal = $('session-modal');
let closeMode = 'none', sDate = '', sTime = '', sClose = '';

function refreshSessionLabels() {
  $('session-date-btn').innerHTML = `<span>${sDate ? buildSessionDate(sDate, '') : 'اختار التاريخ'}</span><span>📅</span>`;
  $('session-time-btn').innerHTML = `<span>${sTime ? t12(sTime) : 'اختار الوقت'}</span><span>🕐</span>`;
  $('session-close-btn').innerHTML = `<span>${sClose ? t12(sClose) : 'اختار وقت الإقفال'}</span><span>⏰</span>`;
  $('session-preview').textContent = sDate ? `هيظهر للطلاب: ${buildSessionDate(sDate, sTime)}` : 'اختار التاريخ';
}
function setCloseMode(m) {
  closeMode = m;
  document.querySelectorAll('[data-closemode]').forEach(b => {
    const on = b.dataset.closemode === m;
    b.className = 'seg ' + (on ? 'bg-academic-900 text-white border-academic-900' : 'bg-white text-slate-600 border-slate-200');
  });
  $('session-close-wrap').classList.toggle('hidden', m !== 'time');
}
function openSessionModal(editId = null) {
  const s = editId ? findSession(editId) : null;
  if (editId && !s) return;
  $('session-modal-title').textContent = s ? 'تعديل بيانات المحاضرة' : 'إضافة مادة / محاضرة جديدة';
  $('session-edit-id').value = s ? s.id : '';
  $('session-course-input').value = s ? s.courseName : '';
  const p = s ? parseSessionDate(s.sessionDate) : { iso: '', hm: '' };
  sDate = p.iso || todayISO();
  sTime = s ? p.hm : nowHM();
  sClose = '';
  $('session-open-input').checked = s ? s.rawOpen !== false : true;
  if (s && s.closeAtMs) {
    const d = new Date(s.closeAtMs);
    sClose = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setCloseMode('time');
  } else setCloseMode('none');
  refreshSessionLabels();
  sessionModal.classList.remove('hidden');
  $('session-course-input').focus();
}
$('session-date-btn').addEventListener('click', async () => { const v = await pickDate(sDate); if (v) { sDate = v; refreshSessionLabels(); } });
$('session-time-btn').addEventListener('click', async () => { const v = await pickTime(sTime); if (v) { sTime = v; refreshSessionLabels(); } });
$('session-close-btn').addEventListener('click', async () => { const v = await pickTime(sClose || sTime); if (v) { sClose = v; refreshSessionLabels(); } });
document.querySelectorAll('[data-closemode]').forEach(b => b.addEventListener('click', () => setCloseMode(b.dataset.closemode)));
$('open-create-session-btn').addEventListener('click', () => openSessionModal());
$('close-session-modal').addEventListener('click', () => sessionModal.classList.add('hidden'));
$('cancel-session-btn').addEventListener('click', () => sessionModal.classList.add('hidden'));

$('session-form').addEventListener('submit', async e => {
  e.preventDefault();
  const editId = $('session-edit-id').value;
  const courseName = $('session-course-input').value.trim();
  const isOpen = $('session-open-input').checked;
  if (!courseName) return;
  if (!sDate) { showToast('اختار تاريخ المحاضرة', 'error'); return; }
  const sessionDate = buildSessionDate(sDate, sTime);
  let closeAfterMin = 0;
  if (isOpen && closeMode === 'time') {
    if (!sClose) { showToast('اختار وقت الإقفال', 'error'); return; }
    const [y, mo, d] = sDate.split('-').map(Number), [h, mi] = sClose.split(':').map(Number);
    const diff = new Date(y, mo - 1, d, h, mi).getTime() - Date.now();
    if (diff <= 0) { showToast('وقت الإقفال فات بالفعل، اختار وقت قادم', 'error'); return; }
    closeAfterMin = Math.ceil(diff / 60000);
  }
  const id = editId || ('lec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const createdAtMs = editId ? (findSession(editId)?.createdAtMs || Date.now()) : Date.now();
  await busy($('session-save-btn'), 'جاري الحفظ...', async () => {
    try { await api({ action: 'saveSession', id, courseName, sessionDate, isOpen, createdAtMs, closeAfterMin }); }
    catch (err) { showToast(err.message === 'timeout' ? 'السيرفر اتأخر، جرب تاني' : 'حدث خطأ أثناء حفظ المحاضرة', 'error'); return; }
    sessionModal.classList.add('hidden');
    selectedAdminSessionId = id;
    loadAdminData().catch(() => {});
    if (!editId) copyText(studentUrl(id), `تم إنشاء ونسخ رابط "${courseName}"!`);
    else showToast('تم تحديث المحاضرة');
  });
});

// ===== QR modal =====
const qrModal = $('qr-modal');
function openQr(id) {
  const s = findSession(id); if (!s) return;
  const url = studentUrl(id);
  $('qr-session-title').textContent = s.courseName;
  $('qr-session-date').textContent = s.sessionDate;
  $('qr-link-input').value = url;
  const c = $('qr-code-container'); c.innerHTML = '';
  if (window.QRCode) new QRCode(c, { text: url, width: 180, height: 180, colorDark: '#0f2942', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  qrModal.classList.remove('hidden');
}
$('close-qr-modal').addEventListener('click', () => qrModal.classList.add('hidden'));
$('qr-copy-btn').addEventListener('click', () => copyText($('qr-link-input').value, 'تم نسخ الرابط!'));

// ===== كشف الأسماء: كله قابل للتعديل مباشرة =====
const rosterModal = $('roster-modal');
let rList = [], rOrig = '';

const snapshot = () => JSON.stringify(rList.map(r => r.name));
function markDirty() {
  const dirty = snapshot() !== rOrig;
  $('roster-save').disabled = !dirty;
  $('roster-dirty').classList.toggle('hidden', !dirty);
  return dirty;
}

async function openRoster() {
  rosterModal.classList.remove('hidden');
  $('roster-search').value = '';
  $('roster-paste').classList.add('hidden');
  $('roster-body').innerHTML = '<div class="p-6 text-center text-sm text-slate-400">جاري التحميل...</div>';
  try { rosterList = (await api({ action: 'roster', sid: selectedAdminSessionId || '' })).names || []; }
  catch { showToast('تعذر تحميل الكشف', 'error'); }
  rList = rosterList.map(n => ({ name: n, orig: n }));
  rOrig = snapshot();
  renderRosterModal();
}

function renderRosterModal(focusIdx = null) {
  $('roster-count').textContent = `${rList.length} اسم`;
  const q = $('roster-search').value, body = $('roster-body');
  const items = rList.map((r, i) => ({ r, i })).filter(x => !q || !x.r.name || matchName(x.r.name, q));
  if (!items.length) { body.innerHTML = '<div class="p-8 text-center text-sm text-slate-400">الكشف فاضي أو مفيش نتائج. اضغط "+ اسم جديد".</div>'; markDirty(); return; }
  body.innerHTML = items.map(({ r, i }) => `<div class="flex items-center gap-2 px-2 py-2">
      <span class="num">${i + 1}</span>
      <input data-ri="${i}" value="${esc(r.name)}" maxlength="60" placeholder="اكتب الاسم" class="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold focus:bg-white focus:border-teal-500 focus:ring-4 focus:ring-teal-100 outline-none">
      <button data-rdel="${i}" class="shrink-0 text-rose-500 text-xs font-bold px-3 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100">حذف</button></div>`).join('');
  markDirty();
  if (focusIdx !== null) {
    const el = body.querySelector(`[data-ri="${focusIdx}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
  }
}

async function saveRoster() {
  const clean = rList.map(r => ({ name: r.name.trim().replace(/\s+/g, ' '), orig: r.orig })).filter(r => r.name);
  if (!clean.length) { showToast('الكشف فاضي', 'error'); return false; }
  const seen = new Set();
  for (const r of clean) {
    const k = normName(r.name);
    if (seen.has(k)) { showToast(`الاسم مكرر: ${r.name}`, 'error'); return false; }
    seen.add(k);
  }
  const names = clean.map(r => r.name);
  const renames = clean.filter(r => r.orig && r.orig !== r.name).map(r => [r.orig, r.name]);
  if (!await confirmDialog('حفظ الكشف', `الكشف هيبقى ${names.length} اسم${renames.length ? `، منهم ${renames.length} اسم متعدّل` : ''}. متأكد؟`)) return false;
  let ok = false;
  await busy($('roster-save'), 'جاري الحفظ...', async () => {
    try {
      await api({ action: 'setRoster', names, renames });
      rosterList = names;
      rList = names.map(n => ({ name: n, orig: n }));
      rOrig = snapshot();
      $('roster-paste').classList.add('hidden');
      renderRosterModal();
      showToast('تم حفظ الكشف');
      loadAdminData().catch(() => {});
      ok = true;
    } catch (err) {
      showToast(err.message === 'busy' ? 'السيرفر مشغول، جرب كمان شوية' : err.message === 'timeout' ? 'السيرفر اتأخر، جرب تاني' : 'تعذر حفظ الكشف', 'error');
    }
  });
  return ok;
}

async function closeRoster() {
  if (markDirty() && !await confirmDialog('تعديلات غير محفوظة', 'في تعديلات ماتحفظتش. تقفل وتتجاهلها؟')) return;
  rosterModal.classList.add('hidden');
}

$('roster-upload-btn').addEventListener('click', openRoster);
$('roster-close').addEventListener('click', closeRoster);
$('roster-cancel').addEventListener('click', closeRoster);
$('roster-search').addEventListener('input', () => renderRosterModal());
$('roster-save').addEventListener('click', saveRoster);

$('roster-add-btn').addEventListener('click', () => {
  $('roster-search').value = '';
  rList.push({ name: '', orig: null });
  renderRosterModal(rList.length - 1);
});
$('roster-paste-btn').addEventListener('click', () => $('roster-paste').classList.toggle('hidden'));

$('roster-body').addEventListener('input', e => {
  const i = e.target.dataset.ri;
  if (i === undefined) return;
  rList[Number(i)].name = e.target.value;
  markDirty();
});
$('roster-body').addEventListener('keydown', e => {
  const i = e.target.dataset?.ri;
  if (e.key !== 'Enter' || i === undefined) return;
  e.preventDefault();
  $('roster-search').value = '';
  rList.splice(Number(i) + 1, 0, { name: '', orig: null });
  renderRosterModal(Number(i) + 1);
});
$('roster-body').addEventListener('click', e => {
  const b = e.target.closest('[data-rdel]'); if (!b) return;
  rList.splice(Number(b.dataset.rdel), 1);
  renderRosterModal();
});

$('roster-paste-ok').addEventListener('click', () => {
  const names = $('roster-text').value.split('\n')
    .map(s => s.replace(/^\s*\d+[\s.\-)]*/, '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (!names.length) return;
  names.forEach(n => rList.push({ name: n, orig: null }));
  $('roster-text').value = ''; $('roster-paste').classList.add('hidden');
  $('roster-search').value = '';
  renderRosterModal();
  const bd = $('roster-body'); bd.scrollTop = bd.scrollHeight;
  showToast(`اتضاف ${names.length} اسم، اضغط "حفظ التعديلات"`, 'info');
});

// ===== Boot =====
async function bootstrapApp() {
  if (!isAdminMode && !isStudentLink) { activeStudentSession = null; renderStudentView(); return; }
  try {
    if (isAdminMode) {
      await loadAdminData();
      setInterval(() => { if (document.visibilityState === 'visible' && $('roster-modal').classList.contains('hidden') && $('session-modal').classList.contains('hidden')) loadAdminData().catch(() => {}); }, 30000);
    } else {
      try { activeStudentSession = (await apiRetry({ action: 'session', sid: requestedSessionId })).session; }
      catch (err) { if (err.message === 'not_found') activeStudentSession = null; else throw err; }
      renderStudentView();
      if (activeStudentSession) {
        if (getSaved(activeStudentSession.id)) verifyRegistration();
        else if (activeStudentSession.isOpen !== false) loadRoster().catch(() => {});
      }
    }
  } catch (err) { console.error(err); fatal(err.message); }
}
bootstrapApp();
