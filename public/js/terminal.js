// ==============================================================================
// LVM Panel - Interactive Web Terminal Manager (xterm.js + WebSockets)
// ==============================================================================

class TerminalManager {
  constructor() {
    this.term = null;
    this.fitAddon = null;
    this.socket = null;
    this.currentVpsId = null;
    this.isConnected = false;
  }

  init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Clean previous
    container.innerHTML = '';

    if (window.Terminal) {
      this.term = new window.Terminal({
        cursorBlink: true,
        fontFamily: 'JetBrains Mono, Menlo, Courier New, monospace',
        fontSize: 14,
        lineHeight: 1.2,
        theme: {
          background: '#0b0f19',
          foreground: '#f8fafc',
          cursor: '#06b6d4',
          selectionBackground: 'rgba(6, 182, 212, 0.3)',
          black: '#1e293b',
          red: '#f43f5e',
          green: '#10b981',
          yellow: '#f59e0b',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#f8fafc'
        }
      });

      if (window.FitAddon && window.FitAddon.FitAddon) {
        this.fitAddon = new window.FitAddon.FitAddon();
        this.term.loadAddon(this.fitAddon);
      }

      this.term.open(container);
      if (this.fitAddon) {
        setTimeout(() => this.fitAddon.fit(), 50);
      }

      // Handle user keyboard input
      this.term.onData(data => {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ type: 'input', data }));
        }
      });

      window.addEventListener('resize', () => {
        if (this.fitAddon) this.fitAddon.fit();
      });
    }
  }

  connect(vpsId) {
    this.currentVpsId = vpsId;
    this.disconnect();

    const container = document.getElementById('terminal-container');
    if (!this.term) {
      this.init('terminal-container');
    }

    this.term.clear();
    this.term.write('\x1b[36m[LVM Terminal]\x1b[0m Initializing secure WebSocket console channel...\r\n');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal?vps_id=${vpsId}&token=${api.getToken()}`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.isConnected = true;
        this.updateStatusUI(true);
        if (this.fitAddon) this.fitAddon.fit();
      };

      this.socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'output') {
            this.term.write(msg.data);
          } else if (msg.type === 'error') {
            this.term.write(`\r\n\x1b[31m[Error] ${msg.data}\x1b[0m\r\n`);
          }
        } catch (e) {
          this.term.write(event.data);
        }
      };

      this.socket.onclose = () => {
        this.isConnected = false;
        this.updateStatusUI(false);
        this.term.write('\r\n\x1b[33m[LVM Terminal] Session disconnected.\x1b[0m\r\n');
      };

      this.socket.onerror = (err) => {
        this.isConnected = false;
        this.updateStatusUI(false);
        this.term.write('\r\n\x1b[31m[LVM Terminal] WebSocket connection error.\x1b[0m\r\n');
      };
    } catch (err) {
      this.term.write(`\r\n\x1b[31mFailed to establish socket: ${err.message}\x1b[0m\r\n`);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.isConnected = false;
    this.updateStatusUI(false);
  }

  updateStatusUI(connected) {
    const badge = document.getElementById('terminal-status-badge');
    const connectBtn = document.getElementById('terminal-connect-btn');
    if (badge) {
      if (connected) {
        badge.className = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5';
        badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Connected';
      } else {
        badge.className = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1.5';
        badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-slate-500"></span> Disconnected';
      }
    }
    if (connectBtn) {
      connectBtn.innerHTML = connected 
        ? '<i data-lucide="power-off" class="w-4 h-4"></i> Disconnect' 
        : '<i data-lucide="play" class="w-4 h-4"></i> Connect Console';
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

window.terminalManager = new TerminalManager();
