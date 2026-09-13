// ==============================================================================
// LVM Panel - API Client & Session Persistence Manager
// ==============================================================================

class ApiClient {
  constructor() {
    this.tokenKey = 'lvm_auth_token';
    this.token = localStorage.getItem(this.tokenKey) || null;
    this.currentUser = null;
    this.settings = null;
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem(this.tokenKey, token);
    } else {
      localStorage.removeItem(this.tokenKey);
    }
  }

  getToken() {
    if (!this.token) {
      this.token = localStorage.getItem(this.tokenKey);
    }
    return this.token;
  }

  clearSession() {
    this.token = null;
    this.currentUser = null;
    localStorage.removeItem(this.tokenKey);
  }

  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(endpoint, {
        ...options,
        headers
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        // If session is expired or invalid, clear and emit logout event
        console.warn('[API] 401 Unauthorized encountered. Session may be expired.');
        if (this.token && !endpoint.includes('/api/auth/login')) {
          this.clearSession();
          window.dispatchEvent(new CustomEvent('lvm:unauthorized'));
        }
      }

      if (!response.ok) {
        throw new Error(data.message || `Request failed with status ${response.status}`);
      }

      return data;
    } catch (err) {
      throw err;
    }
  }

  get(endpoint, options = {}) {
    return this.request(endpoint, { method: 'GET', ...options });
  }

  post(endpoint, body = {}, options = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
      ...options
    });
  }

  put(endpoint, body = {}, options = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body),
      ...options
    });
  }

  delete(endpoint, options = {}) {
    return this.request(endpoint, { method: 'DELETE', ...options });
  }

  // Auth Methods
  async login(emailOrUsername, password) {
    const res = await this.post('/api/auth/login', { emailOrUsername, password });
    if (res.success && res.token) {
      this.setToken(res.token);
      this.currentUser = res.user;
    }
    return res;
  }

  async register(username, email, password) {
    const res = await this.post('/api/auth/register', { username, email, password });
    if (res.success && res.token) {
      this.setToken(res.token);
      this.currentUser = res.user;
    }
    return res;
  }

  async fetchCurrentUser() {
    if (!this.getToken()) return null;
    try {
      const res = await this.get('/api/auth/me');
      if (res.success && res.user) {
        this.currentUser = res.user;
        return res.user;
      }
      return null;
    } catch (err) {
      this.clearSession();
      return null;
    }
  }

  async fetchPublicSettings() {
    try {
      const res = await this.get('/api/settings/public');
      if (res.success) {
        this.settings = res;
        return res;
      }
    } catch (e) {}
    return { panel_name: 'LVM Panel', theme: 'cyber-dark' };
  }
}

window.api = new ApiClient();
