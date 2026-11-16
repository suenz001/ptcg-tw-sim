/** Google 登入與綁定的共同流程；不導航、不自行合併玩家資料。 */
export interface GoogleAccount {
  uid: string;
  isAnonymous: boolean;
  email?: string | null;
  providerData: readonly { providerId: string; uid?: string; email?: string | null }[];
}

export function authUiState(user: GoogleAccount | null | undefined, revision = 0) {
  // Firebase 綁定可能保留同一個 User 物件；revision 讓介面重讀 providerData。
  // >>> v6652-google-management
  const password = user?.providerData.find(p => p.providerId === 'password');
  const google = user?.providerData.find(p => p.providerId === 'google.com');
  const passwordEmail = password ? password.email || user?.email || null : null;
  // 密碼登入信箱與 Google 信箱可能不同，不能拿 Google 的信箱驗證原密碼。
  const email = passwordEmail || user?.email || null;
  const googleEmail = google?.email || null;
  const googleKey = google?.uid || googleEmail?.trim().toLowerCase() || null;
  // <<< v6652-google-management
  return {
    revision,
    email,
    isAnonymous: user?.isAnonymous ?? true,
    password: !!password,
    google: !!google,
    passwordEmail,
    googleEmail,
    googleKey,
    differentGoogleEmail: !!googleEmail && googleEmail.trim().toLowerCase() !== email?.trim().toLowerCase(),
    canUnlinkGoogle: !!googleKey && !!passwordEmail,
  };
}

/** 每次登入回呼建立新世代；舊請求完成後不得覆蓋新帳號或已離開的頁面。 */
export function createAuthGeneration(currentUid: () => string | null) {
  let generation = 0;
  return {
    begin(uid: string | null) {
      const ticket = ++generation;
      return () => ticket === generation && currentUid() === uid;
    },
    invalidate() { generation++; },
  };
}

export interface GoogleFlowAdapter<U extends GoogleAccount> {
  currentUser(): U | null;
  popup(user: U | null, link: boolean): Promise<U>;
  credential(error: unknown): unknown | null;
  signInCredential(credential: unknown): Promise<U>;
  busy(value: boolean): void;
  changed(user: U): void;
  reauthenticate?(user: U, email: string, password: string): Promise<void>;
  unlink?(user: U): Promise<U>;
}

export function createGoogleFlow<U extends GoogleAccount>(api: GoogleFlowAdapter<U>) {
  let running = false;
  async function continueGoogle(linkOnly = false, expectedUid?: string): Promise<U> {
    if (running) throw { code: 'google/busy' };
    const initial = api.currentUser();
    if (linkOnly && (!initial || initial.isAnonymous)) throw { code: 'google/login-required' };
    if (linkOnly && expectedUid && initial?.uid !== expectedUid) throw { code: 'google/account-changed' };
    if (linkOnly && authUiState(initial).google) return initial!;
    const link = linkOnly || !!initial?.isAnonymous;
    running = true;
    api.busy(true);
    try {
      let user: U;
      try {
        // 不在 popup 前 await，保留瀏覽器的使用者點擊授權。
        user = await api.popup(initial, link);
      } catch (error) {
        const code = (error as { code?: string })?.code;
        // 匿名升級碰到已存在的 Google 帳號：使用同一份已驗證 credential 登入原帳號。
        // 正式會員綁定發生碰撞時不得切帳號或自行合併 UID。
        if (!linkOnly && initial?.isAnonymous && code === 'auth/credential-already-in-use') {
          if (api.currentUser()?.uid !== initial.uid) throw { code: 'google/account-changed' };
          const credential = api.credential(error);
          if (!credential) throw error;
          user = await api.signInCredential(credential);
        } else { throw error; }
      }
      if (linkOnly && user.uid !== initial?.uid) throw { code: 'google/account-changed' };
      if (api.currentUser()?.uid !== user.uid) throw { code: 'google/account-changed' };
      api.changed(user);
      return user;
    } finally {
      running = false;
      api.busy(false);
    }
  }
  // >>> v6652-google-management
  async function disconnectGoogle(password: string, expectedUid: string, expectedGoogleKey: string): Promise<U> {
    if (running) throw { code: 'google/busy' };
    const user = api.currentUser();
    if (!user || user.isAnonymous || user.uid !== expectedUid) throw { code: 'google/account-changed' };
    const before = authUiState(user);
    if (!before.google) throw { code: 'google/not-linked' };
    if (!before.canUnlinkGoogle) throw { code: 'google/last-provider' };
    if (!expectedGoogleKey || before.googleKey !== expectedGoogleKey) throw { code: 'google/account-changed' };
    if (!password) throw { code: 'google/password-required' };
    if (!api.reauthenticate || !api.unlink) throw { code: 'google/unlink-unavailable' };
    running = true;
    api.busy(true);
    try {
      await api.reauthenticate(user, before.passwordEmail!, password);
      if (api.currentUser()?.uid !== expectedUid) throw { code: 'google/account-changed' };
      const current = authUiState(api.currentUser());
      if (!current.google || !current.canUnlinkGoogle || current.passwordEmail !== before.passwordEmail || current.googleKey !== expectedGoogleKey) throw { code: 'google/account-changed' };
      const result = await api.unlink(user);
      if (api.currentUser()?.uid !== expectedUid || result.uid !== expectedUid) throw { code: 'google/account-changed' };
      api.changed(result);
      return result;
    } finally {
      running = false;
      api.busy(false);
    }
  }
  return Object.assign(continueGoogle, { disconnectGoogle });
  // <<< v6652-google-management
}

export function googleAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  const messages: Record<string, string> = {
    'auth/popup-closed-by-user': '已取消 Google 登入，可以重新選擇登入方式。',
    'auth/cancelled-popup-request': 'Google 登入視窗已取消，請重新操作。',
    'auth/popup-blocked': '瀏覽器阻擋登入視窗，請允許彈出視窗後再試，或使用 Email 登入。',
    'auth/operation-not-allowed': 'Google 登入尚未啟用，請先使用 Email 登入。',
    'auth/unauthorized-domain': '此網站尚未開放 Google 登入，請先使用 Email 登入。',
    'auth/credential-already-in-use': '這個 Google 帳號已綁定另一個帳號，請使用原帳號登入；此次未合併帳號。',
    'auth/account-exists-with-different-credential': '此 Email 已有其他登入方式，請先用原方式登入，再按「綁定 Google」。',
    'auth/email-already-in-use': '此 Email 已有帳號，請先用 Email 登入，再按「綁定 Google」。',
    'auth/provider-already-linked': '此帳號已綁定 Google。',
    'auth/network-request-failed': '網路連線失敗，請檢查網路後重試。',
    'auth/too-many-requests': '嘗試次數過多，請稍後再試。',
    'auth/user-disabled': '此帳號已停用，請聯絡站長。',
    'auth/operation-not-supported-in-this-environment': '此瀏覽器不支援 Google 登入，請改用 Safari、Chrome 或 Email 登入。',
    'google/account-changed': '登入期間帳號已變更，請確認目前帳號後再試。',
    'google/login-required': '請先登入原帳號，再綁定 Google。',
    'google/busy': '另一個 Google 登入正在處理中。',
    // >>> v6652-google-management
    'google/not-linked': '目前沒有綁定 Google，請重新確認帳號。',
    'google/last-provider': 'Google 是目前唯一的登入方式，不能解除，以免無法登入。',
    'google/password-required': '請輸入原帳號的登入密碼。',
    'google/unlink-unavailable': '目前無法解除綁定，請稍後重試。',
    'auth/invalid-credential': '原帳號信箱或密碼驗證失敗，未解除綁定。',
    'auth/wrong-password': '原帳號密碼不正確，未解除綁定。',
    'auth/requires-recent-login': '請重新登入原帳號，再解除 Google 綁定。',
    // <<< v6652-google-management
  };
  return messages[code] ?? 'Google 登入未完成，請重試或使用 Email 登入。';
}
