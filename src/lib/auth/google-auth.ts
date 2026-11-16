import { writable } from 'svelte/store';
import { GoogleAuthProvider, EmailAuthProvider, reauthenticateWithCredential, unlink, linkWithPopup, signInWithPopup, signInWithCredential, type AuthCredential, type User } from 'firebase/auth';
import { auth } from '$lib/firebase';
import { createGoogleFlow } from './google-flow';
export { authUiState, createAuthGeneration } from './google-flow';

/** 只有玩家主動按鈕時才登入；沒有背景輪詢、redirect 或額外 auth observer。 */
export const googleAuthBusy = writable(false);
export const googleAuthRevision = writable(0);
export const continueGoogle = createGoogleFlow<User>({
  currentUser: () => auth.currentUser,
  popup: (user, link) => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const pending = link && user ? linkWithPopup(user, provider) : signInWithPopup(auth, provider);
    return pending.then(result => result.user);
  },
  credential: error => GoogleAuthProvider.credentialFromError(error as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]),
  signInCredential: credential => signInWithCredential(auth, credential as AuthCredential).then(result => result.user),
  busy: value => googleAuthBusy.set(value),
  changed: () => googleAuthRevision.update(value => value + 1),
  // >>> v6652-google-management
  reauthenticate: (user, email, password) => reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password)).then(() => {}),
  unlink: user => unlink(user, 'google.com'),
  // <<< v6652-google-management
});
export const disconnectGoogle = continueGoogle.disconnectGoogle;
