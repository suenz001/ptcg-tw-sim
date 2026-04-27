import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp, increment } from 'firebase/firestore';

let trackingInitialized = false;

export function initTracking() {
  if (trackingInitialized || typeof window === 'undefined') return;
  trackingInitialized = true;

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          await setDoc(userRef, {
            uid: user.uid,
            isAnonymous: user.isAnonymous,
            email: user.email || null,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            loginCount: 1,
            userAgent: navigator.userAgent
          });
        } else {
          await setDoc(userRef, {
            lastLoginAt: serverTimestamp(),
            loginCount: increment(1),
            isAnonymous: user.isAnonymous,
            email: user.email || null,
            userAgent: navigator.userAgent
          }, { merge: true });
        }
      } catch (err) {
        console.error('Failed to track user visit:', err);
      }
    }
  });
}
