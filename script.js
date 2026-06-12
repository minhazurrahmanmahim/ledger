/* =====================================================================
   মাহিম'স লেজার — অ্যাপ লজিক
   সব ডেটা ব্রাউজারের LocalStorage-এ সংরক্ষিত হয়। কোনো সার্ভার নেই।
   ===================================================================== */

const STORAGE_KEY = "mahim_ledger_state_v1";

const DEFAULT_CATEGORIES = [
  "খাবার", "যাতায়াত", "বাসা ভাড়া ও বিল", "কেনাকাটা",
  "স্বাস্থ্য", "শিক্ষা", "বিনোদন", "ব্যক্তিগত যত্ন", "অন্যান্য"
];

const TOUR_CATS = ["ভাড়া", "খাবার", "হোটেল", "অন্যান্য"];

const WEEKDAYS_BN = ["রবিবার","সোমবার","মঙ্গলবার","বুধবার","বৃহস্পতিবার","শুক্রবার","শনিবার"];
const MONTHS_BN  = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];

/* ===================== ডিফল্ট স্টেট ===================== */
function defaultState(){
  return {
    entries: [],     // {id, kind:'expense'|'receivable'|'payable', category, person, amount, date, time, note, isTour, tourId, tourCategory, settled, createdAt, updatedAt}
    archive: [],     // entry-shaped objects + archivedAt, archiveReason
    tours: [],       // {id, name, start, end}
    categories: [...DEFAULT_CATEGORIES],
    contacts: [],    // {id, name, phone}
    settings: {
      name: "মো. মিনহাজুর রহমান মাহিম",
      reminderEnabled: true,
      reminderTime: "21:00",
      lastReminderDate: "",
      monthlyBudget: 0
    }
  };
}

let state = loadState();
let snoozedToday = false; // রিমাইন্ডার পরে দেখানোর জন্য (সেশন-নির্ভর)

function mergeWithDefaults(parsed){
  const def = defaultState();
  return {
    entries: parsed.entries || [],
    archive: parsed.archive || [],
    tours: parsed.tours || [],
    categories: (parsed.categories && parsed.categories.length) ? parsed.categories : def.categories,
    contacts: parsed.contacts || [],
    settings: { ...def.settings, ...(parsed.settings || {}) }
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // ডিফল্ট কী-গুলো নিশ্চিত করা (পুরোনো ডেটার সাথে সামঞ্জস্যের জন্য)
    return mergeWithDefaults(parsed);
  }catch(e){
    console.error("স্টেট লোড করতে সমস্যা হয়েছে:", e);
    return defaultState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  syncToCloud();
}

/* =====================================================================
   ফায়ারবেস — ক্লাউড সিঙ্ক
   নিচের কনফিগারেশনে আপনার Firebase প্রজেক্টের তথ্য বসান
   (Firebase Console > Project settings > General > Your apps > SDK setup and configuration)
   ===================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyAT6QydYvhgOa_yB92GcQva9dddB8amsYY",
  authDomain: "mahims-ledger.firebaseapp.com",
  projectId: "mahims-ledger",
  storageBucket: "mahims-ledger.firebasestorage.app",
  messagingSenderId: "13228923987",
  appId: "1:13228923987:web:f430a25fda0e234cd63aa6"
};

const firebaseReady = (typeof firebase !== 'undefined');
let auth = null, db = null;
if(firebaseReady){
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
}

let currentUser = null;
let firestoreUnsub = null;
let saveDebounceTimer = null;
let isApplyingRemoteUpdate = false;

function setSyncStatus(status){
  const el = document.getElementById('syncStatus');
  const icon = document.getElementById('syncIcon');
  const text = document.getElementById('syncText');
  if(!el) return;
  el.classList.remove('synced','syncing','error');
  if(status === 'syncing'){
    el.classList.add('syncing');
    icon.setAttribute('data-lucide','refresh-cw');
    text.textContent = 'সিঙ্ক হচ্ছে...';
  } else if(status === 'synced'){
    el.classList.add('synced');
    icon.setAttribute('data-lucide','cloud-check');
    text.textContent = 'সিঙ্ক সম্পন্ন';
  } else if(status === 'error'){
    el.classList.add('error');
    icon.setAttribute('data-lucide','cloud-off');
    text.textContent = 'সিঙ্ক ব্যর্থ';
  }
  refreshIcons();
}

function syncToCloud(){
  if(!firebaseReady || !currentUser || isApplyingRemoteUpdate) return;
  setSyncStatus('syncing');
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    db.collection('users').doc(currentUser.uid).set({
      state: state,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => setSyncStatus('synced'))
      .catch(err => { console.error("ক্লাউড সিঙ্ক সমস্যা:", err); setSyncStatus('error'); });
  }, 800);
}

function translateAuthError(err){
  const map = {
    'auth/invalid-email': 'ইমেইল ঠিকানা সঠিক নয়।',
    'auth/missing-password': 'পাসওয়ার্ড দিন।',
    'auth/weak-password': 'পাসওয়ার্ড কমপক্ষে ৬ ডিজিট হতে হবে।',
    'auth/email-already-in-use': 'এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট তৈরি হয়েছে — অনুগ্রহ করে লগইন করুন।',
    'auth/invalid-credential': 'ইমেইল বা পাসওয়ার্ড ভুল।',
    'auth/wrong-password': 'ইমেইল বা পাসওয়ার্ড ভুল।',
    'auth/user-not-found': 'এই ইমেইলে কোনো অ্যাকাউন্ট পাওয়া যায়নি — নতুন অ্যাকাউন্ট তৈরি করুন।',
    'auth/too-many-requests': 'অনেকবার চেষ্টা করা হয়েছে, কিছুক্ষণ পর আবার চেষ্টা করুন।',
    'auth/network-request-failed': 'ইন্টারনেট সংযোগ নেই, চেক করে আবার চেষ্টা করুন।'
  };
  return map[err.code] || ('সমস্যা হয়েছে: ' + err.message);
}

function setupAuthUI(){
  const overlay        = document.getElementById('authOverlay');
  const emailInput     = document.getElementById('authEmail');
  const passwordInput  = document.getElementById('authPassword');
  const errorEl        = document.getElementById('authError');
  const loginBtn       = document.getElementById('authLoginBtn');
  const signupBtn      = document.getElementById('authSignupBtn');
  const forgotBtn      = document.getElementById('authForgotBtn');
  const loadingEl      = document.getElementById('authLoading');
  const accountEmailEl = document.getElementById('accountEmail');
  const logoutBtn      = document.getElementById('logoutBtn');

  if(!firebaseReady){
    // ক্লাউড সিঙ্ক লোড হয়নি (ইন্টারনেট/CDN সমস্যা) — অফলাইন (লোকাল) মোডে চলবে
    overlay.classList.add('hidden');
    accountEmailEl.value = 'অফলাইন মোড (ইন্টারনেট সংযোগ চেক করুন)';
    setSyncStatus('error');
    return;
  }

  function showError(msg){ errorEl.textContent = msg || ''; }
  function setLoading(on){ loadingEl.style.display = on ? 'flex' : 'none'; }

  loginBtn.addEventListener('click', () => {
    const email = emailInput.value.trim();
    const pass  = passwordInput.value;
    showError('');
    if(!email || !pass){ showError('ইমেইল ও পাসওয়ার্ড দিন।'); return; }
    setLoading(true);
    auth.signInWithEmailAndPassword(email, pass)
      .catch(err => showError(translateAuthError(err)))
      .finally(() => setLoading(false));
  });

  signupBtn.addEventListener('click', () => {
    const email = emailInput.value.trim();
    const pass  = passwordInput.value;
    showError('');
    if(!email || !pass){ showError('ইমেইল ও পাসওয়ার্ড দিন।'); return; }
    if(pass.length < 6){ showError('পাসওয়ার্ড কমপক্ষে ৬ ডিজিট হতে হবে।'); return; }
    setLoading(true);
    auth.createUserWithEmailAndPassword(email, pass)
      .catch(err => showError(translateAuthError(err)))
      .finally(() => setLoading(false));
  });

  forgotBtn.addEventListener('click', () => {
    const email = emailInput.value.trim();
    showError('');
    if(!email){ showError('পাসওয়ার্ড রিসেট লিংক পাঠানোর জন্য উপরে ইমেইল লিখুন।'); return; }
    setLoading(true);
    auth.sendPasswordResetEmail(email)
      .then(() => showError('রিসেট লিংক ইমেইলে পাঠানো হয়েছে — ইনবক্স চেক করুন।'))
      .catch(err => showError(translateAuthError(err)))
      .finally(() => setLoading(false));
  });

  logoutBtn.addEventListener('click', () => {
    openConfirm(
      'লগআউট নিশ্চিত করুন',
      'আপনি কি লগআউট করতে চান? পরবর্তীতে একই ইমেইল-পাসওয়ার্ড দিয়ে লগইন করলে আপনার সব ডেটা ফিরে পাবেন।',
      () => auth.signOut()
    );
  });

  auth.onAuthStateChanged(user => {
    if(firestoreUnsub){ firestoreUnsub(); firestoreUnsub = null; }
    if(user){
      currentUser = user;
      overlay.classList.add('hidden');
      accountEmailEl.value = user.email || '';
      emailInput.value = '';
      passwordInput.value = '';
      setSyncStatus('syncing');

      firestoreUnsub = db.collection('users').doc(user.uid).onSnapshot(docSnap => {
        isApplyingRemoteUpdate = true;
        try{
          if(docSnap.exists && docSnap.data().state){
            state = mergeWithDefaults(docSnap.data().state);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          } else {
            // ক্লাউডে এখনো কোনো ডেটা নেই — বর্তমান (লোকাল) ডেটা ক্লাউডে পাঠানো হচ্ছে
            db.collection('users').doc(user.uid).set({
              state: state,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          }
          renderAll();
          loadSettingsForm();
          setSyncStatus('synced');
        }catch(e){
          console.error("রেন্ডারে সমস্যা:", e);
          setSyncStatus('error');
        }finally{
          isApplyingRemoteUpdate = false;
        }
      }, err => {
        console.error("ফায়ারস্টোর সিঙ্ক সমস্যা:", err);
        setSyncStatus('error');
      });
    } else {
      currentUser = null;
      overlay.classList.remove('hidden');
      setSyncStatus('error');
    }
  });
}

/* ===================== আইকন (Lucide) — নিরাপদ লোডার ===================== */
// আইকন CDN ধীরে লোড হলেও যাতে অ্যাপ ক্র্যাশ না করে এবং
// আইকন লোড হওয়ার সাথে সাথেই (পরে হলেও) যাতে দেখানো যায়, তার জন্য এই হেল্পার।
let _iconRetryCount = 0;
function refreshIcons(){
  if(window.lucide && typeof lucide.createIcons === 'function'){
    lucide.createIcons();
  } else if(_iconRetryCount < 40){
    // আইকন লাইব্রেরি এখনো লোড হয়নি — কিছুক্ষণ পর আবার চেষ্টা করা হবে
    _iconRetryCount++;
    setTimeout(refreshIcons, 250);
  }
}


function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function bnDigits(val){
  const map = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
  return String(val).replace(/[0-9]/g, d => map[d]);
}

function taka(amount){
  const num = Number(amount) || 0;
  const hasDecimal = Math.abs(num % 1) > 0.001;
  const formatted = num.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2
  });
  return '৳ ' + bnDigits(formatted);
}

function todayStr(){
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
}
function nowTimeStr(){
  const d = new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function pad(n){ return String(n).padStart(2,'0'); }

function formatDateDMY(dateStr){
  if(!dateStr) return '-';
  const [y,m,d] = dateStr.split('-');
  return bnDigits(`${d}/${m}/${y}`);
}
function formatTimeBn(timeStr){
  if(!timeStr) return '';
  let [h,m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'অপরাহ্ন' : 'পূর্বাহ্ন';
  let h12 = h % 12; if(h12 === 0) h12 = 12;
  return bnDigits(`${pad(h12)}:${pad(m)}`) + ' ' + period;
}
function formatFullDateBn(date){
  return `${bnDigits(date.getDate())} ${MONTHS_BN[date.getMonth()]}, ${bnDigits(date.getFullYear())} — ${WEEKDAYS_BN[date.getDay()]}`;
}

function entryTitle(entry){
  if(entry.kind === 'expense') return entry.category || 'খরচ';
  if(entry.kind === 'receivable') return 'পাই: ' + (entry.person || 'অজানা');
  if(entry.kind === 'payable') return 'দেব: ' + (entry.person || 'অজানা');
  return '';
}
function entryAmountClass(entry){
  if(entry.kind === 'expense') return 'expense';
  if(entry.kind === 'receivable') return 'income';
  if(entry.kind === 'payable') return 'expense';
  return '';
}
function entryKindLabel(kind){
  return {expense:'খরচ', receivable:'পাই', payable:'পাওনা'}[kind] || kind;
}

/* ছোট নোটিফিকেশন (টোস্ট) */
function toast(msg){
  let t = document.createElement('div');
  t.textContent = msg;
  t.style.position = 'fixed';
  t.style.bottom = '20px';
  t.style.right = '20px';
  t.style.background = 'var(--primary)';
  t.style.color = '#fff';
  t.style.padding = '.7rem 1.2rem';
  t.style.borderRadius = '10px';
  t.style.fontFamily = "var(--font-body)";
  t.style.fontSize = '.88rem';
  t.style.boxShadow = '0 6px 20px rgba(0,0,0,.18)';
  t.style.zIndex = 200;
  t.style.opacity = '0';
  t.style.transition = 'opacity .25s ease, transform .25s ease';
  t.style.transform = 'translateY(8px)';
  document.body.appendChild(t);
  requestAnimationFrame(()=>{ t.style.opacity='1'; t.style.transform='translateY(0)'; });
  setTimeout(()=>{
    t.style.opacity='0'; t.style.transform='translateY(8px)';
    setTimeout(()=> t.remove(), 300);
  }, 2200);
}

/* ===================== কনফার্ম মোডাল ===================== */
const confirmModal = document.getElementById('confirmModal');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmYesBtn = document.getElementById('confirmYesBtn');
const confirmNoBtn = document.getElementById('confirmNoBtn');

function openConfirm(title, message, onYes){
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmModal.classList.add('open');
  const yes = () => { onYes(); close(); };
  const close = () => {
    confirmModal.classList.remove('open');
    confirmYesBtn.removeEventListener('click', yes);
    confirmNoBtn.removeEventListener('click', close);
  };
  confirmYesBtn.addEventListener('click', yes);
  confirmNoBtn.addEventListener('click', close);
}

/* =====================================================================
   ন্যাভিগেশন
   ===================================================================== */
const PAGE_TITLES = {
  dashboard: 'ড্যাশবোর্ড',
  'add-entry': 'নতুন এন্ট্রি',
  receivables: 'পাই ও পাওনা',
  tours: 'ট্যুর হিসাব',
  categories: 'ক্যাটাগরি ব্যবস্থাপনা',
  reports: 'পরিসংখ্যান ও রিপোর্ট',
  contacts: 'কন্টাক্টস',
  archive: 'আর্কাইভ',
  settings: 'সেটিংস'
};

function goToPage(pageId){
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === pageId));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === pageId));
  document.getElementById('pageTitle').textContent = PAGE_TITLES[pageId] || '';
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  window.scrollTo({top:0, behavior:'smooth'});
}

document.querySelectorAll('.nav-item, .link-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => goToPage(btn.dataset.page));
});

document.getElementById('hamburgerBtn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
});
document.getElementById('sidebarOverlay').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
});
document.getElementById('bellBtn').addEventListener('click', () => goToPage('settings'));

/* =====================================================================
   এন্ট্রি ফর্ম (খরচ / পাই / পাওনা)
   ===================================================================== */
let currentEntryType = 'expense';

const entryForm        = document.getElementById('entryForm');
const entryIdInput     = document.getElementById('entryId');
const entryCategorySel = document.getElementById('entryCategory');
const entryPersonInput = document.getElementById('entryPerson');
const entryAmountInput = document.getElementById('entryAmount');
const entryDateInput   = document.getElementById('entryDate');
const entryTimeInput   = document.getElementById('entryTime');
const entryNoteInput   = document.getElementById('entryNote');
const entryIsTour      = document.getElementById('entryIsTour');
const tourFields       = document.getElementById('tourFields');
const entryTourSel     = document.getElementById('entryTour');
const entryTourCatSel  = document.getElementById('entryTourCategory');
const categoryRow      = document.getElementById('categoryRow');
const personRow        = document.getElementById('personRow');
const entryFormTitle   = document.getElementById('entryFormTitle');
const tourCheckboxRow  = entryIsTour.closest('.form-row');

document.querySelectorAll('#entryTypeControl .seg').forEach(seg => {
  seg.addEventListener('click', () => {
    document.querySelectorAll('#entryTypeControl .seg').forEach(s => s.classList.remove('active'));
    seg.classList.add('active');
    currentEntryType = seg.dataset.value;
    updateEntryFormForType();
  });
});

function updateEntryFormForType(){
  if(currentEntryType === 'expense'){
    categoryRow.style.display = '';
    personRow.style.display = 'none';
    tourCheckboxRow.style.display = '';
    entryCategorySel.required = true;
    entryPersonInput.required = false;
  } else {
    categoryRow.style.display = 'none';
    personRow.style.display = '';
    tourCheckboxRow.style.display = 'none';
    entryIsTour.checked = false;
    tourFields.style.display = 'none';
    entryCategorySel.required = false;
    entryPersonInput.required = true;
  }
}

entryIsTour.addEventListener('change', () => {
  tourFields.style.display = entryIsTour.checked ? '' : 'none';
});

function populateCategorySelect(){
  entryCategorySel.innerHTML = state.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}
function populateTourSelect(){
  if(state.tours.length === 0){
    entryTourSel.innerHTML = `<option value="">— প্রথমে "ট্যুর হিসাব" থেকে একটি ট্যুর তৈরি করুন —</option>`;
  } else {
    entryTourSel.innerHTML = state.tours.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  }
}
function populateContactDatalist(){
  document.getElementById('contactList').innerHTML =
    state.contacts.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.phone)}</option>`).join('');
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function resetEntryForm(){
  entryForm.reset();
  entryIdInput.value = '';
  entryDateInput.value = todayStr();
  entryTimeInput.value = nowTimeStr();
  currentEntryType = 'expense';
  document.querySelectorAll('#entryTypeControl .seg').forEach(s => s.classList.toggle('active', s.dataset.value === 'expense'));
  updateEntryFormForType();
  entryFormTitle.innerHTML = `<i data-lucide="pencil-line"></i> নতুন এন্ট্রি যোগ করুন`;
  refreshIcons();
}

document.getElementById('resetFormBtn').addEventListener('click', resetEntryForm);

entryForm.addEventListener('submit', e => {
  e.preventDefault();
  const amount = parseFloat(entryAmountInput.value);
  if(isNaN(amount) || amount <= 0){
    alert('সঠিক পরিমাণ লিখুন।');
    return;
  }
  const editingId = entryIdInput.value;
  const base = {
    kind: currentEntryType,
    amount,
    date: entryDateInput.value,
    time: entryTimeInput.value,
    note: entryNoteInput.value.trim(),
    category: currentEntryType === 'expense' ? entryCategorySel.value : null,
    person: currentEntryType !== 'expense' ? entryPersonInput.value.trim() : null,
    isTour: currentEntryType === 'expense' && entryIsTour.checked,
    tourId: (currentEntryType === 'expense' && entryIsTour.checked) ? entryTourSel.value : null,
    tourCategory: (currentEntryType === 'expense' && entryIsTour.checked) ? entryTourCatSel.value : null,
  };

  if(editingId){
    const idx = state.entries.findIndex(en => en.id === editingId);
    if(idx > -1){
      const old = { ...state.entries[idx], archivedAt: new Date().toISOString(), archiveReason: 'সম্পাদনার পূর্বের সংস্করণ' };
      state.archive.unshift(old);
      state.entries[idx] = { ...state.entries[idx], ...base, updatedAt: new Date().toISOString() };
    }
    toast('এন্ট্রি আপডেট হয়েছে। পূর্বের তথ্য আর্কাইভে সংরক্ষিত হয়েছে।');
  } else {
    state.entries.unshift({
      id: uid(),
      ...base,
      settled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    toast('এন্ট্রি সংরক্ষিত হয়েছে।');
  }

  saveState();
  renderAll();
  resetEntryForm();
});

function editEntry(id){
  const entry = state.entries.find(en => en.id === id);
  if(!entry) return;
  entryIdInput.value = entry.id;
  document.querySelectorAll('#entryTypeControl .seg').forEach(s => s.classList.toggle('active', s.dataset.value === entry.kind));
  currentEntryType = entry.kind;
  updateEntryFormForType();
  if(entry.kind === 'expense'){
    entryCategorySel.value = entry.category || state.categories[0];
  } else {
    entryPersonInput.value = entry.person || '';
  }
  entryAmountInput.value = entry.amount;
  entryDateInput.value = entry.date;
  entryTimeInput.value = entry.time;
  entryNoteInput.value = entry.note || '';
  entryIsTour.checked = !!entry.isTour;
  tourFields.style.display = entry.isTour ? '' : 'none';
  if(entry.isTour){
    entryTourSel.value = entry.tourId || '';
    entryTourCatSel.value = entry.tourCategory || 'ভাড়া';
  }
  entryFormTitle.innerHTML = `<i data-lucide="pencil-line"></i> এন্ট্রি সম্পাদনা করুন`;
  refreshIcons();
  goToPage('add-entry');
}

function deleteEntry(id){
  openConfirm('এন্ট্রি ডিলিট করুন', 'এই এন্ট্রিটি তালিকা থেকে মুছে আর্কাইভে পাঠানো হবে। পরে প্রয়োজনে পুনরুদ্ধার করা যাবে।', () => {
    const idx = state.entries.findIndex(en => en.id === id);
    if(idx === -1) return;
    const entry = { ...state.entries[idx], archivedAt: new Date().toISOString(), archiveReason: 'ডিলিট করা হয়েছে' };
    state.archive.unshift(entry);
    state.entries.splice(idx, 1);
    saveState();
    renderAll();
    toast('এন্ট্রি আর্কাইভে পাঠানো হয়েছে।');
  });
}

function settleEntry(id){
  const entry = state.entries.find(en => en.id === id);
  if(!entry) return;
  const label = entry.kind === 'receivable' ? 'পরিশোধ পেয়েছেন' : 'পরিশোধ করেছেন';
  openConfirm('পরিশোধ সম্পন্ন', `নিশ্চিত করুন যে আপনি এই টাকা ${label}। এটি আর্কাইভে চলে যাবে।`, () => {
    const idx = state.entries.findIndex(en => en.id === id);
    const archived = { ...state.entries[idx], settled: true, archivedAt: new Date().toISOString(), archiveReason: 'পরিশোধ সম্পন্ন হয়েছে' };
    state.archive.unshift(archived);
    state.entries.splice(idx, 1);
    saveState();
    renderAll();
    toast('লেনদেনটি পরিশোধ হিসেবে চিহ্নিত হয়েছে।');
  });
}

/* =====================================================================
   রেন্ডার: ড্যাশবোর্ড
   ===================================================================== */
function renderDashboard(){
  document.getElementById('dashName').textContent = state.settings.name;

  const today = todayStr();
  const now = new Date();

  const todayExpense = state.entries
    .filter(e => e.kind === 'expense' && e.date === today)
    .reduce((s,e) => s + e.amount, 0);

  const monthExpense = state.entries
    .filter(e => e.kind === 'expense' && e.date && e.date.slice(0,7) === today.slice(0,7))
    .reduce((s,e) => s + e.amount, 0);

  const totalReceivable = state.entries
    .filter(e => e.kind === 'receivable')
    .reduce((s,e) => s + e.amount, 0);

  const totalPayable = state.entries
    .filter(e => e.kind === 'payable')
    .reduce((s,e) => s + e.amount, 0);

  document.getElementById('statTodayExpense').textContent = taka(todayExpense);
  document.getElementById('statMonthExpense').textContent = taka(monthExpense);
  document.getElementById('statTotalReceivable').textContent = taka(totalReceivable);
  document.getElementById('statTotalPayable').textContent = taka(totalPayable);

  // মাসিক বাজেট
  const budget = state.settings.monthlyBudget || 0;
  const budgetEmpty = document.getElementById('budgetEmptyState');
  const budgetContent = document.getElementById('budgetContent');
  if(budget <= 0){
    budgetEmpty.style.display = 'block';
    budgetContent.style.display = 'none';
  } else {
    budgetEmpty.style.display = 'none';
    budgetContent.style.display = 'block';
    const pct = Math.min(100, (monthExpense / budget) * 100);
    const fill = document.getElementById('budgetProgressFill');
    fill.style.width = pct + '%';
    fill.classList.toggle('over-budget', monthExpense > budget);
    document.getElementById('budgetSpentLabel').textContent = `খরচ হয়েছে: ${taka(monthExpense)}`;
    document.getElementById('budgetTotalLabel').textContent = `বাজেট: ${taka(budget)}`;
    const remainText = document.getElementById('budgetRemainingText');
    const remain = budget - monthExpense;
    if(remain >= 0){
      remainText.textContent = `অবশিষ্ট আছে: ${taka(remain)} (এই মাসের জন্য)`;
      remainText.className = 'budget-remaining ok';
    } else {
      remainText.textContent = `বাজেট অতিক্রম হয়েছে: ${taka(Math.abs(remain))}`;
      remainText.className = 'budget-remaining over';
    }
  }

  // রিমাইন্ডার স্ট্যাটাস
  const reminderText = document.getElementById('reminderStatusText');
  const markDoneBtn = document.getElementById('markDoneBtn');
  if(state.settings.lastReminderDate === today){
    reminderText.textContent = '✓ আজকের সব খরচ এন্ট্রি সম্পন্ন হিসেবে চিহ্নিত করা হয়েছে। ধন্যবাদ!';
    markDoneBtn.textContent = 'পুনরায় চিহ্নিত করুন';
  } else {
    reminderText.textContent = 'আজকের সব খরচ ও লেনদেন কি এন্ট্রি করা হয়েছে? নিচের বাটনে ক্লিক করে নিশ্চিত করুন।';
    markDoneBtn.textContent = 'আজকের এন্ট্রি সম্পন্ন';
  }

  // সাম্প্রতিক লেনদেন
  const recent = [...state.entries]
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  const recentWrap = document.getElementById('recentEntries');
  if(recent.length === 0){
    recentWrap.innerHTML = `<div class="empty-state">কোনো এন্ট্রি নেই। "নতুন এন্ট্রি" থেকে শুরু করুন।</div>`;
  } else {
    recentWrap.innerHTML = recent.map(e => `
      <div class="entry-row">
        <div class="entry-main">
          <span class="entry-title">${escapeHtml(entryTitle(e))}</span>
          <span class="entry-sub">${formatDateDMY(e.date)} · ${formatTimeBn(e.time)}${e.note ? ' · ' + escapeHtml(e.note) : ''}</span>
        </div>
        <span class="entry-amount ${entryAmountClass(e)}">${taka(e.amount)}</span>
      </div>
    `).join('');
  }
}

/* =====================================================================
   রেন্ডার: খরচের তালিকা (নতুন এন্ট্রি পেজের নিচে)
   ===================================================================== */
function renderExpenseTable(){
  const search = document.getElementById('expenseSearch').value.trim().toLowerCase();
  const tbody = document.querySelector('#expenseTable tbody');
  let rows = state.entries.filter(e => e.kind === 'expense');
  if(search){
    rows = rows.filter(e =>
      (e.category && e.category.toLowerCase().includes(search)) ||
      (e.note && e.note.toLowerCase().includes(search))
    );
  }
  rows = rows.sort((a,b) => (b.date+b.time).localeCompare(a.date+a.time));

  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">কোনো খরচের তথ্য পাওয়া যায়নি।</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(e => `
    <tr>
      <td>${formatDateDMY(e.date)}</td>
      <td>${formatTimeBn(e.time)}</td>
      <td>${escapeHtml(e.category || '')}${e.isTour ? ` <span class="badge income" style="font-size:.65rem;padding:.1rem .5rem;">ট্যুর</span>` : ''}</td>
      <td>${escapeHtml(e.note || '')}</td>
      <td class="num expense">${taka(e.amount)}</td>
      <td>
        <div class="entry-actions">
          <button class="icon-btn" data-action="edit" data-id="${e.id}" title="সম্পাদনা"><i data-lucide="pencil"></i></button>
          <button class="icon-btn danger" data-action="delete" data-id="${e.id}" title="ডিলিট"><i data-lucide="trash-2"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
}

document.getElementById('expenseSearch').addEventListener('input', renderExpenseTable);

document.querySelector('#expenseTable tbody').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if(!btn) return;
  const id = btn.dataset.id;
  if(btn.dataset.action === 'edit') editEntry(id);
  if(btn.dataset.action === 'delete') deleteEntry(id);
});

/* =====================================================================
   রেন্ডার: পাই ও পাওনা
   ===================================================================== */
function renderReceivables(){
  const receivables = state.entries.filter(e => e.kind === 'receivable');
  const payables = state.entries.filter(e => e.kind === 'payable');

  document.getElementById('receivableTotal').textContent = taka(receivables.reduce((s,e)=>s+e.amount,0));
  document.getElementById('payableTotal').textContent = taka(payables.reduce((s,e)=>s+e.amount,0));

  renderDueList('receivableList', receivables, 'income');
  renderDueList('payableList', payables, 'expense');
}

function renderDueList(containerId, list, amountClass){
  const wrap = document.getElementById(containerId);
  if(list.length === 0){
    wrap.innerHTML = `<div class="empty-state">কোনো হিসাব নেই।</div>`;
    return;
  }
  wrap.innerHTML = [...list].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)).map(e => `
    <div class="entry-row">
      <div class="entry-main">
        <span class="entry-title">${escapeHtml(e.person || 'অজানা')}</span>
        <span class="entry-sub">${formatDateDMY(e.date)} · ${formatTimeBn(e.time)}${e.note ? ' · ' + escapeHtml(e.note) : ''}</span>
      </div>
      <span class="entry-amount ${amountClass}">${taka(e.amount)}</span>
      <div class="entry-actions">
        <button class="icon-btn" data-action="settle" data-id="${e.id}" title="পরিশোধ হয়েছে"><i data-lucide="check-circle-2"></i></button>
        <button class="icon-btn" data-action="edit" data-id="${e.id}" title="সম্পাদনা"><i data-lucide="pencil"></i></button>
        <button class="icon-btn danger" data-action="delete" data-id="${e.id}" title="ডিলিট"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
  `).join('');
}

['receivableList','payableList'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if(!btn) return;
    const entryId = btn.dataset.id;
    if(btn.dataset.action === 'edit') editEntry(entryId);
    if(btn.dataset.action === 'delete') deleteEntry(entryId);
    if(btn.dataset.action === 'settle') settleEntry(entryId);
  });
});

/* =====================================================================
   ট্যুর হিসাব
   ===================================================================== */
document.getElementById('tourForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('tourName').value.trim();
  const start = document.getElementById('tourStart').value;
  const end = document.getElementById('tourEnd').value;
  if(!name || !start) return;
  state.tours.unshift({ id: uid(), name, start, end: end || '' });
  saveState();
  document.getElementById('tourForm').reset();
  renderAll();
  toast('ট্যুর তৈরি হয়েছে।');
});

function renderTours(){
  populateTourSelect();
  const wrap = document.getElementById('tourCardsWrap');
  if(state.tours.length === 0){
    wrap.innerHTML = `<div class="ledger-card"><div class="empty-state">এখনো কোনো ট্যুর তৈরি করা হয়নি। উপরের ফর্ম থেকে একটি ট্যুর তৈরি করুন।</div></div>`;
    return;
  }
  wrap.innerHTML = state.tours.map(tour => {
    const items = state.entries.filter(e => e.kind === 'expense' && e.isTour && e.tourId === tour.id);
    const totals = {};
    TOUR_CATS.forEach(c => totals[c] = 0);
    let grand = 0;
    items.forEach(it => {
      const cat = TOUR_CATS.includes(it.tourCategory) ? it.tourCategory : 'অন্যান্য';
      totals[cat] += it.amount;
      grand += it.amount;
    });

    const itemsHtml = items.length === 0
      ? `<div class="empty-state">এই ট্যুরে এখনো কোনো খরচ যুক্ত হয়নি। "নতুন এন্ট্রি" পেজ থেকে "ট্যুর সম্পর্কিত খরচ" চেকবক্স দিয়ে যুক্ত করুন।</div>`
      : [...items].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).map(it => `
        <div class="entry-row">
          <div class="entry-main">
            <span class="entry-title">${escapeHtml(it.tourCategory || 'অন্যান্য')} — ${escapeHtml(it.note || '')}</span>
            <span class="entry-sub">${formatDateDMY(it.date)} · ${formatTimeBn(it.time)}</span>
          </div>
          <span class="entry-amount expense">${taka(it.amount)}</span>
          <div class="entry-actions">
            <button class="icon-btn" data-action="edit" data-id="${it.id}" title="সম্পাদনা"><i data-lucide="pencil"></i></button>
            <button class="icon-btn danger" data-action="delete" data-id="${it.id}" title="ডিলিট"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
      `).join('');

    return `
      <div class="ledger-card tour-card">
        <div class="tour-head">
          <div>
            <h4>${escapeHtml(tour.name)}</h4>
            <p>${formatDateDMY(tour.start)}${tour.end ? ' — ' + formatDateDMY(tour.end) : ''} · সর্বমোট খরচ: <strong>${taka(grand)}</strong></p>
          </div>
          <button class="btn btn-danger" data-action="delete-tour" data-id="${tour.id}"><i data-lucide="trash-2"></i> ট্যুর মুছুন</button>
        </div>
        <div class="tour-breakdown">
          ${TOUR_CATS.map(c => `
            <div class="tour-stat">
              <p class="label">${c}</p>
              <p class="value">${taka(totals[c])}</p>
            </div>
          `).join('')}
        </div>
        <div class="entry-list">${itemsHtml}</div>
      </div>
    `;
  }).join('');

  // ডায়নামিক বাটনের জন্য ইভেন্ট
  wrap.querySelectorAll('[data-action="edit"]').forEach(b => b.addEventListener('click', () => editEntry(b.dataset.id)));
  wrap.querySelectorAll('[data-action="delete"]').forEach(b => b.addEventListener('click', () => deleteEntry(b.dataset.id)));
  wrap.querySelectorAll('[data-action="delete-tour"]').forEach(b => b.addEventListener('click', () => deleteTour(b.dataset.id)));
  refreshIcons();
}

function deleteTour(tourId){
  openConfirm('ট্যুর মুছুন', 'এই ট্যুর এবং এর সাথে যুক্ত সব খরচ আর্কাইভে পাঠানো হবে। নিশ্চিত করুন।', () => {
    const linked = state.entries.filter(e => e.tourId === tourId);
    linked.forEach(e => {
      state.archive.unshift({ ...e, archivedAt: new Date().toISOString(), archiveReason: 'ট্যুর মুছে ফেলার কারণে' });
    });
    state.entries = state.entries.filter(e => e.tourId !== tourId);
    state.tours = state.tours.filter(t => t.id !== tourId);
    saveState();
    renderAll();
    toast('ট্যুর মুছে ফেলা হয়েছে।');
  });
}

/* =====================================================================
   ক্যাটাগরি ব্যবস্থাপনা
   ===================================================================== */
document.getElementById('categoryForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('categoryName');
  const name = input.value.trim();
  if(!name) return;
  if(state.categories.includes(name)){
    toast('এই ক্যাটাগরি আগেই আছে।');
    return;
  }
  state.categories.push(name);
  saveState();
  input.value = '';
  renderAll();
  toast('ক্যাটাগরি যুক্ত হয়েছে।');
});

let categoryChartInstance = null;

function renderCategories(){
  populateCategorySelect();

  // মোট হিসাব (সর্বমোট, এন্ট্রিতে থাকা সব ক্যাটাগরি বিবেচনায়)
  const totals = {};
  state.entries.filter(e => e.kind === 'expense').forEach(e => {
    const cat = e.category || 'অন্যান্য';
    totals[cat] = (totals[cat] || 0) + e.amount;
  });
  // ক্যাটাগরি তালিকায় না থাকলেও যুক্ত করা
  Object.keys(totals).forEach(c => { if(!state.categories.includes(c)) state.categories.push(c); });

  const sorted = state.categories
    .map(c => ({ name: c, total: totals[c] || 0 }))
    .sort((a,b) => b.total - a.total);

  const listWrap = document.getElementById('categoryList');
  listWrap.innerHTML = sorted.map(c => `
    <div class="entry-row">
      <div class="entry-main">
        <span class="entry-title">${escapeHtml(c.name)}</span>
      </div>
      <span class="entry-amount expense">${taka(c.total)}</span>
      <div class="entry-actions">
        <button class="icon-btn danger" data-action="delete-category" data-cat="${escapeHtml(c.name)}" title="তালিকা থেকে মুছুন"><i data-lucide="x"></i></button>
      </div>
    </div>
  `).join('');

  listWrap.querySelectorAll('[data-action="delete-category"]').forEach(b => {
    b.addEventListener('click', () => {
      const cat = b.dataset.cat;
      openConfirm('ক্যাটাগরি মুছুন', `"${cat}" ক্যাটাগরিটি নতুন এন্ট্রির তালিকা থেকে মুছে যাবে (পূর্বের এন্ট্রিগুলো অপরিবর্তিত থাকবে)।`, () => {
        state.categories = state.categories.filter(c => c !== cat);
        saveState();
        renderAll();
      });
    });
  });

  // চার্ট
  const ctx = document.getElementById('categoryChart');
  const chartData = sorted.filter(c => c.total > 0);
  if(typeof Chart === 'undefined'){
    refreshIcons();
    return;
  }
  if(categoryChartInstance) categoryChartInstance.destroy();
  if(chartData.length === 0){
    return;
  }
  categoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: chartData.map(c => c.name),
      datasets: [{
        data: chartData.map(c => c.total),
        backgroundColor: ['#2B3D2F','#B08D4F','#7C3B3B','#3D5C46','#A98F6A','#5B6F5F','#C9AE7C','#8C4F4F','#41594A'],
        borderColor: '#FFFDF9',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: "'Hind Siliguri', sans-serif" }, boxWidth: 14 } }
      }
    }
  });
  refreshIcons();
}

/* =====================================================================
   রিপোর্ট ও পরিসংখ্যান
   ===================================================================== */
let monthlyChartInstance = null;
let yearlyChartInstance = null;
let currentFilteredEntries = [];

function populateReportCategorySelect(){
  const sel = document.getElementById('reportCategory');
  const current = sel.value;
  sel.innerHTML = `<option value="all">সব ক্যাটাগরি</option>` +
    state.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if([...sel.options].some(o => o.value === current)) sel.value = current;
}

document.getElementById('applyFilterBtn').addEventListener('click', () => renderReportTable());
document.getElementById('clearFilterBtn').addEventListener('click', () => {
  document.getElementById('reportFrom').value = '';
  document.getElementById('reportTo').value = '';
  document.getElementById('reportCategory').value = 'all';
  renderReportTable();
});

function renderReportTable(){
  const from = document.getElementById('reportFrom').value;
  const to = document.getElementById('reportTo').value;
  const cat = document.getElementById('reportCategory').value;

  let rows = [...state.entries];
  if(from) rows = rows.filter(e => e.date >= from);
  if(to) rows = rows.filter(e => e.date <= to);
  if(cat !== 'all') rows = rows.filter(e => e.kind !== 'expense' || e.category === cat);

  rows.sort((a,b) => (b.date+b.time).localeCompare(a.date+a.time));
  currentFilteredEntries = rows;

  const tbody = document.querySelector('#reportTable tbody');
  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">কোনো তথ্য পাওয়া যায়নি।</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(e => `
    <tr>
      <td>${formatDateDMY(e.date)}</td>
      <td>${formatTimeBn(e.time)}</td>
      <td>${entryKindLabel(e.kind)}</td>
      <td>${escapeHtml(e.kind === 'expense' ? (e.category || '') : (e.person || ''))}</td>
      <td>${escapeHtml(e.note || '')}</td>
      <td class="num ${entryAmountClass(e)}">${taka(e.amount)}</td>
    </tr>
  `).join('');
}

function renderCharts(){
  if(typeof Chart === 'undefined') return;

  const year = new Date().getFullYear();
  const monthly = new Array(12).fill(0);
  const yearly = {};

  state.entries.filter(e => e.kind === 'expense').forEach(e => {
    const y = parseInt(e.date.slice(0,4));
    const m = parseInt(e.date.slice(5,7)) - 1;
    if(y === year) monthly[m] += e.amount;
    yearly[y] = (yearly[y] || 0) + e.amount;
  });

  const ctx1 = document.getElementById('monthlyChart');
  if(monthlyChartInstance) monthlyChartInstance.destroy();
  monthlyChartInstance = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: MONTHS_BN.map(m => m.slice(0,3)),
      datasets: [{ label: `${bnDigits(year)} সালের খরচ`, data: monthly, backgroundColor: '#2B3D2F', borderRadius: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { family: "'Hind Siliguri', sans-serif" } } } },
      scales: {
        x: { ticks: { font: { family: "'Hind Siliguri', sans-serif" } } },
        y: { ticks: { callback: v => bnDigits(v), font: { family: "'Hind Siliguri', sans-serif" } } }
      }
    }
  });

  const years = Object.keys(yearly).sort();
  const ctx2 = document.getElementById('yearlyChart');
  if(yearlyChartInstance) yearlyChartInstance.destroy();
  yearlyChartInstance = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: years.map(y => bnDigits(y)),
      datasets: [{ label: 'বাৎসরিক খরচ', data: years.map(y => yearly[y]), backgroundColor: '#B08D4F', borderRadius: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { family: "'Hind Siliguri', sans-serif" } } } },
      scales: {
        x: { ticks: { font: { family: "'Hind Siliguri', sans-serif" } } },
        y: { ticks: { callback: v => bnDigits(v), font: { family: "'Hind Siliguri', sans-serif" } } }
      }
    }
  });
}

/* ----- PDF/প্রিন্ট এক্সপোর্ট ----- */
document.getElementById('downloadPdfBtn').addEventListener('click', () => {
  if(currentFilteredEntries.length === 0) renderReportTable();
  const rows = currentFilteredEntries.length ? currentFilteredEntries : state.entries;

  document.getElementById('printName').textContent = state.settings.name;
  const from = document.getElementById('reportFrom').value;
  const to = document.getElementById('reportTo').value;
  document.getElementById('printRange').textContent =
    (from || to) ? `সময়কাল: ${from ? formatDateDMY(from) : '...'} — ${to ? formatDateDMY(to) : '...'}` : `সময়কাল: সব তথ্য`;

  const tbody = document.querySelector('#printTable tbody');
  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="6">কোনো তথ্য পাওয়া যায়নি।</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(e => `
      <tr>
        <td>${formatDateDMY(e.date)}</td>
        <td>${formatTimeBn(e.time)}</td>
        <td>${entryKindLabel(e.kind)}</td>
        <td>${escapeHtml(e.kind === 'expense' ? (e.category || '') : (e.person || ''))}</td>
        <td>${escapeHtml(e.note || '')}</td>
        <td>${taka(e.amount)}</td>
      </tr>
    `).join('');
  }

  const totalExpense = rows.filter(e=>e.kind==='expense').reduce((s,e)=>s+e.amount,0);
  const totalReceivable = rows.filter(e=>e.kind==='receivable').reduce((s,e)=>s+e.amount,0);
  const totalPayable = rows.filter(e=>e.kind==='payable').reduce((s,e)=>s+e.amount,0);
  document.getElementById('printSummary').innerHTML = `
    মোট খরচ: ${taka(totalExpense)} &nbsp;|&nbsp;
    মোট পাই: ${taka(totalReceivable)} &nbsp;|&nbsp;
    মোট পাওনা: ${taka(totalPayable)}
  `;

  window.print();
});

/* ----- CSV এক্সপোর্ট ----- */
document.getElementById('downloadCsvBtn').addEventListener('click', () => {
  if(currentFilteredEntries.length === 0) renderReportTable();
  const rows = currentFilteredEntries.length ? currentFilteredEntries : state.entries;

  if(rows.length === 0){
    toast('ডাউনলোডের জন্য কোনো তথ্য পাওয়া যায়নি।');
    return;
  }

  const header = ['তারিখ','সময়','ধরন','খাত/ব্যক্তি','নোট','পরিমাণ'];
  const csvRows = [header.map(csvEscape).join(',')];
  rows.forEach(e => {
    csvRows.push([
      formatDateDMY(e.date),
      e.time || '',
      entryKindLabel(e.kind),
      e.kind === 'expense' ? (e.category || '') : (e.person || ''),
      e.note || '',
      e.amount
    ].map(csvEscape).join(','));
  });

  // এক্সেলে বাংলা সঠিকভাবে দেখানোর জন্য UTF-8 BOM যুক্ত করা হলো
  const csvContent = '\uFEFF' + csvRows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mahims-ledger-statement-${todayStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('CSV ফাইল ডাউনলোড হয়েছে।');
});

function csvEscape(val){
  const s = String(val ?? '');
  if(/[",\n\r]/.test(s)){
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/* =====================================================================
   কন্টাক্টস
   ===================================================================== */
document.getElementById('contactForm').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('contactId').value;
  const name = document.getElementById('contactName').value.trim();
  const phone = document.getElementById('contactPhone').value.trim();
  if(!name || !phone) return;
  if(id){
    const c = state.contacts.find(c => c.id === id);
    if(c){ c.name = name; c.phone = phone; }
  } else {
    state.contacts.unshift({ id: uid(), name, phone });
  }
  saveState();
  document.getElementById('contactForm').reset();
  document.getElementById('contactId').value = '';
  renderAll();
  toast('কন্টাক্ট সংরক্ষিত হয়েছে।');
});

document.getElementById('contactSearch').addEventListener('input', renderContacts);

function renderContacts(){
  populateContactDatalist();
  const search = document.getElementById('contactSearch').value.trim().toLowerCase();
  let list = [...state.contacts];
  if(search){
    list = list.filter(c => c.name.toLowerCase().includes(search) || c.phone.toLowerCase().includes(search));
  }
  list.sort((a,b) => a.name.localeCompare(b.name, 'bn'));

  const wrap = document.getElementById('contactsList');
  if(list.length === 0){
    wrap.innerHTML = `<div class="empty-state">কোনো কন্টাক্ট নেই। উপরের ফর্ম থেকে যুক্ত করুন বা গুগল কন্টাক্টস থেকে ইম্পোর্ট করুন।</div>`;
    return;
  }
  wrap.innerHTML = list.map(c => `
    <div class="entry-row">
      <div class="entry-main">
        <span class="entry-title">${escapeHtml(c.name)}</span>
        <span class="entry-sub">${escapeHtml(c.phone)}</span>
      </div>
      <div class="entry-actions">
        <button class="icon-btn" data-action="edit-contact" data-id="${c.id}" title="সম্পাদনা"><i data-lucide="pencil"></i></button>
        <button class="icon-btn danger" data-action="delete-contact" data-id="${c.id}" title="ডিলিট"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('[data-action="edit-contact"]').forEach(b => b.addEventListener('click', () => {
    const c = state.contacts.find(c => c.id === b.dataset.id);
    if(!c) return;
    document.getElementById('contactId').value = c.id;
    document.getElementById('contactName').value = c.name;
    document.getElementById('contactPhone').value = c.phone;
    window.scrollTo({top:0, behavior:'smooth'});
  }));
  wrap.querySelectorAll('[data-action="delete-contact"]').forEach(b => b.addEventListener('click', () => {
    openConfirm('কন্টাক্ট ডিলিট করুন', 'এই কন্টাক্টটি স্থায়ীভাবে মুছে যাবে।', () => {
      state.contacts = state.contacts.filter(c => c.id !== b.dataset.id);
      saveState();
      renderAll();
    });
  }));
  refreshIcons();
}

/* ----- গুগল কন্টাক্টস CSV ইম্পোর্ট ----- */
document.getElementById('csvFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try{
      // ফাইলের শুরুতে থাকা BOM (Byte Order Mark) ক্যারেক্টার মুছে ফেলা হচ্ছে
      const text = String(ev.target.result).replace(/^\uFEFF/, '');
      const rows = parseCSV(text);
      if(rows.length < 2){ toast('ফাইলে কোনো তথ্য পাওয়া যায়নি।'); return; }

      const header = rows[0].map(h => h.replace(/^\uFEFF/, '').trim());

      // নামের কলাম খোঁজা — "Name" অথবা "Given Name" + "Family Name"
      const nameIdx   = header.findIndex(h => h.toLowerCase() === 'name');
      const givenIdx  = header.findIndex(h => /given\s*name/i.test(h));
      const familyIdx = header.findIndex(h => /family\s*name/i.test(h));

      // ফোন নম্বরের কলাম খোঁজা — "Phone 1 - Value", "Phone 2 - Value" ইত্যাদি সব
      const phoneIdxs = header
        .map((h, i) => (/phone\s*\d*\s*-?\s*value/i.test(h) ? i : -1))
        .filter(i => i !== -1);

      if(nameIdx === -1 && givenIdx === -1 && familyIdx === -1){
        toast('CSV ফাইলে নাম-সংক্রান্ত কোনো কলাম ("Name") পাওয়া যায়নি।');
        return;
      }
      if(phoneIdxs.length === 0){
        toast('CSV ফাইলে ফোন নম্বরের কোনো কলাম ("Phone ... Value") পাওয়া যায়নি।');
        return;
      }

      let added = 0;
      for(let i=1; i<rows.length; i++){
        const row = rows[i];

        let name = nameIdx !== -1 ? (row[nameIdx] || '').trim() : '';
        if(!name){
          const given = givenIdx !== -1 ? (row[givenIdx] || '').trim() : '';
          const family = familyIdx !== -1 ? (row[familyIdx] || '').trim() : '';
          name = [given, family].filter(Boolean).join(' ').trim();
        }

        // একাধিক ফোন কলামের মধ্যে প্রথম যেটাতে মান আছে সেটি নেওয়া হবে
        let phone = '';
        for(const pi of phoneIdxs){
          const val = (row[pi] || '').trim();
          if(val){ phone = val; break; }
        }

        if(!name || !phone) continue;
        const exists = state.contacts.some(c => c.name === name && c.phone === phone);
        if(!exists){
          state.contacts.unshift({ id: uid(), name, phone });
          added++;
        }
      }
      saveState();
      renderAll();
      toast(`${bnDigits(added)} টি কন্টাক্ট যুক্ত হয়েছে।`);
    }catch(err){
      console.error(err);
      toast('CSV ফাইল পড়তে সমস্যা হয়েছে।');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// সাধারণ CSV পার্সার (কোটেড কমা সাপোর্ট সহ)
function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0; i<text.length; i++){
    const ch = text[i];
    if(inQuotes){
      if(ch === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if(ch === '"') inQuotes = true;
      else if(ch === ','){ row.push(field); field=''; }
      else if(ch === '\n' || ch === '\r'){
        if(ch === '\r' && text[i+1] === '\n') i++;
        row.push(field); field='';
        if(row.length > 1 || row[0] !== ''){ rows.push(row); }
        row = [];
      } else field += ch;
    }
  }
  if(field !== '' || row.length){ row.push(field); rows.push(row); }
  return rows;
}

/* =====================================================================
   আর্কাইভ
   ===================================================================== */
function renderArchive(){
  const tbody = document.querySelector('#archiveTable tbody');
  if(state.archive.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">আর্কাইভ খালি।</td></tr>`;
    return;
  }
  const list = [...state.archive].sort((a,b)=> new Date(b.archivedAt) - new Date(a.archivedAt));
  tbody.innerHTML = list.map(e => `
    <tr>
      <td>${formatDateDMY(e.date)}</td>
      <td>${entryKindLabel(e.kind)}</td>
      <td>${escapeHtml(e.kind === 'expense' ? (e.category || '') : (e.person || ''))}</td>
      <td class="num ${entryAmountClass(e)}">${taka(e.amount)}</td>
      <td>${escapeHtml(e.archiveReason || '')}</td>
      <td>
        <div class="entry-actions">
          <button class="icon-btn" data-action="restore" data-id="${e.id}" data-archived="${e.archivedAt}" title="পুনরুদ্ধার"><i data-lucide="rotate-ccw"></i></button>
          <button class="icon-btn danger" data-action="perm-delete" data-id="${e.id}" data-archived="${e.archivedAt}" title="স্থায়ীভাবে মুছুন"><i data-lucide="x"></i></button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-action="restore"]').forEach(b => b.addEventListener('click', () => {
    const item = state.archive.find(x => x.id === b.dataset.id && x.archivedAt === b.dataset.archived);
    if(!item) return;
    const { archivedAt, archiveReason, ...rest } = item;
    state.entries.unshift({ ...rest, settled: false });
    state.archive = state.archive.filter(x => !(x.id === item.id && x.archivedAt === item.archivedAt));
    saveState();
    renderAll();
    toast('এন্ট্রি পুনরুদ্ধার করা হয়েছে।');
  }));

  tbody.querySelectorAll('[data-action="perm-delete"]').forEach(b => b.addEventListener('click', () => {
    openConfirm('স্থায়ীভাবে ডিলিট', 'এই এন্ট্রিটি আর্কাইভ থেকেও স্থায়ীভাবে মুছে যাবে — এটি ফিরিয়ে আনা যাবে না।', () => {
      state.archive = state.archive.filter(x => !(x.id === b.dataset.id && x.archivedAt === b.dataset.archived));
      saveState();
      renderAll();
    });
  }));
  refreshIcons();
}

/* =====================================================================
   সেটিংস
   ===================================================================== */
function loadSettingsForm(){
  document.getElementById('settingName').value = state.settings.name;
  document.getElementById('settingMonthlyBudget').value = state.settings.monthlyBudget || '';
  document.getElementById('reminderEnabled').checked = state.settings.reminderEnabled;
  document.getElementById('reminderTime').value = state.settings.reminderTime;
}

document.getElementById('saveSettingsBtn').addEventListener('click', () => {
  state.settings.name = document.getElementById('settingName').value.trim() || state.settings.name;
  state.settings.monthlyBudget = Math.max(0, Number(document.getElementById('settingMonthlyBudget').value) || 0);
  state.settings.reminderEnabled = document.getElementById('reminderEnabled').checked;
  state.settings.reminderTime = document.getElementById('reminderTime').value || '21:00';
  saveState();
  renderAll();
  toast('সেটিংস সংরক্ষিত হয়েছে।');
});

document.getElementById('exportDataBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mahims-ledger-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById('importDataInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try{
      const data = JSON.parse(ev.target.result);
      if(!data || !Array.isArray(data.entries)){
        toast('ফাইলটি সঠিক ব্যাকআপ ফরম্যাটে নেই।');
        return;
      }
      openConfirm('ব্যাকআপ আমদানি করুন', 'এটি বর্তমান সব ডেটার সাথে প্রতিস্থাপিত হবে। আপনি কি নিশ্চিত?', () => {
        const def = defaultState();
        state = {
          entries: data.entries || [],
          archive: data.archive || [],
          tours: data.tours || [],
          categories: (data.categories && data.categories.length) ? data.categories : def.categories,
          contacts: data.contacts || [],
          settings: { ...def.settings, ...(data.settings || {}) }
        };
        saveState();
        renderAll();
        toast('ব্যাকআপ সফলভাবে আমদানি হয়েছে।');
      });
    }catch(err){
      toast('ফাইল পড়তে সমস্যা হয়েছে।');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

document.getElementById('resetAllBtn').addEventListener('click', () => {
  openConfirm('সব ডেটা মুছে ফেলুন', 'এটি স্থায়ীভাবে সব লেনদেন, ট্যুর, কন্টাক্ট ও ক্যাটাগরি মুছে দেবে। ব্যাকআপ ছাড়া এটি ফিরিয়ে আনা যাবে না।', () => {
    state = defaultState();
    saveState();
    renderAll();
    loadSettingsForm();
    toast('সব ডেটা রিসেট করা হয়েছে।');
  });
});

/* =====================================================================
   রিমাইন্ডার সিস্টেম
   ===================================================================== */
const reminderModal = document.getElementById('reminderModal');

function checkReminder(){
  if(!state.settings.reminderEnabled) return;
  if(snoozedToday) return;
  const today = todayStr();
  if(state.settings.lastReminderDate === today) return;
  if(nowTimeStr() >= state.settings.reminderTime){
    reminderModal.classList.add('open');
    if(window.Notification && Notification.permission === 'granted'){
      new Notification('দৈনিক রিমাইন্ডার — মাহিম\'স লেজার', {
        body: 'আজকের সব খরচ ও লেনদেন এন্ট্রি করা হয়েছে কি?'
      });
    }
  }
}

document.getElementById('reminderDoneBtn').addEventListener('click', () => {
  state.settings.lastReminderDate = todayStr();
  saveState();
  reminderModal.classList.remove('open');
  renderDashboard();
});
document.getElementById('reminderLaterBtn').addEventListener('click', () => {
  snoozedToday = true;
  reminderModal.classList.remove('open');
});

document.getElementById('markDoneBtn').addEventListener('click', () => {
  state.settings.lastReminderDate = todayStr();
  saveState();
  renderDashboard();
  toast('আজকের জন্য চিহ্নিত করা হয়েছে।');
});

document.getElementById('enableNotifBtn').addEventListener('click', () => {
  if(!window.Notification){
    toast('এই ব্রাউজারে নোটিফিকেশন সাপোর্ট নেই।');
    return;
  }
  Notification.requestPermission().then(perm => {
    if(perm === 'granted') toast('নোটিফিকেশন চালু হয়েছে।');
    else toast('নোটিফিকেশন অনুমতি দেওয়া হয়নি।');
  });
});

/* =====================================================================
   সামগ্রিক রেন্ডার
   ===================================================================== */
function renderAll(){
  renderDashboard();
  renderExpenseTable();
  renderReceivables();
  renderTours();
  renderCategories();
  populateReportCategorySelect();
  renderReportTable();
  renderCharts();
  renderContacts();
  renderArchive();
  populateContactDatalist();
  refreshIcons();
}

/* =====================================================================
   ইনিশিয়ালাইজেশন
   ===================================================================== */
function init(){
  // লগইন/সাইনআপ চালু করা (অন্য কোনো অংশে এরর হলেও এটি কাজ করবে)
  setupAuthUI();

  try{
    // ফর্মে আজকের তারিখ/সময় বসানো
    entryDateInput.value = todayStr();
    entryTimeInput.value = nowTimeStr();
    updateEntryFormForType();

    // টপবারে আজকের তারিখ
    document.getElementById('pageDate').textContent = formatFullDateBn(new Date());

    loadSettingsForm();
    renderAll();
    refreshIcons();

    checkReminder();
    setInterval(checkReminder, 60 * 1000);
  }catch(e){
    console.error("ইনিশিয়ালাইজেশনে সমস্যা:", e);
  }
}

init();
