import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

// These values are public client-side keys. Real security lives in
// Firestore rules and Cloud Functions authorization — never here.
const firebaseConfig = {
  apiKey: 'AIzaSyAH5IsKlGyHWWCWKKliDIvOqfevJQW8qhs',
  authDomain: 'ptcg-tw-sim.firebaseapp.com',
  projectId: 'ptcg-tw-sim',
  storageBucket: 'ptcg-tw-sim.firebasestorage.app',
  messagingSenderId: '180930993953',
  appId: '1:180930993953:web:df843feb3fbfba9de66860'
};

export const app: FirebaseApp = initializeApp(firebaseConfig);
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
// v5.970：getFunctions/functions export 為死碼(全站無 httpsCallable),移除以縮小 firebase chunk。
