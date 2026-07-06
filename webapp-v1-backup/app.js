const WS_URL = `wss://${location.host}`;
let ws, currentMac = null;
let renamingMac = null;
let pendingNewDevice = null;
let term = null;
let fitAddon = null;
let rawBuffer = '';
let namingQueue = [];

function initTerminal() {
  if (term) term.dispose();
  term = new Terminal({
    theme: { background: '#000000', foreground: '#00ff88', cursor: '#00ff88' },
    fontFamily: '"Courier New", monospace',
    fontSize: 13,
    convertEol: true,
    cursorBlink: true,
    scrollback: 2000,
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container'));
  setTimeout(() => fitAddon.fit(), 50);
  term.onKey(({ key }) => {
    if (currentMac && ws) {
      ws.send(JSON.stringify({ type: 'command', mac: currentMac, cmd: key }));
    }
  });
  window.addEventListener('resize', () => { if (fitAddon) fitAddon.fit(); });
}

function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    setStatus('online');
    ws.send(JSON.stringify({ type: 'browser_hello' }));
    loadDevices();
  };
  ws.onclose = () => { setStatus('offline'); setTimeout(connect, 3000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'serial_data' && msg.mac === currentMac) {
      if (term) term.write(msg.data);
      rawBuffer += msg.data;
      updateDashboard(rawBuffer);
    }
    if (msg.type === 'new_device') {
      enqueueNaming(msg.mac);
      loadDevices();
    }
    if (msg.type === 'device_named' || msg.type === 'device_offline') loadDevices();
  };
}

function setStatus(s) {
  const el = document.getElementById('conn-status');
  el.textContent = s === 'online' ? 'Online' : 'Offline';
  el.className = `badge ${s}`;
}

async function loadDevices() {
  const devs = await fetch('/api/devices').then(r => r.json());
  const c = document.getElementById('devices');
  c.innerHTML = devs.length === 0
    ? '<p style="color:#444;font-size:13px">Δεν υπάρχουν μηχανήματα ακόμα.</p>'
    : devs.map(d => `
      <div class="device-card" onclick="openMagnet('${d.mac}','${d.name || d.mac}',${d.online})">
        <div class="card-main">
          <div class="dev-name">${d.name || '<span class="unnamed">Αχαρακτήριστο</span>'}</div>
          <div class="dev-mac">${d.mac}</div>
          <div class="${d.online ? 'dev-online' : 'dev-offline'}">
            ${d.online ? '● Online' : '○ Offline'}
          </div>
        </div>
        <button class="card-menu-btn" onclick="event.stopPropagation(); openRenameModal('${d.mac}','${(d.name||'').replace(/'/g,"\\'")}')">⋮</button>
      </div>`).join('');

  // Prompt naming for any unnamed devices not already in queue
  devs.filter(d => !d.name).forEach(d => enqueueNaming(d.mac));
}

// --- Naming queue ---
function enqueueNaming(mac) {
  if (namingQueue.includes(mac)) return;
  namingQueue.push(mac);
  if (namingQueue.length === 1) showNamingModal();
}

function showNamingModal() {
  if (namingQueue.length === 0) return;
  const mac = namingQueue[0];
  pendingNewDevice = mac;
  document.getElementById('modal-mac').textContent = `MAC: ${mac}`;
  document.getElementById('modal-name').value = '';
  const queueInfo = document.getElementById('modal-queue-info');
  queueInfo.textContent = namingQueue.length > 1
    ? `+ ${namingQueue.length - 1} ακόμα συσκευή σε αναμονή`
    : '';
  document.getElementById('modal-new-device').style.display = 'flex';
  setTimeout(() => document.getElementById('modal-name').focus(), 50);
}

function closeNamingModal() {
  document.getElementById('modal-new-device').style.display = 'none';
  pendingNewDevice = null;
}

document.getElementById('modal-save').onclick = () => {
  const name = document.getElementById('modal-name').value.trim();
  if (!name || !pendingNewDevice) return;
  ws.send(JSON.stringify({ type: 'name_device', mac: pendingNewDevice, name }));
  namingQueue.shift();
  closeNamingModal();
  loadDevices();
  if (namingQueue.length > 0) setTimeout(showNamingModal, 300);
};

document.getElementById('modal-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('modal-save').click();
});

document.getElementById('modal-later').onclick = () => {
  namingQueue.shift();
  closeNamingModal();
  if (namingQueue.length > 0) setTimeout(showNamingModal, 300);
};

// --- Rest of app ---
function openMagnet(mac, name, online) {
  currentMac = mac;
  rawBuffer = '';
  document.getElementById('view-devices').style.display = 'none';
  document.getElementById('view-magnet').style.display = 'block';
  document.getElementById('magnet-title').textContent = name;
  const badge = document.getElementById('magnet-online');
  badge.textContent = online ? 'Online' : 'Offline';
  badge.className = `badge ${online ? 'online' : 'offline'}`;
  switchTab('terminal', document.querySelector('.tab[data-tab="terminal"]'));
  ws.send(JSON.stringify({ type: 'watch', mac }));
  setTimeout(() => {
    initTerminal();
    fetch(`/api/history/${mac}`).then(r => r.json()).then(rows => {
      rows.reverse().forEach(r => {
        if (term) term.write(r.raw);
        rawBuffer += r.raw;
      });
      if (rawBuffer) updateDashboard(rawBuffer);
    });
  }, 100);
}

function sendCmd(cmd) {
  if (!currentMac || !ws) return;
  ws.send(JSON.stringify({ type: 'command', mac: currentMac, cmd }));
  if (term) {
    const label = cmd === '\x1B' ? 'ESC' : cmd.replace('\r', '');
    term.write(`\r\n\x1b[33m> ${label}\x1b[0m\r\n`);
  }
}

document.getElementById('manual-send').onclick = () => {
  const inp = document.getElementById('manual-cmd');
  const cmd = inp.value.trim();
  if (!cmd) return;
  sendCmd(cmd + '\r');
  inp.value = '';
};
document.getElementById('manual-cmd').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('manual-send').click();
});

document.getElementById('save-btn').onclick = () => {
  const blob = new Blob([rawBuffer], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `magnet_${currentMac}_${new Date().toISOString()}.txt`;
  a.click();
};

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => switchTab(btn.dataset.tab, btn);
});

function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tabcontent').forEach(t => t.style.display = 'none');
  if (btn) btn.classList.add('active');
  else document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`tab-${name}`).style.display = 'flex';
  if (name === 'terminal' && fitAddon) setTimeout(() => fitAddon.fit(), 50);
}

// --- ⋮ Menu (device detail topbar) ---
document.getElementById('menu-btn').onclick = (e) => {
  e.stopPropagation();
  const dd = document.getElementById('menu-dropdown');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
};
document.addEventListener('click', () => {
  document.getElementById('menu-dropdown').style.display = 'none';
});
document.getElementById('rename-btn').onclick = () => {
  document.getElementById('menu-dropdown').style.display = 'none';
  const current = document.getElementById('magnet-title').textContent;
  openRenameModal(currentMac, current !== currentMac ? current : '');
};

// --- Rename modal (shared by list ⋮ and detail ⋮) ---
function openRenameModal(mac, currentName) {
  renamingMac = mac;
  const input = document.getElementById('rename-input');
  input.value = currentName || '';
  document.getElementById('modal-rename').style.display = 'flex';
  setTimeout(() => { input.focus(); input.select(); }, 50);
}
document.getElementById('rename-cancel').onclick = () => {
  document.getElementById('modal-rename').style.display = 'none';
  renamingMac = null;
};
document.getElementById('rename-save').onclick = () => {
  const name = document.getElementById('rename-input').value.trim();
  if (!name || !renamingMac) return;
  ws.send(JSON.stringify({ type: 'name_device', mac: renamingMac, name }));
  if (renamingMac === currentMac) document.getElementById('magnet-title').textContent = name;
  document.getElementById('modal-rename').style.display = 'none';
  renamingMac = null;
  loadDevices();
};
document.getElementById('rename-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('rename-save').click();
  if (e.key === 'Escape') document.getElementById('rename-cancel').click();
});

document.getElementById('back-btn').onclick = () => {
  currentMac = null;
  if (term) { term.dispose(); term = null; }
  document.getElementById('view-magnet').style.display = 'none';
  document.getElementById('view-devices').style.display = 'block';
  loadDevices();
};

function updateDashboard(raw) {
  const grid = document.getElementById('parsed-grid');
  const faultsEl = document.getElementById('faults-box');

  // Parse VT100 cursor position sequences: ESC[row;colH (or [row;colH if ESC stripped)
  // Last occurrence of each position wins = most recent screen state
  const screen = {};
  const posRe = /(?:\x1b)?\[(\d+);(\d+)H([^\[\x1b]*)/g;
  let m;
  while ((m = posRe.exec(raw)) !== null) {
    const val = m[3].replace(/\x1b?\[\d*[a-zA-Z]/g, '').trim();
    if (val) screen[`${m[1]}:${m[2]}`] = val;
  }

  // Field current is a label+value at position 3:16
  const fcRaw = screen['3:16'] || '';
  const fcVal = (fcRaw.match(/([\d.]+A)/) || [])[1] || '';

  const fields = [
    { label: 'He Level 1',    val: screen['7:41']  },
    { label: 'He Level 2',    val: screen['7:48']  },
    { label: 'He Status',     val: screen['8:6']   },
    { label: 'Field Current', val: fcVal           },
    { label: 'Self Test',     val: screen['9:37']  },
    { label: 'Battery',       val: screen['10:11'] },
    { label: 'Volts',         val: screen['11:11'] },
    { label: 'Press HTR',     val: screen['11:41'] },
    { label: 'Compressor',    val: screen['10:37'] },
    { label: 'Cold Head',     val: screen['13:20'] },
    { label: 'Shield S1',     val: screen['14:20'] },
    { label: 'Shield S2',     val: screen['14:36'] },
    { label: 'Turret S1',     val: screen['15:20'] },
    { label: 'Turret S2',     val: screen['15:36'] },
    { label: 'Mag psiA',      val: screen['20:20'] },
    { label: 'Avg Power',     val: screen['21:20'] },
    { label: 'ERDU',          val: ((screen['22:21'] || '').match(/([\d.]+)/) || [])[1] || '' },
  ];

  const cards = fields.filter(f => f.val).map(f => {
    const v = f.val;
    const isAlarm = v.includes('ALARM') || v.includes('FAULT') || v === 'FAIL' || v === '00.00';
    const isWarn  = v === 'OFF' || v.includes('WARN') || v === 'LOW';
    return `<div class="pcard"><div class="plabel">${f.label}</div><div class="pvalue ${isAlarm ? 'alarm' : isWarn ? 'warn' : ''}">${v}</div></div>`;
  }).join('');
  if (cards) grid.innerHTML = cards;

  const faults = [];
  if (raw.includes('LOAD ALARM')) faults.push('Battery: Load Alarm');
  if (raw.includes('TOO FEW BUTTONS')) faults.push('ERDU: Too Few Buttons');
  if (raw.includes('Alarmbox Communications Fault')) faults.push('Alarmbox Communications Fault');
  if ((screen['10:37'] || '') === 'OFF') faults.push('Compressor είναι OFF');
  faultsEl.innerHTML = faults.length > 0
    ? faults.map(f => `<div class="fault-item">⚠️ ${f}</div>`).join('')
    : '<div class="no-faults">✅ Δεν υπάρχουν faults</div>';
}

connect();
