const makeIcon = (name) => {
  const icon = document.createElement('i');
  icon.dataset.lucide = name;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
};

const showFeatureToast = (message, type = 'info') => {
  let toast = document.querySelector('#featureToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'featureToast';
    toast.className = 'feature-toast';
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.dataset.type = ['success', 'error'].includes(type) ? type : 'info';
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  toast.classList.add('visible');
  window.clearTimeout(showFeatureToast.timeout);
  showFeatureToast.timeout = window.setTimeout(() => toast.classList.remove('visible'), 3200);
};

const writeClipboard = async (value) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  return false;
};

const analyticsConsentKey = 'portfolio-analytics-consent-v2';
const likeClientKey = 'portfolio-like-client-id';
const analyticsVisitorKey = 'portfolio-analytics-visitor-id';
const analyticsSessionKey = 'portfolio-analytics-session-id';
let cachedLikeClientId = null;
let analyticsReady = false;
let analyticsHeartbeat = 0;
let cachedAnalyticsVisitorId = null;
let cachedAnalyticsSessionId = null;

function getLikeClientId() {
  if (cachedLikeClientId) return cachedLikeClientId;
  try {
    const savedId = localStorage.getItem(likeClientKey);
    if (typeof savedId === 'string' && /^[0-9a-f-]{36}$/i.test(savedId)) {
      cachedLikeClientId = savedId;
      return savedId;
    }
    if (!window.crypto?.randomUUID) return null;
    cachedLikeClientId = window.crypto.randomUUID();
    localStorage.setItem(likeClientKey, cachedLikeClientId);
    return cachedLikeClientId;
  } catch {
    if (!window.crypto?.randomUUID) return null;
    cachedLikeClientId = window.crypto.randomUUID();
    return cachedLikeClientId;
  }
}

function hasAnalyticsConsent() {
  try {
    return localStorage.getItem(analyticsConsentKey) === 'accepted';
  } catch {
    return false;
  }
}

function analyticsVisitorId() {
  if (cachedAnalyticsVisitorId) return cachedAnalyticsVisitorId;
  try {
    const savedId = localStorage.getItem(analyticsVisitorKey);
    if (typeof savedId === 'string' && /^[0-9a-f-]{36}$/i.test(savedId)) {
      cachedAnalyticsVisitorId = savedId;
      return savedId;
    }
    if (!window.crypto?.randomUUID) return null;
    cachedAnalyticsVisitorId = window.crypto.randomUUID();
    localStorage.setItem(analyticsVisitorKey, cachedAnalyticsVisitorId);
    return cachedAnalyticsVisitorId;
  } catch {
    return null;
  }
}

function analyticsSessionId() {
  if (cachedAnalyticsSessionId) return cachedAnalyticsSessionId;
  try {
    const savedId = sessionStorage.getItem(analyticsSessionKey);
    if (typeof savedId === 'string' && /^[0-9a-f-]{36}$/i.test(savedId)) {
      cachedAnalyticsSessionId = savedId;
      return savedId;
    }
    if (!window.crypto?.randomUUID) return null;
    cachedAnalyticsSessionId = window.crypto.randomUUID();
    sessionStorage.setItem(analyticsSessionKey, cachedAnalyticsSessionId);
    return cachedAnalyticsSessionId;
  } catch {
    return null;
  }
}

function sendAnalytics(eventType, label = '') {
  if (!hasAnalyticsConsent() || !analyticsReady) return;
  const sessionId = analyticsSessionId();
  if (!sessionId) return;
  window.portfolioApiFetch('/api/analytics/event', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType,
      sessionId,
      pagePath: currentPageKey(),
      ...(label ? { label } : {}),
    }),
  }).then((response) => {
    if (!response.ok) console.warn('Anonymous analytics event was not accepted.');
  }).catch((error) => console.warn('Could not record anonymous analytics.', error));
}

function currentPageKey() {
  return document.body.dataset.sitePage
    ? `${document.body.dataset.sitePage}.html`
    : window.location.pathname.split('/').pop() || 'index.html';
}

function recordCurrentPage() {
  sendAnalytics('page_view');
}

async function enableAnalytics() {
  if (!hasAnalyticsConsent()) return false;
  const visitorId = analyticsVisitorId();
  if (!visitorId) return false;
  try {
    const response = await window.portfolioApiFetch('/api/analytics/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId }),
    });
    if (!response.ok) throw new Error('Analytics consent could not be confirmed.');
    analyticsReady = true;
    recordCurrentPage();
    window.clearInterval(analyticsHeartbeat);
    analyticsHeartbeat = window.setInterval(() => {
      if (document.visibilityState === 'visible') sendAnalytics('session_heartbeat');
    }, 30_000);
    return true;
  } catch (error) {
    analyticsReady = false;
    console.warn(error.message);
    return false;
  }
}

function addAnalyticsConsent() {
  let consent = null;
  try {
    consent = localStorage.getItem(analyticsConsentKey);
  } catch {
    return;
  }

  if (consent === 'accepted') {
    enableAnalytics();
    return;
  }
  if (consent === 'declined' || document.querySelector('.analytics-consent')) return;

  const banner = document.createElement('aside');
  banner.className = 'analytics-consent';
  banner.setAttribute('aria-label', 'Pseudonymous analytics choice');
  banner.innerHTML = '<div><strong>Help improve this portfolio?</strong><p>Allow anonymous, pseudonymous session and interaction analytics, including pages, broad device/browser category, and referring site hostname. Random identifiers are not linked to account IDs; IP addresses, exact locations, and full referrer URLs are not stored. Detailed records are retained for up to 365 days. You can withdraw consent at any time.</p></div><div class="analytics-consent-actions"><button class="analytics-consent-accept" type="button">Allow</button><button class="analytics-consent-decline" type="button">Decline</button></div>';
  document.body.append(banner);

  const chooseConsent = async (choice) => {
    try {
      localStorage.setItem(analyticsConsentKey, choice);
    } catch {
      banner.remove();
      return;
    }
    banner.remove();
    if (choice === 'accepted') {
      if (!(await enableAnalytics())) showFeatureToast('Analytics could not connect. Your portfolio session is unaffected.');
    }
  };
  banner.querySelector('.analytics-consent-accept').addEventListener('click', () => chooseConsent('accepted'));
  banner.querySelector('.analytics-consent-decline').addEventListener('click', () => chooseConsent('declined'));
}

function addProfileEngagement() {
  const likeButton = document.querySelector('#profileLikeButton');
  const likeCount = document.querySelector('#profileLikeCount');
  if (!likeButton || !likeCount || likeButton.dataset.ready) return;
  likeButton.dataset.ready = 'true';

  let liked = false;
  try {
    liked = localStorage.getItem('portfolio-profile-liked') === 'true';
  } catch {
    liked = false;
  }
  likeButton.setAttribute('aria-pressed', String(liked));
  likeButton.querySelector('span').textContent = liked ? 'Liked' : 'Like profile';

  window.portfolioApiFetch('/api/analytics/like-count', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => { if (data) likeCount.textContent = String(data.likes); })
    .catch(() => {});

  likeButton.addEventListener('click', () => {
    const clientId = getLikeClientId();
    if (!clientId) {
      showFeatureToast('Likes are unavailable in this browser session.');
      return;
    }
    liked = !liked;
    likeButton.setAttribute('aria-pressed', String(liked));
    likeButton.querySelector('span').textContent = liked ? 'Liked' : 'Like profile';
    try {
      localStorage.setItem('portfolio-profile-liked', String(liked));
    } catch {
      showFeatureToast('Like saved for this visit only.');
    }
    window.portfolioApiFetch('/api/analytics/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked, clientId }),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data) likeCount.textContent = String(data.likes);
        else likeCount.textContent = String(Math.max(0, Number(likeCount.textContent) + (liked ? 1 : -1)));
      })
      .catch(() => showFeatureToast('Likes update when the portfolio server is available.'));
  });
}

function addInterestTracking() {
  if (document.body.dataset.interestTracking === 'ready') return;
  document.body.dataset.interestTracking = 'ready';
  document.addEventListener('click', (event) => {
    const skill = event.target.closest('.skill-interest');
    if (skill) sendAnalytics('skill_interest', skill.dataset.interest || skill.textContent.trim());

    const follow = event.target.closest('[data-analytics-event="follow"], .contact-links a[href*="linkedin.com"], .contact-links a[href*="github.com"]');
    if (follow) {
      const service = follow.dataset.analyticsValue || (follow.href.includes('github.com') ? 'GitHub' : 'LinkedIn');
      sendAnalytics('follow_click', service);
    }

    const projectLink = event.target.closest('.project-link');
    if (projectLink) {
      const title = projectLink.closest('.project-card')?.querySelector('.project-meta h3')?.textContent.trim();
      if (title) sendAnalytics('project_click', title);
    }
    if (event.target.closest('.page-share-button')) sendAnalytics('share');
    if (event.target.closest('.cv-download-button')) sendAnalytics('cv_download');
    if (event.target.closest('.vcard-download-button')) sendAnalytics('vcard_download');

    const outboundLink = event.target.closest('a[href]');
    if (outboundLink) {
      const href = outboundLink.href.toLowerCase();
      if (href.includes('linkedin.com')) sendAnalytics('linkedin_click');
      else if (href.includes('github.com')) sendAnalytics('github_click');
      else if (href.includes('wa.me/')) sendAnalytics('whatsapp_click');
      else if (outboundLink.matches('.contact-links a') && (href.startsWith('mailto:') || href.startsWith('tel:'))) {
        sendAnalytics('contact_click');
      }
    }

    const certificate = event.target.closest('.certificate-list a');
    if (certificate) {
      const title = certificate.closest('article')?.querySelector('h3')?.textContent.trim();
      if (title) sendAnalytics('certificate_view', title);
    }
  });
  if ('IntersectionObserver' in window) {
    const viewedSections = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const section = entry.target;
        const label = section.querySelector('h2, h3')?.textContent.trim().slice(0, 120);
        if (!label || viewedSections.has(label)) return;
        viewedSections.add(label);
        sendAnalytics('section_view', label);
        observer.unobserve(section);
      });
    }, { threshold: 0.4 });
    document.querySelectorAll('main section, main .page-block').forEach((section) => observer.observe(section));
  }
}

function addScrollReveal() {
  if (!('IntersectionObserver' in window)
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const main = document.querySelector('main');
  if (!main || main.dataset.revealObserver === 'ready') return;
  main.dataset.revealObserver = 'ready';

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -32px 0px' });

  const observeTargets = (root) => {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const targets = [];
    if (root.matches('main > section, .project-card, .focus-item, .skill-interest, .certificate-list article')) {
      targets.push(root);
    }
    targets.push(...root.querySelectorAll('main > section, .project-card, .focus-item, .skill-interest, .certificate-list article'));
    targets.forEach((target) => {
      if (target.dataset.revealReady) return;
      target.dataset.revealReady = 'true';
      target.classList.add('reveal-on-scroll');
      revealObserver.observe(target);
    });
  };

  observeTargets(main);
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach(observeTargets));
  }).observe(main, { childList: true, subtree: true });
}

function addLiveVisitorBadge() {
  let badge = document.querySelector('#liveVisitorBadge');
  if (!badge) {
    const target = document.querySelector('.hero .hero-grid > div:first-child, .page-intro .container');
    if (!target) return;
    badge = document.createElement('p');
    badge.className = 'live-visitor-badge';
    badge.id = 'liveVisitorBadge';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    const icon = makeIcon('activity');
    const count = document.createElement('span');
    count.dataset.liveVisitorCount = '';
    count.textContent = 'Checking active visitors…';
    badge.append(icon, count);
    target.append(badge);
  }
  if (badge.dataset.liveVisitorsReady) return;
  badge.dataset.liveVisitorsReady = 'true';
  const count = badge.querySelector('[data-live-visitor-count]') || badge;

  const refresh = async () => {
    try {
      const response = await window.portfolioApiFetch('/api/analytics/live-visitors', {
        cache: 'no-store',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Live visitor count is unavailable.');
      if (!Number.isSafeInteger(result.activeVisitors) || result.activeVisitors < 0) {
        throw new Error('Live visitor count is unavailable.');
      }
      count.textContent = `${result.activeVisitors} visitor${result.activeVisitors === 1 ? '' : 's'} active now`;
    } catch {
      count.textContent = 'Live visitor count unavailable';
    }
  };

  refresh();
  window.setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
}

function addVisitorAccountLink() {
  const navigation = document.querySelector('#navLinks');
  if (!navigation || navigation.querySelector('.visitor-account-link')) return;
  const link = document.createElement('a');
  link.className = 'visitor-account-link';
  link.href = 'account.html';
  link.append(makeIcon('circle-user-round'), document.createTextNode('Visitor access'));
  navigation.append(link);
}

function addGlobalSearch() {
  const navigation = document.querySelector('#navLinks');
  if (!navigation || document.querySelector('#siteSearchToggle')) return;

  const toggle = document.createElement('button');
  toggle.className = 'site-search-toggle';
  toggle.id = 'siteSearchToggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Search portfolio');
  toggle.title = 'Search portfolio';
  toggle.append(makeIcon('search'));
  navigation.parentElement.insertBefore(toggle, document.querySelector('#themeToggle'));

  const dialog = document.createElement('dialog');
  dialog.className = 'site-search-dialog';
  dialog.id = 'siteSearchDialog';
  dialog.innerHTML = '<form method="dialog" class="site-search-form"><label for="siteSearchInput">Search this portfolio</label><div class="site-search-field"><i data-lucide="search" aria-hidden="true"></i><input id="siteSearchInput" type="search" autocomplete="off" placeholder="Search pages and topics"><button class="icon-button" type="submit" aria-label="Close search"><i data-lucide="x" aria-hidden="true"></i></button></div><div class="site-search-results" id="siteSearchResults" role="listbox" aria-label="Search results"></div><p class="search-hint">Press Esc to close</p></form>';
  document.body.append(dialog);

  const input = dialog.querySelector('#siteSearchInput');
  const results = dialog.querySelector('#siteSearchResults');
  const renderResults = () => {
    const query = input.value.trim().toLowerCase();
    results.replaceChildren();
    if (!query) {
      results.append(Object.assign(document.createElement('p'), { className: 'search-empty', textContent: 'Search pages, skills, education, projects, or athletics.' }));
      return;
    }

    const entries = [];
    document.querySelectorAll('#navLinks a[data-page]').forEach((link) => {
      entries.push({ title: link.textContent.trim(), detail: 'Portfolio page', href: link.href, terms: link.textContent });
    });
    document.querySelectorAll('main h2, main h3').forEach((heading) => {
      const section = heading.closest('section[id]');
      const detail = section?.innerText.replace(/\s+/g, ' ').trim() || heading.parentElement?.innerText || '';
      entries.push({
        title: heading.textContent.trim(),
        detail: detail.slice(0, 150),
        href: section?.id ? `index.html#${section.id}` : window.location.href,
        terms: `${heading.textContent} ${detail}`,
      });
    });

    const matches = entries.filter((entry) => entry.terms.toLowerCase().includes(query));
    if (!matches.length) {
      results.append(Object.assign(document.createElement('p'), { className: 'search-empty', textContent: 'No matching pages or topics.' }));
      return;
    }

    matches.slice(0, 12).forEach((entry) => {
      const result = document.createElement('a');
      result.className = 'search-result';
      result.href = entry.href;
      result.setAttribute('role', 'option');
      result.append(Object.assign(document.createElement('strong'), { textContent: entry.title }));
      result.append(Object.assign(document.createElement('span'), { textContent: entry.detail }));
      results.append(result);
    });
  };

  toggle.addEventListener('click', () => {
    dialog.showModal();
    input.focus();
    renderResults();
  });
  input.addEventListener('input', renderResults);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      dialog.showModal();
      input.focus();
      renderResults();
    }
  });
}

function addProjectTools() {
  const grids = [...document.querySelectorAll('#portfolioProjects, #pageProjects')];
  grids.forEach((grid) => {
    if (grid.dataset.featureTools === 'ready') return;
    grid.dataset.featureTools = 'ready';

    const tools = document.createElement('div');
    tools.className = 'project-tools';
    tools.innerHTML = '<label class="project-search-label"><span>Search projects</span><input class="project-search-input" type="search" placeholder="Name or description" aria-label="Search projects"></label><div class="project-category-filters" role="group" aria-label="Filter projects by category"><button class="project-category-filter" type="button" data-category="all" aria-pressed="true">All</button><button class="project-category-filter" type="button" data-category="frontend" aria-pressed="false">Frontend</button><button class="project-category-filter" type="button" data-category="backend" aria-pressed="false">Backend</button></div><label class="project-sort-label"><span>Sort</span><select class="project-sort-select" aria-label="Sort projects"><option value="featured">Featured order</option><option value="az">Title A to Z</option></select></label><button class="project-saved-filter" type="button" aria-pressed="false"><i data-lucide="bookmark-check" aria-hidden="true"></i>Saved</button><button class="project-reset" type="button"><i data-lucide="rotate-ccw" aria-hidden="true"></i>Reset</button><p class="project-result-count" aria-live="polite"></p>';
    grid.parentElement.insertBefore(tools, grid);

    const search = tools.querySelector('.project-search-input');
    const categoryFilters = [...tools.querySelectorAll('.project-category-filter')];
    const sort = tools.querySelector('.project-sort-select');
    const savedFilter = tools.querySelector('.project-saved-filter');
    const resultCount = tools.querySelector('.project-result-count');
    let showSavedOnly = false;
    let savedProjects = [];
    try {
      savedProjects = JSON.parse(localStorage.getItem('saved-portfolio-projects') || '[]');
      if (!Array.isArray(savedProjects)) savedProjects = [];
    } catch {
      savedProjects = [];
    }
    let selectedCategory = 'all';

    const updateCards = () => {
      let cards = [...grid.querySelectorAll('.project-card')];
      cards.forEach((card, index) => {
        if (card.dataset.defaultOrder === undefined) card.dataset.defaultOrder = String(index);
        card.dataset.projectTitle = card.querySelector('.project-meta h3')?.textContent.trim() || '';
      });
      const sortedCards = [...cards].sort((first, second) => sort.value === 'az'
        ? first.dataset.projectTitle.localeCompare(second.dataset.projectTitle)
        : Number(first.dataset.defaultOrder) - Number(second.dataset.defaultOrder));
      if (cards.some((card, index) => card !== sortedCards[index])) {
        sortedCards.forEach((card) => grid.append(card));
        cards = sortedCards;
      }
      let visible = 0;
      cards.forEach((card, index) => {
        const title = card.querySelector('.project-meta h3')?.textContent.trim() || `Project ${index + 1}`;
        const description = card.querySelector('.project-body p')?.textContent || '';
        const itemCategory = card.querySelector('.project-meta span')?.textContent.trim() || '';
        const isSaved = savedProjects.includes(title);
        card.dataset.projectTitle = title;
        card.dataset.projectCategory = itemCategory;
        const categoryText = `${itemCategory} ${title} ${description}`.toLowerCase();
        const projectType = /\b(back[ -]?end|api|server|database|sql|node(?:\.js)?|express|python|java)\b/.test(categoryText)
          ? 'backend'
          : /\b(front[ -]?end|web|ui|html|css|javascript|react|vue|angular|responsive)\b/.test(categoryText)
            ? 'frontend'
            : 'other';

        let saveButton = card.querySelector('.project-save-button');
        if (!saveButton) {
          saveButton = document.createElement('button');
          saveButton.className = 'project-save-button';
          saveButton.type = 'button';
          card.append(saveButton);
        }
        const savedState = String(isSaved);
        if (saveButton.dataset.savedState !== savedState) {
          saveButton.setAttribute('aria-label', `${isSaved ? 'Remove saved' : 'Save'} project: ${title}`);
          saveButton.setAttribute('aria-pressed', savedState);
          saveButton.title = isSaved ? 'Remove saved project' : 'Save project';
          saveButton.replaceChildren(makeIcon(isSaved ? 'bookmark-check' : 'bookmark'));
          saveButton.dataset.savedState = savedState;
        }

        const matchesText = `${title} ${description}`.toLowerCase().includes(search.value.trim().toLowerCase());
        const matchesCategory = selectedCategory === 'all' || selectedCategory === projectType;
        const matchesSaved = !showSavedOnly || isSaved;
        const isVisible = matchesText && matchesCategory && matchesSaved;
        card.hidden = !isVisible;
        if (isVisible) visible += 1;
      });
      resultCount.textContent = `${visible} of ${cards.length} project${cards.length === 1 ? '' : 's'}`;
      if (window.lucide?.createIcons) window.lucide.createIcons();
    };

    search.addEventListener('input', updateCards);
    categoryFilters.forEach((button) => {
      button.addEventListener('click', () => {
        selectedCategory = button.dataset.category;
        categoryFilters.forEach((filter) => {
          filter.setAttribute('aria-pressed', String(filter === button));
        });
        updateCards();
      });
    });
    sort.addEventListener('change', updateCards);
    savedFilter.addEventListener('click', () => {
      showSavedOnly = !showSavedOnly;
      savedFilter.setAttribute('aria-pressed', String(showSavedOnly));
      updateCards();
    });
    tools.querySelector('.project-reset').addEventListener('click', () => {
      search.value = '';
      selectedCategory = 'all';
      categoryFilters.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.category === 'all'));
      });
      sort.value = 'featured';
      showSavedOnly = false;
      savedFilter.setAttribute('aria-pressed', 'false');
      updateCards();
      search.focus();
    });
    grid.addEventListener('click', (event) => {
      const button = event.target.closest('.project-save-button');
      if (!button) return;
      const card = button.closest('.project-card');
      const title = card.dataset.projectTitle;
      savedProjects = savedProjects.includes(title)
        ? savedProjects.filter((item) => item !== title)
        : [...savedProjects, title];
      try {
        localStorage.setItem('saved-portfolio-projects', JSON.stringify(savedProjects));
      } catch {
        showFeatureToast('Bookmarks are unavailable in this browser.');
      }
      showFeatureToast(savedProjects.includes(title) ? 'Project saved on this device.' : 'Project removed from saved items.');
      updateCards();
    });

    const observer = new MutationObserver(updateCards);
    observer.observe(grid, { childList: true });
    updateCards();
  });
}

function addContactActions() {
  document.querySelectorAll('.contact-links').forEach((links) => {
    const emailLink = links.querySelector('a[href^="mailto:"]');
    if (emailLink && !links.querySelector('.copy-email-button')) {
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'copy-email-button';
      copyButton.title = 'Copy email address';
      copyButton.setAttribute('aria-label', 'Copy email address');
      copyButton.append(makeIcon('copy'));
      copyButton.addEventListener('click', async () => {
        const email = emailLink.href.slice('mailto:'.length).split('?')[0];
        try {
          if (await writeClipboard(email)) showFeatureToast('Email address copied.');
          else showFeatureToast(email);
        } catch {
          showFeatureToast('Could not copy email address.');
        }
      });
      emailLink.after(copyButton);
    }

    links.querySelectorAll('a:not([href^="mailto:"])').forEach((link) => {
      if (link.nextElementSibling?.classList.contains('copy-contact-button')) return;
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'copy-email-button copy-contact-button';
      copyButton.title = `Copy ${link.textContent.trim()} link`;
      copyButton.setAttribute('aria-label', `Copy ${link.textContent.trim()} link`);
      copyButton.append(makeIcon('copy'));
      copyButton.addEventListener('click', async () => {
        try {
          if (await writeClipboard(link.href)) showFeatureToast(`${link.textContent.trim()} link copied.`);
          else showFeatureToast(link.href);
        } catch {
          showFeatureToast(`Could not copy ${link.textContent.trim()} link.`);
        }
      });
      link.after(copyButton);
    });

    const contactArea = links.closest('.contact') || links.closest('.page-block');
    if (!contactArea || contactArea.querySelector('.mailto-contact-form')) return;

    const form = document.createElement('form');
    form.className = 'mailto-contact-form';
    form.innerHTML = `
      <h3>Send a message</h3>
      <p>Your message is saved to the portfolio owner’s private inbox. Email delivery is not configured.</p>
      <div class="contact-form-grid">
        <label>Your name<input name="name" type="text" maxlength="100" autocomplete="name" required></label>
        <label>Your email<input name="email" type="email" maxlength="254" autocomplete="email" required></label>
        <label class="contact-form-wide">Subject<input name="subject" type="text" maxlength="150" required></label>
        <label class="contact-form-wide">Description<textarea name="message" rows="4" maxlength="3000" required></textarea></label>
      </div>
      <button class="button button-primary" type="submit"><i data-lucide="send" aria-hidden="true"></i><span>Send message</span></button>`;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = new FormData(form);
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const response = await window.portfolioApiFetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: values.get('name'),
            email: values.get('email'),
            message: `Subject: ${values.get('subject')}\n\n${values.get('message')}`,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Message could not be submitted.');
        form.reset();
        showFeatureToast('Your message was saved to the owner’s inbox.', 'success');
        sendAnalytics('contact_submission');
      } catch (error) {
        showFeatureToast(error.message || 'Message could not be submitted.', 'error');
      } finally {
        button.disabled = false;
      }
    });
    contactArea.append(form);
    if (window.lucide?.createIcons) window.lucide.createIcons();
  });

  document.querySelectorAll('.contact-links').forEach((links) => {
    if (links.dataset.contactObserver) return;
    links.dataset.contactObserver = 'ready';
    const observer = new MutationObserver(() => addContactActions());
    observer.observe(links, { childList: true });
  });
}

function addPageUtilities() {
  const footer = document.querySelector('footer .footer-row');
  if (footer && !footer.querySelector('.page-utilities')) {
    const utilities = document.createElement('div');
    utilities.className = 'page-utilities';
    utilities.innerHTML = '<button class="page-share-button" type="button"><i data-lucide="share-2" aria-hidden="true"></i>Share page</button><button class="page-print-button" type="button"><i data-lucide="printer" aria-hidden="true"></i>Print / Save PDF</button><button class="cv-download-button" type="button"><i data-lucide="file-down" aria-hidden="true"></i>Download CV</button><button class="vcard-download-button" type="button"><i data-lucide="contact" aria-hidden="true"></i>Save contact</button><button class="text-size-toggle" type="button"><i data-lucide="a-large-small" aria-hidden="true"></i>Text size</button><button class="reading-mode-toggle" type="button"><i data-lucide="book-open-text" aria-hidden="true"></i>Reading mode</button><button class="analytics-preferences-button" type="button">Analytics privacy settings</button>';
    footer.append(utilities);
    utilities.querySelector('.analytics-preferences-button').addEventListener('click', async () => {
      if (!hasAnalyticsConsent()) {
        try {
          localStorage.removeItem(analyticsConsentKey);
        } catch {
          return showFeatureToast('Privacy settings are unavailable in this browser.');
        }
        addAnalyticsConsent();
        return;
      }

      if (!window.confirm('Withdraw analytics consent and delete this browser’s pseudonymous analytics records?')) return;
      try {
        localStorage.setItem(analyticsConsentKey, 'declined');
        analyticsReady = false;
        window.clearInterval(analyticsHeartbeat);
        const response = await window.portfolioApiFetch('/api/analytics/consent/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!response.ok) throw new Error('Your analytics data could not be deleted from the server.');
        const result = await response.json();
        cachedAnalyticsVisitorId = null;
        cachedAnalyticsSessionId = null;
        try {
          localStorage.removeItem(analyticsVisitorKey);
          sessionStorage.removeItem(analyticsSessionKey);
        } catch {
          showFeatureToast('Server analytics were deleted, but this browser could not clear its local identifier.');
          return;
        }
        showFeatureToast(result.deleted
          ? 'Analytics consent withdrawn and stored analytics deleted.'
          : 'Analytics consent withdrawn. No active server consent was found to delete.');
      } catch (error) {
        showFeatureToast(error.message);
      }
    });
    utilities.querySelector('.page-share-button').addEventListener('click', async () => {
      const shareData = { title: document.title, text: document.querySelector('meta[name="description"]')?.content || '', url: window.location.href };
      try {
        if (navigator.share) await navigator.share(shareData);
        else if (await writeClipboard(shareData.url)) showFeatureToast('Page link copied.');
        else showFeatureToast(shareData.url);
      } catch (error) {
        if (error.name !== 'AbortError') showFeatureToast('Could not share this page.');
      }
    });
    utilities.querySelector('.page-print-button').addEventListener('click', () => window.print());
    utilities.querySelector('.cv-download-button').addEventListener('click', () => {
      const profile = window.portfolioData;
      const name = profile?.name || document.querySelector('[data-portfolio-name]')?.textContent.trim() || 'Portfolio Profile';
      const about = profile?.aboutParagraphs || [...document.querySelectorAll('#portfolioAboutParagraphs p, .page-copy p')].map((paragraph) => paragraph.innerText.trim());
      const skills = profile?.skills || [...document.querySelectorAll('.skill-list span')].map((skill) => skill.textContent.trim());
      const education = profile?.education || [...document.querySelectorAll('.education-item')].map((item) => `${item.querySelector('.education-years')?.textContent.trim()} | ${item.querySelector('h3')?.textContent.trim()} | ${item.querySelector('p')?.textContent.trim()}`);
      const projects = profile?.projects || [...document.querySelectorAll('.project-card')].map((card) => `${card.querySelector('h3')?.textContent.trim()} (${card.querySelector('.project-meta span')?.textContent.trim()})\n${card.querySelector('.project-body p')?.textContent.trim()}`);
      const contacts = profile?.contacts?.map((item) => `${item.label}: ${item.href}`) || [...document.querySelectorAll('.contact-links a')].map((link) => `${link.textContent.trim()}: ${link.href}`);
      const tagline = profile?.tagline || document.querySelector('#portfolioTagline, .page-intro .eyebrow')?.textContent.trim() || '';
      const intro = profile?.intro || document.querySelector('#portfolioIntro, .page-lede')?.textContent.trim() || '';
      const sections = [
        `# ${name}`,
        tagline,
        '',
        '## Profile',
        intro,
        ...about,
        '',
        '## Skills',
        skills.join(' | '),
        '',
        '## Education',
        ...education,
        '',
        '## Projects',
        ...projects,
        '',
        '## Contact',
        ...contacts,
      ].filter(Boolean);
      downloadFile(`${name.replace(/[^a-z0-9]+/gi, '-')}-CV.md`, sections.join('\n'));
      showFeatureToast('CV downloaded as a Markdown file.');
    });
    utilities.querySelector('.vcard-download-button').addEventListener('click', () => {
      const profile = window.portfolioData;
      const contacts = profile?.contacts || [...document.querySelectorAll('.contact-links a')].map((link) => ({ label: link.textContent.trim(), href: link.href }));
      const escapeVCard = (value) => String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
      const name = profile?.name || document.querySelector('[data-portfolio-name]')?.textContent.trim() || '';
      const email = contacts.find((item) => item.href.startsWith('mailto:'))?.href.slice('mailto:'.length).split('?')[0];
      const whatsapp = contacts.find((item) => item.href.includes('wa.me/'))?.href;
      if (!name || (!email && !whatsapp)) return showFeatureToast('Contact details are not available on this page.');

      const fields = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVCard(name)}`];
      if (email) fields.push(`EMAIL;TYPE=INTERNET:${escapeVCard(email)}`);
      if (whatsapp) {
        const phone = new URL(whatsapp).pathname.replace(/\D/g, '');
        if (phone) fields.push(`TEL;TYPE=CELL,VOICE:+${phone}`);
      }
      contacts.filter((item) => item.href.startsWith('https://')).forEach((item) => fields.push(`URL:${escapeVCard(item.href)}`));
      fields.push('END:VCARD');
      downloadFile(`${name.replace(/[^a-z0-9]+/gi, '-')}.vcf`, fields.join('\r\n'), 'text/vcard;charset=utf-8');
      showFeatureToast('Contact card downloaded.');
    });

    const textSizeButton = utilities.querySelector('.text-size-toggle');
    const readingButton = utilities.querySelector('.reading-mode-toggle');
    const readPreference = (key) => {
      try {
        return localStorage.getItem(key) === 'true';
      } catch {
        return false;
      }
    };
    const savePreference = (key, value) => {
      try {
        localStorage.setItem(key, String(value));
      } catch {
        return;
      }
    };
    const setTextSize = (isLarge) => {
      document.documentElement.dataset.textSize = isLarge ? 'large' : 'normal';
      textSizeButton.setAttribute('aria-pressed', String(isLarge));
      textSizeButton.title = isLarge ? 'Use standard text size' : 'Use larger text';
      textSizeButton.setAttribute('aria-label', textSizeButton.title);
    };
    const setReadingMode = (isActive) => {
      document.documentElement.dataset.readingMode = String(isActive);
      readingButton.setAttribute('aria-pressed', String(isActive));
      readingButton.title = isActive ? 'Turn off reading mode' : 'Turn on reading mode';
      readingButton.setAttribute('aria-label', readingButton.title);
    };
    setTextSize(readPreference('portfolio-large-text'));
    setReadingMode(readPreference('portfolio-reading-mode'));
    textSizeButton.addEventListener('click', () => {
      const isLarge = document.documentElement.dataset.textSize !== 'large';
      setTextSize(isLarge);
      savePreference('portfolio-large-text', isLarge);
    });
    readingButton.addEventListener('click', () => {
      const isActive = document.documentElement.dataset.readingMode !== 'true';
      setReadingMode(isActive);
      savePreference('portfolio-reading-mode', isActive);
    });
  }

  let progress = document.querySelector('.reading-progress');
  if (!progress) {
    progress = document.createElement('div');
    progress.className = 'reading-progress';
    document.body.append(progress);
  }
  if (progress.dataset.progressReady !== 'true') {
    progress.dataset.progressReady = 'true';
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'Page reading progress');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-valuenow', '0');
    const updateProgress = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const percent = maxScroll > 0 ? Math.min(100, Math.round((window.scrollY / maxScroll) * 100)) : 100;
      progress.style.transform = `scaleX(${percent / 100})`;
      progress.setAttribute('aria-valuenow', String(percent));
    };
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
    updateProgress();
  }

  if (!document.querySelector('.back-to-top')) {
    const button = document.createElement('button');
    button.className = 'back-to-top';
    button.type = 'button';
    button.title = 'Back to top';
    button.setAttribute('aria-label', 'Back to top');
    button.append(makeIcon('arrow-up'));
    document.body.append(button);
    const updateButton = () => button.classList.toggle('visible', window.scrollY > 500);
    button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    window.addEventListener('scroll', updateButton, { passive: true });
    updateButton();
  }
}

function downloadFile(fileName, contents, type = 'text/markdown;charset=utf-8') {
  const file = new Blob([contents], { type });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function addLocalPortfolioTools() {
  const pageKey = currentPageKey();
  window.portfolioApiFetch(`/api/site?page=${encodeURIComponent(pageKey)}`, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) {
        if (response.status !== 401) throw new Error('Portfolio tools could not be loaded.');
        return null;
      }
      return response.json();
    })
    .then((data) => {
      if (!data) return;
      const { appearance, seo, certificates, comments, follows, account } = data;
      if (appearance && /^#[0-9a-f]{6}$/i.test(appearance.accentColor)) {
        document.documentElement.style.setProperty('--primary', appearance.accentColor);
        document.documentElement.style.setProperty('--green', appearance.accentColor);
        document.documentElement.dataset.defaultTheme = appearance.defaultTheme === 'dark' ? 'dark' : 'light';
      }
      if (!readSavedTheme()) {
        document.documentElement.dataset.theme = appearance?.defaultTheme === 'dark' ? 'dark' : 'light';
        const themeButton = document.querySelector('#themeToggle');
        if (themeButton) {
          const label = `Switch to ${document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'} theme`;
          themeButton.setAttribute('aria-label', label);
          themeButton.setAttribute('title', label);
          themeButton.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'));
        }
      }
      if (seo) {
        document.title = seo.title;
        const description = document.querySelector('meta[name="description"]');
        if (description) description.content = seo.description;
      }

      if (certificates?.length && ['education.html', 'academic-record.html', 'index.html'].includes(pageKey)) {
        const main = document.querySelector('main');
        if (main) {
          const section = document.createElement('section');
          section.className = 'local-feature-section';
          const container = document.createElement('div');
          container.className = 'container';
          const heading = document.createElement('h2');
          heading.textContent = 'Certificates and badges';
          const list = document.createElement('div');
          list.className = 'certificate-list';
          certificates.forEach((certificate) => {
            const item = document.createElement('article');
            const title = document.createElement('h3');
            title.textContent = certificate.title;
            item.append(title);
            if (certificate.issuer) {
              const issuer = document.createElement('p');
              issuer.textContent = certificate.issuer;
              item.append(issuer);
            }
            if (certificate.issuedAt) {
              const issued = document.createElement('p');
              issued.textContent = certificate.issuedAt;
              item.append(issued);
            }
            if (certificate.url) {
              const link = document.createElement('a');
              link.href = certificate.url;
              link.textContent = 'View credential';
              link.rel = 'noopener noreferrer';
              if (/^https:\/\//i.test(certificate.url)) link.target = '_blank';
              item.append(link);
            }
            list.append(item);
          });
          container.append(heading, list);
          section.append(container);
          main.append(section);
        }
      }

      if (!document.querySelector('.portfolio-follow')) {
        const footer = document.querySelector('footer');
        if (footer) {
          const section = document.createElement('section');
          section.className = 'portfolio-follow';
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('aria-pressed', String(follows.following));
          button.textContent = follows.following ? 'Following this portfolio' : 'Follow this portfolio';
          const count = document.createElement('span');
          count.textContent = `${follows.followers} followers`;
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              const response = await window.portfolioApiFetch('/api/community/follow', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ following: button.getAttribute('aria-pressed') !== 'true' }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'Follow status could not be updated.');
              button.setAttribute('aria-pressed', String(result.following));
              button.textContent = result.following ? 'Following this portfolio' : 'Follow this portfolio';
              count.textContent = `${result.followers} followers`;
            } catch (error) {
              showFeatureToast(error.message);
            } finally {
              button.disabled = false;
            }
          });
          section.append(button, count);
          footer.before(section);
        }
      }

      if (['projects.html', 'contact.html'].includes(pageKey) && !document.querySelector('.portfolio-comments')) {
        const main = document.querySelector('main');
        if (main) {
          const section = document.createElement('section');
          section.className = 'local-feature-section portfolio-comments';
          const container = document.createElement('div');
          container.className = 'container';
          const heading = document.createElement('h2');
          heading.textContent = 'Community comments';
          const list = document.createElement('div');
          list.className = 'comment-list';
          comments.forEach((comment) => {
            const item = document.createElement('article');
            const author = document.createElement('strong');
            author.textContent = comment.displayName;
            const text = document.createElement('p');
            text.textContent = comment.message;
            item.append(author, text);
            list.append(item);
          });
          const form = document.createElement('form');
          form.className = 'local-feature-form';
          const label = document.createElement('label');
          label.textContent = 'Add a comment (reviewed before it appears)';
          const textarea = document.createElement('textarea');
          textarea.name = 'message';
          textarea.maxLength = 1000;
          textarea.minLength = 2;
          textarea.required = true;
          textarea.rows = 4;
          label.append(textarea);
          const submit = document.createElement('button');
          submit.type = 'submit';
          submit.textContent = 'Submit comment';
          const status = document.createElement('p');
          status.className = 'local-feature-status';
          status.setAttribute('role', 'status');
          form.append(label, submit, status);
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            submit.disabled = true;
            try {
              const response = await window.portfolioApiFetch('/api/community/comment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageKey, message: textarea.value }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'Comment could not be submitted.');
              textarea.value = '';
              status.textContent = 'Comment submitted for owner review.';
            } catch (error) {
              status.textContent = error.message;
            } finally {
              submit.disabled = false;
            }
          });
          container.append(heading, list, form);
          section.append(container);
          main.append(section);
        }
      }

      if (pageKey === 'contact.html' && !document.querySelector('.mailto-contact-form')) {
        const main = document.querySelector('main');
        if (main) {
          const section = document.createElement('section');
          section.className = 'local-feature-section';
          const container = document.createElement('div');
          container.className = 'container';
          const heading = document.createElement('h2');
          heading.textContent = 'Send a message';
          const note = document.createElement('p');
          note.textContent = 'Messages are saved to the portfolio owner’s local inbox. Email delivery is not configured.';
          const form = document.createElement('form');
          form.className = 'local-feature-form local-contact-form';
          const emailLabel = document.createElement('label');
          emailLabel.textContent = 'Reply email';
          const email = document.createElement('input');
          email.type = 'email';
          email.name = 'email';
          email.value = account.email;
          email.required = true;
          email.maxLength = 254;
          emailLabel.append(email);
          const messageLabel = document.createElement('label');
          messageLabel.textContent = 'Message';
          const textarea = document.createElement('textarea');
          textarea.name = 'message';
          textarea.required = true;
          textarea.minLength = 2;
          textarea.maxLength = 5000;
          textarea.rows = 5;
          messageLabel.append(textarea);
          const submit = document.createElement('button');
          submit.type = 'submit';
          submit.textContent = 'Save message to local inbox';
          const status = document.createElement('p');
          status.className = 'local-feature-status';
          status.setAttribute('role', 'status');
          form.append(emailLabel, messageLabel, submit, status);
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            submit.disabled = true;
            try {
              const response = await window.portfolioApiFetch('/api/community/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.value, message: textarea.value }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'Message could not be saved.');
              textarea.value = '';
              status.textContent = 'Message saved to the owner’s local inbox.';
              sendAnalytics('contact_submission');
            } catch (error) {
              status.textContent = error.message;
            } finally {
              submit.disabled = false;
            }
          });
          container.append(heading, note, form);
          section.append(container);
          main.append(section);
        }
      }
    })
    .catch((error) => console.warn(error.message));
}

addAnalyticsConsent();
addProfileEngagement();
addInterestTracking();
addScrollReveal();
addLiveVisitorBadge();
addVisitorAccountLink();
addGlobalSearch();
addProjectTools();
addContactActions();
addPageUtilities();
addLocalPortfolioTools();

const contentRoot = document.querySelector('#pageRoot');
if (contentRoot) {
  const contentObserver = new MutationObserver(() => {
    addProjectTools();
    addContactActions();
  });
  contentObserver.observe(document.body, { childList: true, subtree: true });
}

if (window.lucide?.createIcons) window.lucide.createIcons();
