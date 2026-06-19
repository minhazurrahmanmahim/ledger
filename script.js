/* =====================================================================
   মাহিম'স লেজার — অ্যাপ লজিক
   সব ডেটা ক্লাউডে (Firebase Firestore) সংরক্ষিত হয় এবং লোকাল কপি ক্যাশ হিসেবে রাখা হয়।
   ===================================================================== */

const STORAGE_KEY = "mahim_ledger_state_v1";

const DEFAULT_CATEGORIES = [
  "খাবার", "যাতায়াত", "বাসা ভাড়া ও বিল", "কেনাকাটা",
  "স্বাস্থ্য", "শিক্ষা", "বিনোদন", "ব্যক্তিগত যত্ন", "অন্যান্য"
];

const TOUR_CATS = ["ভাড়া", "খাবার", "হোটেল", "অন্যান্য"];

const INCOME_SOURCES = ["বেতন", "ব্যবসা", "ফ্রিল্যান্স", "উপহার", "বিনিয়োগ", "অন্যান্য"];

const WEEKDAYS_BN = ["রবিবার","সোমবার","মঙ্গলবার","বুধবার","বৃহস্পতিবার","শুক্রবার","শনিবার"];
const MONTHS_BN  = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];

/* ===================== ডিফল্ট স্টেট ===================== */
function defaultState(){
  return {
    entries: [],     // {id, kind:'expense'|'receivable'|'payable'|'income', category, person, amount, date, time, note, isTour, tourId, tourCategory, settled, createdAt, updatedAt}
    archive: [],     // entry-shaped objects + archivedAt, archiveReason
    tours: [],       // {id, name, start, end}
    categories: [...DEFAULT_CATEGORIES],
    categoryBudgets: {}, // { categoryName: monthlyAmount } — ক্যাটাগরি-ভিত্তিক মাসিক বাজেট
    contacts: [],    // {id, name, phone}
    dailyLimits: [], // [{amount, effectiveFrom: 'YYYY-MM-DD'}] — দৈনিক খরচের লিমিটের ইতিহাস
    dayExceptions: {}, // { 'YYYY-MM-DD': true } — যেদিনগুলো লিমিট হিসাবের বাইরে রাখা হয়েছে
    notes: [], // {id, title, content, updatedAt, pinned, checklist:[{text,done}]}
    recurring: [], // {id, kind, category, amount, note, dayOfMonth, lastGeneratedMonth, active}
    savingsGoals: [], // {id, title, targetAmount, savedAmount, targetDate, createdAt}
    quickTemplates: [], // {id, label, kind, category, amount, note}
    settings: {
      name: "মো. মিনহাজুর রহমান মাহিম",
      reminderEnabled: true,
      reminderTime: "21:00",
      lastReminderDate: "",
      monthlyBudget: 0,
      profilePhoto: null,
      theme: "light",
      currency: "BDT",
      accentColor: "B08D4F",
      pinHash: null
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
    categoryBudgets: parsed.categoryBudgets || {},
    contacts: parsed.contacts || [],
    dailyLimits: parsed.dailyLimits || [],
    dayExceptions: parsed.dayExceptions || {},
    notes: parsed.notes || [],
    recurring: parsed.recurring || [],
    savingsGoals: parsed.savingsGoals || [],
    quickTemplates: parsed.quickTemplates || [],
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

  // অফলাইন সাপোর্ট চালু — ইন্টারনেট না থাকলেও অ্যাপ ব্যবহার/তথ্য পরিবর্তন করা যাবে,
  // এবং ইন্টারনেট ফিরে আসলে স্বয়ংক্রিয়ভাবে ক্লাউডের সাথে সিঙ্ক হয়ে যাবে।
  db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if(err.code === 'failed-precondition'){
      console.warn('অফলাইন সাপোর্ট শুধু একটি ট্যাবে চালু থাকতে পারে।');
    } else if(err.code === 'unimplemented'){
      console.warn('এই ব্রাউজারে অফলাইন সাপোর্ট নেই।');
    } else {
      console.warn('অফলাইন সাপোর্ট চালু করতে সমস্যা:', err);
    }
  });
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
  el.classList.remove('synced','syncing','error','pending');
  if(status === 'syncing'){
    el.classList.add('syncing');
    icon.setAttribute('data-lucide','refresh-cw');
    text.textContent = 'সিঙ্ক হচ্ছে...';
  } else if(status === 'synced'){
    el.classList.add('synced');
    icon.setAttribute('data-lucide','check-circle-2');
    text.textContent = 'সিঙ্ক সম্পন্ন';
  } else if(status === 'pending'){
    el.classList.add('pending');
    icon.setAttribute('data-lucide','cloud-upload');
    text.textContent = 'অফলাইন — পরে সিঙ্ক হবে';
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

// সিঙ্ক স্ট্যাটাসে ট্যাপ/ক্লিক করলে সার্ভার থেকে সর্বশেষ ডেটা জোর করে পুনরায় আনা হয়
// (এনিমেশন দেখিয়ে বোঝানো হয় রিফ্রেশ হচ্ছে)
function manualRefresh(){
  if(!firebaseReady || !currentUser){
    setSyncStatus('syncing');
    setTimeout(() => { renderAll(); setSyncStatus('error'); }, 500);
    return;
  }
  setSyncStatus('syncing');
  isApplyingRemoteUpdate = true;
  db.collection('users').doc(currentUser.uid).get({ source: 'server' })
    .then(docSnap => {
      if(docSnap.exists && docSnap.data().state){
        state = mergeWithDefaults(docSnap.data().state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
      renderAll();
      loadSettingsForm();
      setSyncStatus('synced');
      toast('সর্বশেষ তথ্য রিফ্রেশ হয়েছে।');
    })
    .catch(err => {
      console.error("রিফ্রেশ সমস্যা:", err);
      if(!navigator.onLine || err.code === 'unavailable'){
        setSyncStatus('pending');
        toast('ইন্টারনেট সংযোগ নেই — অফলাইনে পরিবর্তন করা যাবে, পরে সিঙ্ক হবে।');
      } else {
        setSyncStatus('error');
      }
    })
    .finally(() => { isApplyingRemoteUpdate = false; });
}

document.getElementById('syncStatus').addEventListener('click', manualRefresh);

// ইন্টারনেট সংযোগের অবস্থা পরিবর্তন হলে সিঙ্ক স্ট্যাটাস আপডেট করা
window.addEventListener('offline', () => {
  if(currentUser) setSyncStatus('pending');
});
window.addEventListener('online', () => {
  if(currentUser) setSyncStatus('syncing');
});

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

/* ===================== মোবাইলে অ্যাপ ইনস্টল বাটন ===================== */
let deferredInstallPrompt = null;

function isMobileDevice(){
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 768;
}
function isIOSDevice(){
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function isAlreadyInstalled(){
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('mobileInstallBtn');
  if(btn && isMobileDevice() && !isAlreadyInstalled()){
    btn.style.display = 'flex';
  }
});

/* ===================== ফিচার ১৫ — ডার্ক মোড ===================== */
/* ===================== ফিচার ২০ — পিন লক ===================== */
// সাধারণ হ্যাশ (true cryptographic security নয়, কিন্তু পিন প্লেইন-টেক্সটে রাখা এড়ানোর জন্য যথেষ্ট)
async function hashPin(pin){
  const enc = new TextEncoder().encode('mahims-ledger-salt-' + pin);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

let pinUnlocked = false; // সেশনে একবার আনলক হলে আর বারবার চাইবে না

function isPinLockActive(){
  return !!(state.settings && state.settings.pinHash);
}

function showPinLockIfNeeded(){
  if(isPinLockActive() && !pinUnlocked){
    document.getElementById('pinLockOverlay').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    setTimeout(() => document.getElementById('pinUnlockInput').focus(), 100);
  } else {
    document.getElementById('pinLockOverlay').style.display = 'none';
    document.getElementById('app').style.display = '';
  }
}

document.getElementById('pinUnlockBtn').addEventListener('click', async () => {
  const input = document.getElementById('pinUnlockInput');
  const errorEl = document.getElementById('pinUnlockError');
  const entered = input.value.trim();
  if(entered.length !== 4){
    errorEl.textContent = '৪-সংখ্যার পিন দিন।';
    errorEl.style.display = 'block';
    return;
  }
  const hash = await hashPin(entered);
  if(hash === state.settings.pinHash){
    pinUnlocked = true;
    errorEl.style.display = 'none';
    input.value = '';
    showPinLockIfNeeded();
  } else {
    errorEl.textContent = 'পিন সঠিক নয়, আবার চেষ্টা করুন।';
    errorEl.style.display = 'block';
    input.value = '';
  }
});

document.getElementById('pinUnlockInput').addEventListener('keypress', e => {
  if(e.key === 'Enter') document.getElementById('pinUnlockBtn').click();
});

document.getElementById('setPinBtn').addEventListener('click', async () => {
  const pin = document.getElementById('appPinInput').value.trim();
  if(pin.length !== 4 || !/^\d{4}$/.test(pin)){
    toast('সঠিক ৪-সংখ্যার পিন দিন (শুধু সংখ্যা)।');
    return;
  }
  state.settings.pinHash = await hashPin(pin);
  saveState();
  document.getElementById('appPinInput').value = '';
  updatePinStatusUI();
  toast('পিন সেট করা হয়েছে — পরের বার অ্যাপ খোলার সময় এই পিন চাইবে।');
});

document.getElementById('removePinBtn').addEventListener('click', () => {
  openConfirm('পিন বন্ধ করুন', 'অ্যাপ লক বন্ধ করতে চান? এরপর পিন ছাড়াই অ্যাপ খোলা যাবে।', () => {
    state.settings.pinHash = null;
    saveState();
    updatePinStatusUI();
    toast('অ্যাপ লক বন্ধ করা হয়েছে।');
  });
});

function updatePinStatusUI(){
  const statusEl = document.getElementById('pinStatusText');
  const removeBtn = document.getElementById('removePinBtn');
  if(!statusEl) return;
  if(isPinLockActive()){
    statusEl.textContent = 'অ্যাপ লক চালু আছে।';
    removeBtn.style.display = 'inline-block';
  } else {
    statusEl.textContent = 'অ্যাপ লক বন্ধ আছে।';
    removeBtn.style.display = 'none';
  }
}

function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  const icon = document.querySelector('#themeToggleBtn i');
  if(icon) icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
  refreshIcons();
}

/* ফিচার ১৮ — কাস্টম থিম রঙ (ব্রাশ/অ্যাকসেন্ট রঙের প্রিসেট) */
function hexToRgb(hex){
  const r = parseInt(hex.slice(0,2), 16);
  const g = parseInt(hex.slice(2,4), 16);
  const b = parseInt(hex.slice(4,6), 16);
  return `${r}, ${g}, ${b}`;
}

function applyAccentColor(hex){
  if(!hex) hex = 'B08D4F';
  const root = document.documentElement.style;
  root.setProperty('--accent', '#' + hex);
  root.setProperty('--accent-soft', `rgba(${hexToRgb(hex)}, .14)`);
  document.querySelectorAll('.theme-color-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === hex);
  });
}

document.querySelectorAll('.theme-color-swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    state.settings.accentColor = sw.dataset.color;
    applyAccentColor(sw.dataset.color);
    saveState();
    toast('থিম রঙ পরিবর্তিত হয়েছে।');
  });
});

document.getElementById('themeToggleBtn').addEventListener('click', () => {
  const current = (state.settings.theme === 'dark') ? 'light' : 'dark';
  state.settings.theme = current;
  applyTheme(current);
  saveState();
});

function setupMobileInstallUI(){
  const btn = document.getElementById('mobileInstallBtn');
  const iosHint = document.getElementById('iosInstallHint');
  if(!btn || isAlreadyInstalled() || !isMobileDevice()) return;

  if(isIOSDevice()){
    // iOS Safari beforeinstallprompt সাপোর্ট করে না — তাই ম্যানুয়াল নির্দেশনা দেখানো হয়
    iosHint.style.display = 'flex';
    refreshIcons();
  }
  // অ্যান্ড্রয়েড/Chrome: beforeinstallprompt ইভেন্ট এলে বাটন দেখানো হবে (উপরে হ্যান্ডলার আছে)

  btn.addEventListener('click', async () => {
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if(choice.outcome === 'accepted'){
      btn.style.display = 'none';
    }
    deferredInstallPrompt = null;
  });
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
      .then(() => incrementUserCounter())
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
      pinUnlocked = false;
      showPinLockIfNeeded();

      // অফলাইনে থাকা অবস্থায় ক্যাশড ডেটাও দেখানোর জন্য includeMetadataChanges:true
      firestoreUnsub = db.collection('users').doc(user.uid)
        .onSnapshot({ includeMetadataChanges: true }, docSnap => {
        isApplyingRemoteUpdate = true;
        try{
          if(docSnap.exists && docSnap.data().state){
            state = mergeWithDefaults(docSnap.data().state);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          } else if(!docSnap.exists) {
            // ক্লাউডে এখনো কোনো ডেটা নেই — বর্তমান (লোকাল) ডেটা ক্লাউডে পাঠানো হচ্ছে
            db.collection('users').doc(user.uid).set({
              state: state,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          }
          renderAll();
          loadSettingsForm();
          showPinLockIfNeeded();

          // সিঙ্ক স্ট্যাটাস — অফলাইনে পরিবর্তন করলে "পরে সিঙ্ক হবে" দেখাবে,
          // ইন্টারনেট ফিরে এসে সার্ভারে পৌঁছালে "সিঙ্ক সম্পন্ন" দেখাবে
          if(docSnap.metadata.hasPendingWrites){
            setSyncStatus('pending');
          } else if(docSnap.metadata.fromCache && !navigator.onLine){
            setSyncStatus('pending');
          } else {
            setSyncStatus('synced');
          }
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

// বাংলা সংখ্যা থাকলে ল্যাটিন (০-৯ → 0-9) সংখ্যায় রূপান্তর — সার্চে কাজে লাগে
function latinDigits(val){
  const map = {'০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9'};
  return String(val).replace(/[০-৯]/g, d => map[d]);
}

const CURRENCY_SYMBOLS = {
  BDT: '৳', USD: '$', EUR: '€', GBP: '£', INR: '₹', SAR: 'SR', AED: 'AED', MYR: 'RM'
};

function taka(amount){
  const num = Number(amount) || 0;
  const hasDecimal = Math.abs(num % 1) > 0.001;
  const formatted = num.toLocaleString('en-IN', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2
  });
  const symbol = CURRENCY_SYMBOLS[(state && state.settings && state.settings.currency) || 'BDT'] || '৳';
  // বাংলা টাকা চিহ্নের ক্ষেত্রে সংখ্যাও বাংলায় দেখানো হয়; অন্য কারেন্সিতে ল্যাটিন সংখ্যা স্বাভাবিক থাকে
  return symbol === '৳' ? (symbol + ' ' + bnDigits(formatted)) : (symbol + ' ' + formatted);
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
  if(!timeStr) return '—';
  let [h,m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'অপরাহ্ন' : 'পূর্বাহ্ন';
  let h12 = h % 12; if(h12 === 0) h12 = 12;
  return bnDigits(`${pad(h12)}:${pad(m)}`) + ' ' + period;
}

// এন্ট্রি লিস্টে দেখানোর জন্য তারিখ/সময়/নোট একসাথে — সময় না থাকলে এড়িয়ে যাওয়া হয়
function entryMetaLine(e){
  const parts = [formatDateDMY(e.date)];
  if(e.time) parts.push(formatTimeBn(e.time));
  else parts.push('সময় উল্লেখ নেই');
  if(e.note) parts.push(escapeHtml(e.note));
  if(e.partialPayments && e.partialPayments.length){
    const totalPaid = e.partialPayments.reduce((s,p)=>s+p.amount,0);
    parts.push(`আংশিক পরিশোধ হয়েছে ${taka(totalPaid)} (বাকি ${taka(e.amount)})`);
  }
  return parts.join(' · ');
}
function formatFullDateBn(date){
  return `${bnDigits(date.getDate())} ${MONTHS_BN[date.getMonth()]}, ${bnDigits(date.getFullYear())} — ${WEEKDAYS_BN[date.getDay()]}`;
}

function entryTitle(entry){
  if(entry.kind === 'expense') return entry.category || 'খরচ';
  if(entry.kind === 'income') return 'আয়: ' + (entry.incomeSource || 'অন্যান্য');
  if(entry.kind === 'receivable') return 'পাই: ' + (entry.person || 'অজানা');
  if(entry.kind === 'payable') return 'দেব: ' + (entry.person || 'অজানা');
  return '';
}
/* এন্ট্রির পাশে কোন কোন হিসাব থেকে বাদ আছে তা ছোট ব্যাজে দেখানো */
function exclusionBadges(e){
  const labels = [];
  if(e.excludeFromDailyTotal && e.excludeFromDailyLimit){
    labels.push('দৈনিক হিসাবের বাইরে');
  } else {
    if(e.excludeFromDailyTotal) labels.push('দৈনিক মোটের বাইরে');
    if(e.excludeFromDailyLimit) labels.push('দৈনিক লিমিটের বাইরে');
  }
  if(e.excludeFromMonthlyTotal && e.excludeFromMonthlyLimit){
    labels.push('মাসিক হিসাবের বাইরে');
  } else {
    if(e.excludeFromMonthlyTotal) labels.push('মাসিক মোটের বাইরে');
    if(e.excludeFromMonthlyLimit) labels.push('মাসিক বাজেটের বাইরে');
  }
  if(labels.length === 0) return '';
  return labels.map(l => ` <span class="badge-mini">${l}</span>`).join('');
}

function entryAmountClass(entry){
  if(entry.kind === 'expense') return 'expense';
  if(entry.kind === 'income') return 'income';
  if(entry.kind === 'receivable') return 'income';
  if(entry.kind === 'payable') return 'expense';
  return '';
}
function entryKindLabel(kind){
  return {expense:'খরচ', income:'আয়', receivable:'পাই', payable:'পাওনা'}[kind] || kind;
}

/* ===================== দৈনিক খরচের লিমিট — হেল্পার ফাংশন ===================== */

// নির্দিষ্ট তারিখে কার্যকর দৈনিক লিমিট বের করা (সেদিন বা তার আগের সর্বশেষ পরিবর্তন অনুযায়ী)
function getDailyLimitForDate(dateStr){
  if(!state.dailyLimits || state.dailyLimits.length === 0) return 0;
  const applicable = state.dailyLimits.filter(l => l.effectiveFrom <= dateStr);
  if(applicable.length === 0) return 0;
  applicable.sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return applicable[applicable.length - 1].amount;
}

// বর্তমানে (আজকের জন্য) কার্যকর লিমিট
function getCurrentDailyLimit(){
  return getDailyLimitForDate(todayStr());
}

// নির্দিষ্ট তারিখের মোট খরচ (দৈনন্দিন "মোট খরচ" হিসেবে দেখানোর জন্য — excludeFromDailyTotal বাদ)
function getDayExpenseTotal(dateStr){
  return state.entries
    .filter(e => e.kind === 'expense' && e.date === dateStr && !e.excludeFromDailyTotal)
    .reduce((s,e) => s + e.amount, 0);
}

// নির্দিষ্ট তারিখের খরচ — দৈনিক লিমিটের সাথে তুলনার জন্য (excludeFromDailyLimit বাদ)
function getDayExpenseForLimit(dateStr){
  return state.entries
    .filter(e => e.kind === 'expense' && e.date === dateStr && !e.excludeFromDailyLimit)
    .reduce((s,e) => s + e.amount, 0);
}

// নির্দিষ্ট মাসের (YYYY-MM) মোট খরচ — "মাসের মোট খরচ" হিসেবে দেখানোর জন্য (excludeFromMonthlyTotal বাদ)
function getMonthExpenseTotal(yearMonth){
  return state.entries
    .filter(e => e.kind === 'expense' && e.date && e.date.slice(0,7) === yearMonth && !e.excludeFromMonthlyTotal)
    .reduce((s,e) => s + e.amount, 0);
}

// নির্দিষ্ট মাসের খরচ — মাসিক বাজেট/লিমিটের সাথে তুলনার জন্য (excludeFromMonthlyLimit বাদ)
function getMonthExpenseForLimit(yearMonth){
  return state.entries
    .filter(e => e.kind === 'expense' && e.date && e.date.slice(0,7) === yearMonth && !e.excludeFromMonthlyLimit)
    .reduce((s,e) => s + e.amount, 0);
}

// নির্দিষ্ট তারিখ লিমিট অতিক্রম করেছে কিনা (এক্সসেপশন না থাকলে)
function isDayOverLimit(dateStr){
  const limit = getDailyLimitForDate(dateStr);
  if(!limit || limit <= 0) return false;
  if(state.dayExceptions && state.dayExceptions[dateStr]) return false;
  return getDayExpenseForLimit(dateStr) > limit;
}

function tomorrowStr(){
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
}

// একটি নির্দিষ্ট effectiveFrom তারিখের জন্য লিমিট সেট/আপডেট করা
function setDailyLimit(amount, effectiveFrom){
  const existing = state.dailyLimits.find(l => l.effectiveFrom === effectiveFrom);
  if(existing){
    existing.amount = amount;
  } else {
    state.dailyLimits.push({ amount, effectiveFrom });
  }
  state.dailyLimits.sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  saveState();
}

function currentLimitDisplayText(){
  const limit = getCurrentDailyLimit();
  return limit > 0 ? taka(limit) : 'নির্ধারিত নেই';
}

// এন্ট্রি ফর্মের নিচে সেই তারিখের লিমিট-স্ট্যাটাস দেখানো (এন্ট্রি যুক্ত/সম্পাদনার পর)
function updateDailyLimitStatus(dateStr){
  const statusEl = document.getElementById('dailyLimitStatus');
  const yearMonth = dateStr.slice(0,7);
  const dateLabel = dateStr === todayStr() ? 'আজ' : formatDateDMY(dateStr);

  const dailyLimit  = getDailyLimitForDate(dateStr);
  const dailyTotal  = getDayExpenseTotal(dateStr);
  const dailyForLimit = getDayExpenseForLimit(dateStr);

  const monthlyBudget = state.settings.monthlyBudget || 0;
  const monthlyTotal  = getMonthExpenseTotal(yearMonth);
  const monthlyForLimit = getMonthExpenseForLimit(yearMonth);

  let anyOverLimit = false;
  const rows = [];

  // ১. দৈনিক মোট খরচ (লিমিটের সাথে সম্পর্ক নেই, শুধু তথ্য)
  rows.push({
    label: `${dateLabel} মোট খরচ`,
    text: taka(dailyTotal),
    over: false
  });

  // ২. দৈনিক লিমিট
  if(dailyLimit > 0){
    const remain = dailyLimit - dailyForLimit;
    if(remain >= 0){
      rows.push({ label: `${dateLabel} লিমিট ${taka(dailyLimit)}-এর মধ্যে বাকি আছে`, text: taka(remain), over: false });
    } else {
      rows.push({ label: `${dateLabel} লিমিট ${taka(dailyLimit)} অতিক্রম হয়েছে`, text: taka(Math.abs(remain)), over: true });
      anyOverLimit = true;
    }
  } else {
    rows.push({ label: 'দৈনিক লিমিট', text: 'নির্ধারিত নেই', over: false, muted: true });
  }

  // ৩. মাসিক মোট খরচ
  rows.push({
    label: 'এই মাসের মোট খরচ',
    text: taka(monthlyTotal),
    over: false
  });

  // ৪. মাসিক বাজেট
  if(monthlyBudget > 0){
    const remainM = monthlyBudget - monthlyForLimit;
    if(remainM >= 0){
      rows.push({ label: `মাসিক বাজেট ${taka(monthlyBudget)}-এর মধ্যে বাকি আছে`, text: taka(remainM), over: false });
    } else {
      rows.push({ label: `মাসিক বাজেট ${taka(monthlyBudget)} অতিক্রম হয়েছে`, text: taka(Math.abs(remainM)), over: true });
      anyOverLimit = true;
    }
  } else {
    rows.push({ label: 'মাসিক বাজেট', text: 'নির্ধারিত নেই', over: false, muted: true });
  }

  statusEl.className = 'daily-limit-status' + (anyOverLimit ? ' over' : '');
  statusEl.innerHTML = `
    <div class="limit-status-head"><i data-lucide="${anyOverLimit ? 'alert-triangle' : 'gauge'}"></i> এই এন্ট্রির পরে হিসাব</div>
    <div class="limit-status-grid">
      ${rows.map(r => `
        <div class="limit-status-row${r.over ? ' over' : ''}${r.muted ? ' muted' : ''}">
          <span class="limit-status-label">${r.label}</span>
          <span class="limit-status-value">${r.text}</span>
        </div>
      `).join('')}
    </div>
  `;
  statusEl.style.display = 'block';
  refreshIcons();
}

/* ছোট নোটিফিকেশন (টোস্ট) */
function toast(msg){
  let t = document.createElement('div');
  t.textContent = msg;
  t.style.position = 'fixed';
  t.style.bottom = '90px';
  t.style.left = '50%';
  t.style.background = 'var(--primary)';
  t.style.color = '#fff';
  t.style.padding = '.7rem 1.2rem';
  t.style.borderRadius = '10px';
  t.style.fontFamily = "var(--font-body)";
  t.style.fontSize = '.88rem';
  t.style.boxShadow = '0 6px 20px rgba(0,0,0,.18)';
  t.style.zIndex = 200;
  t.style.opacity = '0';
  t.style.maxWidth = '90vw';
  t.style.textAlign = 'center';
  t.style.transition = 'opacity .25s ease, transform .25s ease';
  t.style.transform = 'translate(-50%, 8px)';
  document.body.appendChild(t);
  requestAnimationFrame(()=>{ t.style.opacity='1'; t.style.transform='translate(-50%, 0)'; });
  setTimeout(()=>{
    t.style.opacity='0'; t.style.transform='translate(-50%, 8px)';
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
  'daily-expenses': 'দৈনন্দিন খরচ',
  reports: 'পরিসংখ্যান ও রিপোর্ট',
  contacts: 'কন্টাক্টস',
  archive: 'আর্কাইভ',
  calculator: 'ক্যালকুলেটর',
  notes: 'নোটস',
  guide: 'ব্যবহার-বিধি',
  settings: 'সেটিংস'
};

function goToPage(pageId, opts){
  opts = opts || {};
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === pageId));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === pageId));
  document.getElementById('pageTitle').textContent = PAGE_TITLES[pageId] || '';
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  window.scrollTo({top:0, behavior:'smooth'});

  // অ্যাড-এন্ট্রি পেজে থাকলে ফ্লোটিং বাটন দেখানোর প্রয়োজন নেই
  document.getElementById('fabAddBtn').classList.toggle('hide', pageId === 'add-entry');

  // ব্রাউজার হিস্ট্রিতে যুক্ত করা — যাতে মোবাইলের ব্যাক বাটনে অ্যাপের আগের পেজে যাওয়া যায়,
  // ওয়েবসাইট থেকে বের হয়ে না যায়
  if(!opts.skipHistory){
    history.pushState({ page: pageId }, '', '#' + pageId);
  }
}

window.addEventListener('popstate', e => {
  const pageId = (e.state && e.state.page) || 'dashboard';
  goToPage(pageId, { skipHistory: true });
});

document.querySelectorAll('.nav-item, .link-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => goToPage(btn.dataset.page));
});

document.getElementById('fabAddBtn').addEventListener('click', () => goToPage('add-entry'));

document.querySelectorAll('.stat-card.clickable[data-page]').forEach(card => {
  card.addEventListener('click', () => goToPage(card.dataset.page));
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
let selectedContact = null; // {name, phone} — পাই/পাওনা এন্ট্রির সাথে লিংক করা কন্টাক্ট

function setLinkedContact(contact){
  selectedContact = contact;
  const chip = document.getElementById('linkedContactChip');
  const text = document.getElementById('linkedContactText');
  text.textContent = contact.phone ? `${contact.name} (${contact.phone})` : contact.name;
  chip.style.display = 'flex';
  refreshIcons();
}

function clearLinkedContact(){
  selectedContact = null;
  document.getElementById('linkedContactChip').style.display = 'none';
}

const entryForm        = document.getElementById('entryForm');
const entryIdInput     = document.getElementById('entryId');
const entryCategorySel = document.getElementById('entryCategory');
const entryPersonInput = document.getElementById('entryPerson');
const entryAmountInput = document.getElementById('entryAmount');
const entryDateInput   = document.getElementById('entryDate');
const entryTimeInput   = document.getElementById('entryTime');
const entryTimeUnknown = document.getElementById('entryTimeUnknown');
const entryNoteInput   = document.getElementById('entryNote');
const entryIsTour      = document.getElementById('entryIsTour');
const tourFields       = document.getElementById('tourFields');
const entryTourSel     = document.getElementById('entryTour');
const entryTourCatSel  = document.getElementById('entryTourCategory');
const categoryRow      = document.getElementById('categoryRow');
const incomeSourceRow    = document.getElementById('incomeSourceRow');
const entryIncomeSourceSel = document.getElementById('entryIncomeSource');
const personRow        = document.getElementById('personRow');
const dueDateRow       = document.getElementById('dueDateRow');
const entryDueDateInput = document.getElementById('entryDueDate');
const entryFormTitle   = document.getElementById('entryFormTitle');
const tourCheckboxRow  = entryIsTour.closest('.form-row');
const excludeOptionsRow      = document.getElementById('excludeOptionsRow');
const entryExcludeDailyTotal   = document.getElementById('entryExcludeDailyTotal');
const entryExcludeDailyLimit   = document.getElementById('entryExcludeDailyLimit');
const entryExcludeMonthlyTotal = document.getElementById('entryExcludeMonthlyTotal');
const entryExcludeMonthlyLimit = document.getElementById('entryExcludeMonthlyLimit');

document.querySelectorAll('#entryTypeControl .seg').forEach(seg => {
  seg.addEventListener('click', () => {
    document.querySelectorAll('#entryTypeControl .seg').forEach(s => s.classList.remove('active'));
    seg.classList.add('active');
    currentEntryType = seg.dataset.value;
    updateEntryFormForType();
  });
});

function updateEntryFormForType(){
  // সব রো প্রথমে লুকিয়ে রাখা, তারপর প্রয়োজন অনুযায়ী দেখানো
  categoryRow.style.display = 'none';
  incomeSourceRow.style.display = 'none';
  personRow.style.display = 'none';
  dueDateRow.style.display = 'none';
  tourCheckboxRow.style.display = 'none';
  excludeOptionsRow.style.display = 'none';
  entryCategorySel.required = false;
  entryIncomeSourceSel.required = false;
  entryPersonInput.required = false;

  if(currentEntryType === 'expense'){
    categoryRow.style.display = '';
    tourCheckboxRow.style.display = '';
    excludeOptionsRow.style.display = '';
    entryCategorySel.required = true;
  } else if(currentEntryType === 'income'){
    incomeSourceRow.style.display = '';
    entryIncomeSourceSel.required = true;
  } else {
    // receivable / payable
    personRow.style.display = '';
    dueDateRow.style.display = '';
    entryPersonInput.required = true;
  }

  if(currentEntryType !== 'expense'){
    entryIsTour.checked = false;
    entryExcludeDailyTotal.checked = false;
    entryExcludeDailyLimit.checked = false;
    entryExcludeMonthlyTotal.checked = false;
    entryExcludeMonthlyLimit.checked = false;
    tourFields.style.display = 'none';
  }
  if(currentEntryType !== 'receivable' && currentEntryType !== 'payable'){
    entryDueDateInput.value = '';
  }
}

entryIsTour.addEventListener('change', () => {
  tourFields.style.display = entryIsTour.checked ? '' : 'none';
  // ট্যুরের খরচ সাধারণত দৈনন্দিন/মাসিক বাজেটে আলাদাভাবে ধরা হয় না —
  // তাই ডিফল্টভাবে দৈনিক মোট ও লিমিট থেকে বাদ রাখা টিক হয়ে যাবে, চাইলে পরিবর্তন করা যাবে
  if(entryIsTour.checked){
    entryExcludeDailyTotal.checked = true;
    entryExcludeDailyLimit.checked = true;
  }
});

entryTimeUnknown.addEventListener('change', () => {
  if(entryTimeUnknown.checked){
    entryTimeInput.value = '';
    entryTimeInput.disabled = true;
    entryTimeInput.required = false;
  } else {
    entryTimeInput.disabled = false;
    entryTimeInput.required = true;
    entryTimeInput.value = nowTimeStr();
  }
});

function populateCategorySelect(){
  const prevValue = entryCategorySel.value;
  entryCategorySel.innerHTML = state.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  // আগে যে ক্যাটাগরি সিলেক্ট করা ছিল, সেটা এখনো তালিকায় থাকলে আবার সিলেক্ট করে দেওয়া হচ্ছে
  // (নতুন ক্যাটাগরি যুক্ত হওয়ার পর, বা যেকোনো renderAll()-এর পরে যাতে সিলেকশন হারিয়ে না যায়)
  if(prevValue && state.categories.includes(prevValue)){
    entryCategorySel.value = prevValue;
  }
}
function populateIncomeSourceSelect(){
  const prevValue = entryIncomeSourceSel.value;
  entryIncomeSourceSel.innerHTML = INCOME_SOURCES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if(prevValue && INCOME_SOURCES.includes(prevValue)){
    entryIncomeSourceSel.value = prevValue;
  }
}
function populateTourSelect(){
  if(state.tours.length === 0){
    entryTourSel.innerHTML = `<option value="">— প্রথমে "ট্যুর হিসাব" থেকে একটি ট্যুর তৈরি করুন —</option>`;
  } else {
    entryTourSel.innerHTML = state.tours.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  }
}
/* ===================== কন্টাক্ট পিকার মোডাল ===================== */
function renderContactPickerList(filter){
  const list = document.getElementById('contactPickerList');
  const q = (filter || '').trim().toLowerCase();
  const contacts = state.contacts.filter(c =>
    !q || c.name.toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q)
  );
  if(contacts.length === 0){
    list.innerHTML = `<div class="empty-state">কোনো কন্টাক্ট পাওয়া যায়নি।</div>`;
    return;
  }
  list.innerHTML = contacts.map(c => `
    <div class="contact-picker-item" data-name="${escapeHtml(c.name)}" data-phone="${escapeHtml(c.phone || '')}">
      <span class="name">${escapeHtml(c.name)}</span>
      <span class="phone">${escapeHtml(c.phone || '')}</span>
    </div>
  `).join('');
}

document.getElementById('pickContactBtn').addEventListener('click', () => {
  document.getElementById('contactPickerSearch').value = '';
  renderContactPickerList('');
  document.getElementById('contactPickerModal').classList.add('open');
  refreshIcons();
});

document.getElementById('contactPickerCloseBtn').addEventListener('click', () => {
  document.getElementById('contactPickerModal').classList.remove('open');
});

document.getElementById('contactPickerSearch').addEventListener('input', e => {
  renderContactPickerList(e.target.value);
});

document.getElementById('contactPickerList').addEventListener('click', e => {
  const item = e.target.closest('.contact-picker-item');
  if(!item) return;
  setLinkedContact({ name: item.dataset.name, phone: item.dataset.phone || '' });
  // ব্যক্তির নাম ফিল্ড খালি থাকলে সুবিধার জন্য কন্টাক্টের নাম দিয়ে শুরু করে দেওয়া হলো,
  // তবে ব্যবহারকারী চাইলে এটি পরিবর্তন করতে পারবেন
  if(!entryPersonInput.value.trim()){
    entryPersonInput.value = item.dataset.name;
  }
  document.getElementById('contactPickerModal').classList.remove('open');
});

document.getElementById('removeLinkedContactBtn').addEventListener('click', clearLinkedContact);


/* ===================== গ্লোবাল সার্চ ===================== */
function openGlobalSearch(){
  const modal = document.getElementById('globalSearchModal');
  const input = document.getElementById('globalSearchInput');
  modal.classList.add('open');
  input.value = '';
  renderGlobalSearchResults('');
  setTimeout(() => input.focus(), 50);
}

document.getElementById('searchBtn').addEventListener('click', openGlobalSearch);
document.getElementById('globalSearchCloseBtn').addEventListener('click', () => {
  document.getElementById('globalSearchModal').classList.remove('open');
});
document.getElementById('globalSearchInput').addEventListener('input', e => {
  renderGlobalSearchResults(e.target.value);
});

function renderGlobalSearchResults(query){
  const container = document.getElementById('globalSearchResults');
  const q = query.trim().toLowerCase();
  if(!q){
    container.innerHTML = `<div class="empty-state">টাইপ করা শুরু করুন — টাকার পরিমাণ, ক্যাটাগরি, ব্যক্তির নাম, নোট, ট্যুর, কন্টাক্ট বা নোটস থেকে খুঁজে দেখাবে।</div>`;
    return;
  }
  const qLatin = latinDigits(q);
  let html = '';

  // লেনদেন (খরচ/পাই/পাওনা)
  const entryMatches = state.entries.filter(e => {
    const amountStr = String(e.amount);
    return (
      (e.category && e.category.toLowerCase().includes(q)) ||
      (e.person && e.person.toLowerCase().includes(q)) ||
      (e.note && e.note.toLowerCase().includes(q)) ||
      (e.contactName && e.contactName.toLowerCase().includes(q)) ||
      (e.contactPhone && e.contactPhone.includes(qLatin)) ||
      amountStr.includes(qLatin) ||
      formatDateDMY(e.date).includes(bnDigits(qLatin))
    );
  }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 25);

  if(entryMatches.length){
    html += `<div class="search-group-title">লেনদেন (${bnDigits(entryMatches.length)})</div>`;
    html += entryMatches.map(e => `
      <div class="search-result-item" data-type="entry" data-id="${e.id}" data-kind="${e.kind}">
        <div class="search-result-main">
          <span class="search-result-title">${escapeHtml(entryTitle(e))}</span>
          <span class="search-result-sub">${entryMetaLine(e)}</span>
        </div>
        <span class="search-result-amount ${entryAmountClass(e)}">${taka(e.amount)}</span>
      </div>
    `).join('');
  }

  // কন্টাক্ট
  const contactMatches = state.contacts.filter(c =>
    c.name.toLowerCase().includes(q) || (c.phone || '').includes(qLatin)
  ).slice(0, 10);
  if(contactMatches.length){
    html += `<div class="search-group-title">কন্টাক্ট (${bnDigits(contactMatches.length)})</div>`;
    html += contactMatches.map(c => `
      <div class="search-result-item" data-type="contact" data-id="${c.id}">
        <div class="search-result-main">
          <span class="search-result-title">${escapeHtml(c.name)}</span>
          <span class="search-result-sub">${escapeHtml(c.phone || '')}</span>
        </div>
        <i data-lucide="chevron-right" class="stat-arrow" style="position:static;"></i>
      </div>
    `).join('');
  }

  // ট্যুর
  const tourMatches = state.tours.filter(t => t.name.toLowerCase().includes(q)).slice(0, 10);
  if(tourMatches.length){
    html += `<div class="search-group-title">ট্যুর (${bnDigits(tourMatches.length)})</div>`;
    html += tourMatches.map(t => `
      <div class="search-result-item" data-type="tour" data-id="${t.id}">
        <div class="search-result-main">
          <span class="search-result-title">${escapeHtml(t.name)}</span>
          <span class="search-result-sub">${formatDateDMY(t.start)} – ${formatDateDMY(t.end)}</span>
        </div>
        <i data-lucide="chevron-right" class="stat-arrow" style="position:static;"></i>
      </div>
    `).join('');
  }

  // নোটস
  const noteMatches = (state.notes || []).filter(n =>
    (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q)
  ).slice(0, 10);
  if(noteMatches.length){
    html += `<div class="search-group-title">নোটস (${bnDigits(noteMatches.length)})</div>`;
    html += noteMatches.map(n => `
      <div class="search-result-item" data-type="note" data-id="${n.id}">
        <div class="search-result-main">
          <span class="search-result-title">${escapeHtml(n.title || 'শিরোনামহীন নোট')}</span>
          <span class="search-result-sub">${escapeHtml((n.content || '').slice(0, 60))}</span>
        </div>
        <i data-lucide="chevron-right" class="stat-arrow" style="position:static;"></i>
      </div>
    `).join('');
  }

  // ক্যাটাগরি
  const catMatches = state.categories.filter(c => c.toLowerCase().includes(q)).slice(0, 5);
  if(catMatches.length){
    html += `<div class="search-group-title">ক্যাটাগরি (${bnDigits(catMatches.length)})</div>`;
    html += catMatches.map(c => `
      <div class="search-result-item" data-type="category" data-id="${escapeHtml(c)}">
        <div class="search-result-main"><span class="search-result-title">${escapeHtml(c)}</span></div>
        <i data-lucide="chevron-right" class="stat-arrow" style="position:static;"></i>
      </div>
    `).join('');
  }

  if(!html){
    html = `<div class="empty-state">কোনো ফলাফল পাওয়া যায়নি।</div>`;
  }
  container.innerHTML = html;
  refreshIcons();
}

document.getElementById('globalSearchResults').addEventListener('click', e => {
  const item = e.target.closest('.search-result-item');
  if(!item) return;
  const { type, id, kind } = item.dataset;
  document.getElementById('globalSearchModal').classList.remove('open');

  if(type === 'entry'){
    if(kind === 'expense'){
      goToPage('add-entry');
      setTimeout(() => editEntry(id), 80);
    } else {
      goToPage('receivables');
    }
  } else if(type === 'contact'){
    goToPage('contacts');
    setTimeout(() => {
      const searchInput = document.getElementById('contactSearch');
      if(searchInput){
        const contact = state.contacts.find(c => c.id === id);
        if(contact) searchInput.value = contact.name;
        renderContacts();
      }
    }, 80);
  } else if(type === 'tour'){
    goToPage('tours');
  } else if(type === 'note'){
    goToPage('notes');
    setTimeout(() => {
      const note = state.notes.find(n => n.id === id);
      if(!note) return;
      document.getElementById('noteId').value = note.id;
      document.getElementById('noteTitle').value = note.title || '';
      document.getElementById('noteContent').value = note.content || '';
      document.getElementById('noteFormTitle').innerHTML = `<i data-lucide="pencil-line"></i> নোট সম্পাদনা করুন`;
      refreshIcons();
    }, 80);
  } else if(type === 'category'){
    goToPage('categories');
  }
});


/* ===================== দৈনিক লিমিট মোডাল ===================== */
let limitMode = 'auto'; // 'auto' | 'custom'

function getSuggestedDailyLimit(){
  const budget = state.settings.monthlyBudget || 0;
  if(budget <= 0) return 0;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round(budget / daysInMonth);
}

function updateLimitModalUI(){
  const autoSection = document.getElementById('limitAutoSection');
  const customSection = document.getElementById('limitCustomSection');
  const hintEl = document.getElementById('limitAutoHint');
  const suggested = getSuggestedDailyLimit();
  const budget = state.settings.monthlyBudget || 0;

  if(limitMode === 'auto'){
    autoSection.style.display = '';
    customSection.style.display = 'none';
    if(budget <= 0){
      hintEl.innerHTML = `<span style="color:var(--expense);">⚠️ মাসিক বাজেট এখনো সেট করা হয়নি। সেটিংস পেজ থেকে মাসিক বাজেট সেট করুন, তারপর এখানে ফিরে আসুন।</span>`;
    } else {
      const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
      hintEl.innerHTML = `মাসিক বাজেট ${taka(budget)} ÷ এই মাসের ${bnDigits(daysInMonth)} দিন = <strong style="color:var(--accent);">দৈনিক ${taka(suggested)}</strong><br><small style="color:var(--muted);">নিচের বাটনে চাপলে এই মান কার্যকর হবে।</small>`;
    }
  } else {
    autoSection.style.display = 'none';
    customSection.style.display = '';
  }
}

function openDailyLimitModal(){
  limitMode = 'auto';
  document.getElementById('modalCurrentLimitText').textContent = currentLimitDisplayText();
  const current = getCurrentDailyLimit();
  document.getElementById('newDailyLimitInput').value = current > 0 ? current : '';
  // সেগমেন্ট কন্ট্রোলে auto সক্রিয় করা
  document.querySelectorAll('#limitTypeControl .seg').forEach(s =>
    s.classList.toggle('active', s.dataset.val === 'auto')
  );
  updateLimitModalUI();
  document.getElementById('dailyLimitModal').classList.add('open');
  refreshIcons();
}

document.querySelectorAll('#limitTypeControl .seg').forEach(btn => {
  btn.addEventListener('click', () => {
    limitMode = btn.dataset.val;
    document.querySelectorAll('#limitTypeControl .seg').forEach(s =>
      s.classList.toggle('active', s.dataset.val === limitMode)
    );
    updateLimitModalUI();
  });
});

['changeDailyLimitBtn','openDailyLimitBtnFromEntry'].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('click', openDailyLimitModal);
});

document.getElementById('cancelLimitBtn').addEventListener('click', () => {
  document.getElementById('dailyLimitModal').classList.remove('open');
});

function applyDailyLimit(effectiveFrom){
  let val;
  if(limitMode === 'auto'){
    val = getSuggestedDailyLimit();
    if(!val || val <= 0){
      toast('আগে সেটিংস পেজ থেকে মাসিক বাজেট সেট করুন।');
      return;
    }
  } else {
    val = Number(document.getElementById('newDailyLimitInput').value);
    if(!val || val <= 0){
      toast('সঠিক লিমিট পরিমাণ দিন।');
      return;
    }
  }
  setDailyLimit(val, effectiveFrom);
  document.getElementById('dailyLimitModal').classList.remove('open');
  renderAll();
  toast(`দৈনিক লিমিট ${taka(val)} কার্যকর হয়েছে।`);
}

document.getElementById('applyLimitTodayBtn').addEventListener('click', () => applyDailyLimit(todayStr()));
document.getElementById('applyLimitTomorrowBtn').addEventListener('click', () => applyDailyLimit(tomorrowStr()));

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
  entryTimeInput.disabled = false;
  entryTimeInput.required = true;
  entryTimeUnknown.checked = false;
  currentEntryType = 'expense';
  document.querySelectorAll('#entryTypeControl .seg').forEach(s => s.classList.toggle('active', s.dataset.value === 'expense'));
  // form.reset() ক্যাটাগরি সিলেক্টের মান মুছে দিতে পারে — তাই আবার পপুলেট করতে হবে
  populateCategorySelect();
  populateIncomeSourceSelect();
  populateTourSelect();
  updateEntryFormForType();
  clearLinkedContact();
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
    time: entryTimeUnknown.checked ? '' : entryTimeInput.value,
    note: entryNoteInput.value.trim(),
    category: currentEntryType === 'expense' ? entryCategorySel.value : null,
    incomeSource: currentEntryType === 'income' ? entryIncomeSourceSel.value : null,
    person: (currentEntryType === 'receivable' || currentEntryType === 'payable') ? entryPersonInput.value.trim() : null,
    contactName: (currentEntryType === 'receivable' || currentEntryType === 'payable') ? (selectedContact ? selectedContact.name : null) : null,
    contactPhone: (currentEntryType === 'receivable' || currentEntryType === 'payable') ? (selectedContact ? selectedContact.phone : null) : null,
    dueDate: (currentEntryType === 'receivable' || currentEntryType === 'payable') ? (entryDueDateInput.value || null) : null,
    isTour: currentEntryType === 'expense' && entryIsTour.checked,
    tourId: (currentEntryType === 'expense' && entryIsTour.checked) ? entryTourSel.value : null,
    tourCategory: (currentEntryType === 'expense' && entryIsTour.checked) ? entryTourCatSel.value : null,
    excludeFromDailyTotal: currentEntryType === 'expense' && entryExcludeDailyTotal.checked,
    excludeFromDailyLimit: currentEntryType === 'expense' && entryExcludeDailyLimit.checked,
    excludeFromMonthlyTotal: currentEntryType === 'expense' && entryExcludeMonthlyTotal.checked,
    excludeFromMonthlyLimit: currentEntryType === 'expense' && entryExcludeMonthlyLimit.checked,
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
  if(base.kind === 'expense'){
    updateDailyLimitStatus(base.date);
  } else {
    document.getElementById('dailyLimitStatus').style.display = 'none';
  }
  resetEntryForm();
});

function editEntry(id){
  const entry = state.entries.find(en => en.id === id);
  if(!entry) return;
  entryIdInput.value = entry.id;
  document.querySelectorAll('#entryTypeControl .seg').forEach(s => s.classList.toggle('active', s.dataset.value === entry.kind));
  currentEntryType = entry.kind;
  // updateEntryFormForType আগে, তারপর ভ্যালু সেট — না হলে hidden field-এ সেট হয়ে সমস্যা হয়
  populateCategorySelect();
  populateIncomeSourceSelect();
  populateTourSelect();
  updateEntryFormForType();
  if(entry.kind === 'expense'){
    entryCategorySel.value = entry.category || (state.categories[0] || '');
  } else if(entry.kind === 'income'){
    entryIncomeSourceSel.value = entry.incomeSource || INCOME_SOURCES[0];
  } else {
    entryPersonInput.value = entry.person || '';
    entryDueDateInput.value = entry.dueDate || '';
  }
  entryAmountInput.value = entry.amount;
  entryDateInput.value = entry.date;
  if(entry.time){
    entryTimeUnknown.checked = false;
    entryTimeInput.disabled = false;
    entryTimeInput.required = true;
    entryTimeInput.value = entry.time;
  } else {
    entryTimeUnknown.checked = true;
    entryTimeInput.disabled = true;
    entryTimeInput.required = false;
    entryTimeInput.value = '';
  }
  entryNoteInput.value = entry.note || '';
  if(entry.contactName){
    setLinkedContact({ name: entry.contactName, phone: entry.contactPhone || '' });
  } else {
    clearLinkedContact();
  }
  entryIsTour.checked = !!entry.isTour;
  tourFields.style.display = entry.isTour ? '' : 'none';
  entryExcludeDailyTotal.checked = !!entry.excludeFromDailyTotal;
  entryExcludeDailyLimit.checked = !!entry.excludeFromDailyLimit;
  entryExcludeMonthlyTotal.checked = !!entry.excludeFromMonthlyTotal;
  entryExcludeMonthlyLimit.checked = !!entry.excludeFromMonthlyLimit;
  if(entry.isTour){
    entryTourSel.value = entry.tourId || '';
    entryTourCatSel.value = entry.tourCategory || 'ভাড়া';
  }
  entryFormTitle.innerHTML = `<i data-lucide="pencil-line"></i> এন্ট্রি সম্পাদনা করুন`;
  refreshIcons();
  goToPage('add-entry');
}

/* ফিচার ১৯ — সোয়াইপ-টু-ডিলিট: একটা কন্টেইনারের ভিতরের সব .entry-row-কে সোয়াইপ-সক্ষম করা।
   বাম দিকে সোয়াইপ করলে নিচে লাল "ডিলিট" দেখাবে, পর্যাপ্ত দূরত্ব সোয়াইপ করলে deleteCallback(id) চলবে। */
function enableSwipeToDelete(containerEl, deleteCallback){
  if(!containerEl || window.innerWidth > 768) return; // শুধু মোবাইলে সক্রিয়
  containerEl.querySelectorAll('.entry-row[data-id]').forEach(row => {
    if(row.closest('.swipe-wrap')) return; // আগেই র‍্যাপ করা থাকলে আবার করা হবে না

    const wrap = document.createElement('div');
    wrap.className = 'swipe-wrap';
    const bg = document.createElement('div');
    bg.className = 'swipe-delete-bg';
    bg.innerHTML = `<i data-lucide="trash-2"></i> ডিলিট`;
    row.parentNode.insertBefore(wrap, row);
    wrap.appendChild(bg);
    wrap.appendChild(row);

    let startX = 0, currentX = 0, dragging = false;
    const THRESHOLD = 90;

    row.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      dragging = true;
      row.style.transition = 'none';
    }, { passive: true });

    row.addEventListener('touchmove', e => {
      if(!dragging) return;
      currentX = e.touches[0].clientX - startX;
      if(currentX > 0) currentX = 0; // শুধু বামে সোয়াইপ
      row.style.transform = `translateX(${currentX}px)`;
    }, { passive: true });

    row.addEventListener('touchend', () => {
      dragging = false;
      row.style.transition = 'transform .2s ease';
      if(currentX < -THRESHOLD){
        row.style.transform = `translateX(-100%)`;
        setTimeout(() => deleteCallback(row.dataset.id), 150);
      } else {
        row.style.transform = 'translateX(0)';
      }
      currentX = 0;
    });
  });
  refreshIcons();
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

/* ফিচার ১৩ — আংশিক পরিশোধ: পুরো এন্ট্রি সেটল করার বদলে একটা অংশ পরিশোধ হলে তা বাদ দিয়ে বাকিটা এন্ট্রিতে রেখে দেওয়া */
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

function openPartialSettleModal(id){
  const entry = state.entries.find(en => en.id === id);
  if(!entry) return;
  document.getElementById('partialSettleEntryId').value = id;
  document.getElementById('partialSettleInfo').textContent =
    `${entry.person || 'অজানা'} — মোট ${taka(entry.amount)} (${entryKindLabel(entry.kind)})`;
  document.getElementById('partialSettleAmount').value = '';
  document.getElementById('partialSettleAmount').max = entry.amount;
  document.getElementById('partialSettleModal').classList.add('open');
}

document.getElementById('partialSettleCancelBtn').addEventListener('click', () => {
  document.getElementById('partialSettleModal').classList.remove('open');
});

document.getElementById('partialSettleConfirmBtn').addEventListener('click', () => {
  const id = document.getElementById('partialSettleEntryId').value;
  const paidNow = Number(document.getElementById('partialSettleAmount').value);
  const entry = state.entries.find(en => en.id === id);
  if(!entry) return;
  if(!paidNow || paidNow <= 0){ toast('সঠিক পরিমাণ দিন।'); return; }
  if(paidNow >= entry.amount){
    // পুরোটাই পরিশোধ হয়ে গেলে সম্পূর্ণ সেটল করে দেওয়া
    document.getElementById('partialSettleModal').classList.remove('open');
    settleEntry(id);
    return;
  }
  // আংশিক পরিশোধের ইতিহাস এন্ট্রিতে যুক্ত করে, বাকি অংক দিয়ে মূল এন্ট্রি আপডেট করা
  if(!entry.partialPayments) entry.partialPayments = [];
  entry.partialPayments.push({ amount: paidNow, date: todayStr(), createdAt: new Date().toISOString() });
  entry.amount = Math.round((entry.amount - paidNow) * 100) / 100;
  entry.updatedAt = new Date().toISOString();
  saveState();
  document.getElementById('partialSettleModal').classList.remove('open');
  renderAll();
  toast(`${taka(paidNow)} আংশিক পরিশোধ হিসেবে যুক্ত হয়েছে। বাকি আছে ${taka(entry.amount)}।`);
});

/* =====================================================================
   রেন্ডার: ড্যাশবোর্ড
   ===================================================================== */

/* ফিচার ১, ৩, ৫ — ট্রেন্ড তুলনা, ব্যস্ত খাত/দিন হাইলাইট, গড় দৈনিক/সাপ্তাহিক খরচ */
function renderInsights(thisMonth, monthExpense, monthIncome){
  const container = document.getElementById('insightsList');
  if(!container) return;

  const insights = [];
  const now = new Date();
  const today = todayStr();

  // ফিচার ১২ — নির্ধারিত তারিখ পার হওয়া পাই/পাওনার রিমাইন্ডার
  const overdueDues = state.entries.filter(e =>
    (e.kind === 'receivable' || e.kind === 'payable') && e.dueDate && e.dueDate < today
  );
  if(overdueDues.length > 0){
    const overdueReceivable = overdueDues.filter(e => e.kind === 'receivable').length;
    const overduePayable = overdueDues.filter(e => e.kind === 'payable').length;
    const msgParts = [];
    if(overdueReceivable) msgParts.push(`${bnDigits(overdueReceivable)}টি পাই`);
    if(overduePayable) msgParts.push(`${bnDigits(overduePayable)}টি পাওনা`);
    insights.push({
      icon: 'alarm-clock', type: 'negative',
      text: `নির্ধারিত তারিখ পার হয়ে গেছে এমন ${msgParts.join(' ও ')} আছে — "পাই ও পাওনা" পেজে দেখুন।`
    });
  }

  // গত মাসের হিসাব
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = lastMonthDate.getFullYear() + '-' + pad(lastMonthDate.getMonth()+1);
  const lastMonthExpense = getMonthExpenseTotal(lastMonth);

  // ১. মাস-অনুযায়ী তুলনা (ট্রেন্ড)
  if(lastMonthExpense > 0){
    const diffPct = Math.round(((monthExpense - lastMonthExpense) / lastMonthExpense) * 100);
    if(diffPct > 0){
      insights.push({
        icon: 'trending-up', type: 'negative',
        text: `এই মাসে গত মাসের তুলনায় <strong>${bnDigits(diffPct)}%</strong> বেশি খরচ হয়েছে।`
      });
    } else if(diffPct < 0){
      insights.push({
        icon: 'trending-down', type: 'positive',
        text: `এই মাসে গত মাসের তুলনায় <strong>${bnDigits(Math.abs(diffPct))}%</strong> কম খরচ হয়েছে — ভালো চলছে!`
      });
    } else {
      insights.push({
        icon: 'minus', type: '',
        text: `এই মাসের খরচ গত মাসের সমান।`
      });
    }
  }

  // ৩. সবচেয়ে বেশি খরচ হওয়া ক্যাটাগরি (এই মাসে)
  const monthEntries = state.entries.filter(e => e.kind === 'expense' && e.date && e.date.slice(0,7) === thisMonth);
  if(monthEntries.length > 0){
    const catTotals = {};
    monthEntries.forEach(e => { catTotals[e.category || 'অন্যান্য'] = (catTotals[e.category || 'অন্যান্য'] || 0) + e.amount; });
    const topCat = Object.entries(catTotals).sort((a,b) => b[1]-a[1])[0];
    insights.push({
      icon: 'flame', type: '',
      text: `এই মাসে সবচেয়ে বেশি খরচ হয়েছে <strong>${escapeHtml(topCat[0])}</strong> খাতে — ${taka(topCat[1])}।`
    });

    // সবচেয়ে বেশি খরচ হওয়া দিন
    const dayTotals = {};
    monthEntries.forEach(e => { dayTotals[e.date] = (dayTotals[e.date] || 0) + e.amount; });
    const topDay = Object.entries(dayTotals).sort((a,b) => b[1]-a[1])[0];
    insights.push({
      icon: 'calendar-clock', type: '',
      text: `এই মাসের সবচেয়ে বেশি খরচের দিন <strong>${formatDateDMY(topDay[0])}</strong> — ${taka(topDay[1])}।`
    });
  }

  // ৫. গড় দৈনিক/সাপ্তাহিক খরচ (এই মাসের এখন পর্যন্ত হিসাব)
  const dayOfMonth = now.getDate();
  if(monthExpense > 0 && dayOfMonth > 0){
    const avgDaily = monthExpense / dayOfMonth;
    const avgWeekly = avgDaily * 7;
    insights.push({
      icon: 'calculator', type: '',
      text: `এই মাসে গড় দৈনিক খরচ <strong>${taka(Math.round(avgDaily))}</strong>, গড় সাপ্তাহিক খরচ <strong>${taka(Math.round(avgWeekly))}</strong>।`
    });
  }

  // আয়-ব্যয়ের অনুপাত (ফিচার ৬ সম্পর্কিত)
  if(monthIncome > 0){
    const savedPct = Math.round(((monthIncome - monthExpense) / monthIncome) * 100);
    if(savedPct >= 0){
      insights.push({
        icon: 'piggy-bank', type: 'positive',
        text: `এই মাসের আয়ের <strong>${bnDigits(savedPct)}%</strong> এখনো খরচ হয়নি।`
      });
    } else {
      insights.push({
        icon: 'alert-circle', type: 'negative',
        text: `এই মাসে আয়ের তুলনায় <strong>${bnDigits(Math.abs(savedPct))}%</strong> বেশি খরচ হয়ে গেছে।`
      });
    }
  }

  if(insights.length === 0){
    container.innerHTML = `<div class="empty-state">পর্যাপ্ত তথ্য জমা হলে এখানে স্বয়ংক্রিয় ইনসাইট দেখানো হবে।</div>`;
  } else {
    container.innerHTML = insights.map(ins => `
      <div class="insight-item ${ins.type}">
        <i data-lucide="${ins.icon}"></i>
        <span class="insight-text">${ins.text}</span>
      </div>
    `).join('');
  }
  refreshIcons();
}

/* ফিচার ১৭ — দিনের সারাংশের একটা শেয়ারযোগ্য ছবি তৈরি করা */
function shareSummaryImage(){
  const canvas = document.createElement('canvas');
  const W = 800, H = 1000;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const today = todayStr();
  const thisMonth = today.slice(0,7);
  const todayExpense = getDayExpenseTotal(today);
  const monthExpense = getMonthExpenseTotal(thisMonth);
  const totalReceivable = state.entries.filter(e => e.kind === 'receivable').reduce((s,e)=>s+e.amount,0);
  const totalPayable = state.entries.filter(e => e.kind === 'payable').reduce((s,e)=>s+e.amount,0);
  const dailyLimit = getCurrentDailyLimit();

  // ব্যাকগ্রাউন্ড
  ctx.fillStyle = '#F6F1E6';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(176,141,79,.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, W-40, H-40);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#2B3D2F';
  ctx.font = '700 34px "Noto Serif Bengali", serif';
  ctx.fillText("Mahim's Ledger", W/2, 95);
  ctx.font = '400 18px "Hind Siliguri", sans-serif';
  ctx.fillStyle = '#8C8374';
  ctx.fillText(formatFullDateBn(new Date()), W/2, 130);

  const rows = [
    { label: 'আজকের মোট খরচ', value: taka(todayExpense), color: '#7C3B3B' },
    { label: 'এই মাসের মোট খরচ', value: taka(monthExpense), color: '#2B3D2F' },
    { label: 'মোট পাই (অন্যের কাছে)', value: taka(totalReceivable), color: '#3D5C46' },
    { label: 'মোট পাওনা (আমার কাছে)', value: taka(totalPayable), color: '#7C3B3B' },
  ];
  if(dailyLimit > 0){
    rows.push({ label: 'দৈনিক লিমিট', value: taka(dailyLimit), color: '#B08D4F' });
  }

  let y = 210;
  rows.forEach(r => {
    ctx.fillStyle = '#FFFDF9';
    ctx.strokeStyle = '#E3D9C6';
    ctx.lineWidth = 1.5;
    roundRect(ctx, 70, y, W-140, 110, 14);
    ctx.fill(); ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = '400 20px "Hind Siliguri", sans-serif';
    ctx.fillStyle = '#8C8374';
    ctx.fillText(r.label, 100, y + 42);

    ctx.font = '700 38px "Noto Serif Bengali", serif';
    ctx.fillStyle = r.color;
    ctx.fillText(r.value, 100, y + 85);

    y += 130;
  });

  ctx.textAlign = 'center';
  ctx.font = '400 15px "Hind Siliguri", sans-serif';
  ctx.fillStyle = '#8C8374';
  ctx.fillText('মাহিম\'স লেজার অ্যাপ দিয়ে তৈরি — ব্যক্তিগত হিসাব-খাতা', W/2, H - 45);

  canvas.toBlob(blob => {
    const file = new File([blob], 'mahims-ledger-summary.png', { type: 'image/png' });
    if(navigator.canShare && navigator.canShare({ files: [file] })){
      navigator.share({ files: [file], title: 'আমার হিসাবের সারাংশ' }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'mahims-ledger-summary.png';
      a.click();
      URL.revokeObjectURL(url);
      toast('সারাংশের ছবি ডাউনলোড হয়েছে।');
    }
  }, 'image/png');
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

document.getElementById('shareSummaryBtn').addEventListener('click', shareSummaryImage);

function renderDashboard(){
  document.getElementById('dashName').textContent = state.settings.name;

  const today = todayStr();
  const now = new Date();
  const thisMonth = today.slice(0,7);

  // "আজকের মোট খরচ" স্ট্যাট কার্ডে — দৈনিক মোট থেকে এক্সক্লুড করা এন্ট্রি বাদে
  const todayExpense = getDayExpenseTotal(today);
  // দৈনিক লিমিটের সাথে তুলনার জন্য আলাদা হিসাব (ভিন্ন এক্সক্লুড ফ্ল্যাগ)
  const todayExpenseForLimit = getDayExpenseForLimit(today);

  // "এই মাসের মোট খরচ" স্ট্যাট কার্ডে
  const monthExpense = getMonthExpenseTotal(thisMonth);
  // মাসিক বাজেট/লিমিটের সাথে তুলনার জন্য আলাদা হিসাব
  const monthExpenseForLimit = getMonthExpenseForLimit(thisMonth);

  const totalReceivable = state.entries
    .filter(e => e.kind === 'receivable')
    .reduce((s,e) => s + e.amount, 0);

  const totalPayable = state.entries
    .filter(e => e.kind === 'payable')
    .reduce((s,e) => s + e.amount, 0);

  // "এই মাসের মোট আয়" স্ট্যাট কার্ডে
  const monthIncome = state.entries
    .filter(e => e.kind === 'income' && e.date && e.date.slice(0,7) === thisMonth)
    .reduce((s,e) => s + e.amount, 0);

  const statTodayEl = document.getElementById('statTodayExpense');
  statTodayEl.textContent = taka(todayExpense);
  statTodayEl.classList.toggle('over-limit-text', isDayOverLimit(today));
  document.getElementById('statMonthExpense').textContent = taka(monthExpense);
  document.getElementById('statTotalReceivable').textContent = taka(totalReceivable);
  document.getElementById('statTotalPayable').textContent = taka(totalPayable);
  document.getElementById('statMonthIncome').textContent = taka(monthIncome);

  renderInsights(thisMonth, monthExpense, monthIncome);

  // মাসিক বাজেট (মাসিক লিমিট-নির্দিষ্ট হিসাব ব্যবহার করা হচ্ছে)
  const budget = state.settings.monthlyBudget || 0;
  const budgetEmpty = document.getElementById('budgetEmptyState');
  const budgetContent = document.getElementById('budgetContent');
  if(budget <= 0){
    budgetEmpty.style.display = 'block';
    budgetContent.style.display = 'none';
  } else {
    budgetEmpty.style.display = 'none';
    budgetContent.style.display = 'block';
    const pct = Math.min(100, (monthExpenseForLimit / budget) * 100);
    const fill = document.getElementById('budgetProgressFill');
    fill.style.width = pct + '%';
    fill.classList.toggle('over-budget', monthExpenseForLimit > budget);
    document.getElementById('budgetSpentLabel').textContent = `খরচ হয়েছে: ${taka(monthExpenseForLimit)}`;
    document.getElementById('budgetTotalLabel').textContent = `বাজেট: ${taka(budget)}`;
    const remainText = document.getElementById('budgetRemainingText');
    const remain = budget - monthExpenseForLimit;
    if(remain >= 0){
      remainText.textContent = `অবশিষ্ট আছে: ${taka(remain)} (এই মাসের জন্য)`;
      remainText.className = 'budget-remaining ok';
    } else {
      remainText.textContent = `বাজেট অতিক্রম হয়েছে: ${taka(Math.abs(remain))}`;
      remainText.className = 'budget-remaining over';
    }
  }

  // দৈনিক খরচের লিমিট (দৈনিক লিমিট-নির্দিষ্ট হিসাব ব্যবহার করা হচ্ছে)
  const dailyLimit = getCurrentDailyLimit();
  const dailyLimitEmpty = document.getElementById('dailyLimitEmptyState');
  const dailyLimitContent = document.getElementById('dailyLimitContent');
  if(dailyLimit <= 0){
    dailyLimitEmpty.style.display = 'block';
    dailyLimitContent.style.display = 'none';
  } else {
    dailyLimitEmpty.style.display = 'none';
    dailyLimitContent.style.display = 'block';
    const pctD = Math.min(100, (todayExpenseForLimit / dailyLimit) * 100);
    const fillD = document.getElementById('dailyLimitProgressFill');
    fillD.style.width = pctD + '%';
    fillD.classList.toggle('over-budget', todayExpenseForLimit > dailyLimit);
    document.getElementById('dailyLimitSpentLabel').textContent = `আজ খরচ হয়েছে: ${taka(todayExpenseForLimit)}`;
    document.getElementById('dailyLimitTotalLabel').textContent = `লিমিট: ${taka(dailyLimit)}`;
    const remainTextD = document.getElementById('dailyLimitRemainingText');
    const remainD = dailyLimit - todayExpenseForLimit;
    if(remainD >= 0){
      remainTextD.textContent = `আজকের জন্য বাকি আছে: ${taka(remainD)}`;
      remainTextD.className = 'budget-remaining ok';
    } else {
      remainTextD.textContent = `আজকের লিমিট অতিক্রম হয়েছে: ${taka(Math.abs(remainD))}`;
      remainTextD.className = 'budget-remaining over';
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
          <span class="entry-sub">${entryMetaLine(e)}</span>
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
    <tr class="${isDayOverLimit(e.date) ? 'over-limit-row' : ''}">
      <td>${formatDateDMY(e.date)}</td>
      <td>${formatTimeBn(e.time)}</td>
      <td>${escapeHtml(e.category || '')}${e.isTour ? ` <span class="badge income" style="font-size:.65rem;padding:.1rem .5rem;">ট্যুর</span>` : ''}${exclusionBadges(e)}</td>
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

// লিংকড কন্টাক্টের তথ্য (নাম ও ফোন নম্বর) দেখানোর জন্য
function contactInfoLine(e){
  if(!e.contactName && !e.contactPhone) return '';
  const parts = [];
  if(e.contactName) parts.push(escapeHtml(e.contactName));
  if(e.contactPhone) parts.push(escapeHtml(e.contactPhone));
  return `<span class="entry-sub contact-link-line"><i data-lucide="link"></i> কন্টাক্ট: ${parts.join(' · ')}</span>`;
}

/* ফিচার ১২ — পাই/পাওনার নির্ধারিত তারিখ দেখানো (লিমিট পার হলে লাল রঙে) */
function dueDateLine(e){
  if(!e.dueDate) return '';
  const overdue = e.dueDate < todayStr();
  return `<span class="entry-sub due-date-line${overdue ? ' overdue' : ''}"><i data-lucide="calendar-clock"></i> ${overdue ? 'নির্ধারিত তারিখ পার হয়ে গেছে' : 'নির্ধারিত তারিখ'}: ${formatDateDMY(e.dueDate)}</span>`;
}

function renderDueList(containerId, list, amountClass){
  const wrap = document.getElementById(containerId);
  if(list.length === 0){
    wrap.innerHTML = `<div class="empty-state">কোনো হিসাব নেই।</div>`;
    return;
  }

  // ব্যক্তি অনুযায়ী গ্রুপ করা — একজনের সব এন্ট্রি একসাথে যোগ হয়ে দেখাবে
  const groups = {};
  list.forEach(e => {
    const key = (e.person || '').trim() || 'অজানা';
    if(!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  const groupKeys = Object.keys(groups).sort((a,b) => {
    const totalA = groups[a].reduce((s,e)=>s+e.amount,0);
    const totalB = groups[b].reduce((s,e)=>s+e.amount,0);
    return totalB - totalA;
  });

  wrap.innerHTML = groupKeys.map(key => {
    const entries = [...groups[key]].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    const total = entries.reduce((s,e)=>s+e.amount,0);
    const groupId = 'grp-' + uid();

    if(entries.length === 1){
      const e = entries[0];
      return `
        <div class="due-group">
          <div class="due-group-header" style="cursor:default;">
            <div class="due-group-main">
              <span class="entry-title">${escapeHtml(key)}</span>
              <span class="entry-sub">${entryMetaLine(e)}</span>
              ${contactInfoLine(e)}${dueDateLine(e)}
            </div>
            <span class="entry-amount ${amountClass}">${taka(total)}</span>
          </div>
          <div class="due-group-detail open" style="border-top:none; padding-top:0;">
            <div class="entry-row">
              <div class="entry-main"><span class="entry-sub">এই এন্ট্রির বিস্তারিত</span></div>
              <div class="entry-actions">
                <button class="icon-btn" data-action="partial" data-id="${e.id}" title="আংশিক পরিশোধ"><i data-lucide="split"></i></button>
                <button class="icon-btn" data-action="share" data-id="${e.id}" title="শেয়ার করুন"><i data-lucide="share-2"></i></button>
                <button class="icon-btn" data-action="settle" data-id="${e.id}" title="পরিশোধ হয়েছে"><i data-lucide="check-circle-2"></i></button>
                <button class="icon-btn" data-action="edit" data-id="${e.id}" title="সম্পাদনা"><i data-lucide="pencil"></i></button>
                <button class="icon-btn danger" data-action="delete" data-id="${e.id}" title="ডিলিট"><i data-lucide="trash-2"></i></button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const linkedEntry = entries.find(e => e.contactName || e.contactPhone);

    return `
      <div class="due-group">
        <button class="due-group-header" data-target="${groupId}">
          <div class="due-group-main">
            <span class="entry-title">${escapeHtml(key)}</span>
            <span class="entry-sub">${bnDigits(entries.length)} টি এন্ট্রি — বিস্তারিত দেখতে ট্যাপ করুন</span>
            ${linkedEntry ? contactInfoLine(linkedEntry) : ''}
          </div>
          <span class="entry-amount ${amountClass}">${taka(total)}</span>
          <i data-lucide="chevron-down" class="due-group-chevron"></i>
        </button>
        <div class="due-group-detail" id="${groupId}">
          ${entries.map(e => `
            <div class="entry-row">
              <div class="entry-main">
                <span class="entry-sub">${entryMetaLine(e)}</span>
                ${contactInfoLine(e)}${dueDateLine(e)}
              </div>
              <span class="entry-amount ${amountClass}">${taka(e.amount)}</span>
              <div class="entry-actions">
                <button class="icon-btn" data-action="partial" data-id="${e.id}" title="আংশিক পরিশোধ"><i data-lucide="split"></i></button>
                <button class="icon-btn" data-action="share" data-id="${e.id}" title="শেয়ার করুন"><i data-lucide="share-2"></i></button>
                <button class="icon-btn" data-action="settle" data-id="${e.id}" title="পরিশোধ হয়েছে"><i data-lucide="check-circle-2"></i></button>
                <button class="icon-btn" data-action="edit" data-id="${e.id}" title="সম্পাদনা"><i data-lucide="pencil"></i></button>
                <button class="icon-btn danger" data-action="delete" data-id="${e.id}" title="ডিলিট"><i data-lucide="trash-2"></i></button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
  refreshIcons();
}

['receivableList','payableList'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    const toggleBtn = e.target.closest('[data-target]');
    if(toggleBtn){
      const detail = document.getElementById(toggleBtn.dataset.target);
      detail.classList.toggle('open');
      toggleBtn.classList.toggle('open');
      return;
    }
    const btn = e.target.closest('[data-action]');
    if(!btn) return;
    const entryId = btn.dataset.id;
    if(btn.dataset.action === 'edit') editEntry(entryId);
    if(btn.dataset.action === 'delete') deleteEntry(entryId);
    if(btn.dataset.action === 'settle') settleEntry(entryId);
    if(btn.dataset.action === 'partial') openPartialSettleModal(entryId);
    if(btn.dataset.action === 'share') shareDueEntry(entryId);
  });
});

/* ফিচার ১৪ — পাই/পাওনার তথ্য মেসেজ আকারে শেয়ার করা (WhatsApp/SMS/অন্য অ্যাপে) */
function shareDueEntry(id){
  const entry = state.entries.find(en => en.id === id);
  if(!entry) return;
  const isReceivable = entry.kind === 'receivable';
  const verb = isReceivable ? 'পাই' : 'পাওনা — দিতে হবে';
  const name = entry.person || 'আপনার কাছে';
  const text = isReceivable
    ? `${name}, আমার হিসাব অনুযায়ী আপনার কাছে আমি ${taka(entry.amount)} টাকা পাই। সুবিধামত ফেরত দিলে খুশি হব। ধন্যবাদ।`
    : `${name}, আমার হিসাব অনুযায়ী আপনাকে আমি ${taka(entry.amount)} টাকা দেওয়ার কথা। শীঘ্রই পরিশোধ করে দিচ্ছি।`;

  if(navigator.share){
    navigator.share({ text }).catch(() => {});
  } else {
    // শেয়ার API না থাকলে ক্লিপবোর্ডে কপি করে দেওয়া
    navigator.clipboard.writeText(text).then(() => {
      toast('মেসেজ ক্লিপবোর্ডে কপি হয়েছে — যেকোনো অ্যাপে পেস্ট করে পাঠাতে পারেন।');
    }).catch(() => {
      toast('শেয়ার করা সম্ভব হলো না।');
    });
  }
}

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
        <div class="entry-row" data-id="${it.id}">
          <div class="entry-main">
            <span class="entry-title">${escapeHtml(it.tourCategory || 'অন্যান্য')} — ${escapeHtml(it.note || '')}</span>
            <span class="entry-sub">${entryMetaLine(it)}</span>
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
  wrap.querySelectorAll('.entry-list').forEach(list => enableSwipeToDelete(list, deleteEntry));
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
  populateIncomeSourceSelect();

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
  renderCategoryBudgets();
}

/* ফিচার ২ — খাতভিত্তিক মাসিক বাজেট */
function renderCategoryBudgets(){
  const wrap = document.getElementById('categoryBudgetList');
  if(!wrap) return;
  const thisMonth = todayStr().slice(0,7);

  // এই মাসে প্রতিটি খাতে কত খরচ হয়েছে
  const monthTotals = {};
  state.entries
    .filter(e => e.kind === 'expense' && e.date && e.date.slice(0,7) === thisMonth)
    .forEach(e => {
      const cat = e.category || 'অন্যান্য';
      monthTotals[cat] = (monthTotals[cat] || 0) + e.amount;
    });

  if(state.categories.length === 0){
    wrap.innerHTML = `<div class="empty-state">কোনো ক্যাটাগরি নেই।</div>`;
    return;
  }

  wrap.innerHTML = state.categories.map(cat => {
    const budget = (state.categoryBudgets && state.categoryBudgets[cat]) || 0;
    const spent = monthTotals[cat] || 0;
    const safeCat = escapeHtml(cat);
    let progressHtml = '';
    if(budget > 0){
      const pct = Math.min(100, (spent / budget) * 100);
      const over = spent > budget;
      progressHtml = `
        <div class="progress-track"><div class="progress-fill${over ? ' over-budget' : ''}" style="width:${pct}%"></div></div>
        <div class="cat-budget-progress-row${over ? ' over' : ''}">
          <span>খরচ হয়েছে: ${taka(spent)}</span>
          <span>${over ? 'বাজেট অতিক্রম: ' + taka(spent - budget) : 'বাকি: ' + taka(budget - spent)}</span>
        </div>
      `;
    }
    return `
      <div class="cat-budget-item">
        <div class="cat-budget-head">
          <span class="cat-budget-name">${safeCat}</span>
          <div class="cat-budget-input-wrap">
            <input type="number" min="0" step="1" placeholder="বাজেট নেই" value="${budget > 0 ? budget : ''}" data-cat="${safeCat}" class="cat-budget-input" />
            <button type="button" class="cat-budget-save" data-cat="${safeCat}" title="সংরক্ষণ করুন"><i data-lucide="check"></i></button>
          </div>
        </div>
        ${progressHtml}
      </div>
    `;
  }).join('');

  wrap.querySelectorAll('.cat-budget-save').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const input = wrap.querySelector(`.cat-budget-input[data-cat="${CSS.escape(cat)}"]`);
      const val = Number(input.value);
      if(!state.categoryBudgets) state.categoryBudgets = {};
      if(!val || val <= 0){
        delete state.categoryBudgets[cat];
      } else {
        state.categoryBudgets[cat] = val;
      }
      saveState();
      renderCategoryBudgets();
      toast('খাতভিত্তিক বাজেট সংরক্ষিত হয়েছে।');
    });
  });

  refreshIcons();
}

/* =====================================================================
   রিপোর্ট ও পরিসংখ্যান
   ===================================================================== */
let monthlyChartInstance = null;
let yearlyChartInstance = null;
let dailyChartInstance = null;
let dailyChartRangeDays = 14;
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
  document.getElementById('includeReceivable').checked = true;
  document.getElementById('includePayable').checked = true;
  renderReportTable();
});

['includeReceivable','includePayable'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => renderReportTable());
});

function renderReportTable(){
  const from = document.getElementById('reportFrom').value;
  const to = document.getElementById('reportTo').value;
  const cat = document.getElementById('reportCategory').value;
  const includeReceivable = document.getElementById('includeReceivable').checked;
  const includePayable = document.getElementById('includePayable').checked;

  let rows = [...state.entries];
  if(from) rows = rows.filter(e => e.date >= from);
  if(to) rows = rows.filter(e => e.date <= to);
  if(cat !== 'all') rows = rows.filter(e => e.kind === 'expense' && e.category === cat);
  if(!includeReceivable) rows = rows.filter(e => e.kind !== 'receivable');
  if(!includePayable) rows = rows.filter(e => e.kind !== 'payable');

  rows.sort((a,b) => (b.date+b.time).localeCompare(a.date+a.time));
  currentFilteredEntries = rows;

  const tbody = document.querySelector('#reportTable tbody');
  const summaryWrap = document.getElementById('reportDetailedSummary');

  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">কোনো তথ্য পাওয়া যায়নি।</td></tr>`;
    if(summaryWrap) summaryWrap.innerHTML = '';
    return;
  }
  tbody.innerHTML = rows.map(e => `
    <tr class="${e.kind === 'expense' && isDayOverLimit(e.date) ? 'over-limit-row' : ''}">
      <td>${formatDateDMY(e.date)}</td>
      <td>${formatTimeBn(e.time)}</td>
      <td>${entryKindLabel(e.kind)}</td>
      <td>${escapeHtml(e.kind === 'expense' ? (e.category || '') :
            e.kind === 'income' ? (e.incomeSource || '') : (e.person || ''))}</td>
      <td>${escapeHtml(e.note || '')}</td>
      <td class="num ${entryAmountClass(e)}">${taka(e.amount)}</td>
    </tr>
  `).join('');

  // বিস্তারিত সারাংশ টেবিল
  if(summaryWrap){
    const expenseRows = rows.filter(e => e.kind === 'expense');
    const incomeRows  = rows.filter(e => e.kind === 'income');
    const paiRows     = rows.filter(e => e.kind === 'receivable');
    const paonaRows   = rows.filter(e => e.kind === 'payable');

    const totalExpense = expenseRows.reduce((s,e)=>s+e.amount,0);
    const totalIncome  = incomeRows.reduce((s,e)=>s+e.amount,0);
    const totalPai     = paiRows.reduce((s,e)=>s+e.amount,0);
    const totalPaona   = paonaRows.reduce((s,e)=>s+e.amount,0);

    // দৈনিক লিমিট সারাংশ
    const datesWithExpense = [...new Set(expenseRows.map(e=>e.date))].sort();
    let overLimitDays = 0, totalLimitEligible = 0, totalOverLimit = 0;
    datesWithExpense.forEach(d => {
      const lim = getDailyLimitForDate(d);
      const forLim = getDayExpenseForLimit(d);
      totalLimitEligible += forLim;
      if(lim > 0 && !state.dayExceptions?.[d] && forLim > lim){
        overLimitDays++;
        totalOverLimit += forLim - lim;
      }
    });

    // ক্যাটাগরি ব্রেকডাউন
    const catBreakdown = {};
    expenseRows.forEach(e => {
      const c = e.category || 'অন্যান্য';
      catBreakdown[c] = (catBreakdown[c] || 0) + e.amount;
    });
    const sortedCats = Object.entries(catBreakdown).sort((a,b)=>b[1]-a[1]);

    summaryWrap.innerHTML = `
      <div style="margin-top:1.6rem;">
        <h4 style="font-family:var(--font-display);color:var(--primary);margin-bottom:.9rem;font-size:1rem;">
          <i data-lucide="list-checks" style="width:16px;height:16px;vertical-align:middle;margin-right:.4rem;"></i>
          ফিল্টার-পরবর্তী বিস্তারিত সারাংশ
        </h4>
        <div style="overflow-x:auto;">
          <table class="report-summary-table">
            <thead>
              <tr>
                <th>বিবরণ</th>
                <th style="text-align:right;">এন্ট্রি সংখ্যা</th>
                <th style="text-align:right;">মোট পরিমাণ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>মোট খরচ</td>
                <td class="num">${bnDigits(expenseRows.length)}</td>
                <td class="num expense">${taka(totalExpense)}</td>
              </tr>
              <tr>
                <td>লিমিট-যোগ্য মোট খরচ</td>
                <td class="num">—</td>
                <td class="num">${taka(totalLimitEligible)}</td>
              </tr>
              <tr>
                <td>লিমিট অতিক্রান্ত দিন</td>
                <td class="num">${bnDigits(overLimitDays)}</td>
                <td class="num${totalOverLimit>0?' expense':''}">${totalOverLimit>0?taka(totalOverLimit):'—'}</td>
              </tr>
              ${incomeRows.length>0?`<tr>
                <td>মোট আয়</td>
                <td class="num">${bnDigits(incomeRows.length)}</td>
                <td class="num income">${taka(totalIncome)}</td>
              </tr>`:''}
              ${paiRows.length>0?`<tr>
                <td>মোট পাই (অন্যের কাছে)</td>
                <td class="num">${bnDigits(paiRows.length)}</td>
                <td class="num income">${taka(totalPai)}</td>
              </tr>`:''}
              ${paonaRows.length>0?`<tr>
                <td>মোট পাওনা (আমার কাছে)</td>
                <td class="num">${bnDigits(paonaRows.length)}</td>
                <td class="num expense">${taka(totalPaona)}</td>
              </tr>`:''}
              ${sortedCats.map(([cat,amt])=>`<tr>
                <td style="padding-left:1.8rem;color:var(--muted);">${escapeHtml(cat)}</td>
                <td class="num">—</td>
                <td class="num">${taka(amt)}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td>নিট (আয় − খরচ)</td>
                <td class="num">—</td>
                <td class="num${totalIncome-totalExpense>=0?' income':' expense'}">${taka(totalIncome-totalExpense)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
    refreshIcons();
  }
}

/* ফিচার ৪ — বছরের সারসংক্ষেপ */
function populateAnnualSummaryYearSelect(){
  const sel = document.getElementById('annualSummaryYear');
  if(!sel) return;
  const years = new Set(state.entries.filter(e => e.date).map(e => e.date.slice(0,4)));
  years.add(String(new Date().getFullYear()));
  const sortedYears = [...years].sort((a,b) => b - a);
  const prevValue = sel.value;
  sel.innerHTML = sortedYears.map(y => `<option value="${y}">${bnDigits(y)}</option>`).join('');
  if(sortedYears.includes(prevValue)){
    sel.value = prevValue;
  } else {
    sel.value = String(new Date().getFullYear());
  }
}

function renderAnnualSummary(){
  const content = document.getElementById('annualSummaryContent');
  const sel = document.getElementById('annualSummaryYear');
  if(!content || !sel) return;
  const year = sel.value;

  const yearEntries = state.entries.filter(e => e.date && e.date.slice(0,4) === year);
  const totalExpense = yearEntries.filter(e => e.kind === 'expense').reduce((s,e) => s+e.amount, 0);
  const totalIncome  = yearEntries.filter(e => e.kind === 'income').reduce((s,e) => s+e.amount, 0);
  const totalReceivable = yearEntries.filter(e => e.kind === 'receivable').reduce((s,e) => s+e.amount, 0);
  const totalPayable = yearEntries.filter(e => e.kind === 'payable').reduce((s,e) => s+e.amount, 0);

  // সবচেয়ে বেশি খরচ হওয়া মাস
  const monthTotals = {};
  yearEntries.filter(e => e.kind === 'expense').forEach(e => {
    const m = e.date.slice(0,7);
    monthTotals[m] = (monthTotals[m] || 0) + e.amount;
  });
  const topMonthEntry = Object.entries(monthTotals).sort((a,b) => b[1]-a[1])[0];
  const topMonthLabel = topMonthEntry ? MONTHS_BN[Number(topMonthEntry[0].slice(5,7)) - 1] : '—';

  // সবচেয়ে বেশি খরচ হওয়া ক্যাটাগরি
  const catTotals = {};
  yearEntries.filter(e => e.kind === 'expense').forEach(e => {
    const c = e.category || 'অন্যান্য';
    catTotals[c] = (catTotals[c] || 0) + e.amount;
  });
  const topCatEntry = Object.entries(catTotals).sort((a,b) => b[1]-a[1])[0];

  const avgMonthly = totalExpense > 0 ? totalExpense / Math.max(1, Object.keys(monthTotals).length) : 0;

  const stats = [
    { label: `${bnDigits(year)} সালের মোট খরচ`, value: taka(totalExpense), cls: 'expense' },
    { label: `${bnDigits(year)} সালের মোট আয়`, value: taka(totalIncome), cls: 'income' },
    { label: 'সর্বমোট পাই', value: taka(totalReceivable), cls: 'income' },
    { label: 'সর্বমোট পাওনা', value: taka(totalPayable), cls: 'expense' },
    { label: 'সবচেয়ে বেশি খরচের মাস', value: topMonthEntry ? `${topMonthLabel} (${taka(topMonthEntry[1])})` : '—', cls: '' },
    { label: 'সবচেয়ে বেশি খরচের খাত', value: topCatEntry ? `${escapeHtml(topCatEntry[0])} (${taka(topCatEntry[1])})` : '—', cls: '' },
    { label: 'গড় মাসিক খরচ', value: taka(Math.round(avgMonthly)), cls: '' },
  ];

  if(yearEntries.length === 0){
    content.innerHTML = `<div class="empty-state">${bnDigits(year)} সালের কোনো তথ্য পাওয়া যায়নি।</div>`;
    return;
  }

  content.innerHTML = stats.map(s => `
    <div class="annual-stat">
      <div class="annual-stat-label">${s.label}</div>
      <div class="annual-stat-value ${s.cls}">${s.value}</div>
    </div>
  `).join('');
}

document.addEventListener('change', e => {
  if(e.target && e.target.id === 'annualSummaryYear'){
    renderAnnualSummary();
  }
});

function renderCharts(){
  populateAnnualSummaryYearSelect();
  renderAnnualSummary();

  if(typeof Chart === 'undefined') return;

  // দৈনন্দিন খরচের চার্ট (সাম্প্রতিক N দিন)
  const dailyLabels = [];
  const dailyData = [];         // মোট খরচ (displayable)
  const dailyForLimitData = []; // লিমিট-যোগ্য খরচ (limit তুলনার জন্য)
  const dailyLimitData = [];
  const dailyColors = [];
  const dailyDateStrs = [];

  for(let i = dailyChartRangeDays - 1; i >= 0; i--){
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
    const total = getDayExpenseTotal(dateStr);
    const forLimit = getDayExpenseForLimit(dateStr);
    const limit = getDailyLimitForDate(dateStr);
    dailyLabels.push(bnDigits(d.getDate()) + ' ' + MONTHS_BN[d.getMonth()].slice(0,3));
    dailyData.push(total);
    dailyForLimitData.push(forLimit);
    dailyLimitData.push(limit > 0 ? limit : null);
    dailyColors.push(isDayOverLimit(dateStr) ? '#7C3B3B' : '#2B3D2F');
    dailyDateStrs.push(dateStr);
  }

  const ctxD = document.getElementById('dailyChart');
  if(dailyChartInstance) dailyChartInstance.destroy();
  dailyChartInstance = new Chart(ctxD, {
    type: 'bar',
    data: {
      labels: dailyLabels,
      datasets: [
        {
          label: 'মোট খরচ',
          data: dailyData,
          backgroundColor: dailyColors,
          borderRadius: 5,
          order: 2
        },
        {
          label: 'লিমিট-যোগ্য খরচ',
          data: dailyForLimitData,
          backgroundColor: 'transparent',
          borderColor: dailyColors.map(c => c),
          borderWidth: 2,
          type: 'bar',
          borderRadius: 3,
          order: 3,
          hidden: true // legend থেকে টগল করা যাবে
        },
        {
          label: 'দৈনিক লিমিট',
          data: dailyLimitData,
          type: 'line',
          borderColor: '#B08D4F',
          borderDash: [6,4],
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          spanGaps: true,
          order: 1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom',
          labels: { font: { family: "'Hind Siliguri', sans-serif" }, boxWidth: 12, padding: 12 } },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              return dailyDateStrs[idx] ? formatDateDMY(dailyDateStrs[idx]) : items[0].label;
            },
            label: (item) => {
              if(item.dataset.label === 'মোট খরচ')
                return ` মোট খরচ: ${taka(item.raw)}`;
              if(item.dataset.label === 'লিমিট-যোগ্য খরচ')
                return ` লিমিটে গণ্য: ${taka(item.raw)}`;
              if(item.dataset.label === 'দৈনিক লিমিট' && item.raw != null)
                return ` দৈনিক লিমিট: ${taka(item.raw)}`;
              return null;
            },
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              const limit = dailyLimitData[idx];
              const forLimit = dailyForLimitData[idx];
              if(limit && limit > 0){
                const diff = limit - forLimit;
                return diff >= 0
                  ? [`  বাকি: ${taka(diff)}`]
                  : [`  অতিক্রম: ${taka(Math.abs(diff))}`];
              }
              return [];
            }
          }
        }
      },
      scales: {
        x: { ticks: { font: { family: "'Hind Siliguri', sans-serif" }, maxRotation: 0, autoSkip: true } },
        y: { ticks: { callback: v => bnDigits(v), font: { family: "'Hind Siliguri', sans-serif" } } }
      }
    }
  });

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

document.querySelectorAll('.daily-chart-range .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.daily-chart-range .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    dailyChartRangeDays = Number(btn.dataset.days);
    renderCharts();
  });
});

/* ----- PDF/প্রিন্ট এক্সপোর্ট ----- */
document.getElementById('downloadPdfBtn').addEventListener('click', () => {
  renderReportTable();
  const rows = currentFilteredEntries;
  const includeReceivable = document.getElementById('includeReceivable').checked;
  const includePayable = document.getElementById('includePayable').checked;

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
        <td>${escapeHtml(e.kind === 'expense' ? (e.category||'') : e.kind==='income'?(e.incomeSource||''):(e.person||''))}</td>
        <td>${escapeHtml(e.note || '')}</td>
        <td>${taka(e.amount)}</td>
      </tr>
    `).join('');
  }

  const expenseRows = rows.filter(e=>e.kind==='expense');
  const incomeRows  = rows.filter(e=>e.kind==='income');
  const totalExpense = expenseRows.reduce((s,e)=>s+e.amount,0);
  const totalIncome  = incomeRows.reduce((s,e)=>s+e.amount,0);
  const totalReceivable = rows.filter(e=>e.kind==='receivable').reduce((s,e)=>s+e.amount,0);
  const totalPayable = rows.filter(e=>e.kind==='payable').reduce((s,e)=>s+e.amount,0);

  // বিস্তারিত সারাংশ (দৈনিক লিমিট তথ্য সহ)
  const datesWithExpense = [...new Set(expenseRows.map(e=>e.date))].sort();
  let overLimitDays=0, totalOverLimit=0, totalLimitEligible=0;
  datesWithExpense.forEach(d=>{
    const lim=getDailyLimitForDate(d);
    const fl=getDayExpenseForLimit(d);
    totalLimitEligible+=fl;
    if(lim>0&&!state.dayExceptions?.[d]&&fl>lim){overLimitDays++;totalOverLimit+=fl-lim;}
  });

  let summaryParts = [
    `মোট খরচ: ${taka(totalExpense)}`,
    `লিমিট-যোগ্য খরচ: ${taka(totalLimitEligible)}`,
  ];
  if(overLimitDays>0) summaryParts.push(`লিমিট অতিক্রান্ত দিন: ${bnDigits(overLimitDays)} (অতিরিক্ত ${taka(totalOverLimit)})`);
  if(totalIncome>0) summaryParts.push(`মোট আয়: ${taka(totalIncome)}`);
  if(includeReceivable) summaryParts.push(`মোট পাই: ${taka(totalReceivable)}`);
  if(includePayable) summaryParts.push(`মোট পাওনা: ${taka(totalPayable)}`);
  summaryParts.push(`নিট (আয় − খরচ): ${taka(totalIncome-totalExpense)}`);

  document.getElementById('printSummary').innerHTML = summaryParts.join('<br>');

  window.print();
});

/* ----- CSV এক্সপোর্ট ----- */
document.getElementById('downloadCsvBtn').addEventListener('click', () => {
  renderReportTable();
  const rows = currentFilteredEntries;

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

/* ফিচার ২৩ — Excel (.xlsx) এক্সপোর্ট */
document.getElementById('downloadExcelBtn').addEventListener('click', () => {
  renderReportTable();
  const rows = currentFilteredEntries;
  if(rows.length === 0){ toast('ডাউনলোডের জন্য কোনো তথ্য পাওয়া যায়নি।'); return; }

  if(typeof XLSX === 'undefined'){ toast('Excel লাইব্রেরি লোড হয়নি — কিছুক্ষণ পর আবার চেষ্টা করুন।'); return; }

  const wsData = [
    ['তারিখ','সময়','ধরন','খাত/ব্যক্তি/উৎস','নোট','পরিমাণ (৳)']
  ];
  rows.forEach(e => {
    wsData.push([
      formatDateDMY(e.date),
      e.time ? formatTimeBn(e.time) : 'উল্লেখ নেই',
      entryKindLabel(e.kind),
      e.kind === 'expense' ? (e.category || '') :
        e.kind === 'income' ? (e.incomeSource || '') : (e.person || ''),
      e.note || '',
      e.amount
    ]);
  });

  const totalExpense  = rows.filter(e=>e.kind==='expense').reduce((s,e)=>s+e.amount,0);
  const totalIncome   = rows.filter(e=>e.kind==='income').reduce((s,e)=>s+e.amount,0);
  const totalReceivable = rows.filter(e=>e.kind==='receivable').reduce((s,e)=>s+e.amount,0);
  const totalPayable  = rows.filter(e=>e.kind==='payable').reduce((s,e)=>s+e.amount,0);
  wsData.push([]);
  wsData.push(['সারাংশ','','','','','']);
  wsData.push(['মোট খরচ','','','','',totalExpense]);
  wsData.push(['মোট আয়','','','','',totalIncome]);
  wsData.push(['মোট পাই','','','','',totalReceivable]);
  wsData.push(['মোট পাওনা','','','','',totalPayable]);

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'হিসাব স্টেটমেন্ট');
  XLSX.writeFile(wb, `mahims-ledger-${todayStr()}.xlsx`);
  toast('Excel ফাইল ডাউনলোড হয়েছে।');
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
    <div class="entry-row" data-id="${c.id}">
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
  enableSwipeToDelete(wrap, contactId => {
    openConfirm('কন্টাক্ট ডিলিট করুন', 'এই কন্টাক্টটি স্থায়ীভাবে মুছে যাবে।', () => {
      state.contacts = state.contacts.filter(c => c.id !== contactId);
      saveState();
      renderAll();
    });
  });
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

      // নামের কলাম খোঁজা — "Name", বা "Given/First Name" + "Middle Name" + "Family/Last Name"
      const nameIdx   = header.findIndex(h => h.toLowerCase() === 'name');
      const givenIdx  = header.findIndex(h => /^(given|first)\s*name$/i.test(h));
      const middleIdx = header.findIndex(h => /^middle\s*name$/i.test(h));
      const familyIdx = header.findIndex(h => /^(family|last)\s*name$/i.test(h));

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
          const middle = middleIdx !== -1 ? (row[middleIdx] || '').trim() : '';
          const family = familyIdx !== -1 ? (row[familyIdx] || '').trim() : '';
          name = [given, middle, family].filter(Boolean).join(' ').trim();
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
function populateArchiveCategoryFilter(){
  const sel = document.getElementById('archiveFilterCategory');
  if(!sel) return;
  const cats = new Set(state.archive.filter(e=>e.kind==='expense').map(e=>e.category).filter(Boolean));
  const prev = sel.value;
  sel.innerHTML = '<option value="all">সব খাত</option>' +
    [...cats].sort().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if([...cats].includes(prev)) sel.value = prev;
}

function renderArchive(){
  populateArchiveCategoryFilter();
  const tbody = document.querySelector('#archiveTable tbody');
  if(state.archive.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">আর্কাইভ খালি।</td></tr>`;
    return;
  }
  const sortBy      = document.getElementById('archiveSortBy')?.value || 'date-desc';
  const filterKind  = document.getElementById('archiveFilterKind')?.value || 'all';
  const filterCat   = document.getElementById('archiveFilterCategory')?.value || 'all';

  let list = [...state.archive];
  if(filterKind !== 'all') list = list.filter(e => e.kind === filterKind);
  if(filterCat !== 'all') list = list.filter(e => e.category === filterCat);
  list.sort((a,b)=>{
    if(sortBy === 'date-asc')    return new Date(a.archivedAt) - new Date(b.archivedAt);
    if(sortBy === 'amount-desc') return b.amount - a.amount;
    if(sortBy === 'amount-asc')  return a.amount - b.amount;
    return new Date(b.archivedAt) - new Date(a.archivedAt);
  });

  if(list.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">এই ফিল্টারে কোনো আর্কাইভ নেই।</td></tr>`;
    return;
  }

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
    saveState(); renderAll(); toast('এন্ট্রি পুনরুদ্ধার করা হয়েছে।');
  }));

  tbody.querySelectorAll('[data-action="perm-delete"]').forEach(b => b.addEventListener('click', () => {
    openConfirm('স্থায়ীভাবে ডিলিট', 'এই এন্ট্রিটি আর্কাইভ থেকেও স্থায়ীভাবে মুছে যাবে — এটি ফিরিয়ে আনা যাবে না।', () => {
      state.archive = state.archive.filter(x => !(x.id === b.dataset.id && x.archivedAt === b.dataset.archived));
      saveState(); renderAll();
    });
  }));
  refreshIcons();
}

['archiveSortBy','archiveFilterKind','archiveFilterCategory'].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', renderArchive);
});

/* =====================================================================
   সেটিংস
   ===================================================================== */
function loadSettingsForm(){
  document.getElementById('settingName').value = state.settings.name;
  document.getElementById('settingMonthlyBudget').value = state.settings.monthlyBudget || '';
  document.getElementById('reminderEnabled').checked = state.settings.reminderEnabled;
  document.getElementById('reminderTime').value = state.settings.reminderTime;
  document.getElementById('settingCurrency').value = state.settings.currency || 'BDT';
  renderProfilePhoto();
  applyTheme(state.settings.theme || 'light');
  applyAccentColor(state.settings.accentColor || 'B08D4F');
  updatePinStatusUI();
}

function renderProfilePhoto(){
  const photo = state.settings.profilePhoto;
  const preview = document.getElementById('profilePhotoPreview');
  const seal = document.getElementById('sidebarSeal');
  if(photo){
    preview.innerHTML = `<img src="${photo}" alt="প্রোফাইল ছবি" />`;
    seal.innerHTML = `<img src="${photo}" alt="প্রোফাইল ছবি" />`;
  } else {
    preview.innerHTML = 'মি.মা.';
    seal.innerHTML = 'মি.মা.';
  }
}

/* ছবি রিসাইজ করে ছোট base64 ডেটাতে রূপান্তর — Firestore-এ সংরক্ষণের জন্য আকার কমিয়ে রাখা হয় */
function resizeImageFile(file, maxSize, quality){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if(width > height){
          if(width > maxSize){ height = Math.round(height * (maxSize / width)); width = maxSize; }
        } else {
          if(height > maxSize){ width = Math.round(width * (maxSize / height)); height = maxSize; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('profilePhotoInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if(!file) return;
  try{
    const dataUrl = await resizeImageFile(file, 200, 0.8);
    state.settings.profilePhoto = dataUrl;
    saveState();
    renderProfilePhoto();
    toast('প্রোফাইল ছবি সংরক্ষিত হয়েছে।');
  }catch(err){
    console.error(err);
    toast('ছবি প্রসেস করতে সমস্যা হয়েছে।');
  }
  e.target.value = '';
});

document.getElementById('removeProfilePhotoBtn').addEventListener('click', () => {
  if(!state.settings.profilePhoto){ toast('কোনো ছবি যুক্ত নেই।'); return; }
  openConfirm('ছবি সরান', 'আপনার প্রোফাইল ছবি সরিয়ে দিতে চান?', () => {
    state.settings.profilePhoto = null;
    saveState();
    renderProfilePhoto();
    toast('প্রোফাইল ছবি সরানো হয়েছে।');
  });
});

document.getElementById('saveSettingsBtn').addEventListener('click', () => {
  state.settings.name = document.getElementById('settingName').value.trim() || state.settings.name;
  state.settings.monthlyBudget = Math.max(0, Number(document.getElementById('settingMonthlyBudget').value) || 0);
  state.settings.reminderEnabled = document.getElementById('reminderEnabled').checked;
  state.settings.reminderTime = document.getElementById('reminderTime').value || '21:00';
  state.settings.currency = document.getElementById('settingCurrency').value || 'BDT';
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
   দৈনন্দিন খরচ — ক্যালেন্ডার
   ===================================================================== */
const now0 = new Date();
let calendarYear = now0.getFullYear();
let calendarMonth = now0.getMonth(); // 0-indexed
let selectedCalendarDate = todayStr();

function renderDailyExpensesPage(){
  // বর্তমান লিমিট দেখানো
  document.getElementById('currentDailyLimitText').textContent = currentLimitDisplayText();
  renderCalendar();
  renderDayDetail(selectedCalendarDate);
}

function renderCalendar(){
  document.getElementById('calendarMonthLabel').textContent =
    `${MONTHS_BN[calendarMonth]} ${bnDigits(calendarYear)}`;

  const grid = document.getElementById('calendarGrid');
  const firstDay = new Date(calendarYear, calendarMonth, 1);
  const startWeekday = firstDay.getDay(); // ০ = রবিবার
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const today = todayStr();

  let html = '';
  for(let i=0; i<startWeekday; i++){
    html += `<div class="calendar-day empty"></div>`;
  }
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${calendarYear}-${pad(calendarMonth+1)}-${pad(d)}`;
    const total = getDayExpenseTotal(dateStr);
    const over = isDayOverLimit(dateStr);
    const classes = ['calendar-day'];
    if(dateStr === today) classes.push('today');
    if(dateStr === selectedCalendarDate) classes.push('selected');
    if(over) classes.push('over-limit');
    html += `
      <div class="${classes.join(' ')}" data-date="${dateStr}">
        <span class="day-num">${bnDigits(d)}</span>
        ${total > 0 ? `<span class="day-amt">${taka(total)}</span>` : ''}
      </div>
    `;
  }
  grid.innerHTML = html;
  refreshIcons();
}

function renderDayDetail(dateStr){
  selectedCalendarDate = dateStr;
  const card = document.getElementById('dayDetailCard');
  const title = document.getElementById('dayDetailTitle');
  const summary = document.getElementById('dayDetailSummary');
  const list = document.getElementById('dayDetailList');
  const exceptionRow = document.getElementById('dayExceptionRow');
  const exceptionCheckbox = document.getElementById('dayExceptionCheckbox');

  card.style.display = 'block';
  const [y,m,d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m-1, d);
  title.innerHTML = `<i data-lucide="calendar-check"></i> ${formatFullDateBn(dateObj)}`;

  const total = getDayExpenseTotal(dateStr);
  const totalForLimit = getDayExpenseForLimit(dateStr);
  const limit = getDailyLimitForDate(dateStr);
  const over = isDayOverLimit(dateStr);

  let summaryHtml = `<span>মোট খরচ: <strong class="${over ? 'over':''}">${taka(total)}</strong></span>`;
  if(limit > 0){
    summaryHtml += `<span>দৈনিক লিমিট: <strong>${taka(limit)}</strong></span>`;
    summaryHtml += `<span>লিমিট-যোগ্য খরচ: <strong>${taka(totalForLimit)}</strong></span>`;
    const diff = limit - totalForLimit;
    if(diff >= 0){
      summaryHtml += `<span>বাকি আছে: <strong>${taka(diff)}</strong></span>`;
    } else {
      summaryHtml += `<span class="over">অতিরিক্ত খরচ: <strong>${taka(Math.abs(diff))}</strong></span>`;
    }
  }
  summary.innerHTML = summaryHtml;

  // সেদিনের খরচের এন্ট্রিসমূহ
  const dayEntries = state.entries
    .filter(e => e.kind === 'expense' && e.date === dateStr)
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  if(dayEntries.length === 0){
    list.innerHTML = `<div class="empty-state">এই দিনের কোনো খরচের তথ্য নেই।</div>`;
  } else {
    list.innerHTML = dayEntries.map(e => `
      <div class="entry-row" data-id="${e.id}">
        <div class="entry-main">
          <span class="entry-title">${escapeHtml(entryTitle(e))}${exclusionBadges(e)}</span>
          <span class="entry-sub">${entryMetaLine(e)}</span>
        </div>
        <span class="entry-amount ${entryAmountClass(e)}">${taka(e.amount)}</span>
        <div class="entry-actions">
          <button class="icon-btn" data-action="edit" data-id="${e.id}" title="সম্পাদনা"><i data-lucide="pencil"></i></button>
          <button class="icon-btn danger" data-action="delete" data-id="${e.id}" title="ডিলিট"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `).join('');
  }

  // লিমিট অতিক্রম করলে বা আগে এক্সসেপশন দেওয়া থাকলে — এক্সসেপশন চেকবক্স দেখানো
  if(limit > 0 && (over || (state.dayExceptions && state.dayExceptions[dateStr]))){
    exceptionRow.style.display = 'block';
    exceptionCheckbox.checked = !!(state.dayExceptions && state.dayExceptions[dateStr]);
  } else {
    exceptionRow.style.display = 'none';
  }

  refreshIcons();
  enableSwipeToDelete(list, deleteEntry);
}

document.getElementById('calendarGrid').addEventListener('click', e => {
  const cell = e.target.closest('.calendar-day');
  if(!cell || cell.classList.contains('empty')) return;
  const prevSelected = document.querySelector('.calendar-day.selected');
  if(prevSelected) prevSelected.classList.remove('selected');
  cell.classList.add('selected');
  renderDayDetail(cell.dataset.date);
});

document.getElementById('dayDetailList').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if(!btn) return;
  const entryId = btn.dataset.id;
  if(btn.dataset.action === 'edit') editEntry(entryId);
  if(btn.dataset.action === 'delete') deleteEntry(entryId);
});

document.getElementById('prevMonthBtn').addEventListener('click', () => {
  calendarMonth--;
  if(calendarMonth < 0){ calendarMonth = 11; calendarYear--; }
  renderCalendar();
});

document.getElementById('nextMonthBtn').addEventListener('click', () => {
  calendarMonth++;
  if(calendarMonth > 11){ calendarMonth = 0; calendarYear++; }
  renderCalendar();
});

document.getElementById('dayExceptionCheckbox').addEventListener('change', e => {
  if(!state.dayExceptions) state.dayExceptions = {};
  if(e.target.checked){
    state.dayExceptions[selectedCalendarDate] = true;
  } else {
    delete state.dayExceptions[selectedCalendarDate];
  }
  saveState();
  renderAll();
  toast(e.target.checked ? 'এই দিনটি লিমিটের বাইরে রাখা হলো।' : 'এই দিনটি আবার লিমিট হিসাবে যুক্ত হলো।');
});


/* =====================================================================
   ক্যালকুলেটর
   ===================================================================== */
let calcExpr = ''; // ব্যবহারকারীর ইনপুট (লাতিন সংখ্যা ও অপারেটরে সংরক্ষিত)

const CALC_OP_SYMBOLS = { '+':'+', '-':'−', '*':'×', '/':'÷' };

function calcDisplayExpr(){
  let display = calcExpr;
  Object.keys(CALC_OP_SYMBOLS).forEach(op => {
    display = display.split(op).join(CALC_OP_SYMBOLS[op]);
  });
  return bnDigits(display);
}

function calcEvaluate(expr){
  // নিরাপত্তা: শুধু সংখ্যা, দশমিক বিন্দু, +-*/%, এবং বন্ধনী অনুমোদিত
  if(!/^[0-9+\-*/.%() ]*$/.test(expr)) return null;
  if(!expr) return null;
  try{
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + expr.replace(/%/g, '/100') + ')')();
    if(typeof result !== 'number' || !isFinite(result)) return null;
    return result;
  }catch(e){
    return null;
  }
}

function renderCalculator(){
  const exprEl = document.getElementById('calcExpression');
  const resultEl = document.getElementById('calcResult');
  if(!exprEl || !resultEl) return;

  exprEl.innerHTML = calcExpr ? calcDisplayExpr() : '&nbsp;';

  const result = calcEvaluate(calcExpr);
  if(result === null){
    resultEl.textContent = calcExpr ? '—' : '০';
  } else {
    // সংখ্যাটি অতিরিক্ত দশমিক ঘর ছাড়া দেখানো (ফ্লোটিং-পয়েন্ট ত্রুটি এড়াতে)
    const rounded = Math.round(result * 1e8) / 1e8;
    resultEl.textContent = bnDigits(
      rounded.toLocaleString('en-US', { maximumFractionDigits: 8 })
    );
  }
}

document.querySelectorAll('.calc-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    if(key === 'clear'){
      calcExpr = '';
    } else if(key === 'backspace'){
      calcExpr = calcExpr.slice(0, -1);
    } else if(key === '='){
      const result = calcEvaluate(calcExpr);
      if(result !== null){
        const rounded = Math.round(result * 1e8) / 1e8;
        calcExpr = String(rounded);
      }
    } else if(key === '%'){
      calcExpr += '%';
    } else if(['+','-','*','/'].includes(key)){
      // পরপর দুটো অপারেটর এড়ানো
      if(calcExpr === '' && key !== '-') return;
      const last = calcExpr.slice(-1);
      if(['+','-','*','/'].includes(last)){
        calcExpr = calcExpr.slice(0, -1) + key;
      } else {
        calcExpr += key;
      }
    } else if(key === '.'){
      // একই সংখ্যায় একাধিক দশমিক বিন্দু এড়ানো
      const parts = calcExpr.split(/[+\-*/]/);
      const currentNum = parts[parts.length - 1];
      if(!currentNum.includes('.')) calcExpr += '.';
    } else {
      // সংখ্যা (০-৯)
      calcExpr += key;
    }
    renderCalculator();
  });
});

document.getElementById('calcUseAsExpenseBtn').addEventListener('click', () => {
  const result = calcEvaluate(calcExpr);
  if(result === null || result <= 0){
    toast('প্রথমে ক্যালকুলেটরে একটি ফলাফল হিসাব করুন।');
    return;
  }
  const rounded = Math.round(result * 100) / 100;
  goToPage('add-entry');
  setTimeout(() => {
    entryAmountInput.value = rounded;
    entryAmountInput.focus();
  }, 50);
});

/* =====================================================================
   ফিচার ৭ — রিকারিং (পুনরাবৃত্ত) এন্ট্রি
   ===================================================================== */
function populateRecurringFormSelects(){
  const catSel = document.getElementById('recurringCategory');
  const incSel = document.getElementById('recurringIncomeSource');
  if(catSel) catSel.innerHTML = state.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if(incSel) incSel.innerHTML = INCOME_SOURCES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

document.getElementById('recurringKind').addEventListener('change', e => {
  const isIncome = e.target.value === 'income';
  document.getElementById('recurringCategoryRow').style.display = isIncome ? 'none' : '';
  document.getElementById('recurringIncomeSourceRow').style.display = isIncome ? '' : 'none';
});

document.getElementById('addRecurringBtn').addEventListener('click', () => {
  const kind = document.getElementById('recurringKind').value;
  const amount = Number(document.getElementById('recurringAmount').value);
  const day = Number(document.getElementById('recurringDay').value);
  const note = document.getElementById('recurringNote').value.trim();
  if(!amount || amount <= 0){ toast('সঠিক পরিমাণ দিন।'); return; }
  if(!day || day < 1 || day > 28){ toast('তারিখ ১ থেকে ২৮-এর মধ্যে দিন (যাতে প্রতি মাসেই এই তারিখ থাকে)।'); return; }

  const item = {
    id: uid(), kind, amount, note,
    category: kind === 'expense' ? document.getElementById('recurringCategory').value : null,
    incomeSource: kind === 'income' ? document.getElementById('recurringIncomeSource').value : null,
    dayOfMonth: day,
    lastGeneratedMonth: '',
    active: true
  };
  state.recurring.push(item);
  saveState();
  document.getElementById('recurringAmount').value = '';
  document.getElementById('recurringDay').value = '';
  document.getElementById('recurringNote').value = '';
  renderRecurringList();
  toast('রিকারিং এন্ট্রি যুক্ত হয়েছে।');
});

function renderRecurringList(){
  const wrap = document.getElementById('recurringList');
  if(!wrap) return;
  populateRecurringFormSelects();
  if(state.recurring.length === 0){
    wrap.innerHTML = `<div class="empty-state">এখনো কোনো রিকারিং এন্ট্রি নেই।</div>`;
    return;
  }
  wrap.innerHTML = state.recurring.map(r => `
    <div class="recurring-item">
      <div class="recurring-item-main">
        <span class="recurring-item-title">${r.kind === 'income' ? escapeHtml(r.incomeSource || '') : escapeHtml(r.category || '')} — ${taka(r.amount)}</span>
        <span class="recurring-item-sub">প্রতি মাসের ${bnDigits(r.dayOfMonth)} তারিখে${r.note ? ' · ' + escapeHtml(r.note) : ''}</span>
      </div>
      <div class="recurring-item-actions">
        <button class="recurring-toggle ${r.active ? 'active' : ''}" data-id="${r.id}" title="চালু/বন্ধ করুন"></button>
        <button class="icon-btn danger" data-action="delete-recurring" data-id="${r.id}" title="ডিলিট"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('.recurring-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = state.recurring.find(r => r.id === btn.dataset.id);
      if(item){ item.active = !item.active; saveState(); renderRecurringList(); }
    });
  });
  wrap.querySelectorAll('[data-action="delete-recurring"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openConfirm('রিকারিং এন্ট্রি ডিলিট', 'এই রিকারিং এন্ট্রিটি ডিলিট করতে চান? আগে তৈরি হওয়া এন্ট্রিগুলো প্রভাবিত হবে না।', () => {
        state.recurring = state.recurring.filter(r => r.id !== btn.dataset.id);
        saveState();
        renderRecurringList();
      });
    });
  });
}

// অ্যাপ চালু হওয়ার সময় চেক করা — এই মাসের জন্য এখনো তৈরি না হওয়া রিকারিং এন্ট্রি স্বয়ংক্রিয়ভাবে তৈরি করা
function generateRecurringEntries(){
  if(!state.recurring || state.recurring.length === 0) return;
  const today = new Date();
  const thisMonth = today.getFullYear() + '-' + pad(today.getMonth()+1);
  const todayDate = today.getDate();
  let generated = false;

  state.recurring.forEach(r => {
    if(!r.active) return;
    if(r.lastGeneratedMonth === thisMonth) return; // এই মাসে আগেই তৈরি হয়েছে
    if(todayDate < r.dayOfMonth) return; // এখনো সেই তারিখ আসেনি

    const dateStr = thisMonth + '-' + pad(r.dayOfMonth);
    state.entries.unshift({
      id: uid(),
      kind: r.kind,
      category: r.kind === 'expense' ? r.category : null,
      incomeSource: r.kind === 'income' ? r.incomeSource : null,
      person: null, contactName: null, contactPhone: null,
      amount: r.amount,
      date: dateStr,
      time: '',
      note: (r.note || '') + ' (রিকারিং)',
      isTour: false, tourId: null, tourCategory: null,
      excludeFromDailyTotal: false, excludeFromDailyLimit: false,
      excludeFromMonthlyTotal: false, excludeFromMonthlyLimit: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    r.lastGeneratedMonth = thisMonth;
    generated = true;
  });

  if(generated){
    saveState();
    toast('এই মাসের রিকারিং এন্ট্রি স্বয়ংক্রিয়ভাবে যুক্ত হয়েছে।');
  }
}

/* =====================================================================
   ফিচার ১০ — সঞ্চয় লক্ষ্য (Savings Goals)
   ===================================================================== */
document.getElementById('addGoalBtn').addEventListener('click', () => {
  const title = document.getElementById('goalTitle').value.trim();
  const target = Number(document.getElementById('goalTarget').value);
  const date = document.getElementById('goalDate').value;
  if(!title){ toast('লক্ষ্যের নাম দিন।'); return; }
  if(!target || target <= 0){ toast('সঠিক লক্ষ্য পরিমাণ দিন।'); return; }

  state.savingsGoals.push({
    id: uid(), title, targetAmount: target, savedAmount: 0,
    targetDate: date || null, createdAt: new Date().toISOString()
  });
  saveState();
  document.getElementById('goalTitle').value = '';
  document.getElementById('goalTarget').value = '';
  document.getElementById('goalDate').value = '';
  renderGoals();
  toast('সঞ্চয় লক্ষ্য যুক্ত হয়েছে।');
});

function goalCardHtml(g){
  const pct = Math.min(100, (g.savedAmount / g.targetAmount) * 100);
  const completed = g.savedAmount >= g.targetAmount;
  return `
    <div class="goal-item" data-id="${g.id}">
      <div class="goal-item-head">
        <span class="goal-item-title">${escapeHtml(g.title)}</span>
        ${completed ? `<span class="goal-completed-badge"><i data-lucide="check-circle-2"></i> সম্পন্ন</span>` : (g.targetDate ? `<span class="goal-item-date">${formatDateDMY(g.targetDate)}</span>` : '')}
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="goal-progress-row">
        <span>জমা হয়েছে: ${taka(g.savedAmount)}</span>
        <span>লক্ষ্য: ${taka(g.targetAmount)}</span>
      </div>
      ${!completed ? `
        <div class="goal-add-amount-row">
          <input type="number" min="0" step="1" placeholder="যত টাকা জমা করলেন" class="goal-add-input" data-id="${g.id}" />
          <button type="button" class="goal-add-btn" data-id="${g.id}">জমা করুন</button>
        </div>
      ` : ''}
      <div class="entry-actions" style="margin-top:.5rem;">
        <button class="icon-btn danger" data-action="delete-goal" data-id="${g.id}" title="ডিলিট"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
  `;
}

function wireGoalCardEvents(container){
  container.querySelectorAll('.goal-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = container.querySelector(`.goal-add-input[data-id="${btn.dataset.id}"]`);
      const val = Number(input.value);
      if(!val || val <= 0) return;
      const goal = state.savingsGoals.find(g => g.id === btn.dataset.id);
      if(goal){
        goal.savedAmount = Math.min(goal.targetAmount, goal.savedAmount + val);
        saveState();
        renderGoals();
        toast('সঞ্চয়ে যুক্ত হয়েছে।');
      }
    });
  });
  container.querySelectorAll('[data-action="delete-goal"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openConfirm('লক্ষ্য ডিলিট', 'এই সঞ্চয় লক্ষ্যটি ডিলিট করতে চান?', () => {
        state.savingsGoals = state.savingsGoals.filter(g => g.id !== btn.dataset.id);
        saveState();
        renderGoals();
      });
    });
  });
}

function renderGoals(){
  const wrap = document.getElementById('goalsList');
  const dashCard = document.getElementById('dashboardGoalsCard');
  const dashList = document.getElementById('dashboardGoalsList');

  if(wrap){
    if(state.savingsGoals.length === 0){
      wrap.innerHTML = `<div class="empty-state">এখনো কোনো সঞ্চয় লক্ষ্য নেই।</div>`;
    } else {
      wrap.innerHTML = state.savingsGoals.map(goalCardHtml).join('');
      wireGoalCardEvents(wrap);
    }
  }
  if(dashCard && dashList){
    if(state.savingsGoals.length === 0){
      dashCard.style.display = 'none';
    } else {
      dashCard.style.display = 'block';
      dashList.innerHTML = state.savingsGoals.slice(0,3).map(goalCardHtml).join('');
      wireGoalCardEvents(dashList);
    }
  }
  refreshIcons();
}

/* =====================================================================
   ফিচার ১১ — কুইক-অ্যাড টেমপ্লেট
   ===================================================================== */
function populateTemplateFormSelects(){
  const catSel = document.getElementById('templateCategory');
  const incSel = document.getElementById('templateIncomeSource');
  if(catSel) catSel.innerHTML = state.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if(incSel) incSel.innerHTML = INCOME_SOURCES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

document.getElementById('templateKind').addEventListener('change', e => {
  const isIncome = e.target.value === 'income';
  document.getElementById('templateCategoryRow').style.display = isIncome ? 'none' : '';
  document.getElementById('templateIncomeSourceRow').style.display = isIncome ? '' : 'none';
});

document.getElementById('addTemplateBtn').addEventListener('click', () => {
  const label = document.getElementById('templateLabel').value.trim();
  const kind = document.getElementById('templateKind').value;
  const amount = Number(document.getElementById('templateAmount').value);
  const note = document.getElementById('templateNote').value.trim();
  if(!label){ toast('টেমপ্লেটের নাম দিন।'); return; }
  if(!amount || amount <= 0){ toast('সঠিক পরিমাণ দিন।'); return; }

  state.quickTemplates.push({
    id: uid(), label, kind,
    category: kind === 'expense' ? document.getElementById('templateCategory').value : null,
    incomeSource: kind === 'income' ? document.getElementById('templateIncomeSource').value : null,
    amount, note
  });
  saveState();
  document.getElementById('templateLabel').value = '';
  document.getElementById('templateAmount').value = '';
  document.getElementById('templateNote').value = '';
  renderTemplatesList();
  toast('টেমপ্লেট যুক্ত হয়েছে।');
});

function renderTemplatesList(){
  const wrap = document.getElementById('templatesList');
  if(!wrap) return;
  populateTemplateFormSelects();
  if(state.quickTemplates.length === 0){
    wrap.innerHTML = `<div class="empty-state">এখনো কোনো টেমপ্লেট নেই।</div>`;
  } else {
    wrap.innerHTML = state.quickTemplates.map(t => `
      <div class="template-item">
        <div class="template-item-main">
          <span class="template-item-title">${escapeHtml(t.label)}</span>
          <span class="template-item-sub">${t.kind === 'income' ? 'আয়' : 'খরচ'} · ${taka(t.amount)}${t.note ? ' · ' + escapeHtml(t.note) : ''}</span>
        </div>
        <div class="template-item-actions">
          <button class="icon-btn danger" data-action="delete-template" data-id="${t.id}" title="ডিলিট"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-action="delete-template"]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.quickTemplates = state.quickTemplates.filter(t => t.id !== btn.dataset.id);
        saveState();
        renderTemplatesList();
        renderQuickTemplatesRow();
        toast('টেমপ্লেট ডিলিট হয়েছে।');
      });
    });
  }
  renderQuickTemplatesRow();
}

function renderQuickTemplatesRow(){
  const row = document.getElementById('quickTemplatesRow');
  if(!row) return;
  if(!state.quickTemplates || state.quickTemplates.length === 0){
    row.style.display = 'none';
    return;
  }
  row.style.display = 'flex';
  row.innerHTML = state.quickTemplates.map(t => `
    <button type="button" class="quick-template-btn" data-id="${t.id}">
      <i data-lucide="zap"></i> ${escapeHtml(t.label)} (${taka(t.amount)})
    </button>
  `).join('');
  row.querySelectorAll('.quick-template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = state.quickTemplates.find(tt => tt.id === btn.dataset.id);
      if(!t) return;
      document.querySelectorAll('#entryTypeControl .seg').forEach(s => s.classList.toggle('active', s.dataset.value === t.kind));
      currentEntryType = t.kind;
      updateEntryFormForType();
      if(t.kind === 'expense'){
        entryCategorySel.value = t.category || state.categories[0];
      } else if(t.kind === 'income'){
        entryIncomeSourceSel.value = t.incomeSource || INCOME_SOURCES[0];
      }
      entryAmountInput.value = t.amount;
      entryNoteInput.value = t.note || '';
      toast(`"${t.label}" টেমপ্লেট থেকে ফর্ম পূরণ হয়েছে — যাচাই করে সংরক্ষণ করুন।`);
    });
  });
  refreshIcons();
}

/* =====================================================================
   নোটস
   ===================================================================== */
function renderNotes(){
  const list = document.getElementById('notesList');
  if(!list) return;
  const q = (document.getElementById('noteSearch').value || '').trim().toLowerCase();

  let notes = [...(state.notes || [])];
  if(q){
    notes = notes.filter(n =>
      (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q)
    );
  }
  notes.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  if(notes.length === 0){
    list.innerHTML = `<div class="empty-state">কোনো নোট পাওয়া যায়নি।</div>`;
    return;
  }

  list.innerHTML = notes.map(n => `
    <div class="note-card" data-id="${n.id}">
      <div class="note-card-head">
        <span class="note-card-title">${escapeHtml(n.title || 'শিরোনামহীন নোট')}</span>
        <span class="note-card-date">${formatDateDMY(n.updatedAt ? n.updatedAt.slice(0,10) : '')}</span>
      </div>
      ${n.content ? `<div class="note-card-preview">${escapeHtml(n.content)}</div>` : ''}
      <div class="note-card-actions">
        <button class="icon-btn" data-action="edit" data-id="${n.id}" title="সম্পাদনা"><i data-lucide="pencil"></i></button>
        <button class="icon-btn danger" data-action="delete" data-id="${n.id}" title="ডিলিট"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
  `).join('');
  refreshIcons();
}

function resetNoteForm(){
  document.getElementById('noteId').value = '';
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteContent').value = '';
  document.getElementById('noteFormTitle').innerHTML = `<i data-lucide="notebook-pen"></i> নতুন নোট`;
  refreshIcons();
}

document.getElementById('saveNoteBtn').addEventListener('click', () => {
  const id = document.getElementById('noteId').value;
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value.trim();
  if(!title && !content){
    toast('নোটে কিছু লিখুন।');
    return;
  }
  const now = new Date().toISOString();
  if(id){
    const note = state.notes.find(n => n.id === id);
    if(note){ note.title = title; note.content = content; note.updatedAt = now; }
  } else {
    state.notes.unshift({ id: uid(), title, content, updatedAt: now });
  }
  saveState();
  renderNotes();
  resetNoteForm();
  toast('নোট সংরক্ষিত হয়েছে।');
});

document.getElementById('resetNoteBtn').addEventListener('click', resetNoteForm);

document.getElementById('noteSearch').addEventListener('input', renderNotes);

document.getElementById('notesList').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if(btn){
    const id = btn.dataset.id;
    if(btn.dataset.action === 'delete'){
      openConfirm('নোট ডিলিট করুন', 'এই নোটটি স্থায়ীভাবে ডিলিট করতে চান?', () => {
        state.notes = state.notes.filter(n => n.id !== id);
        saveState();
        renderNotes();
        toast('নোট ডিলিট হয়েছে।');
      });
    } else if(btn.dataset.action === 'edit'){
      const note = state.notes.find(n => n.id === id);
      if(!note) return;
      document.getElementById('noteId').value = note.id;
      document.getElementById('noteTitle').value = note.title || '';
      document.getElementById('noteContent').value = note.content || '';
      document.getElementById('noteFormTitle').innerHTML = `<i data-lucide="pencil-line"></i> নোট সম্পাদনা করুন`;
      refreshIcons();
    }
    return;
  }
  // কার্ডে ক্লিক করলেও এডিট মোডে যাওয়া
  const card = e.target.closest('.note-card');
  if(card){
    const note = state.notes.find(n => n.id === card.dataset.id);
    if(!note) return;
    document.getElementById('noteId').value = note.id;
    document.getElementById('noteTitle').value = note.title || '';
    document.getElementById('noteContent').value = note.content || '';
    document.getElementById('noteFormTitle').innerHTML = `<i data-lucide="pencil-line"></i> নোট সম্পাদনা করুন`;
    refreshIcons();
  }
});


function renderAll(){
  renderDashboard();
  renderExpenseTable();
  renderReceivables();
  renderTours();
  renderCategories();
  renderDailyExpensesPage();
  populateReportCategorySelect();
  renderReportTable();
  renderCharts();
  renderContacts();
  renderArchive();
  renderNotes();
  renderRecurringList();
  renderGoals();
  renderTemplatesList();
  renderGuide();
  refreshIcons();
}

/* =====================================================================
   ব্যবহার-বিধি (গাইড) পেজ
   ===================================================================== */
const GUIDE_SECTIONS = [
  {
    icon: 'layout-dashboard', title: 'ড্যাশবোর্ড',
    body: `ড্যাশবোর্ডে অ্যাপ খোলার সাথেই আজকের মোট খরচ, মোট পাই (অন্যের কাছে পাওনা টাকা), মোট পাওনা (আপনি অন্যকে যা দিতে হবে), এই মাসের মোট খরচ ও মোট আয় — এই পাঁচটি সংখ্যা একনজরে দেখা যায়। প্রতিটি কার্ডে ট্যাপ করলে সংশ্লিষ্ট বিস্তারিত পেজে চলে যাবেন। নিচে "ইনসাইটস" কার্ডে অ্যাপ স্বয়ংক্রিয়ভাবে আপনার খরচের ধরন বিশ্লেষণ করে জানাবে — গত মাসের তুলনায় খরচ বাড়লো বা কমলো কিনা, কোন খাতে সবচেয়ে বেশি খরচ হয়েছে, কোন দিনে সবচেয়ে বেশি খরচ হয়েছে, এবং গড় দৈনিক/সাপ্তাহিক খরচ কত। সঞ্চয় লক্ষ্য থাকলে তার অগ্রগতিও এখানে দেখা যাবে। সবচেয়ে নিচে মাসিক বাজেট ও দৈনিক লিমিটের প্রোগ্রেস বার আছে।`
  },
  {
    icon: 'pencil-line', title: 'নতুন এন্ট্রি যুক্ত করা',
    body: `"নতুন এন্ট্রি" পেজে চারটি ধরনের এন্ট্রি যুক্ত করা যায়: খরচ, আয়, পাই (অন্যের কাছ থেকে টাকা পাবেন) ও পাওনা (আপনাকে অন্যকে টাকা দিতে হবে)। খরচের জন্য একটি খাত (ক্যাটাগরি) বাছতে হয়, আয়ের জন্য আয়ের উৎস (বেতন, ব্যবসা ইত্যাদি), আর পাই/পাওনার জন্য ব্যক্তির নাম লিখতে হয় (চাইলে কন্টাক্ট থেকেও বেছে নেওয়া যায়)। প্রতিটি এন্ট্রিতে তারিখ, সময় (না জানলে "সময় উল্লেখ নেই" টিক দিন), ও একটি নোট যুক্ত করা যায়। উপরে থাকা কুইক-টেমপ্লেট বাটনে ট্যাপ করলে প্রায়ই করা এন্ট্রি (যেমন "দুপুরের খাবার ৮০ টাকা") এক ট্যাপেই ফর্মে বসে যাবে। খরচের ক্ষেত্রে চারটি ঐচ্ছিক চেকবক্স আছে — এই এন্ট্রি দৈনিক/মাসিক মোট বা লিমিটের হিসাবে যুক্ত হবে কিনা, যেকোনো কম্বিনেশনে বেছে নেওয়া যায়। ট্যুরের খরচ হলে "ট্যুর সম্পর্কিত খরচ" টিক দিলে আলাদা ট্যুর হিসাবেও যুক্ত হয়ে যাবে।`
  },
  {
    icon: 'gauge', title: 'দৈনিক লিমিট ও দৈনন্দিন খরচ',
    body: `"দৈনন্দিন খরচ" পেজে একটি মাসিক ক্যালেন্ডার দেখা যায় — প্রতিদিনের মোট খরচ ছোট করে দেখানো থাকে। দৈনিক লিমিট ঠিক করে রাখলে, কোনো দিনের খরচ লিমিট পার করলে সেই দিনটি লাল রঙে চিহ্নিত হয়ে যাবে (ক্যালেন্ডার, ড্যাশবোর্ড ও তালিকায় সব জায়গায়)। লিমিট পরিবর্তনের সময় দুটো অপশন থাকে — "মাসিক বাজেট অনুযায়ী" বাছলে মাসিক বাজেটকে সেই মাসের দিন সংখ্যা দিয়ে ভাগ করে স্বয়ংক্রিয়ভাবে দৈনিক লিমিট ঠিক হয়ে যায়, অথবা "নিজে নির্ধারণ করুন" দিয়ে নিজের ইচ্ছামতো অংক বসানো যায়। নতুন লিমিট "আজ থেকে কার্যকর" বা "আগামীকাল থেকে" — দুইভাবে সেট করা যায়; আগের তারিখগুলো তখনকার লিমিট অনুযায়ীই রঙ ধরে রাখবে। কোনো দিনে ক্লিক করলে সেদিনের বিস্তারিত এন্ট্রি দেখা যাবে, এবং চাইলে সেই দিনটিকে "লিমিটের বাইরে" রাখার অপশনও (এক্সসেপশন) আছে।`
  },
  {
    icon: 'target', title: 'মাসিক বাজেট ও খাতভিত্তিক বাজেট',
    body: `সেটিংস থেকে একটি সার্বিক মাসিক বাজেট ঠিক করা যায়, যা ড্যাশবোর্ডে প্রোগ্রেস বারে দেখা যাবে। এর পাশাপাশি "ক্যাটাগরি" পেজে প্রতিটি খাতের (যেমন খাবার, যাতায়াত) জন্য আলাদা মাসিক বাজেটও ঠিক করা যায় — সেই খাতে এই মাসে কত খরচ হয়েছে, বাজেটের কতটুকু বাকি বা পার হয়েছে তা প্রোগ্রেস বারে দেখাবে।`
  },
  {
    icon: 'repeat', title: 'রিকারিং (পুনরাবৃত্ত) এন্ট্রি',
    body: `মাসিক ভাড়া, বিল, বেতনের মতো প্রতি মাসে একই অংকের লেনদেনের জন্য সেটিংস পেজ থেকে "রিকারিং এন্ট্রি" তৈরি করা যায়। ধরন (খরচ/আয়), খাত বা উৎস, পরিমাণ এবং মাসের কোন তারিখে (১-২৮ এর মধ্যে) তৈরি হবে তা ঠিক করে দিলে, সেই তারিখ এলে অ্যাপ খোলার সময় স্বয়ংক্রিয়ভাবে একটি এন্ট্রি তৈরি হয়ে যাবে — প্রতি মাসে আবার নতুন করে যুক্ত করার প্রয়োজন নেই। যেকোনো সময় চালু/বন্ধ বা ডিলিট করা যায়।`
  },
  {
    icon: 'piggy-bank', title: 'সঞ্চয় লক্ষ্য',
    body: `সেটিংস থেকে একটি সঞ্চয়ের লক্ষ্য (যেমন "নতুন ফোন কেনা — ৩০,০০০ টাকা") তৈরি করা যায়, ঐচ্ছিকভাবে একটি লক্ষ্য তারিখও দেওয়া যায়। যখনই কিছু টাকা জমা করবেন, "জমা করুন" বাটনে সেই পরিমাণ লিখে যুক্ত করলে প্রোগ্রেস বার এগিয়ে যাবে। লক্ষ্য পূর্ণ হলে "সম্পন্ন" ব্যাজ দেখাবে। ড্যাশবোর্ডেও সক্রিয় লক্ষ্যগুলো দেখা যায়।`
  },
  {
    icon: 'zap', title: 'কুইক-অ্যাড টেমপ্লেট',
    body: `প্রায়ই করা একই রকম এন্ট্রি (যেমন প্রতিদিনের নাস্তার খরচ) বারবার টাইপ না করে, সেটিংস থেকে একটি টেমপ্লেট বানিয়ে রাখা যায়। "নতুন এন্ট্রি" পেজের উপরে এই টেমপ্লেট বাটনগুলো দেখা যাবে — ট্যাপ করলেই ফর্ম স্বয়ংক্রিয়ভাবে পূরণ হয়ে যাবে, শুধু সংরক্ষণ করলেই এন্ট্রি যুক্ত হয়ে যাবে।`
  },
  {
    icon: 'hand-coins', title: 'পাই ও পাওনা',
    body: `"পাই ও পাওনা" পেজে কে কত টাকা পাবেন আর কাকে কত দিতে হবে তা ব্যক্তি ধরে গ্রুপ করে দেখানো হয়। কন্টাক্ট লিংক করা থাকলে ফোন নম্বরও দেখা যাবে। এন্ট্রি যুক্ত করার সময় ঐচ্ছিকভাবে একটি "ফেরত দেওয়ার/নেওয়ার তারিখ" দেওয়া যায় — সেই তারিখ পার হয়ে গেলে ড্যাশবোর্ডের ইনসাইটসে রিমাইন্ডার দেখাবে এবং তালিকায় লাল রঙে চিহ্নিত হবে। কোনো লেনদেনের পুরো টাকা মিটে গেলে "পরিশোধ হয়েছে" বাটনে চাপলে তা সেটল হয়ে আর্কাইভে চলে যাবে। যদি একসাথে পুরো টাকা না দিয়ে আংশিক পরিশোধ করা হয়, "আংশিক পরিশোধ" বাটনে চেপে কত টাকা দিয়েছেন তা লিখলে বাকি অংক স্বয়ংক্রিয়ভাবে এন্ট্রিতে থেকে যাবে। "শেয়ার করুন" বাটনে চাপলে সংশ্লিষ্ট ব্যক্তিকে পাঠানোর জন্য একটি রেডি মেসেজ তৈরি হয়ে যাবে, যা WhatsApp/SMS বা অন্য কোনো অ্যাপে শেয়ার বা কপি করে পাঠানো যাবে।`
  },
  {
    icon: 'map', title: 'ট্যুর হিসাব',
    body: `ভ্রমণের সময় খরচ আলাদাভাবে ট্র্যাক করতে "ট্যুর হিসাব" পেজে একটি ট্যুর তৈরি করুন (নাম, শুরু ও শেষ তারিখ দিয়ে)। এন্ট্রি যুক্ত করার সময় "ট্যুর সম্পর্কিত খরচ" টিক দিয়ে সেই ট্যুর বেছে নিলে, এই পেজে ভাড়া/খাবার/হোটেল/অন্যান্য ক্যাটাগরি ধরে ট্যুরের পুরো খরচের বিস্তারিত দেখা যাবে।`
  },
  {
    icon: 'tags', title: 'ক্যাটাগরি ব্যবস্থাপনা',
    body: `এখানে নতুন খাত (ক্যাটাগরি) যুক্ত করা যায়, সর্বমোট কোন খাতে কত খরচ হয়েছে তার তালিকা ও পাই-চার্ট দেখা যায়, এবং খাতভিত্তিক মাসিক বাজেটও এখান থেকে ঠিক করা যায়।`
  },
  {
    icon: 'bar-chart-3', title: 'পরিসংখ্যান ও রিপোর্ট',
    body: `এই পেজে তারিখ ও খাত দিয়ে ফিল্টার করে নির্দিষ্ট সময়ের লেনদেনের তালিকা দেখা যায়। "পাই" ও "পাওনা" আলাদাভাবে অন্তর্ভুক্ত/বাদ দেওয়ার চেকবক্স আছে, যা রিপোর্ট ও ডাউনলোডে প্রভাব ফেলে। CSV ও PDF/প্রিন্ট ফরম্যাটে ডাউনলোড করা যায়। দৈনন্দিন (১৪/৩০/৯০ দিন), মাসিক ও বাৎসরিক চার্ট দেখা যায়, এবং বছরের একটি সম্পূর্ণ সারসংক্ষেপ (মোট খরচ-আয়, সবচেয়ে বেশি খরচের মাস/খাত, গড় মাসিক খরচ) আলাদা বছর বেছে দেখা যায়।`
  },
  {
    icon: 'users', title: 'কন্টাক্টস',
    body: `পাই-পাওনার এন্ট্রিতে দ্রুত ব্যক্তি বেছে নেওয়ার জন্য এখানে কন্টাক্ট যুক্ত করে রাখা যায় (ম্যানুয়ালি বা Google Contacts থেকে CSV আমদানি করে)।`
  },
  {
    icon: 'archive', title: 'আর্কাইভ',
    body: `এডিট বা ডিলিট হওয়া কোনো এন্ট্রি স্থায়ীভাবে হারিয়ে যায় না — এখানে জমা থাকে এবং প্রয়োজনে পুনরুদ্ধার করা যায়। তারিখ/পরিমাণ অনুযায়ী সাজানো এবং ধরন/খাত অনুযায়ী ফিল্টার করা যায়।`
  },
  {
    icon: 'calculator', title: 'ক্যালকুলেটর',
    body: `সাধারণ হিসাব-নিকাশের জন্য একটি ক্যালকুলেটর আছে। হিসাব করার পর "এই ফলাফল দিয়ে নতুন এন্ট্রি যুক্ত করুন" বাটনে চাপলে সরাসরি এন্ট্রি ফর্মে পরিমাণ বসে যাবে।`
  },
  {
    icon: 'notebook-pen', title: 'নোটস',
    body: `যেকোনো প্রয়োজনীয় তথ্য বা লিস্ট লিখে রাখার জন্য নোটস পেজ আছে। শিরোনাম দিয়ে বা লেখার মধ্যে সার্চ করে নোট খুঁজে পাওয়া যায়। কোনো নোটে ক্লিক করলে এডিট করা যায়।`
  },
  {
    icon: 'search', title: 'গ্লোবাল সার্চ',
    body: `টপবারের সার্চ আইকনে চাপলে পুরো অ্যাকাউন্টে (লেনদেন, কন্টাক্ট, ট্যুর, নোট, ক্যাটাগরি) একসাথে খোঁজা যায় — টাকার পরিমাণ, নাম, খাত, নোট যা দিয়েই খুঁজুন, সংশ্লিষ্ট ফলাফল দেখাবে এবং ক্লিক করলে সরাসরি সেই জায়গায় নিয়ে যাবে।`
  },
  {
    icon: 'cloud', title: 'ক্লাউড সিঙ্ক ও অফলাইন ব্যবহার',
    body: `সব তথ্য স্বয়ংক্রিয়ভাবে ক্লাউডে সংরক্ষিত হয় — একই ইমেইল-পাসওয়ার্ড দিয়ে যেকোনো ডিভাইস থেকে লগইন করলে সর্বশেষ তথ্য দেখা যাবে। ইন্টারনেট না থাকলেও অ্যাপ ব্যবহার করা যায়; পরিবর্তনগুলো ডিভাইসে জমা থাকবে এবং ইন্টারনেট ফিরে আসার সাথে সাথেই স্বয়ংক্রিয়ভাবে ক্লাউডে সিঙ্ক হয়ে যাবে। টপবারের সিঙ্ক আইকনে ট্যাপ করলে ম্যানুয়ালি রিফ্রেশও করা যায়।`
  },
  {
    icon: 'smartphone', title: 'হোম স্ক্রিনে অ্যাপ ইনস্টল করা',
    body: `মোবাইল ব্রাউজার থেকে লগইন পেজে ঢুকলে "মোবাইলে অ্যাপ হিসেবে ইনস্টল করুন" বাটন দেখা যাবে (Android/Chrome-এ এক ট্যাপেই ইনস্টল হবে, iPhone-এ Share বাটন থেকে "Add to Home Screen" করতে হবে)। ইনস্টল করার পর আইকনে দীর্ঘ-চাপ দিলে "নতুন এন্ট্রি" ও "ড্যাশবোর্ড"-এ সরাসরি যাওয়ার শর্টকাটও পাওয়া যাবে।`
  },
  {
    icon: 'image-down', title: 'সারাংশ শেয়ার করা',
    body: `ড্যাশবোর্ডের উপরে "সারাংশ শেয়ার করুন" বাটনে চাপলে আজকের খরচ, এই মাসের খরচ, মোট পাই-পাওনা ও দৈনিক লিমিট নিয়ে একটি সুন্দর ছবি তৈরি হয়ে যাবে, যা সরাসরি অন্য কোনো অ্যাপে শেয়ার করা যাবে অথবা ডাউনলোড করে রাখা যাবে।`
  },
  {
    icon: 'move-horizontal', title: 'সোয়াইপ করে ডিলিট (মোবাইল)',
    body: `মোবাইলে দৈনন্দিন খরচের বিস্তারিত তালিকা, কন্টাক্টস ও ট্যুরের খরচের তালিকায় কোনো এন্ট্রির উপর বাম দিকে আঙুল দিয়ে সোয়াইপ করলে নিচে লাল "ডিলিট" দেখাবে — পর্যাপ্ত দূরত্ব সোয়াইপ করলে এন্ট্রিটি ডিলিট হয়ে যাবে। ডেস্কটপে এই জেসচার প্রয়োজন নেই, তাই বাটন দিয়েই ডিলিট করা যাবে।`
  },
  {
    icon: 'database', title: 'ডেটা ব্যাকআপ ও সেটিংস',
    body: `সেটিংস পেজ থেকে প্রোফাইলের নাম-ছবি, মাসিক বাজেট, দৈনিক রিমাইন্ডার চালু/বন্ধ করা যায়। কারেন্সি (মুদ্রা) সেটিংসে টাকা ছাড়াও ডলার, ইউরো, পাউন্ড, রুপি, সৌদি রিয়াল ইত্যাদি বেছে নেওয়া যায় — সব জায়গায় পরিমাণ সেই মুদ্রার চিহ্নে দেখাবে। টপবারের চাঁদ/সূর্য আইকনে চাপলে ডার্ক/লাইট মোড পরিবর্তন করা যায়। থিম রঙ সেকশনে অ্যাপের ব্রাশ/সোনালি রঙের জায়গায় ৬টি প্রিসেট রঙের যেকোনো একটি বেছে নেওয়া যায়। অতিরিক্ত সতর্কতা হিসেবে সব তথ্যের একটি JSON ব্যাকআপ ডাউনলোড করে রাখা যায়, এবং প্রয়োজনে তা থেকে পুনরায় আমদানি করা যায়।`
  }
];

function renderGuide(){
  const container = document.getElementById('guideContent');
  if(!container) return;
  const query = (document.getElementById('guideSearch').value || '').trim().toLowerCase();

  container.innerHTML = GUIDE_SECTIONS.map((sec, i) => {
    const matches = !query || sec.title.toLowerCase().includes(query) || sec.body.toLowerCase().includes(query);
    return `
      <div class="guide-section${matches ? '' : ' hidden'}" data-idx="${i}">
        <div class="guide-section-head" data-idx="${i}">
          <h4><i data-lucide="${sec.icon}"></i> ${escapeHtml(sec.title)}</h4>
          <i data-lucide="chevron-down" class="guide-chevron"></i>
        </div>
        <div class="guide-section-body">${sec.body}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.guide-section-head').forEach(head => {
    head.addEventListener('click', () => {
      const body = head.nextElementSibling;
      const isOpen = body.classList.contains('open');
      body.classList.toggle('open', !isOpen);
      head.classList.toggle('open', !isOpen);
    });
  });

  // সার্চ করার সময় ফলাফলে থাকা সেকশনগুলো স্বয়ংক্রিয়ভাবে খুলে দেওয়া
  if(query){
    container.querySelectorAll('.guide-section:not(.hidden) .guide-section-body').forEach(body => {
      body.classList.add('open');
      body.previousElementSibling.classList.add('open');
    });
  }

  refreshIcons();
}

document.getElementById('guideSearch').addEventListener('input', renderGuide);

/* =====================================================================
   লাইভ ব্যবহারকারী কাউন্টার (পাবলিক, শেয়ার্ড Firestore ডকুমেন্ট)
   ===================================================================== */
function listenUserCounter(){
  const el = document.getElementById('userCounterValue');
  if(!el || !firebaseReady || !db) return;
  db.collection('public').doc('stats').onSnapshot(docSnap => {
    if(docSnap.exists && typeof docSnap.data().userCount === 'number'){
      el.textContent = bnDigits(docSnap.data().userCount);
    } else {
      el.textContent = bnDigits(1);
    }
  }, () => {
    el.textContent = '—';
  });
}

// নতুন অ্যাকাউন্ট তৈরি হলে এই শেয়ার্ড কাউন্টার ১ বাড়িয়ে দেওয়া (সব ব্যবহারকারী এই একই ডকুমেন্ট দেখেন, কিন্তু কারো ব্যক্তিগত ডেটা এখানে নেই)
function incrementUserCounter(){
  if(!firebaseReady || !db) return;
  db.collection('public').doc('stats').set({
    userCount: firebase.firestore.FieldValue.increment(1)
  }, { merge: true }).catch(err => console.warn('ইউজার কাউন্টার আপডেট সমস্যা:', err));
}

/* =====================================================================
   ইনিশিয়ালাইজেশন
   ===================================================================== */
function init(){
  // লগইন/সাইনআপ চালু করা (অন্য কোনো অংশে এরর হলেও এটি কাজ করবে)
  setupAuthUI();
  setupMobileInstallUI();
  listenUserCounter();

  // হোম স্ক্রিন শর্টকাট (#add-entry, #dashboard ইত্যাদি) থেকে সরাসরি পেজ খোলা
  const initialPage = (location.hash || '').replace('#', '') || 'dashboard';
  const validPages = ['dashboard','add-entry','receivables','tours','categories','daily-expenses','reports','contacts','archive','calculator','notes','guide','settings'];
  const startPage = validPages.includes(initialPage) ? initialPage : 'dashboard';

  // প্রাথমিক হিস্ট্রি স্টেট — মোবাইলের ব্যাক বাটন সঠিকভাবে কাজ করার জন্য
  history.replaceState({ page: startPage }, '', '#' + startPage);
  if(startPage !== 'dashboard'){
    goToPage(startPage, { skipHistory: true });
  }

  // PWA সার্ভিস ওয়ার্কার রেজিস্টার (অফলাইনে অ্যাপ-শেল লোড হওয়ার জন্য)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(err => console.error('SW রেজিস্ট্রেশন সমস্যা:', err));
    // নতুন ভার্সন এক্টিভেট হলে স্বয়ংক্রিয়ভাবে একবার রিলোড — যাতে ব্যবহারকারী সবসময়
    // সর্বশেষ আপডেট দেখতে পান (ক্যাশড পুরোনো ফাইল আটকে না থাকে)
    let swRefreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(swRefreshed) return;
      swRefreshed = true;
      location.reload();
    });
  }

  try{
    // ফর্মে আজকের তারিখ/সময় বসানো
    entryDateInput.value = todayStr();
    entryTimeInput.value = nowTimeStr();
    updateEntryFormForType();

    // টপবারে আজকের তারিখ
    document.getElementById('pageDate').textContent = formatFullDateBn(new Date());

    loadSettingsForm();
    generateRecurringEntries();
    renderAll();
    renderCalculator();
    refreshIcons();

    checkReminder();
    setInterval(checkReminder, 60 * 1000);
  }catch(e){
    console.error("ইনিশিয়ালাইজেশনে সমস্যা:", e);
  }
}

init();
