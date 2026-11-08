const loginView = document.querySelector('#loginView');
const loginForm = document.querySelector('#loginForm');
const loginMessage = document.querySelector('#loginMessage');
const adminApp = document.querySelector('#adminApp');
const contentForm = document.querySelector('#contentForm');
const editorMessage = document.querySelector('#editorMessage');
const saveStatus = document.querySelector('#saveStatus');
const saveButton = document.querySelector('#saveButton');
const publishButton = document.querySelector('#publishButton');
const editorActions = document.querySelector('#editorActions');
const logoutButton = document.querySelector('#logoutButton');
const passwordInput = document.querySelector('#adminPassword');
const passwordToggle = document.querySelector('#passwordToggle');
const recoveryView = document.querySelector('#recoveryView');
const resetPasswordView = document.querySelector('#resetPasswordView');
const forgotPasswordForm = document.querySelector('#forgotPasswordForm');
const resetPasswordForm = document.querySelector('#resetPasswordForm');
let adminResetToken = '';
const tabButtons = [...document.querySelectorAll('.admin-tab')];
const tabPanels = [...document.querySelectorAll('.tab-panel')];
const analyticsCharts = new Map();
let analyticsRefreshTimer = 0;
let analyticsRequestVersion = 0;
const sectionTitles = {
  dashboard: 'Dashboard',
  profile: 'Profile',
  focus: 'Focus areas',
  education: 'Education',
  projects: 'Projects',
  contacts: 'Social links',
  extensions: 'Site tools',
  insights: 'Analytics',
  security: 'Security',
};
const activityLabels = {
  admin_login_failed: 'Failed administrator sign-in',
  admin_login_succeeded: 'Administrator signed in',
  admin_signed_out: 'Administrator signed out',
  admin_password_changed: 'Administrator password changed',
  admin_password_recovery_requested: 'Administrator password recovery verified',
  admin_password_reset: 'Administrator password reset',
  admin_sessions_revoked: 'Administrator sessions revoked',
  admin_login_rate_limited: 'Administrator sign-in rate limit triggered',
  portfolio_draft_saved: 'Portfolio draft saved',
  portfolio_published: 'Portfolio published',
  portfolio_revision_restored_to_draft: 'Revision restored to draft',
  portfolio_extensions_saved: 'Portfolio tools saved',
  session_start: 'Visitor session started',
  page_view: 'Portfolio page viewed',
  cv_download: 'CV download clicked',
  contact_submission: 'Contact form submission',
  project_click: 'Project link clicked',
  github_click: 'GitHub link clicked',
  linkedin_click: 'LinkedIn link clicked',
  whatsapp_click: 'WhatsApp link clicked',
  certificate_view: 'Certificate viewed',
  section_view: 'Portfolio section viewed',
  share: 'Portfolio page shared',
  contact_click: 'Contact link clicked',
};

function renderIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

function setMessage(element, message, isSuccess = false) {
  element.textContent = message;
  element.classList.toggle('success', isSuccess);
}

async function apiRequest(url, options = {}) {
  if (window.location.protocol === 'file:') {
    throw new Error('The admin page must be served by the portfolio server. Run `npm start`, then open http://localhost:3000/admin.');
  }

  let response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Cannot reach the portfolio server. Start it with `npm start`, then open the portfolio and admin page on the same localhost address.');
  }

  const responseText = await response.text();
  let result = {};
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      const status = `HTTP ${response.status}`;
      throw new Error(response.ok
        ? `The server returned an invalid response (${status}). Check the server console for details.`
        : `The server returned an unexpected response (${status}). Confirm the portfolio server is running and open this page from its localhost URL.`);
    }
  }
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' && result.error
      ? result.error
      : `The request failed (HTTP ${response.status}). Try again or check the server console.`);
  }
  return result;
}

function setSignedIn(isSignedIn) {
  if (!isSignedIn) window.clearInterval(analyticsRefreshTimer);
  loginView.classList.toggle('hidden', isSignedIn);
  adminApp.classList.toggle('hidden', !isSignedIn);
}

function setAuthView(view) {
  loginForm.classList.toggle('hidden', view !== 'login');
  recoveryView.classList.toggle('hidden', view !== 'recovery');
  resetPasswordView.classList.toggle('hidden', view !== 'reset');
}

function setActiveTab(tabName) {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.panel === tabName;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });
  document.querySelector('#editorTitle').textContent = sectionTitles[tabName];
  editorActions.hidden = ['dashboard', 'extensions', 'insights', 'security'].includes(tabName);
  if (tabName === 'dashboard' || tabName === 'security') loadDashboard();
  if (tabName === 'insights') {
    loadInsights();
    window.clearInterval(analyticsRefreshTimer);
    analyticsRefreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible'
        && document.querySelector('.tab-panel[data-panel="insights"]').classList.contains('active')) {
        loadInsights();
      }
    }, 30_000);
  } else {
    window.clearInterval(analyticsRefreshTimer);
  }
  if (tabName === 'extensions') loadExtensions();
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
}

function renderActivity(entries) {
  const list = document.querySelector('#activityList');
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No administrator activity has been recorded yet.';
    list.append(empty);
    return;
  }

  entries.forEach((entry) => {
    const item = document.createElement('li');
    const action = document.createElement('strong');
    action.textContent = activityLabels[entry.action] || 'Administrator activity';
    const date = document.createElement('time');
    date.dateTime = entry.createdAt;
    const parsedDate = new Date(entry.createdAt);
    date.textContent = Number.isNaN(parsedDate.getTime()) ? 'Date unavailable' : parsedDate.toLocaleString();
    item.append(action, date);
    list.append(item);
  });
}

async function loadDashboard() {
  try {
    const data = await apiRequest('/api/admin/dashboard');
    document.querySelector('#dashboardPageViews').textContent = String(data.statistics.optInPageViews);
    document.querySelector('#dashboardLikes').textContent = String(data.statistics.profileLikes);
    document.querySelector('#dashboardAccounts').textContent = String(data.statistics.registeredAccounts);
    document.querySelector('#dashboardProjects').textContent = String(data.statistics.projects);
    document.querySelector('#serverStatus').innerHTML = '<i data-lucide="activity" aria-hidden="true"></i>Server online';
    document.querySelector('#serverStatus').classList.add('status-online');
    document.querySelector('#healthServer').textContent = `Online · ${data.system.server.nodeVersion}`;
    document.querySelector('#healthDatabase').textContent = data.system.database.status === 'ok'
      ? `Healthy · ${data.system.database.storageBytes === null ? 'managed storage' : formatBytes(data.system.database.storageBytes)}`
      : 'Integrity check failed';
    document.querySelector('#healthContent').textContent = data.system.content.status === 'available'
      ? `Available · ${formatBytes(data.system.content.storageBytes)}`
      : 'Unavailable';
    document.querySelector('#healthApi').textContent = data.system.api.status === 'ok' ? 'Healthy' : 'Unavailable';
    document.querySelector('#healthResponseTime').textContent = `${data.system.api.responseTimeMs} ms`;
    document.querySelector('#healthErrors').textContent = String(data.system.api.applicationErrors);
    document.querySelector('#healthFailedLogins').textContent = String(data.security.failedLoginAttempts);
    document.querySelector('#healthSuspiciousRequests').textContent = String(data.security.suspiciousRequests);
    document.querySelector('#healthUptime').textContent = formatDuration(data.system.server.uptimeSeconds);
    document.querySelector('#measurementNote').textContent = data.measurementNote;
    document.querySelector('#activeAdminSessions').textContent = String(data.security.activeSessions);
    document.querySelector('#passwordChangedAt').textContent = data.security.passwordUpdatedAt
      ? new Date(data.security.passwordUpdatedAt).toLocaleString()
      : 'Not recorded';
    renderActivity(data.recentActivity);
    renderIcons();
  } catch (error) {
    const status = document.querySelector('#serverStatus');
    status.textContent = 'Dashboard unavailable';
    status.classList.remove('status-online');
    setMessage(editorMessage, error.message);
  }
}

const analyticsPalette = ['#4a9cff', '#83baff', '#2876d5', '#55d6be', '#f3bb62', '#c4a4ff'];

function analyticsChartOptions(type, isHorizontal = false) {
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    plugins: {
      legend: { labels: { color: '#eaf2ff', usePointStyle: true, padding: 18 } },
      tooltip: { backgroundColor: '#07111f', borderColor: '#20344c', borderWidth: 1 },
    },
  };
  if (type !== 'doughnut') {
    options.scales = {
      x: {
        ticks: { color: '#94a8c0', maxRotation: 0, autoSkip: true },
        grid: { color: 'rgba(148, 168, 192, 0.12)' },
        ...(isHorizontal ? { beginAtZero: true } : {}),
      },
      y: {
        ticks: { color: '#94a8c0', autoSkip: true, maxTicksLimit: 12 },
        grid: { color: 'rgba(148, 168, 192, 0.12)' },
        beginAtZero: true,
      },
    };
  } else {
    options.plugins.legend.position = 'bottom';
  }
  if (isHorizontal) options.indexAxis = 'y';
  return options;
}

function renderAnalyticsChart(canvasId, config, hasData, horizontal = false) {
  const canvas = document.querySelector(`#${canvasId}`);
  const emptyMessage = canvas.closest('.analytics-chart').querySelector('.chart-empty');
  const existing = analyticsCharts.get(canvasId);
  if (existing) existing.destroy();
  analyticsCharts.delete(canvasId);
  canvas.hidden = !hasData;
  emptyMessage.classList.toggle('hidden', hasData);
  if (!hasData) return;
  if (!window.Chart) throw new Error('Chart.js could not be loaded. Check the local Chart.js asset.');
  analyticsCharts.set(canvasId, new window.Chart(
    canvas,
    { ...config, options: { ...analyticsChartOptions(config.type, horizontal), ...config.options } },
  ));
}

function groupDailyAnalytics(rows, granularity) {
  const buckets = new Map();
  rows.forEach((row) => {
    const date = new Date(`${row.day}T00:00:00.000Z`);
    let key = row.day;
    if (granularity === 'weekly') {
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = date.toISOString().slice(0, 10);
    } else if (granularity === 'monthly') {
      key = row.day.slice(0, 7);
    }
    if (!buckets.has(key)) buckets.set(key, { visits: 0, pageViews: 0, engagements: 0 });
    const bucket = buckets.get(key);
    bucket.visits += row.visits;
    bucket.pageViews += row.pageViews;
    bucket.engagements += row.engagements;
  });
  return [...buckets.entries()].map(([key, values]) => ({
    key,
    label: granularity === 'monthly' ? key : new Date(`${key}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    ...values,
  }));
}

function selectedAnalyticsQuery() {
  const params = new URLSearchParams({ range: document.querySelector('#analyticsRange').value });
  if (params.get('range') === 'custom') {
    const from = document.querySelector('#analyticsFrom').value;
    const to = document.querySelector('#analyticsTo').value;
    if (!from || !to) throw new Error('Choose both dates for the custom range.');
    params.set('from', from);
    params.set('to', to);
  }
  return `?${params.toString()}`;
}

function formatAnalyticsEvent(entry) {
  const label = activityLabels[entry.eventType] || 'Portfolio activity';
  const pageNames = {
    'index.html': 'Home',
    'about.html': 'About',
    'skills.html': 'Skills',
    'education.html': 'Education',
    'projects.html': 'Projects',
    'athletics.html': 'Athletics',
    'coding.html': 'Coding',
    'academic-record.html': 'Academic Record',
    'professional-focus.html': 'Professional Focus',
    'contact.html': 'Contact',
  };
  const details = entry.eventLabel || pageNames[entry.pagePath] || '';
  return details ? `${label} · ${details}` : label;
}

function renderAnalyticsRanking(rows) {
  const list = document.querySelector('#analyticsRanking');
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No opted-in visitor activity in this range.';
    list.append(empty);
    return;
  }
  rows.forEach((row, index) => {
    const item = document.createElement('li');
    const heading = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = `Visitor ${index + 1} · ${row.authenticated ? 'Signed in' : 'Anonymous'}`;
    const score = document.createElement('strong');
    score.textContent = `Score ${row.score}`;
    const detail = document.createElement('small');
    detail.textContent = `${row.visits} visits · ${row.pageViews} pages · ${formatDuration(row.durationSeconds)} · ${row.projectClicks} project clicks`;
    heading.append(name, score);
    item.append(heading, detail);
    list.append(item);
  });
}

function renderAnalyticsActivity(rows) {
  const list = document.querySelector('#analyticsActivity');
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No activity has been recorded yet.';
    list.append(empty);
    return;
  }
  rows.forEach((entry) => {
    const item = document.createElement('li');
    const action = document.createElement('strong');
    action.textContent = formatAnalyticsEvent(entry);
    const date = document.createElement('time');
    date.dateTime = entry.createdAt;
    const parsedDate = new Date(entry.createdAt);
    date.textContent = Number.isNaN(parsedDate.getTime()) ? 'Date unavailable' : parsedDate.toLocaleString();
    item.append(action, date);
    list.append(item);
  });
}

function renderAnalytics(data) {
  const totals = data.totals;
  const values = {
    analyticsTotalVisitors: totals.visits,
    analyticsUniqueVisitors: totals.uniqueVisitors,
    analyticsActiveVisitors: totals.activeVisitors,
    analyticsPageViews: totals.pageViews,
    analyticsReturningVisitors: totals.returningVisitors,
    analyticsDuration: formatDuration(totals.averageSessionDuration),
    analyticsBounce: `${totals.bounceRate}%`,
    analyticsCvDownloads: totals.cvDownloads,
    analyticsSubmissions: totals.contactSubmissions,
  };
  Object.entries(values).forEach(([id, value]) => {
    document.querySelector(`#${id}`).textContent = String(value);
  });

  const grouped = groupDailyAnalytics(data.daily, document.querySelector('#analyticsGranularity').value);
  const labels = grouped.map((row) => row.label);
  const dayHasVisits = grouped.some((row) => row.visits > 0);
  const dayHasTraffic = grouped.some((row) => row.visits > 0 || row.pageViews > 0);
  const dayHasEngagement = grouped.some((row) => row.engagements > 0 || row.pageViews > 0);
  renderAnalyticsChart('dailyVisitorsChart', {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Visits', data: grouped.map((row) => row.visits), backgroundColor: '#4a9cff', borderRadius: 4 }] },
  }, dayHasVisits);
  renderAnalyticsChart('trafficTrendChart', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Visits', data: grouped.map((row) => row.visits), borderColor: '#4a9cff', backgroundColor: 'rgba(74, 156, 255, 0.12)', tension: 0.3 },
        { label: 'Page views', data: grouped.map((row) => row.pageViews), borderColor: '#55d6be', backgroundColor: 'rgba(85, 214, 190, 0.1)', tension: 0.3 },
      ],
    },
  }, dayHasTraffic);
  renderAnalyticsChart('deviceChart', {
    type: 'doughnut',
    data: {
      labels: data.devices.map((row) => row.key),
      datasets: [{ data: data.devices.map((row) => row.count), backgroundColor: analyticsPalette }],
    },
  }, data.devices.some((row) => row.count > 0));
  renderAnalyticsChart('pagesChart', {
    type: 'bar',
    data: {
      labels: data.pages.slice(0, 10).map((row) => row.label),
      datasets: [{ label: 'Page views', data: data.pages.slice(0, 10).map((row) => row.count), backgroundColor: '#4a9cff', borderRadius: 4 }],
    },
  }, data.pages.length > 0, true);
  const sourceRows = data.sources.slice(0, 10);
  renderAnalyticsChart('sourcesChart', {
    type: 'bar',
    data: {
      labels: sourceRows.map((row) => `${row.category} · ${row.key}`),
      datasets: [{ label: 'Visits', data: sourceRows.map((row) => row.count), backgroundColor: '#83baff', borderRadius: 4 }],
    },
  }, sourceRows.length > 0, true);
  const landingLabels = [...new Set([
    ...data.landingPages.map((row) => row.key),
    ...data.exitPages.map((row) => row.key),
  ])];
  const landingCounts = (rows) => landingLabels.map((label) => rows.find((row) => row.key === label)?.count || 0);
  renderAnalyticsChart('landingExitChart', {
    type: 'bar',
    data: {
      labels: landingLabels,
      datasets: [
        { label: 'Landing visits', data: landingCounts(data.landingPages), backgroundColor: '#4a9cff', borderRadius: 4 },
        { label: 'Exit visits', data: landingCounts(data.exitPages), backgroundColor: '#55d6be', borderRadius: 4 },
      ],
    },
  }, landingLabels.length > 0, true);
  const technologyRows = [
    ...data.browsers.map((row) => ({ label: `Browser · ${row.key}`, count: row.count })),
    ...data.operatingSystems.map((row) => ({ label: `OS · ${row.key}`, count: row.count })),
  ].sort((first, second) => second.count - first.count).slice(0, 10);
  renderAnalyticsChart('technologyChart', {
    type: 'bar',
    data: {
      labels: technologyRows.map((row) => row.label),
      datasets: [{ label: 'Sessions', data: technologyRows.map((row) => row.count), backgroundColor: '#83baff', borderRadius: 4 }],
    },
  }, technologyRows.length > 0, true);
  renderAnalyticsChart('projectsChart', {
    type: 'bar',
    data: {
      labels: data.popularProjects.map((row) => row.label),
      datasets: [{ label: 'Project clicks', data: data.popularProjects.map((row) => row.count), backgroundColor: '#4a9cff', borderRadius: 4 }],
    },
  }, data.popularProjects.length > 0, true);
  renderAnalyticsChart('sectionsChart', {
    type: 'bar',
    data: {
      labels: data.popularSections.map((row) => row.label),
      datasets: [{ label: 'Section views', data: data.popularSections.map((row) => row.count), backgroundColor: '#55d6be', borderRadius: 4 }],
    },
  }, data.popularSections.length > 0, true);
  const legacyRows = [
    ...data.legacy.pages.map((row) => ({ label: `Page: ${row.label}`, count: row.count })),
    ...data.legacy.skills.map((row) => ({ label: `Skill: ${row.label}`, count: row.count })),
    ...data.legacy.follows.map((row) => ({ label: `Follow: ${row.label}`, count: row.count })),
    ...data.legacy.engagement.map((row) => ({ label: `Action: ${row.label}`, count: row.count })),
  ].sort((first, second) => second.count - first.count).slice(0, 10);
  renderAnalyticsChart('legacyChart', {
    type: 'bar',
    data: {
      labels: legacyRows.map((row) => row.label),
      datasets: [{ label: 'Historical aggregate count', data: legacyRows.map((row) => row.count), backgroundColor: '#c4a4ff', borderRadius: 4 }],
    },
  }, legacyRows.length > 0, true);
  renderAnalyticsChart('engagementChart', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Page views', data: grouped.map((row) => row.pageViews), borderColor: '#4a9cff', backgroundColor: 'rgba(74, 156, 255, 0.18)', fill: true, tension: 0.3 },
        { label: 'Engagement actions', data: grouped.map((row) => row.engagements), borderColor: '#55d6be', backgroundColor: 'rgba(85, 214, 190, 0.12)', fill: true, tension: 0.3 },
      ],
    },
  }, dayHasEngagement);
  renderAnalyticsRanking(data.rankings);
  renderAnalyticsActivity(data.activity);
  document.querySelector('#analyticsUpdatedAt').textContent = `Updated ${new Date(data.updatedAt).toLocaleString()} · ${data.period.from} to ${data.period.to}`;
}

async function loadInsights() {
  const message = document.querySelector('#insightsMessage');
  const version = ++analyticsRequestVersion;
  setMessage(message, 'Loading consented analytics…');
  try {
    const data = await apiRequest(`/api/admin/analytics${selectedAnalyticsQuery()}`);
    if (version !== analyticsRequestVersion) return;
    renderAnalytics(data);
    setMessage(message, '');
  } catch (error) {
    if (version === analyticsRequestVersion) setMessage(message, error.message);
  }
}

function addManagedAction(item, label, action, className = 'button-secondary') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button ${className}`;
  button.dataset.action = action;
  button.textContent = label;
  item.append(button);
}

function renderExtensions(data) {
  const config = data.extensions;
  document.querySelector('#certificatesJson').value = JSON.stringify(config.certificates || [], null, 2);
  document.querySelector('#seoJson').value = JSON.stringify(config.seo || {}, null, 2);
  document.querySelector('#accentColor').value = config.appearance?.accentColor || '#236653';
  document.querySelector('#defaultTheme').value = config.appearance?.defaultTheme || 'light';
  document.querySelector('#followCount').textContent = String(data.follows.followers);

  const uploadList = document.querySelector('#uploadList');
  uploadList.replaceChildren();
  data.uploads.forEach((upload) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/uploads/${upload.id}.${({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' })[upload.contentType]}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${upload.originalName} · ${formatBytes(upload.fileSize)}`;
    item.append(link);
    addManagedAction(item, 'Remove', 'delete-upload', 'button-danger');
    item.dataset.id = upload.id;
    uploadList.append(item);
  });
  if (!data.uploads.length) uploadList.append(Object.assign(document.createElement('li'), { textContent: 'No files uploaded.' }));

  const commentList = document.querySelector('#commentList');
  commentList.replaceChildren();
  data.comments.forEach((comment) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = `${comment.displayName} · ${comment.pageKey} · ${comment.status}`;
    const message = document.createElement('p');
    message.textContent = comment.message;
    details.append(heading, message);
    item.append(details);
    if (comment.status === 'pending') addManagedAction(item, 'Approve', 'approve-comment', 'button-primary');
    else addManagedAction(item, 'Unapprove', 'unapprove-comment');
    addManagedAction(item, 'Delete', 'delete-comment', 'button-danger');
    item.dataset.id = comment.id;
    commentList.append(item);
  });
  if (!data.comments.length) commentList.append(Object.assign(document.createElement('li'), { textContent: 'No comments have been submitted.' }));

  const messageList = document.querySelector('#messageList');
  messageList.replaceChildren();
  data.messages.forEach((message) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = `${message.displayName} · ${message.email}`;
    const body = document.createElement('p');
    body.textContent = message.message;
    const date = document.createElement('time');
    date.dateTime = message.createdAt;
    date.textContent = new Date(message.createdAt).toLocaleString();
    details.append(heading, body, date);
    item.append(details);
    addManagedAction(item, 'Delete', 'delete-message', 'button-danger');
    item.dataset.id = message.id;
    messageList.append(item);
  });
  if (!data.messages.length) messageList.append(Object.assign(document.createElement('li'), { textContent: 'No messages in the local inbox.' }));
}

async function loadExtensions() {
  const message = document.querySelector('#extensionsMessage');
  setMessage(message, 'Loading site tools…');
  try {
    renderExtensions(await apiRequest('/api/admin/extensions'));
    setMessage(message, '');
    renderIcons();
  } catch (error) {
    setMessage(message, error.message);
  }
}

async function saveExtensions() {
  const message = document.querySelector('#extensionsMessage');
  try {
    const extensions = {
      certificates: JSON.parse(document.querySelector('#certificatesJson').value),
      seo: JSON.parse(document.querySelector('#seoJson').value),
      appearance: {
        accentColor: document.querySelector('#accentColor').value,
        defaultTheme: document.querySelector('#defaultTheme').value,
      },
    };
    await apiRequest('/api/admin/extensions', { method: 'PUT', body: JSON.stringify(extensions) });
    setMessage(message, 'Site settings saved.', true);
  } catch (error) {
    setMessage(message, error instanceof SyntaxError ? 'Certificates and SEO must contain valid JSON.' : error.message);
  }
}

function setField(name, value) {
  const field = contentForm.elements.namedItem(name);
  if (field) field.value = value;
}

function addRepeatItem(type, value = {}) {
  const template = document.querySelector(`#${type}Template`);
  const list = document.querySelector(`#${type}List`);
  if (!template || !list) return;

  const fragment = template.content.cloneNode(true);
  const item = fragment.querySelector('.repeat-item');
  const heading = item.querySelector('.repeat-item-heading');
  const removeButton = heading.querySelector('.remove-item');
  const actions = document.createElement('div');
  actions.className = 'repeat-item-actions';
  for (const [direction, icon, label] of [['up', 'arrow-up', 'Move up'], ['down', 'arrow-down', 'Move down']]) {
    const moveButton = document.createElement('button');
    moveButton.className = 'icon-button move-item';
    moveButton.type = 'button';
    moveButton.dataset.direction = direction;
    moveButton.setAttribute('aria-label', label);
    moveButton.title = label;
    const moveIcon = document.createElement('i');
    moveIcon.dataset.lucide = icon;
    moveIcon.setAttribute('aria-hidden', 'true');
    moveButton.append(moveIcon);
    actions.append(moveButton);
  }
  actions.append(removeButton);
  heading.append(actions);
  item.querySelector('.item-number').textContent = `${list.children.length + 1}`.padStart(2, '0');
  item.querySelectorAll('[data-field]').forEach((field) => {
    const key = field.dataset.field;
    if (field.type === 'checkbox') {
      field.checked = Boolean(value[key]);
    } else if (value[key] !== undefined) {
      field.value = value[key];
    }
  });
  list.append(fragment);
  updateItemNumbers(list);
  renderIcons();
}

function updateItemNumbers(list) {
  [...list.children].forEach((item, index) => {
    item.querySelector('.item-number').textContent = `${index + 1}`.padStart(2, '0');
  });
}

function fillEditor(data, isDraft) {
  setField('name', data.name);
  setField('tagline', data.tagline);
  setField('intro', data.intro);
  setField('aboutHeading', data.aboutHeading);
  setField('aboutParagraphs', data.aboutParagraphs.join('\n\n'));
  setField('skills', data.skills.join(', '));

  for (const type of ['focus', 'education', 'projects', 'contacts']) {
    const list = document.querySelector(`#${type}List`);
    list.replaceChildren();
    (data[type] || []).forEach((item) => addRepeatItem(type, item));
  }

  saveStatus.textContent = isDraft ? 'Draft loaded' : 'Published version loaded';
  contentForm.dataset.original = JSON.stringify(data);
}

function collectItems(type) {
  return [...document.querySelectorAll(`#${type}List .repeat-item`)].map((item) => {
    const result = {};
    item.querySelectorAll('[data-field]').forEach((field) => {
      result[field.dataset.field] = field.type === 'checkbox' ? field.checked : field.value.trim();
    });
    return result;
  });
}

function collectPortfolio() {
  const formData = new FormData(contentForm);
  return {
    name: formData.get('name').trim(),
    tagline: formData.get('tagline').trim(),
    intro: formData.get('intro').trim(),
    aboutHeading: formData.get('aboutHeading').trim(),
    aboutParagraphs: formData.get('aboutParagraphs').split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean),
    skills: formData.get('skills').split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
    focus: collectItems('focus'),
    education: collectItems('education'),
    projects: collectItems('projects'),
    contacts: collectItems('contacts'),
  };
}

async function loadPortfolio() {
  const result = await apiRequest('/api/admin/portfolio/draft');
  fillEditor(result.content, result.isDraft);
  setSignedIn(true);
  setActiveTab('dashboard');
}

function previewSection(title, entries, fields) {
  const section = document.createElement('section');
  section.className = 'preview-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.append(heading);
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No items added.';
    section.append(empty);
    return section;
  }
  entries.forEach((entry) => {
    const item = document.createElement('article');
    fields.forEach((field) => {
      if (!entry[field]) return;
      const text = document.createElement(field === fields[0] ? 'h4' : 'p');
      text.textContent = entry[field];
      item.append(text);
    });
    section.append(item);
  });
  return section;
}

function showPreview() {
  if (!contentForm.reportValidity()) return;
  const data = collectPortfolio();
  const preview = document.querySelector('#previewContent');
  preview.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = data.name;
  const tagline = document.createElement('p');
  tagline.className = 'preview-tagline';
  tagline.textContent = data.tagline;
  const intro = document.createElement('p');
  intro.textContent = data.intro;
  const about = document.createElement('h3');
  about.textContent = data.aboutHeading;
  const paragraphs = data.aboutParagraphs.map((text) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    return paragraph;
  });
  preview.append(title, tagline, intro, about, ...paragraphs);
  preview.append(
    previewSection('Skills', data.skills.map((skill) => ({ skill })), ['skill']),
    previewSection('Focus areas', data.focus, ['title', 'description']),
    previewSection('Education', data.education, ['title', 'period', 'description']),
    previewSection('Projects', data.projects, ['title', 'category', 'description', 'url']),
    previewSection('Contact links', data.contacts, ['label', 'href']),
  );
  document.querySelector('#previewDialog').showModal();
}

async function loadRevisions() {
  const message = document.querySelector('#revisionsMessage');
  const list = document.querySelector('#revisionList');
  list.replaceChildren();
  setMessage(message, 'Loading revision history…');
  try {
    const data = await apiRequest('/api/admin/portfolio/revisions');
    if (!data.revisions.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No published revisions yet. A snapshot is saved each time you publish.';
      list.append(empty);
    }
    data.revisions.forEach((revision) => {
      const item = document.createElement('li');
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = 'Published version';
      const time = document.createElement('time');
      time.dateTime = revision.createdAt;
      time.textContent = new Date(revision.createdAt).toLocaleString();
      details.append(title, time);
      const restore = document.createElement('button');
      restore.className = 'button button-secondary';
      restore.type = 'button';
      restore.textContent = 'Restore to draft';
      restore.addEventListener('click', () => restoreRevision(revision.id));
      item.append(details, restore);
      list.append(item);
    });
    setMessage(message, '');
  } catch (error) {
    setMessage(message, error.message);
  }
}

async function restoreRevision(id) {
  if (!window.confirm('Replace the current draft with this revision? The published site will not change until you publish.')) return;
  try {
    await apiRequest('/api/admin/portfolio/revisions/restore', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    const result = await apiRequest('/api/admin/portfolio/draft');
    fillEditor(result.content, true);
    document.querySelector('#revisionsDialog').close();
    setActiveTab('profile');
    setMessage(editorMessage, 'Revision restored to draft. Review it and publish when ready.', true);
  } catch (error) {
    setMessage(document.querySelector('#revisionsMessage'), error.message);
  }
}

async function saveDraft() {
  if (!contentForm.reportValidity()) return false;
  saveButton.disabled = true;
  saveStatus.textContent = 'Saving draft…';
  setMessage(editorMessage, '');
  try {
    const data = collectPortfolio();
    await apiRequest('/api/admin/portfolio/draft', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    contentForm.dataset.original = JSON.stringify(data);
    saveStatus.textContent = 'Draft saved';
    setMessage(editorMessage, 'Draft saved. The public website is unchanged until you publish.', true);
    return true;
  } catch (error) {
    saveStatus.textContent = 'Draft save failed';
    setMessage(editorMessage, error.message);
    return false;
  } finally {
    saveButton.disabled = false;
  }
}

async function publishDraft() {
  if (saveStatus.textContent === 'Unsaved changes' && !(await saveDraft())) return;
  if (!window.confirm('Publish these changes to the public portfolio?')) return;
  publishButton.disabled = true;
  saveStatus.textContent = 'Publishing…';
  try {
    await apiRequest('/api/admin/portfolio/publish', { method: 'POST', body: '{}' });
    contentForm.dataset.original = JSON.stringify(collectPortfolio());
    saveStatus.textContent = 'Published';
    setMessage(editorMessage, 'Portfolio published. Visitors will see the updated content when they next load a page.', true);
    loadDashboard();
  } catch (error) {
    saveStatus.textContent = 'Publish failed';
    setMessage(editorMessage, error.message);
  } finally {
    publishButton.disabled = false;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  setMessage(loginMessage, 'Signing in…');

  try {
    await apiRequest('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: passwordInput.value }),
    });
    passwordInput.value = '';
    await loadPortfolio();
  } catch (error) {
    setMessage(loginMessage, error.message);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#forgotPasswordLink').addEventListener('click', (event) => {
  event.preventDefault();
  setMessage(loginMessage, '');
  setMessage(document.querySelector('#recoveryMessage'), '');
  setAuthView('recovery');
  document.querySelector('#adminRecoveryKey').focus();
});

forgotPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = forgotPasswordForm.querySelector('[type="submit"]');
  const recoveryKeyInput = document.querySelector('#adminRecoveryKey');
  submitButton.disabled = true;
  setMessage(document.querySelector('#recoveryMessage'), 'Verifying recovery key…');
  try {
    const result = await apiRequest('/api/admin/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ recoveryKey: recoveryKeyInput.value }),
    });
    recoveryKeyInput.value = '';
    if (!result.resetToken) {
      setMessage(document.querySelector('#recoveryMessage'), result.message || 'The recovery key was not accepted.');
      return;
    }
    adminResetToken = result.resetToken;
    setMessage(document.querySelector('#recoveryMessage'), '');
    setAuthView('reset');
    document.querySelector('#adminNewPassword').focus();
  } catch (error) {
    setMessage(document.querySelector('#recoveryMessage'), error.message);
  } finally {
    recoveryKeyInput.value = '';
    submitButton.disabled = false;
  }
});

resetPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = resetPasswordForm.querySelector('[type="submit"]');
  const message = document.querySelector('#resetPasswordMessage');
  const newPasswordInput = document.querySelector('#adminNewPassword');
  const confirmPasswordInput = document.querySelector('#adminConfirmPassword');
  submitButton.disabled = true;
  setMessage(message, 'Resetting password…');
  try {
    await apiRequest('/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        resetToken: adminResetToken,
        newPassword: newPasswordInput.value,
        confirmPassword: confirmPasswordInput.value,
      }),
    });
    adminResetToken = '';
    resetPasswordForm.reset();
    setAuthView('login');
    setMessage(message, '');
    setMessage(loginMessage, 'Password reset. Sign in with your new password.', true);
    passwordInput.focus();
  } catch (error) {
    setMessage(message, error.message);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#recoveryBackLink').addEventListener('click', (event) => {
  event.preventDefault();
  forgotPasswordForm.reset();
  setAuthView('login');
});

document.querySelector('#resetBackLink').addEventListener('click', (event) => {
  event.preventDefault();
  adminResetToken = '';
  resetPasswordForm.reset();
  setAuthView('login');
});

passwordToggle.addEventListener('click', () => {
  const showPassword = passwordInput.type === 'password';
  passwordInput.type = showPassword ? 'text' : 'password';
  passwordToggle.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
  passwordToggle.setAttribute('title', showPassword ? 'Hide password' : 'Show password');
  passwordToggle.setAttribute('aria-pressed', String(showPassword));
  passwordToggle.innerHTML = `<i data-lucide="${showPassword ? 'eye-off' : 'eye'}" aria-hidden="true"></i>`;
  renderIcons();
});

logoutButton.addEventListener('click', async () => {
  try {
    await apiRequest('/api/admin/logout', { method: 'POST', body: '{}' });
    setSignedIn(false);
    setMessage(loginMessage, 'You have signed out.', true);
  } catch (error) {
    setMessage(editorMessage, error.message);
  }
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => setActiveTab(button.dataset.tab));
});

document.querySelector('#refreshInsights').addEventListener('click', loadInsights);
document.querySelector('#refreshDashboard').addEventListener('click', loadDashboard);
document.querySelector('#refreshExtensions').addEventListener('click', loadExtensions);
document.querySelector('#saveExtensions').addEventListener('click', saveExtensions);
document.querySelector('#previewButton').addEventListener('click', showPreview);
document.querySelector('#analyticsRange').addEventListener('change', (event) => {
  const customRange = document.querySelector('#customDateRange');
  const isCustom = event.currentTarget.value === 'custom';
  customRange.classList.toggle('hidden', !isCustom);
  if (isCustom) {
    const today = new Date();
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 6);
    document.querySelector('#analyticsTo').value ||= today.toISOString().slice(0, 10);
    document.querySelector('#analyticsFrom').value ||= from.toISOString().slice(0, 10);
  }
  loadInsights();
});
document.querySelectorAll('#analyticsFrom, #analyticsTo').forEach((input) => {
  input.addEventListener('change', loadInsights);
});
document.querySelector('#analyticsGranularity').addEventListener('change', loadInsights);
document.querySelector('#revisionsButton').addEventListener('click', async () => {
  document.querySelector('#revisionsDialog').showModal();
  await loadRevisions();
});
document.querySelector('#saveButton').addEventListener('click', saveDraft);
publishButton.addEventListener('click', publishDraft);

document.querySelectorAll('[data-open-tab]').forEach((button) => {
  button.addEventListener('click', () => setActiveTab(button.dataset.openTab));
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => document.querySelector(`#${button.dataset.closeDialog}`).close());
});

document.querySelector('#previewDialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

async function exportAnalytics(format, button) {
  const message = document.querySelector('#insightsMessage');
  button.disabled = true;
  setMessage(message, `Preparing ${format.toUpperCase()} analytics report…`);
  try {
    const extension = format === 'json' ? '' : `.${format}`;
    const response = await fetch(`/api/admin/analytics/export${extension}${selectedAnalyticsQuery()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `${format.toUpperCase()} analytics export could not be downloaded.`);
    }
    const file = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = file;
    link.download = `portfolio-analytics-${new Date().toISOString().slice(0, 10)}.${format}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(file), 1000);
    setMessage(message, `Filtered analytics report exported as ${format.toUpperCase()}.`, true);
  } catch (error) {
    setMessage(message, error.message);
  } finally {
    button.disabled = false;
  }
}

document.querySelector('#exportAnalytics').addEventListener('click', (event) => exportAnalytics('json', event.currentTarget));
document.querySelector('#exportAnalyticsCsv').addEventListener('click', (event) => exportAnalytics('csv', event.currentTarget));
document.querySelector('#exportAnalyticsPdf').addEventListener('click', (event) => exportAnalytics('pdf', event.currentTarget));

document.querySelectorAll('[data-add]').forEach((button) => {
  button.addEventListener('click', () => {
    addRepeatItem(button.dataset.add);
    saveStatus.textContent = 'Unsaved changes';
  });
});

document.querySelectorAll('.repeat-list').forEach((list) => {
  list.addEventListener('click', (event) => {
    const button = event.target.closest('.remove-item, .move-item');
    if (!button) return;
    const item = button.closest('.repeat-item');
    if (button.matches('.remove-item')) {
      if (!window.confirm(`Remove this ${list.id.replace('List', '')} item?`)) return;
      item.remove();
    } else if (button.dataset.direction === 'up' && item.previousElementSibling) {
      list.insertBefore(item, item.previousElementSibling);
    } else if (button.dataset.direction === 'down' && item.nextElementSibling) {
      list.insertBefore(item.nextElementSibling, item);
    }
    updateItemNumbers(list);
    saveStatus.textContent = 'Unsaved changes';
  });
});

contentForm.addEventListener('input', (event) => {
  if (event.target.closest('[data-panel="insights"]')) return;
  saveStatus.textContent = 'Unsaved changes';
  setMessage(editorMessage, '');
});

document.querySelector('#passwordChangeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = form.querySelector('[type="submit"]');
  const message = document.querySelector('#securityMessage');
  const payload = Object.fromEntries(new FormData(form));
  button.disabled = true;
  setMessage(message, 'Updating password…');
  try {
    await apiRequest('/api/admin/security/password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    form.reset();
    setMessage(message, 'Password updated. Other administrator sessions have been signed out.', true);
    await loadDashboard();
  } catch (error) {
    setMessage(message, error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#logoutAllButton').addEventListener('click', async (event) => {
  if (!window.confirm('Sign out all administrator sessions, including this device? You will need to sign in again.')) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await apiRequest('/api/admin/security/logout-all', { method: 'POST', body: '{}' });
    setSignedIn(false);
    setMessage(loginMessage, 'All administrator sessions were revoked. Sign in again to continue.', true);
  } catch (error) {
    setMessage(document.querySelector('#securityMessage'), error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#uploadButton').addEventListener('click', async (event) => {
  const input = document.querySelector('#uploadFile');
  const file = input.files[0];
  const message = document.querySelector('#extensionsMessage');
  if (!file) return setMessage(message, 'Choose a file to upload.');
  if (file.size > 5 * 1024 * 1024) return setMessage(message, 'Files must be 5 MB or smaller.');
  const button = event.currentTarget;
  button.disabled = true;
  setMessage(message, 'Uploading file…');
  try {
    if (typeof window.uploadPortfolioFile === 'function') {
      await window.uploadPortfolioFile(file);
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      await apiRequest('/api/admin/uploads', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, content: btoa(binary) }),
      });
    }
    input.value = '';
    await loadExtensions();
    setMessage(message, 'File uploaded.', true);
  } catch (error) {
    setMessage(message, error.message);
  } finally {
    button.disabled = false;
  }
});

['uploadList', 'commentList', 'messageList'].forEach((listId) => {
  document.querySelector(`#${listId}`).addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const item = button.closest('li');
    const id = item.dataset.id;
    const action = button.dataset.action;
    const message = document.querySelector('#extensionsMessage');
    if (action.startsWith('delete-') && !window.confirm('Delete this item permanently?')) return;
    button.disabled = true;
    try {
      if (action === 'approve-comment' || action === 'unapprove-comment') {
        await apiRequest(`/api/admin/comments/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: action === 'approve-comment' ? 'approved' : 'pending' }),
        });
      } else if (action === 'delete-comment') {
        await apiRequest(`/api/admin/comments/${id}`, { method: 'DELETE' });
      } else if (action === 'delete-message') {
        await apiRequest(`/api/admin/messages/${id}`, { method: 'DELETE' });
      } else if (action === 'delete-upload') {
        await apiRequest(`/api/admin/uploads/${id}`, { method: 'DELETE' });
      }
      await loadExtensions();
      setMessage(message, 'Site tools updated.', true);
    } catch (error) {
      setMessage(message, error.message);
      button.disabled = false;
    }
  });
});

async function initializeAdmin() {
  renderIcons();
  try {
    const session = await apiRequest('/api/admin/session');
    if (session.authenticated) await loadPortfolio();
  } catch (error) {
    setMessage(loginMessage, error.message);
  }
}

initializeAdmin();
