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
  const colors = { success: 'bg-teal-900', error: 'bg-rose-600', info: 'bg-academic-900' };
  const t = document.createElement('div');
  t.className = `pointer-events-auto px-4 py-3 rounded-2xl shadow-lg text-white text-sm font-bold fade-in max-w-md ${colors[type] || colors.info}`;
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
    $('closed-title').textContent = 'الرابط غير صحيح أو المحاضرة غير موجودة';
    $('closed-message').textContent = 'يرجى الحصول على رابط الحضور الصحيح من المحاضر.';
    closed.classList.remove('hidden'); return;
  }
  $('student-course-name').textContent = s.courseName;
  $('student-session-date').textContent = s.sessionDate;
  document.title = `تسجيل حضور - ${s.courseName} (${s.sessionDate})`;
  const saved = getSaved(s.id);
  if (saved) {
    $('receipt-badge-text').textContent = 'تم تسجيل حضورك';
    $('receipt-name').textContent = saved.studentName;
    $('receipt-course').textContent = `${s.courseName} (${s.sessionDate})`;
    $('receipt-time').textContent = fmtTime(saved.timestamp);
    receipt.classList.remove('hidden'); return;
  }
  if (s.isOpen === false) {
    $('closed-title').textContent = 'تم إغلاق تسجيل الحضور';
    $('closed-message').textContent = `انتهى وقت التسجيل لمحاضرة "${s.courseName} (${s.sessionDate})".`;
    closed.classList.remove('hidden'); return;
  }
  if (s.closeAtMs) {
    dl.textContent = `التسجيل متاح حتى الساعة ${fmtHM(s.closeAtMs)}`; dl.classList.remove('hidden');
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
  const ws = normName($('student-search').value).split(' ').filter(Boolean);
  const box = $('name-list'), keep = box.scrollTop;
  $('student-stats').textContent = rosterNames.length ? `${takenSet.size} سجّلوا من ${rosterNames.length}` : '';
  if (!rosterNames.length) { box.innerHTML = '<div class="p-6 text-center text-sm text-slate-400">الكشف لسه ماترفعش، كلم المحاضر.</div>'; return; }
  const items = rosterNames.map((n, i) => ({ n, i })).filter(x => { const nn = normName(x.n); return ws.every(w => nn.includes(w)); });
  if (!items.length) { box.innerHTML = '<div class="p-6 text-center text-sm text-slate-400">مفيش اسم بالشكل ده</div>'; return; }
  box.innerHTML = items.map(({ n, i }) => {
    const taken = takenSet.has(i), sel = i === pickedIdx;
    const mark = taken ? '<span class="inline-flex w-6 h-6 items-center justify-center rounded-full bg-slate-200 text-slate-500 text-xs">✓</span>'
      : sel ? '<span class="inline-flex w-7 h-7 items-center justify-center rounded-full bg-teal-600 text-white font-extrabold">✓</span>'
      : '<span class="inline-block w-6 h-6 rounded-full border-2 border-slate-200"></span>';
    return `<button type="button" data-i="${i}" ${taken ? 'disabled' : ''} class="w-full flex items-center gap-2 px-3 py-3 text-sm font-bold text-right ${taken ? 'bg-slate-50 text-slate-300' : sel ? 'bg-teal-50 text-teal-900 ring-2 ring-inset ring-teal-500' : 'hover:bg-slate-50 active:bg-teal-50'}">
      <span class="w-10 text-center text-xs font-extrabold ${sel ? 'text-teal-700' : 'text-slate-400'}">${i + 1}</span>
      <span class="flex-1 leading-6">${esc(n)}</span>
      <span class="w-14 text-center">${mark}</span></button>`;
  }).join('');
  box.scrollTop = keep;
}
$('student-search').addEventListener('input', renderNameList);
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
    await submitWithRetry({ action: 'addRecord', sessionId: s.id, rosterIdx: pickedIdx, deviceId: getDeviceId() });
    saveReg(s.id, { studentName: name, rosterIdx: pickedIdx, timestamp: new Date().toISOString() });
    showToast('تم تسجيل حضورك بنجاح!');
    renderStudentView();
  } catch (err) {
    const m = { duplicate: 'الاسم ده اتسجل قبل كدا!', closed: 'التسجيل مغلق لهذه المحاضرة.', invalid_name: 'اختار اسمك من القائمة.',
      device_used: 'تم التسجيل من هذا الجهاز مسبقاً لهذه المحاضرة.' };
    if (err.message === 'closed') { activeStudentSession = { ...s, isOpen: false }; renderStudentView(); }
    if (err.message === 'duplicate') loadRoster().catch(() => {});
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
  if (!sorted.length) { grid.innerHTML = '<div class="col-span-full text-center py-8 text-slate-400 text-sm">لا توجد مواد بعد. اضغط "إضافة مادة / محاضرة".</div>'; return; }
  grid.innerHTML = sorted.map(s => {
    const sel = s.id === selectedAdminSessionId, id = esc(s.id);
    const expired = s.rawOpen && !s.isOpen;
    const badge = s.isOpen ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">مفتوح</span>'
      : `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">${expired ? 'انتهى الوقت' : 'مغلق'}</span>`;
    const until = s.isOpen && s.closeAtMs ? `<div class="text-[11px] font-bold text-amber-700 mt-1">يقفل الساعة ${fmtHM(s.closeAtMs)}</div>` : '';
    return `<div data-select-session="${id}" class="cursor-pointer rounded-2xl p-4 border-2 flex flex-col gap-3 ${sel ? 'border-teal-600 bg-teal-50/30' : 'border-slate-200 bg-white hover:border-slate-300'}">
      <div>
        <div class="flex items-start justify-between gap-2 mb-1.5"><h3 class="font-extrabold text-base text-academic-900">${esc(s.courseName)}</h3>${badge}</div>
        <div class="flex items-center justify-between text-xs text-slate-500 font-semibold">
          <span>${esc(s.sessionDate)}</span>
          <span class="font-extrabold bg-slate-100 px-2 py-0.5 rounded-md">${counts[s.id] || 0} طالب</span>
        </div>${until}
      </div>
      <div class="pt-2.5 border-t border-slate-100 flex gap-1.5" data-stop>
        <button data-copy-session="${id}" class="flex-1 py-1.5 rounded-lg bg-academic-900 hover:bg-academic-800 text-white font-bold text-xs">رابط الطلاب</button>
        <button data-qr-session="${id}" class="px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">QR</button>
        <button data-edit-session="${id}" class="px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">تعديل</button>
        <button data-delete-session="${id}" class="px-2.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold">حذف</button>
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
    if (!await confirmDialog('حذف مادة / محاضرة', `هل أنت متأكد من حذف "${s?.courseName} (${s?.sessionDate})" وكل أسماء طلابها؟`)) return;
    try { await api({ action: 'deleteSession', id }); await loadAdminData(); showToast('تم حذف المادة', 'info'); }
    catch (err) { showToast('تعذر حذف المادة', 'error'); }
  }));
}

let rosterList = [], adminFilter = 'all';
const pillCls = on => `px-4 py-2 rounded-full text-xs font-extrabold border ${on ? 'bg-academic-900 text-white border-academic-900' : 'bg-white text-slate-600 border-slate-200'}`;

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
  if (!cur) { $('roster-session-title').textContent = 'لم يتم اختيار مادة'; body.innerHTML = ''; return; }
  $('roster-session-title').textContent = `${cur.courseName} (${cur.sessionDate})`;
  const all = buildRows(), present = all.filter(x => x.rec).length, total = all.length;
  $('st-present').textContent = present; $('st-absent').textContent = total - present; $('st-total').textContent = total;
  $('st-bar').style.width = total ? (present / total * 100) + '%' : '0%';
  const ws = normName($('admin-search-input').value).split(' ').filter(Boolean);
  const rows = all.filter(x => (adminFilter === 'all' || (adminFilter === 'present') === !!x.rec) && ws.every(w => normName(x.name).includes(w)));
  if (!rows.length) { body.innerHTML = '<div class="py-12 text-center text-slate-400 font-bold">مفيش نتائج</div>'; return; }
  body.innerHTML = rows.map(x => `<div class="flex items-center gap-2 px-3 py-2.5 ${x.rec ? 'bg-emerald-50/50' : ''}">
    <span class="w-9 text-center text-xs font-extrabold text-slate-400">${x.no}</span>
    <span class="flex-1 font-bold leading-6 ${x.rec ? 'text-slate-800' : 'text-slate-500'}">${esc(x.name)}${x.extra ? ' <span class="text-[10px] text-amber-600">(يدوي)</span>' : ''}</span>
    <span class="w-16 text-center">${x.rec ? '<span class="inline-flex w-7 h-7 items-center justify-center rounded-full bg-emerald-500 text-white font-extrabold">✓</span>' : '<span class="text-slate-300">—</span>'}</span>
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
  <h1>كشف حضور: ${esc(cur.courseName)} (${esc(cur.sessionDate)})</h1><p>حاضر: ${present} | غائب: ${all.length - present} | الإجمالي: ${all.length}</p>
  <table><thead><tr><th style="width:40px">م</th><th>اسم الطالب</th><th style="width:50px">حضور</th><th style="width:90px">الوقت</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 900);
  showToast('اختار "حفظ كملف PDF" من شاشة الطباعة', 'info');
});

$('copy-whatsapp-btn').addEventListener('click', () => {
  const cur = findSession(selectedAdminSessionId); if (!cur) return;
  const pr = buildRows().filter(x => x.rec);
  if (!pr.length) { showToast('مفيش حاضرين لسه', 'error'); return; }
  copyText(`📋 كشف حضور: ${cur.courseName} (${cur.sessionDate})\nالحاضرين: ${pr.length}\n------------------------\n` + pr.map(x => `${x.no}. ${x.name}`).join('\n'), 'تم نسخ الحاضرين!');
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
function openSessionModal(editId = null) {
  const s = editId ? findSession(editId) : null;
  if (editId && !s) return;
  $('session-modal-title').textContent = s ? 'تعديل بيانات المحاضرة' : 'إضافة مادة / محاضرة جديدة';
  $('session-edit-id').value = s ? s.id : '';
  $('session-course-input').value = s ? s.courseName : '';
  $('session-date-input').value = s ? s.sessionDate : '';
  $('session-open-input').checked = s ? s.rawOpen !== false : true;
  const left = s && s.closeAtMs ? Math.ceil((s.closeAtMs - Date.now()) / 60000) : 0;
  $('session-mins-input').value = left > 0 ? left : '';
  sessionModal.classList.remove('hidden');
  $('session-course-input').focus();
}
$('open-create-session-btn').addEventListener('click', () => openSessionModal());
$('close-session-modal').addEventListener('click', () => sessionModal.classList.add('hidden'));
$('cancel-session-btn').addEventListener('click', () => sessionModal.classList.add('hidden'));

$('session-form').addEventListener('submit', async e => {
  e.preventDefault();
  const editId = $('session-edit-id').value;
  const courseName = $('session-course-input').value.trim();
  const sessionDate = $('session-date-input').value.trim();
  const isOpen = $('session-open-input').checked;
  const closeAfterMin = Number($('session-mins-input').value) || 0;
  if (!courseName || !sessionDate) return;
  const id = editId || ('lec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const createdAtMs = editId ? (findSession(editId)?.createdAtMs || Date.now()) : Date.now();
  await busy($('session-save-btn'), 'جاري الحفظ...', async () => {
    try { await api({ action: 'saveSession', id, courseName, sessionDate, isOpen, createdAtMs, closeAfterMin }); }
    catch (err) { showToast(err.message === 'timeout' ? 'السيرفر اتأخر، جرب تاني' : 'حدث خطأ أثناء حفظ المحاضرة', 'error'); return; }
    sessionModal.classList.add('hidden');
    selectedAdminSessionId = id;
    loadAdminData().catch(() => {});
    if (!editId) copyText(studentUrl(id), `تم إنشاء ونسخ رابط "${courseName} (${sessionDate})"!`);
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

// ===== رفع كشف الأسماء (أدمن) =====
$('roster-upload-btn').addEventListener('click', () => $('roster-modal').classList.remove('hidden'));
$('roster-cancel').addEventListener('click', () => $('roster-modal').classList.add('hidden'));
$('roster-save').addEventListener('click', async () => {
  const names = $('roster-text').value.split('\n').map(s => s.replace(/^\s*\d+[\s.\-)]*/, '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (!names.length) return;
  if (!await confirmDialog('رفع الكشف', `هيتم رفع ${names.length} اسم واستبدال الكشف القديم.`)) return;
  await busy($('roster-save'), 'جاري الرفع...', async () => {
    try {
      await api({ action: 'setRoster', names });
      $('roster-modal').classList.add('hidden'); $('roster-text').value = '';
      rosterList = []; showToast(`تم رفع ${names.length} اسم`);
      loadAdminData().catch(() => {});
    } catch (err) {
      showToast(err.message === 'busy' ? 'السيرفر مشغول، جرب كمان شوية' : err.message === 'timeout' ? 'السيرفر اتأخر، جرب تاني' : 'تعذر رفع الكشف', 'error');
    }
  });
});

// ===== Boot =====
async function bootstrapApp() {
  if (!isAdminMode && !isStudentLink) { activeStudentSession = null; renderStudentView(); return; }
  try {
    if (isAdminMode) {
      await loadAdminData();
      setInterval(() => { if (document.visibilityState === 'visible') loadAdminData().catch(() => {}); }, 30000);
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
