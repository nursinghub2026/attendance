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

async function api(body) {
  const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'api_error');
  return j;
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

const nameInput = $('student-name'), nameErr = $('name-error');
const submitBtn = $('submit-btn'), submitText = $('submit-btn-text');
const ARABIC_NAME = /^[\u0600-\u06FF ]+$/;

function showErr(el, input, msg) {
  if (!msg) { el.classList.add('hidden'); input.classList.remove('border-rose-500'); return true; }
  el.textContent = msg; el.classList.remove('hidden'); input.classList.add('border-rose-500'); return false;
}
function validateName() {
  const raw = nameInput.value.trim().replace(/\s+/g, ' ');
  if (!raw) return showErr(nameErr, nameInput, 'يرجى كتابة اسم الطالب.');
  if (!ARABIC_NAME.test(raw)) return showErr(nameErr, nameInput, 'اكتب الاسم بالحروف العربية فقط.');
  if (raw.split(' ').length < 3) return showErr(nameErr, nameInput, 'اكتب الاسم ثلاثياً أو رباعياً على الأقل كما في الكشف.');
  return showErr(nameErr, nameInput, '');
}
nameInput.addEventListener('input', () => { if (!nameErr.classList.contains('hidden')) validateName(); });

$('attendance-form').addEventListener('submit', async e => {
  e.preventDefault();
  const s = activeStudentSession;
  if (!s || s.isOpen === false) { showToast('التسجيل مغلق لهذه المحاضرة.', 'error'); return; }
  if (getSaved(s.id)) { renderStudentView(); return; }
  if (!validateName()) return;
  const cleanName = nameInput.value.trim().replace(/\s+/g, ' ');
  submitBtn.disabled = true; submitText.textContent = 'جاري حفظ الحضور...';
  try {
    await api({ action: 'addRecord', sessionId: s.id, studentName: cleanName, deviceId: getDeviceId() });
    saveReg(s.id, { studentName: cleanName, timestamp: new Date().toISOString() });
    showToast('تم تسجيل حضورك بنجاح!');
    renderStudentView();
  } catch (err) {
    const m = { duplicate: 'هذا الاسم مسجل بالفعل في كشف هذه المحاضرة!', closed: 'التسجيل مغلق لهذه المحاضرة.', invalid_name: 'اكتب الاسم ثلاثياً بالعربية فقط.',
      device_used: 'تم التسجيل من هذا الجهاز مسبقاً لهذه المحاضرة.' };
    if (err.message === 'closed') { activeStudentSession = { ...s, isOpen: false }; renderStudentView(); }
    showToast(m[err.message] || 'حدث خطأ أثناء التسجيل، حاول مرة أخرى.', 'error');
  } finally {
    submitBtn.disabled = false; submitText.textContent = 'تأكيد وتسجيل الحضور';
  }
});

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

function renderRoster() {
  const cur = findSession(selectedAdminSessionId);
  const tbody = $('attendance-table-body');
  if (!cur) { $('roster-session-title').textContent = 'لم يتم اختيار مادة'; $('roster-total-badge').textContent = '0 طالب'; tbody.innerHTML = ''; return; }
  $('roster-session-title').textContent = `${cur.courseName} (${cur.sessionDate})`;
  const q = normName($('admin-search-input').value || '');
  const recs = sortedRecs();
  $('roster-total-badge').textContent = `${recs.length} طالب`;
  const filtered = recs.filter(r => !q || normName(r.studentName).includes(q));
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="py-12 text-center text-slate-400 font-bold">لا يوجد طلاب مسجلون في هذا الكشف بعد</td></tr>'; return;
  }
  tbody.innerHTML = filtered.map((r, i) => `<tr class="hover:bg-slate-50">
    <td class="py-3.5 px-4 text-center font-bold text-slate-500">${i + 1}</td>
    <td class="py-3.5 px-4 font-bold">${esc(r.studentName)}</td>
    <td class="py-3.5 px-4 text-xs font-semibold text-slate-500">${fmtTime(r.timestamp)}</td>
    <td class="py-3.5 px-4 text-center"><button data-del-rec="${esc(r.id)}" class="px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50 text-xs font-bold">حذف</button></td></tr>`).join('');
  tbody.querySelectorAll('[data-del-rec]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.delRec, rec = records.find(r => r.id === id);
    if (!await confirmDialog('حذف اسم طالب', `هل تريد حذف "${rec?.studentName || ''}" من الكشف؟`)) return;
    try { await api({ action: 'deleteRecord', id }); await loadAdminData(); showToast('تم حذف الاسم', 'info'); }
    catch { showToast('حدث خطأ أثناء الحذف', 'error'); }
  }));
}

$('copy-student-link-header-btn').addEventListener('click', () => { if (selectedAdminSessionId) copyText(studentUrl(selectedAdminSessionId), 'تم نسخ رابط الطلاب!'); });
$('admin-search-input').addEventListener('input', renderRoster);

function sortedRecs() { return [...records].sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0)); }
const safeFile = s => String(s).replace(/\s+/g, '_').replace(/[\/\\:*?"<>|]/g, '-');

// ===== Export Excel =====
$('export-excel-btn').addEventListener('click', () => {
  const cur = findSession(selectedAdminSessionId); if (!cur) return;
  const recs = sortedRecs();
  if (!recs.length) { showToast('الكشف فارغ', 'error'); return; }
  if (!window.XLSX) { showToast('مكتبة Excel لم تُحمّل، تأكد من الإنترنت', 'error'); return; }
  const data = [['م', 'اسم الطالب', 'المادة', 'التاريخ', 'وقت التسجيل'],
    ...recs.map((r, i) => [i + 1, r.studentName, cur.courseName, cur.sessionDate, fmtTime(r.timestamp)])];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 5 }, { wch: 36 }, { wch: 24 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'الحضور');
  const name = `حضور_${safeFile(cur.courseName)}_${safeFile(cur.sessionDate)}.xlsx`;
  XLSX.writeFile(wb, name);
  showToast(`تم تنزيل الملف: ${name}`);
});

// ===== Export PDF (طباعة -> حفظ كـ PDF) =====
$('export-pdf-btn').addEventListener('click', () => {
  const cur = findSession(selectedAdminSessionId); if (!cur) return;
  const recs = sortedRecs();
  if (!recs.length) { showToast('الكشف فارغ', 'error'); return; }
  const w = window.open('', '_blank');
  if (!w) { showToast('المتصفح منع النافذة، اسمح بالنوافذ المنبثقة', 'error'); return; }
  const rows = recs.map((r, i) => `<tr><td>${i + 1}</td><td class="n">${esc(r.studentName)}</td><td>${fmtTime(r.timestamp)}</td></tr>`).join('');
  w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${esc(cur.courseName)} ${esc(cur.sessionDate)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Cairo',sans-serif;padding:24px;color:#0f2942}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 14px;color:#475569;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #cbd5e1;padding:7px 10px;text-align:center}th{background:#e2e8f0}td.n{text-align:right}
  tr{page-break-inside:avoid}</style></head><body>
  <h1>كشف حضور: ${esc(cur.courseName)} (${esc(cur.sessionDate)})</h1><p>عدد الطلاب: ${recs.length}</p>
  <table><thead><tr><th style="width:50px">م</th><th>اسم الطالب</th><th style="width:120px">وقت التسجيل</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 900);
  showToast('اختار "حفظ كملف PDF" من شاشة الطباعة', 'info');
});

$('copy-whatsapp-btn').addEventListener('click', () => {
  const cur = findSession(selectedAdminSessionId); if (!cur) return;
  const recs = sortedRecs();
  if (!recs.length) { showToast('الكشف فارغ حالياً', 'error'); return; }
  const head = `📋 كشف حضور: ${cur.courseName} (${cur.sessionDate})\nالعدد: ${recs.length} طالب\n------------------------\n`;
  copyText(head + recs.map((r, i) => `${i + 1}. ${r.studentName}`).join('\n'), 'تم نسخ الأسماء!');
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
  sessionModal.classList.add('hidden');
  try {
    await api({ action: 'saveSession', id, courseName, sessionDate, isOpen, createdAtMs, closeAfterMin });
    selectedAdminSessionId = id;
    await loadAdminData();
    if (!editId) copyText(studentUrl(id), `تم إنشاء ونسخ رابط "${courseName} (${sessionDate})"!`);
    else showToast('تم تحديث المحاضرة');
  } catch (err) { showToast('حدث خطأ أثناء حفظ المحاضرة', 'error'); }
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

// ===== Boot =====
async function loadAdminData() {
  let j = await api({ action: 'adminList', sid: selectedAdminSessionId || '' });
  if (!selectedAdminSessionId || !j.sessions.some(x => x.id === selectedAdminSessionId)) {
    const newest = [...j.sessions].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))[0];
    selectedAdminSessionId = newest ? newest.id : null;
    if (selectedAdminSessionId) j = await api({ action: 'adminList', sid: selectedAdminSessionId });
  }
  sessionsList = j.sessions; counts = j.counts || {}; records = j.records;
  renderAdminView();
}

async function bootstrapApp() {
  if (!isAdminMode && !isStudentLink) { activeStudentSession = null; renderStudentView(); return; }
  try {
    if (isAdminMode) {
      await loadAdminData();
      setInterval(() => { if (document.visibilityState === 'visible') loadAdminData().catch(() => {}); }, 30000);
    } else {
      try { activeStudentSession = (await api({ action: 'session', sid: requestedSessionId })).session; }
      catch (err) { if (err.message === 'not_found') activeStudentSession = null; else throw err; }
      renderStudentView();
    }
  } catch (err) { console.error(err); fatal(err.message); }
}
bootstrapApp();
