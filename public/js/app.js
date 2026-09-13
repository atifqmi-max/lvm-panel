// ==============================================================================
// LVM Panel - Main Reactive Single Page Application Engine
// ==============================================================================

let currentView = 'dashboard';
let currentVps = null;
let currentVpsList = [];
let allUsersList = [];
let allNodesList = [];
let currentAdminTab = 'vps';
let currentManagerTab = 'console';
let credPasswordRevealed = false;
let currentEditingFilePath = null;

// Initialize on document ready
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) window.lucide.createIcons();

  // Listen for unauthorized 401 events
  window.addEventListener('lvm:unauthorized', () => {
    showAuthView();
  });

  // Load public settings & branding
  await loadPublicSettings();

  // Check persistent session
  const user = await api.fetchCurrentUser();
  if (user) {
    setupAuthenticatedState(user);
  } else {
    showAuthView();
  }
});

async function loadPublicSettings() {
  const settings = await api.fetchPublicSettings();
  if (settings) {
    if (settings.panel_name) {
      document.title = `${settings.panel_name} - Cloud Virtualization Manager`;
      const authTitle = document.getElementById('auth-panel-name');
      const sideTitle = document.getElementById('sidebar-panel-name');
      if (authTitle) authTitle.innerText = settings.panel_name;
      if (sideTitle) sideTitle.innerText = settings.panel_name;
    }
    if (settings.theme) {
      applyTheme(settings.theme);
    }
  }
}

function applyTheme(themeName) {
  document.body.className = `theme-${themeName} min-h-screen text-slate-100 flex flex-col antialiased selection:bg-cyan-500 selection:text-white`;
}

// Session & Shell Setup
function setupAuthenticatedState(user) {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  // User Profile
  const nameEl = document.getElementById('user-display-name');
  const roleEl = document.getElementById('user-role-badge');
  const avatarEl = document.getElementById('user-avatar');

  if (nameEl) nameEl.innerText = user.username;
  if (roleEl) {
    roleEl.innerText = user.role.toUpperCase();
    roleEl.className = user.role === 'admin' ? 'text-[10px] text-cyan-400 font-bold uppercase font-mono' : 'text-[10px] text-slate-400 uppercase font-mono';
  }
  if (avatarEl) avatarEl.innerText = user.username.charAt(0).toUpperCase();

  // Admin Navigation Button visibility
  const adminNav = document.getElementById('admin-nav-container');
  if (adminNav) {
    if (user.role === 'admin') {
      adminNav.classList.remove('hidden');
    } else {
      adminNav.classList.add('hidden');
    }
  }

  // Load default view
  navigateTo('dashboard');
}

function showAuthView() {
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('auth-view').classList.remove('hidden');
}

// Navigation Router
function navigateTo(viewName, vpsId = null) {
  currentView = viewName;

  // View sections
  const viewDashboard = document.getElementById('view-dashboard');
  const viewVpsManager = document.getElementById('view-vps-manager');
  const viewAdmin = document.getElementById('view-admin');
  const topTitle = document.getElementById('top-page-title');

  // Nav buttons
  const navDash = document.getElementById('nav-btn-dashboard');
  const navAdmin = document.getElementById('nav-btn-admin');

  viewDashboard.classList.add('hidden');
  viewVpsManager.classList.add('hidden');
  viewAdmin.classList.add('hidden');

  if (navDash) navDash.className = 'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all text-slate-400 hover:text-white hover:bg-white/5';
  if (navAdmin) navAdmin.className = 'w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-medium transition-all text-slate-400 hover:text-white hover:bg-white/5';

  if (viewName === 'dashboard') {
    viewDashboard.classList.remove('hidden');
    if (navDash) navDash.className = 'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-sm';
    if (topTitle) topTitle.innerText = 'Overview Dashboard';
    loadDashboardData();
  } else if (viewName === 'vps-manager') {
    viewVpsManager.classList.remove('hidden');
    if (topTitle) topTitle.innerText = 'VPS Server Manager';
    if (vpsId) {
      loadVpsManagerData(vpsId);
    }
  } else if (viewName === 'admin') {
    if (api.currentUser && api.currentUser.role !== 'admin') {
      Swal.fire('Access Denied', 'Administrator privileges required.', 'error');
      return navigateTo('dashboard');
    }
    viewAdmin.classList.remove('hidden');
    if (navAdmin) navAdmin.className = 'w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-medium transition-all bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 shadow-sm';
    if (topTitle) topTitle.innerText = 'Global Administration';
    loadAdminData();
  }

  if (window.lucide) window.lucide.createIcons();
}

function refreshCurrentView() {
  if (currentView === 'dashboard') {
    loadDashboardData();
  } else if (currentView === 'vps-manager' && currentVps) {
    loadVpsManagerData(currentVps.id);
  } else if (currentView === 'admin') {
    loadAdminData();
  }
}

// =============================================================================
// AUTHENTICATION LOGIC
// =============================================================================

function showAuthTab(tab) {
  const tabLogin = document.getElementById('tab-login');
  const tabReg = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formReg = document.getElementById('form-register');

  if (tab === 'login') {
    tabLogin.className = 'flex-1 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white shadow-sm transition-all';
    tabReg.className = 'flex-1 py-2 text-sm font-semibold rounded-lg text-slate-400 hover:text-white transition-all';
    formLogin.classList.remove('hidden');
    formReg.classList.add('hidden');
  } else {
    tabReg.className = 'flex-1 py-2 text-sm font-semibold rounded-lg bg-purple-600 text-white shadow-sm transition-all';
    tabLogin.className = 'flex-1 py-2 text-sm font-semibold rounded-lg text-slate-400 hover:text-white transition-all';
    formReg.classList.remove('hidden');
    formLogin.classList.add('hidden');
  }
  if (window.lucide) window.lucide.createIcons();
}

async function handleLogin(e) {
  e.preventDefault();
  const id = document.getElementById('login-identifier').value.trim();
  const pass = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-submit-login');

  btn.disabled = true;
  btn.innerHTML = '<span>Signing In...</span>';

  try {
    const res = await api.login(id, pass);
    if (res.success) {
      setupAuthenticatedState(res.user);
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: `Welcome back, ${res.user.username}!`,
        showConfirmButton: false,
        timer: 2500
      });
    }
  } catch (err) {
    Swal.fire('Login Failed', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Sign In to Dashboard</span><i data-lucide="arrow-right" class="w-4 h-4"></i>';
    if (window.lucide) window.lucide.createIcons();
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const user = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-password').value;
  const btn = document.getElementById('btn-submit-register');

  btn.disabled = true;
  btn.innerHTML = '<span>Creating Account...</span>';

  try {
    const res = await api.register(user, email, pass);
    if (res.success) {
      setupAuthenticatedState(res.user);
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Account created successfully!',
        showConfirmButton: false,
        timer: 2500
      });
    }
  } catch (err) {
    Swal.fire('Registration Error', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Create Account</span><i data-lucide="user-plus" class="w-4 h-4"></i>';
    if (window.lucide) window.lucide.createIcons();
  }
}

function handleLogout() {
  Swal.fire({
    title: 'Sign Out?',
    text: 'Are you sure you want to end your active session?',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#3b82f6',
    cancelButtonColor: '#1e293b',
    confirmButtonText: 'Yes, Sign Out'
  }).then((result) => {
    if (result.isConfirmed) {
      api.clearSession();
      if (window.terminalManager) window.terminalManager.disconnect();
      showAuthView();
    }
  });
}

function togglePasswordVisibility(fieldId) {
  const input = document.getElementById(fieldId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

// =============================================================================
// DASHBOARD VIEW
// =============================================================================

async function loadDashboardData() {
  try {
    const res = await api.get('/api/vps');
    if (!res.success) return;

    currentVpsList = res.data || [];

    // Update Stats
    const total = currentVpsList.length;
    const running = currentVpsList.filter(v => v.status === 'running').length;
    const totalCores = currentVpsList.reduce((acc, v) => acc + (v.cpu_cores || 0), 0);
    const totalRamMb = currentVpsList.reduce((acc, v) => acc + (v.ram_mb || 0), 0);

    document.getElementById('stat-total-vps').innerText = total;
    document.getElementById('stat-running-vps').innerText = running;
    document.getElementById('stat-total-cores').innerText = `${totalCores} Cores`;
    document.getElementById('stat-total-ram').innerText = `${(totalRamMb / 1024).toFixed(1)} GB`;

    // Render Cards
    renderDashboardCards(currentVpsList);
  } catch (err) {
    console.error('Failed to load dashboard data:', err);
  }
}

function renderDashboardCards(vpsList) {
  const container = document.getElementById('vps-list-container');
  const emptyState = document.getElementById('vps-empty-state');

  if (vpsList.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  container.innerHTML = vpsList.map(vps => {
    const isRunning = vps.status === 'running';
    const isSuspended = vps.status === 'suspended';
    
    let statusDot = 'stopped';
    let statusText = 'STOPPED';
    let statusClass = 'text-slate-400 bg-slate-800';

    if (isRunning) {
      statusDot = 'online';
      statusText = 'RUNNING';
      statusClass = 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20';
    } else if (isSuspended) {
      statusDot = 'suspended';
      statusText = 'SUSPENDED';
      statusClass = 'text-amber-400 bg-amber-500/10 border border-amber-500/20';
    }

    return `
      <div class="dev-card p-4 flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between gap-2 mb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-bold">
                <i data-lucide="server" class="w-4 h-4"></i>
              </div>
              <div>
                <h4 class="font-bold text-white text-sm font-mono leading-tight">${vps.hostname}</h4>
                <span class="text-[11px] text-slate-400 font-mono">${vps.os}</span>
              </div>
            </div>
            <span class="tech-pill flex items-center gap-1.5 ${statusClass}">
              <span class="pulse-dot ${statusDot}"></span>
              <span>${statusText}</span>
            </span>
          </div>

          <!-- Specs -->
          <div class="grid grid-cols-3 gap-2 my-3 text-center font-mono">
            <div class="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
              <div class="text-[9px] uppercase text-slate-500 font-bold">vCPU</div>
              <div class="text-xs font-bold text-white">${vps.cpu_cores} Cores</div>
            </div>
            <div class="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
              <div class="text-[9px] uppercase text-slate-500 font-bold">RAM</div>
              <div class="text-xs font-bold text-white">${vps.ram_mb} MB</div>
            </div>
            <div class="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
              <div class="text-[9px] uppercase text-slate-500 font-bold">Disk</div>
              <div class="text-xs font-bold text-white">${vps.disk_gb} GB</div>
            </div>
          </div>

          <!-- Connection IP & Port -->
          <div class="bg-slate-950 p-2 rounded-lg border border-slate-800 font-mono text-xs flex items-center justify-between text-slate-300 mb-3">
            <div class="flex items-center gap-1.5 truncate">
              <i data-lucide="globe" class="w-3.5 h-3.5 text-blue-400"></i>
              <span class="truncate font-bold">${vps.connection_ip}</span>
            </div>
            <span class="text-cyan-400 font-bold">Port ${vps.connection_port}</span>
          </div>
        </div>

        <button onclick="navigateTo('vps-manager', '${vps.id}')" class="w-full py-2 px-3 rounded-lg bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-500/20 text-xs font-semibold transition-all flex items-center justify-center gap-1.5">
          <span>Manage Instance</span>
          <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

// =============================================================================
// VPS MANAGER SCREEN
// =============================================================================

async function loadVpsManagerData(vpsId) {
  try {
    const res = await api.get(`/api/vps/${vpsId}`);
    if (!res.success) return;

    currentVps = res.data;

    // Header updates
    document.getElementById('mgr-hostname').innerText = currentVps.hostname;
    document.getElementById('mgr-os').innerHTML = `<i data-lucide="disc" class="w-3.5 h-3.5 text-blue-400"></i><span>${currentVps.os}</span>`;
    document.getElementById('mgr-node').innerHTML = `<i data-lucide="server" class="w-3.5 h-3.5 text-cyan-400"></i><span>${currentVps.node_name}</span>`;
    
    // Expiry info
    const expiryEl = document.getElementById('mgr-expiry');
    if (currentVps.duration_days === 0 || !currentVps.expires_at) {
      expiryEl.innerHTML = `<i data-lucide="clock" class="w-3.5 h-3.5"></i><span>No Expiry (Permanent)</span>`;
      expiryEl.className = 'flex items-center gap-1 text-slate-400';
    } else {
      const expDate = new Date(currentVps.expires_at).toLocaleDateString();
      expiryEl.innerHTML = `<i data-lucide="clock" class="w-3.5 h-3.5"></i><span>Expires: ${expDate}</span>`;
      expiryEl.className = 'flex items-center gap-1 text-amber-400';
    }

    // Status Badge
    const statusBadge = document.getElementById('mgr-status-badge');
    const isRunning = currentVps.status === 'running';
    const isSuspended = currentVps.status === 'suspended';

    if (isRunning) {
      statusBadge.className = 'tech-pill bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex items-center gap-1.5';
      statusBadge.innerHTML = '<span class="pulse-dot online"></span><span>RUNNING</span>';
    } else if (isSuspended) {
      statusBadge.className = 'tech-pill bg-amber-500/10 text-amber-400 border-amber-500/20 flex items-center gap-1.5';
      statusBadge.innerHTML = '<span class="pulse-dot suspended"></span><span>SUSPENDED</span>';
    } else {
      statusBadge.className = 'tech-pill bg-slate-800 text-slate-400 border-slate-700 flex items-center gap-1.5';
      statusBadge.innerHTML = '<span class="pulse-dot stopped"></span><span>STOPPED</span>';
    }

    // Specs
    const cpuEl = document.getElementById('mgr-spec-cpu');
    const ramEl = document.getElementById('mgr-spec-ram');
    const diskEl = document.getElementById('mgr-spec-disk');
    if (cpuEl) cpuEl.innerText = `${currentVps.cpu_cores} Cores`;
    if (ramEl) ramEl.innerText = `${currentVps.ram_mb} MB`;
    if (diskEl) diskEl.innerText = `${currentVps.disk_gb} GB`;

    // Credentials Card
    document.getElementById('cred-ip').innerText = currentVps.connection_ip;
    document.getElementById('cred-port').innerText = currentVps.connection_port;
    document.getElementById('cred-user').innerText = 'root';
    document.getElementById('cred-pass').innerText = credPasswordRevealed ? currentVps.root_password : '••••••••';
    document.getElementById('cred-full-ssh-cmd').innerText = `ssh root@${currentVps.connection_ip} -p ${currentVps.connection_port}`;

    // Dedicated IP Card
    const dedVal = document.getElementById('dedicated-ip-val');
    const dedPill = document.getElementById('dedicated-ip-pill');
    const adminDedBtn = document.getElementById('admin-dedicated-ip-container');

    if (currentVps.dedicated_ip) {
      dedVal.innerHTML = `<span class="tech-pill text-purple-400 bg-purple-500/10 border-purple-500/20 font-bold">${currentVps.dedicated_ip}</span>`;
      dedPill.innerText = 'Dedicated Public IP';
      dedPill.className = 'tech-pill bg-purple-500/20 text-purple-400 border-purple-500/30';
    } else {
      dedVal.innerHTML = `<span class="tech-pill text-amber-400/90 bg-amber-500/10 border-amber-500/20 text-xs">Not Set</span>`;
      dedPill.innerText = 'NAT Shared';
      dedPill.className = 'tech-pill';
    }

    // Dedicated IP Admin-Only configuration button
    if (api.currentUser && api.currentUser.role === 'admin') {
      adminDedBtn.classList.remove('hidden');
    } else {
      adminDedBtn.classList.add('hidden');
    }

    // Terminal Auto-fill
    document.getElementById('terminal-vps-info').innerText = `root@${currentVps.connection_ip}:${currentVps.connection_port}`;

    // If currently on files tab, load files
    if (currentManagerTab === 'files') {
      loadDirectoryFiles('/root');
    }

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Failed to load VPS manager data:', err);
  }
}

async function triggerVpsPower(action) {
  if (!currentVps) return;
  
  try {
    const res = await api.post(`/api/vps/${currentVps.id}/power`, { action });
    if (res.success) {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: res.message,
        showConfirmButton: false,
        timer: 2000
      });
      loadVpsManagerData(currentVps.id);
    }
  } catch (err) {
    Swal.fire('Power Action Failed', err.message, 'error');
  }
}

function toggleCredPasswordVisibility() {
  credPasswordRevealed = !credPasswordRevealed;
  const passEl = document.getElementById('cred-pass');
  const eyeIcon = document.getElementById('cred-eye-icon');
  if (currentVps) {
    passEl.innerText = credPasswordRevealed ? currentVps.root_password : '••••••••';
    if (eyeIcon) {
      eyeIcon.setAttribute('data-lucide', credPasswordRevealed ? 'eye-off' : 'eye');
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

function copyCredPassword() {
  if (currentVps && currentVps.root_password) {
    navigator.clipboard.writeText(currentVps.root_password);
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Password copied to clipboard!',
      showConfirmButton: false,
      timer: 1500
    });
  }
}

function copySshCommand() {
  if (currentVps) {
    const cmd = `ssh root@${currentVps.connection_ip} -p ${currentVps.connection_port}`;
    navigator.clipboard.writeText(cmd);
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'SSH command copied!',
      showConfirmButton: false,
      timer: 1500
    });
  }
}

function switchManagerTab(tab) {
  currentManagerTab = tab;
  const tabConsole = document.getElementById('mgr-tab-console');
  const tabFiles = document.getElementById('mgr-tab-files');
  const tabSec = document.getElementById('mgr-tab-security');

  const contentConsole = document.getElementById('mgr-content-console');
  const contentFiles = document.getElementById('mgr-content-files');
  const contentSec = document.getElementById('mgr-content-security');

  // Reset tab buttons
  [tabConsole, tabFiles, tabSec].forEach(t => {
    t.className = 'px-5 py-3.5 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-white flex items-center gap-2 transition-all';
  });

  contentConsole.classList.add('hidden');
  contentFiles.classList.add('hidden');
  contentSec.classList.add('hidden');

  if (tab === 'console') {
    tabConsole.className = 'px-5 py-3.5 text-sm font-bold border-b-2 border-cyan-400 text-cyan-400 flex items-center gap-2 transition-all';
    contentConsole.classList.remove('hidden');
  } else if (tab === 'files') {
    tabFiles.className = 'px-5 py-3.5 text-sm font-bold border-b-2 border-cyan-400 text-cyan-400 flex items-center gap-2 transition-all';
    contentFiles.classList.remove('hidden');
    loadDirectoryFiles('/root');
  } else if (tab === 'security') {
    tabSec.className = 'px-5 py-3.5 text-sm font-bold border-b-2 border-cyan-400 text-cyan-400 flex items-center gap-2 transition-all';
    contentSec.classList.remove('hidden');
  }

  if (window.lucide) window.lucide.createIcons();
}

// Terminal Controls
function toggleTerminalConnection() {
  if (!currentVps) return;
  if (window.terminalManager.isConnected) {
    window.terminalManager.disconnect();
  } else {
    window.terminalManager.connect(currentVps.id);
  }
}

function clearTerminalScreen() {
  if (window.terminalManager && window.terminalManager.term) {
    window.terminalManager.term.clear();
  }
}

// File Manager Controls
async function loadDirectoryFiles(dirPath = '/root') {
  if (!currentVps) return;
  const pathLabel = document.getElementById('fm-current-path');
  const tableBody = document.getElementById('fm-table-body');
  if (pathLabel) pathLabel.innerText = dirPath;

  try {
    const res = await api.get(`/api/vps/${currentVps.id}/files?path=${encodeURIComponent(dirPath)}`);
    if (res.success && res.files) {
      tableBody.innerHTML = res.files.map(file => {
        const icon = file.isDirectory ? 'folder' : 'file-code';
        const iconColor = file.isDirectory ? 'text-blue-400' : 'text-slate-400';
        const sizeFormatted = file.isDirectory ? '-' : `${(file.size / 1024).toFixed(1)} KB`;
        const dateFormatted = new Date(file.modified).toLocaleString();

        return `
          <tr class="hover:bg-white/5 transition-colors">
            <td class="py-3 px-4 font-mono flex items-center gap-2 text-white">
              <i data-lucide="${icon}" class="w-4 h-4 ${iconColor}"></i>
              <span class="cursor-pointer hover:underline" onclick="${file.isDirectory ? `loadDirectoryFiles('${file.path}')` : `openFileEditor('${file.path}')`}">${file.name}</span>
            </td>
            <td class="py-3 px-4 text-xs text-slate-400 font-mono">${sizeFormatted}</td>
            <td class="py-3 px-4 text-xs text-slate-400">${dateFormatted}</td>
            <td class="py-3 px-4 text-right">
              ${file.isDirectory ? `
                <button onclick="loadDirectoryFiles('${file.path}')" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200">Open</button>
              ` : `
                <button onclick="openFileEditor('${file.path}')" class="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs text-white">Edit</button>
              `}
            </td>
          </tr>
        `;
      }).join('');
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    console.error('File load failed:', err);
  }
}

async function openFileEditor(filePath) {
  if (!currentVps) return;
  currentEditingFilePath = filePath;
  document.getElementById('editor-file-title').innerHTML = `<i data-lucide="file-text" class="w-4 h-4 text-blue-400"></i><span>${filePath}</span>`;

  try {
    const res = await api.get(`/api/vps/${currentVps.id}/files/read?path=${encodeURIComponent(filePath)}`);
    if (res.success) {
      document.getElementById('editor-file-content').value = res.content || '';
      document.getElementById('modal-file-editor').classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    Swal.fire('Error Reading File', err.message, 'error');
  }
}

function closeFileEditorModal() {
  document.getElementById('modal-file-editor').classList.add('hidden');
  currentEditingFilePath = null;
}

async function handleSaveEditedFile() {
  if (!currentVps || !currentEditingFilePath) return;
  const content = document.getElementById('editor-file-content').value;

  try {
    const res = await api.post(`/api/vps/${currentVps.id}/files/write`, {
      path: currentEditingFilePath,
      content
    });
    if (res.success) {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'File saved successfully.',
        showConfirmButton: false,
        timer: 1500
      });
      closeFileEditorModal();
    }
  } catch (err) {
    Swal.fire('Save Error', err.message, 'error');
  }
}

function openCreateFileModal() {
  Swal.fire({
    title: 'Create New File',
    input: 'text',
    inputLabel: 'File Path',
    inputValue: '/root/newfile.txt',
    showCancelButton: true,
    confirmButtonText: 'Create',
    confirmButtonColor: '#3b82f6'
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      try {
        await api.post(`/api/vps/${currentVps.id}/files/write`, {
          path: result.value,
          content: ''
        });
        loadDirectoryFiles(document.getElementById('fm-current-path').innerText);
      } catch (e) {
        Swal.fire('Error', e.message, 'error');
      }
    }
  });
}

// Password Reset Form
async function handleVpsPasswordReset(e) {
  e.preventDefault();
  if (!currentVps) return;
  const newPass = document.getElementById('input-new-vps-pass').value;

  try {
    const res = await api.post(`/api/vps/${currentVps.id}/change-password`, { newPassword: newPass });
    if (res.success) {
      currentVps.root_password = newPass;
      document.getElementById('input-new-vps-pass').value = '';
      Swal.fire('Password Updated', res.message, 'success');
      loadVpsManagerData(currentVps.id);
    }
  } catch (err) {
    Swal.fire('Password Reset Failed', err.message, 'error');
  }
}

// Dedicated IP Modal
function openDedicatedIpModal() {
  if (!currentVps) return;
  document.getElementById('modal-ded-ip-input').value = currentVps.dedicated_ip || '';
  document.getElementById('modal-dedicated-ip').classList.remove('hidden');
}

function closeDedicatedIpModal() {
  document.getElementById('modal-dedicated-ip').classList.add('hidden');
}

async function handleApplyDedicatedIp(e) {
  e.preventDefault();
  if (!currentVps) return;

  const dedIp = document.getElementById('modal-ded-ip-input').value.trim();
  const hostNic = document.getElementById('modal-ded-nic-input').value.trim();
  const cidr = document.getElementById('modal-ded-cidr-input').value.trim();

  try {
    const res = await api.post(`/api/admin/vps/${currentVps.id}/dedicated-ip`, {
      dedicated_ip: dedIp,
      host_nic: hostNic,
      cidr: cidr
    });

    if (res.success) {
      closeDedicatedIpModal();
      Swal.fire('Dedicated IP Configured', res.message, 'success');
      loadVpsManagerData(currentVps.id);
    }
  } catch (err) {
    Swal.fire('Error Configuring IP', err.message, 'error');
  }
}

// =============================================================================
// ADMIN PANEL LOGIC
// =============================================================================

function switchAdminTab(tab) {
  currentAdminTab = tab;
  const tabs = ['vps', 'users', 'nodes', 'settings'];

  tabs.forEach(t => {
    const btn = document.getElementById(`admin-tab-${t}`);
    const sub = document.getElementById(`admin-subview-${t}`);
    if (btn) btn.className = 'py-3 px-4 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-white flex items-center gap-2';
    if (sub) sub.classList.add('hidden');
  });

  const activeBtn = document.getElementById(`admin-tab-${tab}`);
  const activeSub = document.getElementById(`admin-subview-${tab}`);
  if (activeBtn) activeBtn.className = 'py-3 px-4 text-xs font-bold border-b-2 border-cyan-400 text-cyan-400 flex items-center gap-2';
  if (activeSub) activeSub.classList.remove('hidden');

  if (tab === 'vps') loadAdminVps();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'nodes') loadAdminNodes();
  if (tab === 'settings') loadAdminSettings();

  if (window.lucide) window.lucide.createIcons();
}

async function loadAdminData() {
  switchAdminTab(currentAdminTab);
}

// Admin: All VPS
async function loadAdminVps() {
  try {
    const res = await api.get('/api/vps?all=true');
    if (!res.success) return;

    const body = document.getElementById('admin-vps-table-body');
    body.innerHTML = res.data.map(vps => {
      const isSuspended = vps.status === 'suspended';
      const isRunning = vps.status === 'running';

      let statusPill = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400">STOPPED</span>`;
      if (isRunning) statusPill = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">RUNNING</span>`;
      if (isSuspended) statusPill = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400">SUSPENDED</span>`;

      const expiryText = vps.duration_days === 0 || !vps.expires_at 
        ? '<span class="text-slate-500">Permanent</span>' 
        : new Date(vps.expires_at).toLocaleDateString();

      return `
        <tr class="hover:bg-white/5 transition-colors">
          <td class="py-3.5 px-4 font-mono font-bold text-white">${vps.hostname}</td>
          <td class="py-3.5 px-4 text-xs text-slate-300">${vps.owner_name}</td>
          <td class="py-3.5 px-4 text-xs text-cyan-400 font-mono">${vps.node_name}</td>
          <td class="py-3.5 px-4 text-xs font-mono text-slate-300">${vps.cpu_cores}C / ${vps.ram_mb}M / ${vps.disk_gb}G</td>
          <td class="py-3.5 px-4 text-xs font-mono text-slate-400">${vps.connection_ip}:${vps.connection_port}</td>
          <td class="py-3.5 px-4">${statusPill}</td>
          <td class="py-3.5 px-4 text-xs font-mono">${expiryText}</td>
          <td class="py-3.5 px-4 text-right space-x-1">
            ${isSuspended ? `
              <button onclick="adminUnsuspendVps('${vps.id}')" class="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white text-[10px] font-bold transition-colors">Unsuspend</button>
            ` : `
              <button onclick="adminSuspendVps('${vps.id}')" class="px-2 py-1 rounded bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white text-[10px] font-bold transition-colors">Suspend</button>
            `}
            <button onclick="adminRenewVps('${vps.id}')" class="px-2 py-1 rounded bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white text-[10px] font-bold transition-colors">Renew</button>
            <button onclick="navigateTo('vps-manager', '${vps.id}')" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold transition-colors">Manage</button>
            <button onclick="adminDeleteVps('${vps.id}', '${vps.hostname}')" class="px-2 py-1 rounded bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white text-[10px] font-bold transition-colors">Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Admin VPS list error:', err);
  }
}

async function adminSuspendVps(id) {
  try {
    const res = await api.post(`/api/admin/vps/${id}/suspend`);
    if (res.success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: res.message, showConfirmButton: false, timer: 1500 });
      loadAdminVps();
    }
  } catch (e) {
    Swal.fire('Error', e.message, 'error');
  }
}

async function adminUnsuspendVps(id) {
  try {
    const res = await api.post(`/api/admin/vps/${id}/unsuspend`);
    if (res.success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: res.message, showConfirmButton: false, timer: 1500 });
      loadAdminVps();
    }
  } catch (e) {
    Swal.fire('Error', e.message, 'error');
  }
}

async function adminRenewVps(id) {
  Swal.fire({
    title: 'Renew VPS Duration',
    input: 'number',
    inputLabel: 'Additional Days to Add',
    inputValue: 30,
    showCancelButton: true,
    confirmButtonText: 'Renew',
    confirmButtonColor: '#3b82f6'
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      try {
        const res = await api.post(`/api/admin/vps/${id}/renew`, { additional_days: result.value });
        if (res.success) {
          Swal.fire('Renewed!', res.message, 'success');
          loadAdminVps();
        }
      } catch (e) {
        Swal.fire('Error', e.message, 'error');
      }
    }
  });
}

async function adminDeleteVps(id, hostname) {
  Swal.fire({
    title: 'Delete VPS?',
    text: `Are you sure you want to permanently delete '${hostname}'? All data will be wiped.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#f43f5e',
    confirmButtonText: 'Yes, Delete VPS'
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        const res = await api.delete(`/api/admin/vps/${id}`);
        if (res.success) {
          Swal.fire('Deleted', res.message, 'success');
          loadAdminVps();
        }
      } catch (e) {
        Swal.fire('Error', e.message, 'error');
      }
    }
  });
}

// Modal: Create VPS
async function openCreateVpsModal() {
  try {
    const [uRes, nRes] = await Promise.all([
      api.get('/api/admin/users'),
      api.get('/api/admin/nodes')
    ]);

    const userSelect = document.getElementById('create-vps-user');
    const nodeSelect = document.getElementById('create-vps-node');

    if (uRes.success && uRes.users) {
      allUsersList = uRes.users;
      userSelect.innerHTML = uRes.users.map(u => `<option value="${u.id}">${u.username} (${u.email})</option>`).join('');
    }

    if (nRes.success && nRes.nodes) {
      allNodesList = nRes.nodes;
      nodeSelect.innerHTML = nRes.nodes.map(n => `<option value="${n.id}">${n.name} - ${n.location} (${n.fqdn_or_ip})</option>`).join('');
    }

    document.getElementById('modal-create-vps').classList.remove('hidden');
  } catch (err) {
    Swal.fire('Error', 'Failed to load options for VPS creation.', 'error');
  }
}

function closeCreateVpsModal() {
  document.getElementById('modal-create-vps').classList.add('hidden');
}

async function handleAdminCreateVps(e) {
  e.preventDefault();
  const userId = document.getElementById('create-vps-user').value;
  const nodeId = document.getElementById('create-vps-node').value;
  const os = document.getElementById('create-vps-os').value;
  const hostname = document.getElementById('create-vps-hostname').value.trim();
  const ram = document.getElementById('create-vps-ram').value;
  const cores = document.getElementById('create-vps-cores').value;
  const disk = document.getElementById('create-vps-disk').value;
  const duration = document.getElementById('create-vps-duration').value;

  try {
    const res = await api.post('/api/admin/vps', {
      user_id: userId,
      node_id: nodeId,
      os,
      hostname,
      ram_mb: ram,
      cpu_cores: cores,
      disk_gb: disk,
      duration_days: duration
    });

    if (res.success) {
      closeCreateVpsModal();
      Swal.fire('VPS Created!', res.message, 'success');
      loadAdminVps();
    }
  } catch (err) {
    Swal.fire('Creation Error', err.message, 'error');
  }
}

// Admin: Users Management
async function loadAdminUsers() {
  try {
    const res = await api.get('/api/admin/users');
    if (!res.success) return;

    const body = document.getElementById('admin-users-table-body');
    body.innerHTML = res.users.map(u => {
      const isAdmin = u.role === 'admin';
      const isSelf = api.currentUser && api.currentUser.id === u.id;

      return `
        <tr class="hover:bg-white/5 transition-colors">
          <td class="py-3.5 px-4 font-bold text-white flex items-center gap-2">
            <div class="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">
              ${u.username.charAt(0).toUpperCase()}
            </div>
            <span>${u.username}</span>
          </td>
          <td class="py-3.5 px-4 text-xs text-slate-300 font-mono">${u.email}</td>
          <td class="py-3.5 px-4">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isAdmin ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-slate-800 text-slate-400'}">
              ${u.role.toUpperCase()}
            </span>
          </td>
          <td class="py-3.5 px-4 text-xs font-mono text-slate-300">${u.vps_count}</td>
          <td class="py-3.5 px-4">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">${u.status}</span>
          </td>
          <td class="py-3.5 px-4 text-right space-x-1">
            ${!isSelf ? `
              <button onclick="adminToggleUserRole('${u.id}', '${isAdmin ? 'user' : 'admin'}')" class="px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white text-[10px] font-bold transition-colors">
                ${isAdmin ? 'Revoke Admin' : 'Make Admin'}
              </button>
              <button onclick="adminDeleteUser('${u.id}', '${u.username}')" class="px-2.5 py-1 rounded bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white text-[10px] font-bold transition-colors">
                Delete
              </button>
            ` : '<span class="text-xs text-slate-500 italic">You</span>'}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Admin users load error:', err);
  }
}

async function adminToggleUserRole(userId, newRole) {
  try {
    const res = await api.put(`/api/admin/users/${userId}/role`, { role: newRole });
    if (res.success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: res.message, showConfirmButton: false, timer: 1500 });
      loadAdminUsers();
    }
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

async function adminDeleteUser(userId, username) {
  Swal.fire({
    title: 'Delete User Account?',
    text: `Are you sure you want to delete '${username}'? Any VPS assigned to this user will be removed.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#f43f5e',
    confirmButtonText: 'Yes, Delete Account'
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        const res = await api.delete(`/api/admin/users/${userId}`);
        if (res.success) {
          Swal.fire('Deleted', res.message, 'success');
          loadAdminUsers();
        }
      } catch (err) {
        Swal.fire('Error', err.message, 'error');
      }
    }
  });
}

// Admin: Nodes Management
async function loadAdminNodes() {
  try {
    const res = await api.get('/api/admin/nodes');
    if (!res.success) return;

    const container = document.getElementById('admin-nodes-container');
    container.innerHTML = res.nodes.map(node => {
      const isOnline = node.status === 'online';
      return `
        <div class="glass-card p-5 border border-white/5 flex flex-col justify-between">
          <div>
            <div class="flex items-start justify-between mb-3">
              <div>
                <h4 class="font-bold text-white text-base">${node.name}</h4>
                <p class="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                  <i data-lucide="map-pin" class="w-3.5 h-3.5 text-cyan-400"></i>
                  <span>${node.location}</span>
                </p>
              </div>
              <span class="px-2.5 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 ${isOnline ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}">
                <span class="pulse-indicator ${isOnline ? 'pulse-running' : 'pulse-stopped'}"></span>
                <span>${node.status.toUpperCase()}</span>
              </span>
            </div>

            <div class="bg-slate-950 p-3 rounded-xl border border-white/5 space-y-2 text-xs font-mono my-4">
              <div class="flex justify-between text-slate-400">
                <span>IP / Host:</span>
                <span class="text-white">${node.fqdn_or_ip}</span>
              </div>
              <div class="flex justify-between text-slate-400">
                <span>Total RAM:</span>
                <span class="text-white">${(node.ram_total / 1024).toFixed(1)} GB</span>
              </div>
              <div class="flex justify-between text-slate-400">
                <span>Total Cores:</span>
                <span class="text-white">${node.cpu_cores} Cores</span>
              </div>
              <div class="flex justify-between text-slate-400">
                <span>Total Disk:</span>
                <span class="text-white">${node.disk_total} GB</span>
              </div>
              <div class="flex justify-between text-slate-400 border-t border-white/5 pt-1.5">
                <span>Hosted VPS:</span>
                <span class="text-cyan-400 font-bold">${node.vps_count} Instances</span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 pt-2 border-t border-white/5">
            <button onclick="showNodeConnectCmd('${node.token}', '${node.fqdn_or_ip}')" class="flex-1 py-2 px-3 rounded-xl bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-white border border-purple-500/30 text-xs font-bold transition-all flex items-center justify-center gap-1">
              <i data-lucide="terminal" class="w-3.5 h-3.5"></i>
              <span>Connect Guide</span>
            </button>
            ${!node.is_local ? `
              <button onclick="adminDeleteNode('${node.id}', '${node.name}')" class="p-2 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 transition-all" title="Delete Node">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Nodes load error:', err);
  }
}

function openCreateNodeModal() {
  document.getElementById('modal-create-node').classList.remove('hidden');
}

function closeCreateNodeModal() {
  document.getElementById('modal-create-node').classList.add('hidden');
}

async function handleAdminCreateNode(e) {
  e.preventDefault();
  const name = document.getElementById('create-node-name').value;
  const location = document.getElementById('create-node-location').value;
  const ip = document.getElementById('create-node-ip').value;
  const ram = document.getElementById('create-node-ram').value;
  const cores = document.getElementById('create-node-cores').value;
  const disk = document.getElementById('create-node-disk').value;

  try {
    const res = await api.post('/api/admin/nodes', {
      name,
      location,
      fqdn_or_ip: ip,
      ram_total: ram,
      cpu_cores: cores,
      disk_total: disk
    });

    if (res.success) {
      closeCreateNodeModal();
      loadAdminNodes();
      showNodeConnectCmd(res.node.token, ip);
    }
  } catch (err) {
    Swal.fire('Node Creation Error', err.message, 'error');
  }
}

function showNodeConnectCmd(token, ip) {
  const host = window.location.host;
  const cmd = `curl -sSL https://raw.githubusercontent.com/atifqmi-max/lvm-panel/main/daemon/install-agent.sh | bash -s -- --panel-url http://${host} --token ${token}`;
  
  const cmdBox = document.getElementById('node-connect-cmd');
  if (cmdBox) cmdBox.innerText = cmd;

  document.getElementById('modal-node-connect').classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function closeNodeConnectModal() {
  document.getElementById('modal-node-connect').classList.add('hidden');
}

function copyNodeConnectCmd() {
  const cmd = document.getElementById('node-connect-cmd').innerText;
  navigator.clipboard.writeText(cmd);
  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'success',
    title: 'Node install command copied!',
    showConfirmButton: false,
    timer: 1500
  });
}

async function adminDeleteNode(id, name) {
  Swal.fire({
    title: 'Delete Node?',
    text: `Are you sure you want to delete node '${name}'?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#f43f5e',
    confirmButtonText: 'Yes, Delete Node'
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        const res = await api.delete(`/api/admin/nodes/${id}`);
        if (res.success) {
          Swal.fire('Deleted', res.message, 'success');
          loadAdminNodes();
        }
      } catch (e) {
        Swal.fire('Error', e.message, 'error');
      }
    }
  });
}

// Admin: Settings Management
async function loadAdminSettings() {
  try {
    const res = await api.get('/api/admin/settings');
    if (res.success && res.settings) {
      const s = res.settings;
      document.getElementById('settings-panel-name').value = s.panel_name || 'LVM Panel';
      document.getElementById('settings-theme').value = s.theme || 'cyber-dark';
      document.getElementById('settings-registration').checked = s.allow_registration !== false;
    }
  } catch (err) {
    console.error('Settings load error:', err);
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const name = document.getElementById('settings-panel-name').value.trim();
  const theme = document.getElementById('settings-theme').value;
  const reg = document.getElementById('settings-registration').checked;

  try {
    const res = await api.put('/api/admin/settings', {
      panel_name: name,
      theme,
      allow_registration: reg
    });

    if (res.success) {
      applyTheme(theme);
      document.title = `${name} - Cloud Virtualization Manager`;
      document.getElementById('sidebar-panel-name').innerText = name;
      document.getElementById('auth-panel-name').innerText = name;

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Settings updated successfully.',
        showConfirmButton: false,
        timer: 2000
      });
    }
  } catch (err) {
    Swal.fire('Settings Error', err.message, 'error');
  }
}
