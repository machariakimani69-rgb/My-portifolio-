(() => {
  const configuredBase = typeof window.PORTFOLIO_API_BASE_URL === 'string'
    ? window.PORTFOLIO_API_BASE_URL.trim()
    : '';
  let apiOrigin = window.location.origin;

  if (configuredBase) {
    const configuredUrl = new URL(configuredBase);
    if (configuredUrl.protocol !== 'https:' || configuredUrl.origin !== configuredBase) {
      throw new Error('PORTFOLIO_API_BASE_URL must be an HTTPS origin without a path.');
    }
    apiOrigin = configuredUrl.origin;
  }

  function readCsrfCookie() {
    const match = document.cookie.match(/(?:^|;\s*)portfolio_csrf=([^;]+)/);
    return match ? match[1] : null;
  }

  window.portfolioApiUrl = (path) => {
    const url = new URL(path, `${apiOrigin}/`);
    if (url.origin !== apiOrigin) throw new Error('Portfolio API URLs must use the configured backend origin.');
    return url.href;
  };

  window.portfolioApiFetch = (path, options = {}) => {
    const fetchOptions = { ...options, credentials: 'include' };
    const method = (options.method || 'GET').toUpperCase();
    const stateChanging = new Set(['POST', 'PUT', 'DELETE', 'PATCH']).has(method);
    if (stateChanging) {
      const csrfToken = readCsrfCookie();
      if (csrfToken) {
        fetchOptions.headers = { ...(fetchOptions.headers || {}), 'X-CSRF-Token': csrfToken };
      }
    }
    return fetch(window.portfolioApiUrl(path), fetchOptions);
  };

  window.portfolioUploadFile = async (file) => {
    if (!(file instanceof File) || file.size < 1 || file.size > 5 * 1024 * 1024) {
      throw new Error('Choose a file up to 5 MB.');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const response = await window.portfolioApiFetch('/api/admin/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, content: btoa(binary) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The file could not be uploaded.');
    return result;
  };
})();
