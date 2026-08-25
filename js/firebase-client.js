const FIREBASE_VERSION = '10.12.2';
const FIREBASE_BASE_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

const firebaseConfig = {
  apiKey: 'AIzaSyBSxJKvyrMl18t2sv47o6HjlWiY7IsSoRw',
  authDomain: 'brick-guide.firebaseapp.com',
  projectId: 'brick-guide',
  storageBucket: 'brick-guide.firebasestorage.app',
  messagingSenderId: '813833706997',
  appId: '1:813833706997:web:feb3bbbc7669191fbd94bc',
};

let appPromise;
let authPromise;
let firestorePromise;
let storagePromise;

function retryable(factory, reset) {
  return factory().catch(error => {
    reset();
    throw error;
  });
}

export function ensureFirebaseApp() {
  if (!appPromise) {
    appPromise = retryable(async () => {
      const sdk = await import(`${FIREBASE_BASE_URL}/firebase-app.js`);
      return { app: sdk.initializeApp(firebaseConfig), sdk };
    }, () => { appPromise = undefined; });
  }
  return appPromise;
}

export function ensureAuth() {
  if (!authPromise) {
    authPromise = retryable(async () => {
      const [{ app }, sdk] = await Promise.all([
        ensureFirebaseApp(),
        import(`${FIREBASE_BASE_URL}/firebase-auth.js`),
      ]);
      return {
        auth: sdk.getAuth(app),
        provider: new sdk.GoogleAuthProvider(),
        sdk,
      };
    }, () => { authPromise = undefined; });
  }
  return authPromise;
}

export function ensureFirestore() {
  if (!firestorePromise) {
    firestorePromise = retryable(async () => {
      const [{ app }, sdk] = await Promise.all([
        ensureFirebaseApp(),
        import(`${FIREBASE_BASE_URL}/firebase-firestore.js`),
      ]);
      return { db: sdk.getFirestore(app), sdk };
    }, () => { firestorePromise = undefined; });
  }
  return firestorePromise;
}

export function ensureStorage() {
  if (!storagePromise) {
    storagePromise = retryable(async () => {
      const [{ app }, sdk] = await Promise.all([
        ensureFirebaseApp(),
        import(`${FIREBASE_BASE_URL}/firebase-storage.js`),
      ]);
      return { storage: sdk.getStorage(app), sdk };
    }, () => { storagePromise = undefined; });
  }
  return storagePromise;
}

export async function ensureBoardServices() {
  const [auth, firestore] = await Promise.all([ensureAuth(), ensureFirestore()]);
  return { ...auth, ...firestore };
}
