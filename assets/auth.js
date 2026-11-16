// Connexion Google + sauvegarde Firestore des niveaux / préférences.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAgSUnT3U_ysxxTpqgk6OfJHRD1JbhhnsU',
  authDomain: 'wakfu-tool.firebaseapp.com',
  projectId: 'wakfu-tool',
  storageBucket: 'wakfu-tool.firebasestorage.app',
  messagingSenderId: '407547037718',
  appId: '1:407547037718:web:65db2fc60ac0a578df4d37',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const W = window.waktool;
const box = document.getElementById('account');
let user = null;
let saveTimer = null;
let status = '';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  if (!user) {
    box.innerHTML = `<button class="gbtn" id="login" type="button">
      <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      Connexion Google</button>${status ? `<span class="sync err">${esc(status)}</span>` : ''}`;
    document.getElementById('login').onclick = login;
    return;
  }
  const pic = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : '';
  box.innerHTML = `<span class="who" title="${esc(user.email)}">${pic}<span>${esc(user.displayName || user.email)}</span></span>
    <span class="sync ${status.startsWith('Erreur') ? 'err' : ''}">${esc(status)}</span>
    <button class="lnk" id="logout" type="button">Déconnexion</button>`;
  document.getElementById('logout').onclick = () => signOut(auth);
}

async function login() {
  status = '';
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      status = 'Connexion impossible (' + e.code + ')';
      render();
    }
  }
}

const ref = () => doc(db, 'users', user.uid);

async function save() {
  if (!user) return;
  try {
    status = 'Sauvegarde…'; render();
    await setDoc(ref(), { ...W.getState(), updatedAt: serverTimestamp() }, { merge: true });
    status = 'Sauvegardé ✓';
  } catch (e) {
    status = 'Erreur de sauvegarde';
    console.error(e);
  }
  render();
}

W.onChange(() => {
  if (!user) return;
  clearTimeout(saveTimer);
  status = 'Modifié…'; render();
  saveTimer = setTimeout(save, 800);
});

onAuthStateChanged(auth, async u => {
  user = u;
  if (!u) { status = ''; render(); return; }
  status = 'Chargement…'; render();
  try {
    const snap = await getDoc(ref());
    const remote = snap.exists() ? snap.data() : {};
    const local = W.getState();
    // les niveaux du compte priment ; ceux saisis hors connexion complètent
    const merged = {
      levels: { ...(local.levels || {}), ...(remote.levels || {}) },
      prefs: { ...(local.prefs || {}), ...(remote.prefs || {}) },
    };
    W.applyState(merged);
    const needPush = !snap.exists() ||
      Object.keys(merged.levels).some(k => (remote.levels || {})[k] === undefined);
    if (needPush) await save();
    else { status = 'Synchronisé ✓'; render(); }
  } catch (e) {
    status = 'Erreur de chargement';
    console.error(e);
    render();
  }
});

render();
