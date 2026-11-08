const authenticationPanel = document.querySelector('#authenticationPanel');
const visitorDashboard = document.querySelector('#visitorDashboard');
const accountMessage = document.querySelector('#accountMessage');
const dashboardMessage = document.querySelector('#dashboardMessage');
const loginForm = document.querySelector('#loginPanel');
const registerForm = document.querySelector('#registerPanel');
const forgotPasswordForm = document.querySelector('#forgotPasswordPanel');
const resetPasswordForm = document.querySelector('#resetPasswordPanel');
const accountTabs = document.querySelector('.account-tabs');
const tabs = [...document.querySelectorAll('.account-tab')];
const deleteAccountForm = document.querySelector('#deleteAccountForm');
const recoveryKeySettingsForm = document.querySelector('#recoveryKeySettingsForm');
const passwordToggles = document.querySelectorAll('.password-toggle');
let visitorResetToken = '';
const portfolioPages = new Set([
  '/index.html',
  '/about.html',
  '/skills.html',
  '/education.html',
  '/projects.html',
  '/athletics.html',
  '/coding.html',
  '/academic-record.html',
  '/professional-focus.html',
  '/contact.html',
]);

function requestedPortfolioPage() {
  const requested = new URLSearchParams(window.location.search).get('next');
  if (!requested) return null;
  try {
    const target = new URL(requested, window.location.origin);
    const pathname = target.pathname === '/' ? '/index.html' : target.pathname;
    if (target.origin !== window.location.origin || !portfolioPages.has(pathname)) return null;
    return `${pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

function showMessage(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle('success', success);
}

async function accountRequest(path, options = {}) {
  const response = await window.portfolioApiFetch(path, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The account request could not be completed.');
  return result;
}

function setMode(mode) {
  const showLogin = mode === 'login';
  const showRegister = mode === 'register';
  const showRecovery = mode === 'recovery';
  const showReset = mode === 'reset';
  loginForm.hidden = !showLogin;
  loginForm.classList.toggle('hidden', !showLogin);
  registerForm.hidden = !showRegister;
  registerForm.classList.toggle('hidden', !showRegister);
  forgotPasswordForm.hidden = !showRecovery;
  forgotPasswordForm.classList.toggle('hidden', !showRecovery);
  resetPasswordForm.hidden = !showReset;
  resetPasswordForm.classList.toggle('hidden', !showReset);
  accountTabs.hidden = !showLogin && !showRegister;
  tabs.forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelector('#accountHeading').textContent = showRecovery
    ? 'Recover your password'
    : showReset
      ? 'Choose a new password'
      : 'Welcome';
  document.querySelector('.account-intro').textContent = showRecovery || showReset
    ? 'Use your private recovery key to securely reset your visitor account password.'
    : 'Sign in or create a free visitor account to access the portfolio.';
  showMessage(accountMessage, '');
}

function showDashboard(account) {
  authenticationPanel.hidden = true;
  authenticationPanel.classList.add('hidden');
  visitorDashboard.hidden = false;
  visitorDashboard.classList.remove('hidden');
  document.querySelector('#visitorName').textContent = account.name;
  document.querySelector('#visitorEmail').textContent = account.email;
  const createdAt = new Date(account.createdAt);
  document.querySelector('#visitorCreatedAt').textContent = Number.isNaN(createdAt.getTime())
    ? 'Not available'
    : createdAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function completeSignIn(account, successMessage) {
  const requestedPage = requestedPortfolioPage();
  if (requestedPage) {
    window.location.replace(requestedPage);
    return;
  }
  showDashboard(account);
  showMessage(dashboardMessage, successMessage, true);
}

async function submitForm(form, path, messageElement, successMessage) {
  const button = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData);
  if (form === registerForm) payload.privacyAccepted = formData.has('privacyAccepted');
  button.disabled = true;
  showMessage(messageElement, 'Please wait…');
  try {
    const result = await accountRequest(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    form.reset();
    completeSignIn(result.account, successMessage);
  } catch (error) {
    showMessage(messageElement, error.message);
  } finally {
    button.disabled = false;
  }
}

tabs.forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
document.querySelector('#forgotPasswordLink').addEventListener('click', () => {
  setMode('recovery');
  document.querySelector('#recoveryEmail').focus();
});
document.querySelector('#recoveryBackLink').addEventListener('click', () => {
  forgotPasswordForm.reset();
  setMode('login');
  loginForm.elements.email.focus();
});
document.querySelector('#resetBackLink').addEventListener('click', () => {
  visitorResetToken = '';
  resetPasswordForm.reset();
  setMode('login');
  loginForm.elements.email.focus();
});
passwordToggles.forEach((toggle) => {
  toggle.addEventListener('click', () => {
    const input = toggle.closest('.password-field').querySelector('input');
    const showPassword = input.type === 'password';
    input.type = showPassword ? 'text' : 'password';
    toggle.textContent = showPassword ? 'Hide' : 'Show';
    toggle.setAttribute('aria-label', `${showPassword ? 'Hide' : 'Show'} password`);
    toggle.setAttribute('aria-pressed', String(showPassword));
  });
});
setMode(new URLSearchParams(window.location.search).get('mode') === 'register' ? 'register' : 'login');
loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitForm(loginForm, '/api/visitor/login', accountMessage, 'You are signed in.');
});
registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const payload = new FormData(registerForm);
  if (!payload.has('privacyAccepted')) {
    showMessage(accountMessage, 'Please confirm the account data notice to continue.');
    return;
  }
  submitForm(registerForm, '/api/visitor/register', accountMessage, 'Your account has been created.');
});

forgotPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = forgotPasswordForm.querySelector('button[type="submit"]');
  const recoveryKeyInput = document.querySelector('#visitorRecoveryKey');
  button.disabled = true;
  showMessage(accountMessage, 'Verifying recovery details…');
  try {
    const formData = new FormData(forgotPasswordForm);
    const result = await accountRequest('/api/user/forgot-password', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(formData)),
    });
    if (!result.resetToken) {
      showMessage(accountMessage, result.message || 'The account details could not be verified.');
      return;
    }
    visitorResetToken = result.resetToken;
    recoveryKeyInput.value = '';
    setMode('reset');
    document.querySelector('#visitorNewPassword').focus();
  } catch (error) {
    showMessage(accountMessage, error.message);
  } finally {
    recoveryKeyInput.value = '';
    button.disabled = false;
  }
});

resetPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = resetPasswordForm.querySelector('button[type="submit"]');
  button.disabled = true;
  showMessage(accountMessage, 'Resetting password…');
  try {
    const formData = new FormData(resetPasswordForm);
    await accountRequest('/api/user/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        ...Object.fromEntries(formData),
        resetToken: visitorResetToken,
      }),
    });
    visitorResetToken = '';
    resetPasswordForm.reset();
    setMode('login');
    showMessage(accountMessage, 'Your password has been reset. Sign in with your new password.', true);
    loginForm.elements.email.focus();
  } catch (error) {
    showMessage(accountMessage, error.message);
  } finally {
    button.disabled = false;
  }
});

recoveryKeySettingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = recoveryKeySettingsForm.querySelector('button[type="submit"]');
  button.disabled = true;
  showMessage(document.querySelector('#recoveryKeySettingsMessage'), 'Saving recovery key…');
  try {
    const formData = new FormData(recoveryKeySettingsForm);
    await accountRequest('/api/visitor/recovery-key', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(formData)),
    });
    recoveryKeySettingsForm.reset();
    showMessage(document.querySelector('#recoveryKeySettingsMessage'), 'Recovery key saved. Store it somewhere private.', true);
  } catch (error) {
    showMessage(document.querySelector('#recoveryKeySettingsMessage'), error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#visitorLogout').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await accountRequest('/api/visitor/logout', { method: 'POST', body: '{}' });
    visitorDashboard.hidden = true;
    visitorDashboard.classList.add('hidden');
    authenticationPanel.hidden = false;
    authenticationPanel.classList.remove('hidden');
    setMode('login');
    showMessage(accountMessage, 'You have signed out.', true);
  } catch (error) {
    showMessage(dashboardMessage, error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#showDeleteAccount').addEventListener('click', () => {
  deleteAccountForm.hidden = !deleteAccountForm.hidden;
  deleteAccountForm.classList.toggle('hidden', deleteAccountForm.hidden);
});

deleteAccountForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = deleteAccountForm.querySelector('button[type="submit"]');
  if (!new FormData(deleteAccountForm).has('confirmDeletion')) return;
  if (!window.confirm('Permanently delete this visitor account?')) return;

  button.disabled = true;
  showMessage(dashboardMessage, 'Deleting your account…');
  try {
    const password = new FormData(deleteAccountForm).get('password');
    await accountRequest('/api/visitor/account', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
    deleteAccountForm.reset();
    deleteAccountForm.hidden = true;
    deleteAccountForm.classList.add('hidden');
    visitorDashboard.hidden = true;
    visitorDashboard.classList.add('hidden');
    authenticationPanel.hidden = false;
    authenticationPanel.classList.remove('hidden');
    setMode('login');
    showMessage(accountMessage, 'Your account has been deleted.', true);
  } catch (error) {
    showMessage(dashboardMessage, error.message);
  } finally {
    button.disabled = false;
  }
});

async function initializeVisitorAccount() {
  try {
    const session = await accountRequest('/api/visitor/session');
    if (session.authenticated && session.account) completeSignIn(session.account, 'You are signed in.');
  } catch (error) {
    showMessage(accountMessage, error.message);
  }
}

initializeVisitorAccount();
