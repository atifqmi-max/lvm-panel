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

    container.innerHTML = '';

    if (window.Terminal) {
      this.term = new window.Terminal({
        cursorBlink: true,
        fontFamily: 'JetBrains Mono, Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.25,
        theme: {
          background: '#070a10',
          foreground: '#f8fafc',
          cursor: '#38bdf8',
          selectionBackground: 'rgba(56, 189, 248, 0.3)',
          black: '#1e293b',
          red: '#ef4444',
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
        setTimeout(() => this.fitAddon.fit(), 60);
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
    this.term.write('\x1b[36m[LVM Terminal]\x1b[0m Establishing WebSocket console session...\r\n');

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

      this.socket.onerror = () => {
        this.isConnected = false;
        this.updateStatusUI(false);
        this.term.write('\r\n\x1b[31m[LVM Terminal] WebSocket connection error.\x1b[0m\r\n');
      };
    } catch (err) {
      this.term.write(`\r\n\x1b[31mFailed to connect: ${err.message}\x1b[0m\r\n`);
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
        badge.className = 'tech-pill text-emerald-400 bg-emerald-500/10 border-emerald-500/20 flex items-center gap-1.5';
        badge.innerHTML = '<span class="pulse-dot online"></span> Connected';
      } else {
        badge.className = 'tech-pill text-slate-400';
        badge.innerHTML = 'Disconnected';
      }
    }
    if (connectBtn) {
      connectBtn.innerHTML = connected 
        ? '<i data-lucide="square" class="w-3 h-3"></i><span>Disconnect</span>' 
        : '<i data-lucide="play" class="w-3 h-3"></i><span>Connect</span>';
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

window.terminalManager = new TerminalManager();
