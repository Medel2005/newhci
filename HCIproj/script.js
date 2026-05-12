const ADMIN_CREDS = { username: 'admin', password: 'admin123' };

function getUsers()  { try { return JSON.parse(localStorage.getItem('tf_users') || '{}'); } catch { return {}; } }
function saveUsers(u){ localStorage.setItem('tf_users', JSON.stringify(u)); }
function getTasks(u) { try { return JSON.parse(localStorage.getItem('tf_tasks_' + u) || '[]'); } catch { return []; } }
function saveTasks(u,t){ localStorage.setItem('tf_tasks_' + u, JSON.stringify(t)); }
function getSession(){ try { return JSON.parse(sessionStorage.getItem('tf_session') || 'null'); } catch { return null; } }
function setSession(s){ sessionStorage.setItem('tf_session', JSON.stringify(s)); }
function clearSession(){ sessionStorage.removeItem('tf_session'); }

let currentUser = null;   // { username, name, isAdmin }
let currentTasks = [];
let activeFilter = 'all';
let activeListTab = 'tasks';
let editingTaskId = null;
let notifications = [];
let notifIntervalId = null;
let clockIntervalId = null;

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t,i) => t.classList.toggle('active', (i===0 && tab==='login') || (i===1 && tab==='register')));
  document.getElementById('loginForm').classList.toggle('active', tab === 'login');
  document.getElementById('registerForm').classList.toggle('active', tab === 'register');
  document.getElementById('loginError').classList.remove('show');
  document.getElementById('registerError').classList.remove('show');
}

function showAuthError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
}

function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  if (!u || !p) { showAuthError('loginError', 'Please fill in all fields.'); return; }

  // Admin check
  if (u === ADMIN_CREDS.username && p === ADMIN_CREDS.password) {
    setSession({ username: 'admin', name: 'Admin Admin', isAdmin: true });
    enterAdmin();
    return;
  }

  // Block admin username from normal users
  if (u === ADMIN_CREDS.username) {
    showAuthError('loginError', 'Invalid credentials.');
    return;
  }

  const users = getUsers();
  if (!users[u]) { showAuthError('loginError', 'Username not found.'); return; }
  if (users[u].password !== btoa(p)) { showAuthError('loginError', 'Incorrect password.'); return; }

  setSession({ username: u, name: users[u].name, isAdmin: false });
  enterApp(u, users[u].name);
}

function doRegister() {
  const name = document.getElementById('regName').value.trim();
  const u    = document.getElementById('regUser').value.trim();
  const p    = document.getElementById('regPass').value;
  const p2   = document.getElementById('regPass2').value;

  if (!name || !u || !p || !p2) { showAuthError('registerError', 'Please fill in all fields.'); return; }
  if (u === ADMIN_CREDS.username) { showAuthError('registerError', 'That username is reserved.'); return; }
  if (p.length < 4) { showAuthError('registerError', 'Password must be at least 4 characters.'); return; }
  if (p !== p2) { showAuthError('registerError', 'Passwords do not match.'); return; }

  const users = getUsers();
  if (users[u]) { showAuthError('registerError', 'Username already taken.'); return; }

  users[u] = { name, password: btoa(p), createdAt: Date.now() };
  saveUsers(users);
  showToast('Account created! You can now log in.', 'success');
  switchAuthTab('login');
  document.getElementById('loginUser').value = u;
}

function doLogout() {
  stopIntervals();
  clearSession();
  currentUser = null;
  currentTasks = [];
  notifications = [];
  // Reset auth inputs
  ['loginUser','loginPass','regName','regUser','regPass','regPass2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  showScreen('authScreen');
  switchAuthTab('login');
}


function enterApp(username, name) {
  currentUser = { username, name, isAdmin: false };
  currentTasks = getTasks(username);
  activeFilter = 'all';
  notifications = [];

  // UI setup
  const initials = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  document.getElementById('userAvatar').textContent = initials;
  document.getElementById('userDisplayName').textContent = name;

  renderTaskList();
  renderSchedule();
  updateStats();
  updateNotifBadge();

  showScreen('appScreen');
  startClock();
  startNotifChecker();
  showToast(`Welcome back, ${name.split(' ')[0]}!`, 'info');
}

function enterAdmin() {
  currentUser = { username: 'admin', name: 'Admin Admin', isAdmin: true };
  showScreen('adminScreen');
  renderAdminDashboard();
  startAdminClock();
  showToast('Logged in as Admin.', 'info');
}

function showScreen(id) {
  ['authScreen','appScreen','adminScreen'].forEach(s => {
    document.getElementById(s).classList.toggle('active', s === id);
  });
}


function formatClock(d) {
  let h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} ${ampm}`;
}

function startClock() {
  stopClock();
  const tick = () => {
    const now = new Date();
    const el = document.getElementById('liveClock');
    if (el) el.textContent = formatClock(now);
    checkOverdueRealtime(now);
  };
  tick();
  clockIntervalId = setInterval(tick, 1000);
}

function startAdminClock() {
  const tick = () => {
    const now = new Date();
    const el = document.getElementById('adminClock');
    if (el) el.textContent = formatClock(now);
  };
  tick();
  if (!clockIntervalId) clockIntervalId = setInterval(tick, 1000);
}

function stopClock() {
  if (clockIntervalId) { clearInterval(clockIntervalId); clockIntervalId = null; }
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function addTask() {
  const title = document.getElementById('taskTitle').value.trim();
  const desc  = document.getElementById('taskDesc').value.trim();
  const priority = document.getElementById('taskPriority').value;
  const due   = document.getElementById('taskDue').value;
  const remind = parseInt(document.getElementById('taskRemind').value, 10);

  if (!title) { showToast('Please enter a task title.', 'error'); return; }

  const task = {
    id: genId(),
    title, desc, priority,
    due: due ? new Date(due).getTime() : null,
    remind,
    done: false,
    createdAt: Date.now(),
    notified: false
  };

  currentTasks.unshift(task);
  persistTasks();
  renderTaskList();
  renderSchedule();
  updateStats();

  // Clear form
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDesc').value = '';
  document.getElementById('taskDue').value = '';
  document.getElementById('taskPriority').value = 'medium';
  document.getElementById('taskRemind').value = '15';

  showToast('Task added!', 'success');
}

function toggleDone(id) {
  const task = currentTasks.find(t => t.id === id);
  if (!task) return;
  task.done = !task.done;
  if (task.done) task.doneAt = Date.now();
  else delete task.doneAt;
  persistTasks();
  renderTaskList();
  renderSchedule();
  updateStats();
  showToast(task.done ? '✅ Task completed!' : '↩️ Task reopened', task.done ? 'success' : 'info');
}

function deleteTask(id) {
  currentTasks = currentTasks.filter(t => t.id !== id);
  persistTasks();
  renderTaskList();
  renderSchedule();
  updateStats();
  showToast('Task deleted.', 'info');
}

function openEditModal(id) {
  const task = currentTasks.find(t => t.id === id);
  if (!task) return;
  editingTaskId = id;
  document.getElementById('editTitle').value = task.title;
  document.getElementById('editDesc').value = task.desc || '';
  document.getElementById('editPriority').value = task.priority;
  document.getElementById('editDue').value = task.due ? new Date(task.due - new Date(task.due).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
  document.getElementById('editModal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('open');
  editingTaskId = null;
}

function saveEdit() {
  if (!editingTaskId) return;
  const task = currentTasks.find(t => t.id === editingTaskId);
  if (!task) return;
  const title = document.getElementById('editTitle').value.trim();
  if (!title) { showToast('Title cannot be empty.', 'error'); return; }
  task.title = title;
  task.desc  = document.getElementById('editDesc').value.trim();
  task.priority = document.getElementById('editPriority').value;
  const dueVal = document.getElementById('editDue').value;
  task.due = dueVal ? new Date(dueVal).getTime() : null;
  task.notified = false;
  persistTasks();
  renderTaskList();
  renderSchedule();
  updateStats();
  closeEditModal();
  showToast('Task updated!', 'success');
}

function clearCompleted() {
  const before = currentTasks.length;
  currentTasks = currentTasks.filter(t => !t.done);
  if (currentTasks.length === before) { showToast('No completed tasks to clear.', 'info'); return; }
  persistTasks();
  renderTaskList();
  renderSchedule();
  updateStats();
  showToast('Completed tasks cleared.', 'success');
}

function persistTasks() {
  if (currentUser) saveTasks(currentUser.username, currentTasks);
}


function setFilter(f, el) {
  activeFilter = f;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderTaskList();
}

function getFilteredTasks() {
  const now = Date.now();
  return currentTasks.filter(t => {
    const isOverdue = t.due && !t.done && t.due < now;
    switch(activeFilter) {
      case 'pending': return !t.done;
      case 'done':    return t.done;
      case 'overdue': return isOverdue;
      case 'high':    return t.priority === 'high';
      case 'medium':  return t.priority === 'medium';
      case 'low':     return t.priority === 'low';
      default:        return true;
    }
  });
}

function formatDue(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2,'0');
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()} ${h12}:${pad(m)} ${ampm}`;
}

function renderTaskList() {
  const container = document.getElementById('taskList');
  const tasks = getFilteredTasks();
  const now = Date.now();

  if (!tasks.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">🎉</span>No tasks here!</div>`;
    return;
  }

  container.innerHTML = tasks.map(t => {
    const isOverdue = t.due && !t.done && t.due < now;
    return `
    <div class="task-item ${t.done?'done':''} ${isOverdue?'overdue':''}" id="task-${t.id}">
      <div class="task-check" onclick="toggleDone('${t.id}')"></div>
      <div class="task-content">
        <div class="task-title">${escHtml(t.title)}</div>
        <div class="task-meta">
          <span class="task-priority ${t.priority}">${t.priority}</span>
          ${t.due ? `<span class="task-due ${isOverdue?'overdue-label':''}">📅 ${formatDue(t.due)}</span>` : ''}
          ${t.desc ? `<span style="font-size:11px;color:var(--text3)">💬</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="icon-btn edit-btn" onclick="openEditModal('${t.id}')" title="Edit">✏️</button>
        <button class="icon-btn del" onclick="deleteTask('${t.id}')" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function renderSchedule() {
  const container = document.getElementById('scheduleList');
  const withDue = currentTasks.filter(t => t.due && !t.done).sort((a,b) => a.due - b.due);
  if (!withDue.length) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📅</span>No scheduled tasks.</div>`;
    return;
  }
  container.innerHTML = withDue.map(t => `
    <div class="sched-item">
      <div class="sched-dot ${t.priority}"></div>
      <div class="sched-info">
        <div class="sched-title">${escHtml(t.title)}</div>
        <div class="sched-time">Due: ${formatDue(t.due)}</div>
      </div>
      <span class="task-priority ${t.priority}">${t.priority}</span>
    </div>
  `).join('');
}

function updateStats() {
  const now = Date.now();
  const total = currentTasks.length;
  const done  = currentTasks.filter(t => t.done).length;
  const remaining = total - done;
  const overdue = currentTasks.filter(t => t.due && !t.done && t.due < now).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statDone').textContent = done;
  document.getElementById('statRemaining').textContent = remaining;
  document.getElementById('statOverdue').textContent = overdue;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
}

function switchListTab(tab) {
  activeListTab = tab;
  document.getElementById('tabTasksPane').style.display = tab === 'tasks' ? 'block' : 'none';
  document.getElementById('tabSchedulePane').style.display = tab === 'schedule' ? 'block' : 'none';
  document.getElementById('tabTasks').classList.toggle('active', tab === 'tasks');
  document.getElementById('tabSchedule').classList.toggle('active', tab === 'schedule');
}


function startNotifChecker() {
  if (notifIntervalId) clearInterval(notifIntervalId);
  notifIntervalId = setInterval(checkNotifications, 30000);
  checkNotifications();
}

function checkNotifications() {
  if (!currentUser) return;
  const now = Date.now();
  currentTasks.forEach(t => {
    if (t.done || !t.due || t.notified) return;
    const alertTime = t.due - (t.remind || 0) * 60000;
    if (now >= alertTime && now < t.due + 60000) {
      addNotif(`⏰ "${t.title}" is due ${t.remind > 0 ? `in ${t.remind} min` : 'now'}!`);
      t.notified = true;
    }
  });
  persistTasks();
}

function checkOverdueRealtime(now) {
  if (!currentUser) return;
  let changed = false;
  currentTasks.forEach(t => {
    if (!t.done && t.due && t.due < now.getTime() && !t.overdueNotified) {
      addNotif(`🔴 "${t.title}" is overdue!`);
      t.overdueNotified = true;
      changed = true;
    }
  });
  if (changed) {
    persistTasks();
    renderTaskList();
    updateStats();
  }
}

function addNotif(msg) {
  notifications.unshift({ msg, time: new Date().toLocaleTimeString() });
  if (notifications.length > 20) notifications.pop();
  renderNotifList();
  updateNotifBadge();
}

function renderNotifList() {
  const list = document.getElementById('notifList');
  if (!notifications.length) {
    list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
    return;
  }
  list.innerHTML = notifications.map(n => `
    <div class="notif-msg">
      <span class="ni">🔔</span>
      <div><div>${escHtml(n.msg)}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">${n.time}</div></div>
    </div>
  `).join('');
}

function updateNotifBadge() {
  const badge = document.getElementById('notifBadge');
  if (notifications.length > 0) {
    badge.textContent = notifications.length > 9 ? '9+' : notifications.length;
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

function clearNotifs() {
  notifications = [];
  renderNotifList();
  updateNotifBadge();
}

function toggleNotifPanel() {
  document.getElementById('notifPanel').classList.toggle('open');
}

document.addEventListener('click', e => {
  const panel = document.getElementById('notifPanel');
  const btn = e.target.closest('.notif-btn');
  if (!btn && panel && !panel.contains(e.target)) {
    panel.classList.remove('open');
  }
});


function renderAdminDashboard() {
  const users = getUsers();
  const userList = Object.entries(users);
  let totalTasks = 0, totalDone = 0;
  userList.forEach(([u]) => {
    const tasks = getTasks(u);
    totalTasks += tasks.length;
    totalDone  += tasks.filter(t => t.done).length;
  });

  document.getElementById('adminStatUsers').textContent = userList.length;
  document.getElementById('adminStatTasks').textContent = totalTasks;
  document.getElementById('adminStatDone').textContent  = totalDone;

  renderAdminTable();
}

function renderAdminTable() {
  const users = getUsers();
  const query = (document.getElementById('adminSearch')?.value || '').toLowerCase();
  const tbody = document.getElementById('adminTbody');

  const entries = Object.entries(users).filter(([u, d]) =>
    !query || u.toLowerCase().includes(query) || d.name.toLowerCase().includes(query)
  );

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="admin-empty">No registered users yet.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([u, d]) => {
    const tasks = getTasks(u);
    const done = tasks.filter(t => t.done).length;
    const pending = tasks.length - done;
    const initials = d.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const taskMinis = tasks.slice(0,6).map(t =>
      `<span class="user-task-mini"><span class="sched-dot ${t.priority}" style="width:6px;height:6px"></span>${escHtml(t.title.slice(0,22))}${t.done?' ✅':''}</span>`
    ).join('') + (tasks.length > 6 ? `<span class="user-task-mini">+${tasks.length-6} more</span>` : '');

    return `
    <tr>
      <td>
        <button class="expand-btn" onclick="toggleUserRow('row-${u}')" title="View tasks">▶</button>
      </td>
      <td>
        <div class="user-tag">
          <div class="user-avatar-sm">${initials}</div>
          ${escHtml(u)}
        </div>
      </td>
      <td>${escHtml(d.name)}</td>
      <td><span class="num-badge">${tasks.length}</span></td>
      <td><span class="num-badge green">${done}</span></td>
      <td><span class="num-badge orange">${pending}</span></td>
    </tr>
    <tr class="user-tasks-row" id="row-${u}">
      <td colspan="6">
        <div class="user-tasks-inner">
          <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px">Tasks:</div>
          ${taskMinis || '<span style="font-size:12px;color:var(--text3)">No tasks yet.</span>'}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function toggleUserRow(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.classList.toggle('open');
  // Flip the arrow
  const tr = row.previousElementSibling;
  if (tr) {
    const btn = tr.querySelector('.expand-btn');
    if (btn) btn.textContent = row.classList.contains('open') ? '▼' : '▶';
  }
}


function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type='info') {
  const wrap = document.getElementById('toastWrap');
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icon}</span><span>${escHtml(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function stopIntervals() {
  stopClock();
  if (notifIntervalId) { clearInterval(notifIntervalId); notifIntervalId = null; }
}

// Close edit modal on overlay click
document.getElementById('editModal').addEventListener('click', e => {
  if (e.target === document.getElementById('editModal')) closeEditModal();
});

// Enter key support
document.getElementById('taskTitle').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTask();
});
['loginPass','loginUser'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
});

(function boot() {
  const session = getSession();
  if (!session) return;

  if (session.isAdmin) {
    currentUser = session;
    showScreen('adminScreen');
    renderAdminDashboard();
    startAdminClock();
  } else {
    const users = getUsers();
    if (users[session.username]) {
      enterApp(session.username, session.name);
    } else {
      clearSession();
    }
  }
})();