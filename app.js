/* =====================================================
   MyPlanner – app.js
   로그인 / 회원가입 / 목표 / 투두 / 알람 전체 로직
===================================================== */

'use strict';

// ──────────────────────────────────────────────────────
//  Firebase 초기화 & 동기화
// ──────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBifF0Ab8DRIE7YTXqCWRst58t_WJHW5LA",
  authDomain: "planner-dd626.firebaseapp.com",
  databaseURL: "https://planner-dd626-default-rtdb.firebaseio.com",
  projectId: "planner-dd626",
  storageBucket: "planner-dd626.firebasestorage.app",
  messagingSenderId: "1096446655",
  appId: "1:1096446655:web:b5e320ed90c9066aac0c0a"
};

let _fbDb = null;
try {
  firebase.initializeApp(firebaseConfig);
  _fbDb = firebase.database();
} catch(e) {
  console.warn('Firebase 초기화 실패:', e);
}

// localStorage 키를 Firebase 경로로 변환 (점 제거)
function _toFbKey(key) { return key.replace(/\./g, '_DOT_'); }
function _fromFbKey(key) { return key.replace(/_DOT_/g, '.'); }

// Firebase에 비동기 저장 (실패해도 앱 동작에 영향 없음)
function _fbSave(key, val) {
  if (!_fbDb) return;
  _fbDb.ref('planner/' + _toFbKey(key)).set(val)
    .catch(e => console.warn('Firebase 저장 실패:', key, e));
}

// 로그인 시 Firebase → localStorage 전체 동기화
async function syncFromFirebase() {
  if (!_fbDb) return;
  try {
    const snap = await _fbDb.ref('planner').get();
    if (snap.exists()) {
      const data = snap.val();
      Object.keys(data).forEach(fbKey => {
        const localKey = _fromFbKey(fbKey);
        try { localStorage.setItem(localKey, JSON.stringify(data[fbKey])); } catch(e) {}
      });
      console.log('✅ Firebase → localStorage 동기화 완료');
    }
  } catch(e) {
    console.warn('Firebase 동기화 실패 (오프라인?):', e);
  }
}

// ──────────────────────────────────────────────────────
//  상수 & 헬퍼
// ──────────────────────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const MONTHS_KO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const CAT_COLORS = {
  work: { bg: 'rgba(99,102,241,0.18)', text: '#818cf8' },
  study: { bg: 'rgba(6,182,212,0.18)', text: '#22d3ee' },
  health: { bg: 'rgba(16,185,129,0.18)', text: '#34d399' },
  personal: { bg: 'rgba(245,158,11,0.18)', text: '#fbbf24' },
  social: { bg: 'rgba(244,63,94,0.18)', text: '#fb7185' },
};
const CAT_LABELS = { work:'💼 업무', study:'📚 공부', health:'🏃 건강', personal:'🌱 개인', social:'👥 사회' };
const PRI_LABELS = { low:'🟢 낮음', medium:'🟡 보통', high:'🔴 높음' };

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function fmtDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function parseDateStr(s) {
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}
function fmtHour(h) { return `${String(h).padStart(2,'0')}:00`; }
function fmtHourRange(s, e) { return `${fmtHour(s)} – ${fmtHour(e)}`; }
function fmtTime(h, m) { return `${String(h).padStart(2,'0')}:${String(m ?? 0).padStart(2,'0')}`; }
function fmtTimeRange(sH, sM, eH, eM) { return `${fmtTime(sH, sM)} – ${fmtTime(eH, eM)}`; }
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = parseDateStr(dateStr) - new Date();
  return Math.ceil(diff / 86400000);
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ──────────────────────────────────────────────────────
//  localStorage 관리
// ──────────────────────────────────────────────────────
function loadData(key, def = null) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
  catch { return def; }
}
function saveData(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch (e) { console.warn('저장 실패:', e); }
  _fbSave(key, val); // Firebase에도 동기화
}

// 사용자 DB
function getUsers() { return loadData('mp_users', {}); }
function saveUsers(u) { saveData('mp_users', u); }

// 초대 코드 DB
function getInviteCodes() {
  const codes = loadData('mp_invite_codes', []);
  if (!Array.isArray(codes)) return [];
  // Firebase는 빈 배열 필드를 삭제하므로 usedBy 복원
  return codes.map(c => ({ ...c, usedBy: Array.isArray(c.usedBy) ? c.usedBy : [] }));
}
function saveInviteCodes(c) { saveData('mp_invite_codes', c); }

// 현재 로그인 사용자 키 반환
function currentUserKey() { return loadData('mp_current_user', null); }
function isAdmin() { const u = getUsers()[currentUserKey()]; return u && u.role === 'admin'; }

// 사용자별 데이터
function userDataKey(suffix) { return `mp_data_${currentUserKey()}_${suffix}`; }
function getGoals() { return loadData(userDataKey('goals'), []); }
function saveGoals(g) { saveData(userDataKey('goals'), g); }
function getTasks() {
  const tasks = loadData(userDataKey('tasks'), {});
  if (tasks && typeof tasks === 'object') {
    Object.keys(tasks).forEach(d => { if (!Array.isArray(tasks[d])) tasks[d] = []; });
  }
  return tasks || {};
} // { dateStr: [task,...] }
function saveTasks(t) { saveData(userDataKey('tasks'), t); }
function getAlarmSetting() { return loadData(userDataKey('alarm'), { enabled: false, time: '07:00' }); }
function saveAlarmSetting(a) { saveData(userDataKey('alarm'), a); }
function getAlarmHistory() { return loadData(userDataKey('alarm_hist'), []); }
function saveAlarmHistory(h) { saveData(userDataKey('alarm_hist'), h); }
function getStreak() { return loadData(userDataKey('streak'), { count: 0, lastDate: '' }); }
function saveStreak(s) { saveData(userDataKey('streak'), s); }
function getMilestones() { return loadData(userDataKey('milestones'), []); }
function saveMilestones(m) { saveData(userDataKey('milestones'), m); }
function getMilestonesForGoal(goalId) { return getMilestones().filter(m => m.goalId === goalId); }
function getRoutines() { return loadData(userDataKey('routines'), []); }
function saveRoutines(r) { saveData(userDataKey('routines'), r); }
function getRoutinesForDate(date) {
  const dow = date.getDay();
  return getRoutines().filter(r => r.days.includes(dow));
}

// ──────────────────────────────────────────────────────
//  초기화 (관리자 + 초대코드)
// ──────────────────────────────────────────────────────
const _initReady = (async function initSystem() {
  // 새 기기에서도 기존 데이터를 사용할 수 있도록 Firebase에서 먼저 동기화
  await syncFromFirebase();

  const users = getUsers();

  // 관리자 계정 (최초 1회, Firebase sync 이후에 없을 경우만 생성)
  if (!users['admin']) {
    users['admin'] = { id: 'admin', name: '관리자', pw: 'admin1234', role: 'admin' };
    saveUsers(users);
  }

  // 기본 초대 코드 (최초 1회 및 마이그레이션)
  let inviteCodes = getInviteCodes();
  // PLAN2024를 아직 갖고 있는 경우 iamsoawesome으로 일괄 변경
  let updated = false;
  inviteCodes = inviteCodes.map(c => {
    if (c.code === 'PLAN2024') {
      c.code = 'iamsoawesome';
      updated = true;
    }
    return c;
  });
  
  if (inviteCodes.length === 0) {
    inviteCodes = [
      { code: 'iamsoawesome', label: '기본 초대코드', usedBy: [], maxUses: 10, createdAt: new Date().toISOString() },
    ];
    updated = true;
  }
  
  if (updated) {
    saveInviteCodes(inviteCodes);
  }

  // [1회성 마이그레이션] 중복 마일스톤 데이터 정제 (가장 마지막에 등록된 유니크한 항목만 보존)
  Object.keys(users).forEach(uidKey => {
    const msKey = `mp_data_${uidKey}_milestones`;
    const milestonesList = loadData(msKey, null);
    if (milestonesList && Array.isArray(milestonesList)) {
      const uniqueMap = new Map();
      // 뒤에서부터(즉, 좀전에 입력된 최신 데이터부터) 읽어서 중복 제거
      for (let i = milestonesList.length - 1; i >= 0; i--) {
        const item = milestonesList[i];
        // goalId, title, targetDate가 모두 같은 대상을 중복으로 식별
        const key = `${item.goalId}_${item.title}_${item.targetDate}`;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, item);
        }
      }
      // 원래 순서(정방향)로 다시 재배열하여 저장
      const cleanedList = Array.from(uniqueMap.values()).reverse();
      if (cleanedList.length !== milestonesList.length) {
        saveData(msKey, cleanedList);
      }
    }
  });

})();

// ──────────────────────────────────────────────────────
//  LOGIN / REGISTER
// ──────────────────────────────────────────────────────
let currentAuthTab = 'login';

function switchAuthTab(tab) {
  currentAuthTab = tab;
  document.getElementById('loginTab').classList.toggle('active', tab === 'login');
  document.getElementById('registerTab').classList.toggle('active', tab === 'register');
  document.getElementById('loginForm').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('loginError').classList.remove('show');
  document.getElementById('registerError').classList.remove('show');
}
window.switchAuthTab = switchAuthTab;

async function doLogin() {
  const id = document.getElementById('loginId').value.trim();
  const pw = document.getElementById('loginPw').value;
  const errEl = document.getElementById('loginError');
  if (!id || !pw) { errEl.textContent = '아이디와 비밀번호를 입력하세요.'; errEl.classList.add('show'); return; }

  // Firebase에서 최신 데이터를 먼저 동기화
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.disabled = true;
  await syncFromFirebase();
  if (loginBtn) loginBtn.disabled = false;

  const users = getUsers();
  const user = users[id];
  if (!user || user.pw !== pw) { errEl.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.'; errEl.classList.add('show'); return; }
  errEl.classList.remove('show');
  saveData('mp_current_user', id);
  enterApp(user);
}

function doRegister() {
  const name       = document.getElementById('regName').value.trim();
  const id         = document.getElementById('regId').value.trim();
  const pw         = document.getElementById('regPw').value;
  const pw2        = document.getElementById('regPwConfirm').value;
  const inviteCode = document.getElementById('regInviteCode').value.trim();
  const errEl      = document.getElementById('registerError');

  if (!name || !id || !pw || !inviteCode) { errEl.textContent = '모든 항목을 입력하세요.'; errEl.classList.add('show'); return; }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(id)) { errEl.textContent = '아이디는 3~20자 영문/숫자/_만 사용 가능합니다.'; errEl.classList.add('show'); return; }
  if (pw.length < 4) { errEl.textContent = '비밀번호는 4자 이상이어야 합니다.'; errEl.classList.add('show'); return; }
  if (pw !== pw2) { errEl.textContent = '비밀번호가 일치하지 않습니다.'; errEl.classList.add('show'); return; }

  // ── 초대 코드 검증 ──
  const codes = getInviteCodes();
  const codeObj = codes.find(c => c.code.toLowerCase() === inviteCode.toLowerCase());
  if (!codeObj) { errEl.textContent = '❌ 유효하지 않은 초대 코드입니다.'; errEl.classList.add('show'); return; }
  if (codeObj.usedBy.length >= codeObj.maxUses) { errEl.textContent = '❌ 초대 코드 사용 한도를 초과했습니다.'; errEl.classList.add('show'); return; }
  if (codeObj.usedBy.includes(id)) { errEl.textContent = '❌ 이미 이 초대 코드를 사용한 아이디입니다.'; errEl.classList.add('show'); return; }

  const users = getUsers();
  if (users[id]) { errEl.textContent = '이미 사용 중인 아이디입니다.'; errEl.classList.add('show'); return; }

  // 코드 사용 처리
  codeObj.usedBy.push(id);
  saveInviteCodes(codes);

  users[id] = { id, name, pw, role: 'user', inviteCode, joinedAt: new Date().toISOString() };
  saveUsers(users);
  saveData('mp_current_user', id);
  errEl.classList.remove('show');
  enterApp(users[id]);
}

function doLogout() {
  saveData('mp_current_user', null);
  document.getElementById('appPage').style.display = 'none';
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('loginId').value = '';
  document.getElementById('loginPw').value = '';
  clearAlarmTimer();
  showToast('로그아웃 되었습니다.');
}

function enterApp(user) {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appPage').style.display = 'block';

  // 사용자 정보 표시
  const initials = user.name ? user.name[0].toUpperCase() : 'U';
  document.getElementById('userAvatar').textContent = initials;
  document.getElementById('userNameDisp').textContent = user.name;

  initApp();
}

// ──────────────────────────────────────────────────────
//  APP 초기화
// ──────────────────────────────────────────────────────
let activeDate = new Date();
let calViewDate = new Date();
let calSelectedDate = new Date();
let editingTaskId = null;
let editingGoalId = null;
let editingGoalType = 'long';
let currentView = 'today';
let alarmTimer = null;

function initApp() {
  activeDate = new Date();
  calViewDate = new Date();
  calSelectedDate = new Date();
  editingTaskId = null;
  editingGoalId = null;
  currentView = 'today';

  setupSidebar();
  setupTimeGrid();
  setupGoals();
  setupCalendar();
  setupAlarm();
  setupFAB();
  setupModals();
  setupMobileTabbar();
  setupRoutine();
  startClock();
  updateStreak();
  scheduleAlarmCheck();
  checkAlarmOnLoad();

  // 관리자일 경우 관리자 메뉴 표시 (사이드바 + 모바일 탭바)
  const adminNav = document.getElementById('nav-admin');
  if (adminNav) adminNav.style.display = isAdmin() ? '' : 'none';
  const adminTab = document.getElementById('tab-admin');
  if (adminTab) adminTab.style.display = isAdmin() ? '' : 'none';

  // Today view 기본
  switchView('today');
  renderGoalSummaryBar();
  renderTimeGrid();
}

// ──────────────────────────────────────────────────────
//  SIDEBAR & NAVIGATION
// ──────────────────────────────────────────────────────
const VIEW_TITLES = {
  today: '오늘의 플랜',
  goals: '목표 관리',
  calendar: '캘린더',
  alarm: '알람 설정',
  routine: '🔄 루틴',
  admin: '🔧 관리자 패널',
};

function setupSidebar() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('sidebarToggle').addEventListener('click', collapseSidebar);
  document.getElementById('menuBtn').addEventListener('click', expandSidebar);
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('prevDay').addEventListener('click', () => changeDay(-1));
  document.getElementById('nextDay').addEventListener('click', () => changeDay(1));
  document.getElementById('jumpToday').addEventListener('click', () => { activeDate = new Date(); renderTimeGrid(); updateDateLabel(); });
}

function switchView(view) {
  // 관리자 페이지 보호
  if (view === 'admin' && !isAdmin()) { showToast('관리자만 접근 가능합니다.'); return; }

  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const viewEl = document.getElementById(`view-${view}`);
  const navEl  = document.getElementById(`nav-${view}`);
  if (viewEl) viewEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');
  document.getElementById('pageTitle').textContent = VIEW_TITLES[view] || view;
  document.getElementById('fabAddTask').style.display = view === 'today' ? '' : 'none';

  // 하단 탭바 active 업데이트
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  // 모바일: 뷰 전환 시 사이드바 닫기
  if (window.innerWidth <= 768) collapseSidebar();

  if (view === 'today')    { renderGoalSummaryBar(); renderTimeGrid(); updateDateLabel(); }
  if (view === 'goals')    renderGoals();
  if (view === 'calendar') { renderCalendar(); renderCalDayTasks(calSelectedDate); }
  if (view === 'alarm')    renderAlarmView();
  if (view === 'routine')  renderRoutineView();
  if (view === 'admin')    renderAdminView();
}

function collapseSidebar() {
  const sb = document.getElementById('sidebar');
  const main = document.getElementById('main');
  const topbar = document.getElementById('topbar');
  const overlay = document.getElementById('sidebarOverlay');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sb.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('show');
  } else {
    sb.classList.add('collapsed');
    main.classList.add('full');
    topbar.classList.add('full');
  }
}
function expandSidebar() {
  const sb = document.getElementById('sidebar');
  const main = document.getElementById('main');
  const topbar = document.getElementById('topbar');
  const overlay = document.getElementById('sidebarOverlay');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sb.classList.add('mobile-open');
    if (overlay) overlay.classList.add('show');
  } else {
    sb.classList.remove('collapsed');
    main.classList.remove('full');
    topbar.classList.remove('full');
  }
}

// ──────────────────────────────────────────────────────
//  CLOCK
// ──────────────────────────────────────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    const days = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
    document.getElementById('sidebarDate').textContent =
      `${now.getFullYear()}.${now.getMonth()+1}.${now.getDate()} ${days[now.getDay()]}`;
    document.getElementById('sidebarTime').textContent =
      `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ──────────────────────────────────────────────────────
//  STREAK
// ──────────────────────────────────────────────────────
function updateStreak() {
  const tasks = getTasks();
  const today = fmtDate(new Date());
  const todayTasks = tasks[today] || [];
  const allDone = todayTasks.length > 0 && todayTasks.every(t => t.done);
  const streak = getStreak();
  if (allDone && streak.lastDate !== today) {
    const yesterday = fmtDate(new Date(Date.now() - 86400000));
    streak.count = streak.lastDate === yesterday ? streak.count + 1 : 1;
    streak.lastDate = today;
    saveStreak(streak);
  }
  document.getElementById('streakCount').textContent = streak.count;
}

// ──────────────────────────────────────────────────────
//  TIME GRID (오늘 뷰)
// ──────────────────────────────────────────────────────
function setupTimeGrid() {
  updateDateLabel();
}

function updateDateLabel() {
  const d = activeDate;
  const label = `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 (${DOW_KO[d.getDay()]})`;
  document.getElementById('activeDateLabel').textContent = label;
}

function changeDay(delta) {
  activeDate = new Date(activeDate.getTime() + delta * 86400000);
  updateDateLabel();
  renderTimeGrid();
}

function getTasksForDate(date) {
  return (getTasks()[fmtDate(date)] || []);
}

function setTasksForDate(date, tasks) {
  const all = getTasks();
  all[fmtDate(date)] = tasks;
  saveTasks(all);
}

// 루틴 → 오늘 플랜 자동 등록 (이미 추가된 루틴은 중복 추가하지 않음)
function applyRoutinesToDay(date) {
  const routines = getRoutinesForDate(date);
  if (!routines.length) return;

  const tasks = getTasksForDate(date);
  const addedIds = new Set(tasks.filter(t => t.fromRoutine).map(t => t.fromRoutine));

  let changed = false;
  routines.forEach(r => {
    if (addedIds.has(r.id)) return; // 이미 추가됨
    tasks.push({
      id: uid(),
      title: r.title,
      startHour: r.startHour,
      startMinute: r.startMinute || 0,
      endHour: r.endHour,
      endMinute: r.endMinute || 0,
      category: 'personal',
      priority: 'medium',
      done: false,
      fromRoutine: r.id,
      color: r.color,
      note: r.note || ''
    });
    changed = true;
  });

  if (changed) setTasksForDate(date, tasks);
}

function renderTimeGrid() {
  // 루틴을 오늘 플랜에 자동 등록
  applyRoutinesToDay(activeDate);

  const grid = document.getElementById('timeGrid');
  grid.innerHTML = '';
  const tasks = getTasksForDate(activeDate);
  const routines = getRoutinesForDate(activeDate);
  const now = new Date();
  const isToday = fmtDate(activeDate) === fmtDate(now);

  HOURS.forEach(h => {
    const slot = document.createElement('div');
    slot.className = 'time-slot';
    if (isToday && now.getHours() === h) slot.classList.add('current-hour');

    const label = document.createElement('div');
    label.className = 'time-label';
    label.textContent = fmtHour(h);

    const content = document.createElement('div');
    content.className = 'time-slot-content';

    // 루틴 블록 (시작 시간에만)
    routines.filter(r => r.startHour === h).forEach(r => {
      const rb = document.createElement('div');
      rb.className = 'routine-block';
      rb.style.borderColor = r.color;
      rb.style.color = r.color;
      rb.innerHTML = `
        <div class="routine-block-dot" style="background:${r.color}"></div>
        <div class="routine-block-inner">
          <div class="routine-block-title">${escapeHtml(r.title)}</div>
          <div class="routine-block-time">${fmtTime(r.startHour, r.startMinute)} – ${fmtTime(r.endHour, r.endMinute)}</div>
        </div>
        <span class="routine-tag" style="border-color:${r.color}">루틴</span>`;
      rb.addEventListener('click', (e) => { e.stopPropagation(); openRoutineModal(r); });
      content.appendChild(rb);
    });

    // 이 시간대에 속한 tasks
    const slotTasks = tasks.filter(t => t.startHour <= h && t.endHour > h);
    slotTasks.forEach(task => {
      if (task.startHour === h) {
        content.appendChild(buildTaskBlock(task));
      }
    });

    slot.appendChild(label);
    slot.appendChild(content);

    // 빈 슬롯 클릭 → 추가
    slot.addEventListener('click', (e) => {
      if (e.target.closest('.task-block') || e.target.closest('.routine-block')) return;
      openTaskModal(null, h);
    });

    grid.appendChild(slot);
  });

  // 현재 시간으로 스크롤
  if (isToday) {
    setTimeout(() => {
      const curSlot = grid.querySelector('.current-hour');
      if (curSlot) curSlot.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
  }
}

function buildTaskBlock(task) {
  const block = document.createElement('div');
  block.className = `task-block${task.done ? ' done' : ''}`;
  block.dataset.id = task.id;
  block.dataset.priority = task.priority || 'medium';
  block.setAttribute('role', 'button');
  block.setAttribute('tabindex', '0');

  const catCol = CAT_COLORS[task.category] || CAT_COLORS.work;

  block.innerHTML = `
    <button class="task-check" title="${task.done ? '미완료로' : '완료로'} 표시">${task.done ? '✓' : ''}</button>
    <div class="task-info">
      <div class="task-text">${escapeHtml(task.title)}</div>
      <div class="task-meta">
        <span class="task-cat-badge" style="background:${catCol.bg};color:${catCol.text}">${CAT_LABELS[task.category] || '기타'}</span>
        <span class="task-time-badge">${fmtHourRange(task.startHour, task.endHour)}</span>
        <span class="task-priority">${PRI_LABELS[task.priority] || ''}</span>
      </div>
    </div>
    <div class="task-block-actions">
      <button class="task-action-btn edit-btn" title="수정">✏️</button>
      <button class="task-action-btn del-btn" title="삭제">🗑️</button>
    </div>`;

  // 체크
  block.querySelector('.task-check').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTask(task.id);
  });
  // 수정
  block.querySelector('.edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openTaskModal(task);
  });
  // 삭제
  block.querySelector('.del-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task.id);
  });
  // 블록 클릭
  block.addEventListener('click', () => openTaskModal(task));
  block.addEventListener('keydown', (e) => { if (e.key === 'Enter') openTaskModal(task); });

  return block;
}

function toggleTask(id) {
  const tasks = getTasksForDate(activeDate);
  const t = tasks.find(t => t.id === id);
  if (t) { t.done = !t.done; setTasksForDate(activeDate, tasks); renderTimeGrid(); updateStreak(); }
}

function deleteTask(id) {
  if (!confirm('이 할 일을 삭제할까요?')) return;
  const tasks = getTasksForDate(activeDate).filter(t => t.id !== id);
  setTasksForDate(activeDate, tasks);
  renderTimeGrid();
  showToast('할 일이 삭제되었습니다.');
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ──────────────────────────────────────────────────────
//  GOAL SUMMARY BAR
// ──────────────────────────────────────────────────────
function renderGoalSummaryBar() {
  const bar = document.getElementById('goalSummaryBar');
  const goals = getGoals();
  if (!goals.length) { bar.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">목표를 추가해보세요 →</span>'; return; }
  bar.innerHTML = goals.map(g => `
    <div class="goal-pill" title="${escapeHtml(g.title)}" onclick="switchView('goals')">
      <div class="goal-pill-dot" style="background:${g.color}"></div>
      <span>${escapeHtml(g.title)}</span>
      <span class="goal-pill-prog" style="color:${g.color}">${g.progress}%</span>
    </div>`).join('');
}

// ──────────────────────────────────────────────────────
//  GOALS VIEW
// ──────────────────────────────────────────────────────
function setupGoals() {
  document.getElementById('goalTabLong').addEventListener('click', () => switchGoalTab('long'));
  document.getElementById('goalTabShort').addEventListener('click', () => switchGoalTab('short'));
  document.getElementById('addLongGoal').addEventListener('click', () => openGoalModal(null, 'long'));
  document.getElementById('addShortGoal').addEventListener('click', () => openGoalModal(null, 'short'));
}

function switchGoalTab(type) {
  document.querySelectorAll('.goal-tab').forEach(t => t.classList.toggle('active', t.dataset.type === type));
  document.getElementById('panel-long').classList.toggle('active', type === 'long');
  document.getElementById('panel-short').classList.toggle('active', type === 'short');
}

function renderGoals() {
  const goals = getGoals();
  renderGoalList('long', goals.filter(g => g.type === 'long'), document.getElementById('longGoalsList'));
  renderGoalList('short', goals.filter(g => g.type === 'short'), document.getElementById('shortGoalsList'));
}

function renderGoalList(type, goals, container) {
  if (!goals.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${type==='long'?'🏆':'🎯'}</div><div class="empty-state-text">${type==='long'?'장기':'단기'} 목표를 추가해보세요</div></div>`;
    return;
  }
  container.innerHTML = '';
  goals.forEach(g => {
    const card = document.createElement('div');
    card.className = 'goal-card';
    card.style.setProperty('--goal-color', g.color);
    const du = daysUntil(g.deadline);
    const duStr = g.deadline ? (du < 0 ? `${Math.abs(du)}일 초과` : du === 0 ? '오늘 마감' : `D-${du}`) : '기한 없음';

    // 마일스톤
    const milestones = getMilestonesForGoal(g.id);
    let msHtml = '';
    if (milestones.length) {
      const done = milestones.filter(m => m.done).length;
      // 자동 진행률 계산
      g.progress = Math.round((done / milestones.length) * 100);
      const stepsHtml = milestones.map((m, i) => {
        const cls = m.done ? 'done' : (i === done ? 'active' : '');
        return `<div class="ms-step ${cls}" title="${escapeHtml(m.title)} (${m.targetDate})"></div>`;
      }).join('');
      msHtml = `<div class="goal-milestone-bar">
        <div class="goal-milestone-steps">${stepsHtml}</div>
        <div class="goal-milestone-label">📍 ${done}/${milestones.length} 단계 완료${milestones[done] ? ' · 다음: ' + escapeHtml(milestones[done].title) : ' ✅'}</div>
      </div>`;
    }

    card.innerHTML = `
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${g.color};border-radius:var(--radius) var(--radius) 0 0"></div>
      <div class="goal-card-header">
        <div class="goal-card-title">${escapeHtml(g.title)}</div>
        <span class="goal-badge goal-badge-${type}">${type==='long'?'장기':'단기'}</span>
      </div>
      ${g.desc ? `<div class="goal-card-desc">${escapeHtml(g.desc)}</div>` : ''}
      ${msHtml}
      <div class="goal-progress-bar"><div class="goal-progress-fill" style="width:${g.progress}%;background:${g.color}"></div></div>
      <div class="goal-footer">
        <span>⏳ ${duStr}</span>
        <span class="goal-progress-pct" style="color:${g.color}">${g.progress}% 달성</span>
      </div>`;

    card.addEventListener('click', () => openGoalModal(g, type));
    container.appendChild(card);
  });
}

// ──────────────────────────────────────────────────────
//  CALENDAR
// ──────────────────────────────────────────────────────
function setupCalendar() {
  document.getElementById('prevMonth').addEventListener('click', () => {
    calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById('calJumpToday').addEventListener('click', () => {
    calViewDate = new Date();
    calSelectedDate = new Date();
    renderCalendar();
    renderCalDayTasks(calSelectedDate);
  });
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';
  const y = calViewDate.getFullYear(), m = calViewDate.getMonth();
  document.getElementById('calMonthLabel').textContent = `${y}년 ${MONTHS_KO[m]}`;

  // 요일 헤더
  DOW_KO.forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const today = fmtDate(new Date());
  const selectedStr = fmtDate(calSelectedDate);
  const allTasks = getTasks();

  // 이전 달 빈칸
  for (let i = firstDay - 1; i >= 0; i--) {
    const el = document.createElement('div');
    el.className = 'cal-day other-month';
    const dn = document.createElement('div');
    dn.className = 'cal-day-num';
    dn.textContent = prevDays - i;
    el.appendChild(dn);
    grid.appendChild(el);
  }

  const allGoals = getGoals();
  const allMilestones = getMilestones();

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const el = document.createElement('div');
    el.className = 'cal-day';
    if (dateStr === today) el.classList.add('today');
    if (dateStr === selectedStr) el.classList.add('selected');

    const dn = document.createElement('div');
    dn.className = 'cal-day-num';
    dn.textContent = d;
    el.appendChild(dn);

    // 날짜별 항목 점(dots) 표시용 리스트 수집
    const dayTasks = allTasks[dateStr] || [];
    const dayGoals = allGoals.filter(g => g.deadline === dateStr);
    const dayMilestones = allMilestones.filter(m => m.targetDate === dateStr);
    const totalItemsCount = dayTasks.length + dayGoals.length + dayMilestones.length;

    if (totalItemsCount > 0) {
      const dots = document.createElement('div');
      dots.className = 'cal-day-dots';
      
      // 목표 마감일 표시 (깃발 또는 사각형 점)
      dayGoals.forEach(g => {
        const dot = document.createElement('div');
        dot.className = 'cal-dot';
        dot.style.background = g.color;
        dot.style.borderRadius = '2px'; // 목표는 사각형 모양으로 구분
        dot.title = `목표 마감: ${g.title}`;
        dots.appendChild(dot);
      });

      // 마일스톤 마감일 표시 (역삼각형/기둥 모양 또는 테두리가 있는 사각형)
      dayMilestones.forEach(m => {
        const goal = allGoals.find(g => g.id === m.goalId);
        const color = goal ? goal.color : 'var(--accent)';
        const dot = document.createElement('div');
        dot.className = 'cal-dot';
        dot.style.background = 'transparent';
        dot.style.border = `1.5px solid ${color}`;
        dot.style.borderRadius = '2px'; // 마일스톤은 테두리가 있는 사각형 모양으로 구분
        dot.title = `마일스톤: ${m.title}`;
        dots.appendChild(dot);
      });

      // 할 일 표시 (원형 점)
      const maxTasksToShow = 4 - dayGoals.length - dayMilestones.length;
      if (maxTasksToShow > 0) {
        dayTasks.slice(0, maxTasksToShow).forEach(t => {
          const dot = document.createElement('div');
          dot.className = 'cal-dot';
          const goal = t.goalId ? allGoals.find(g => g.id === t.goalId) : null;
          if (goal) dot.style.background = goal.color;
          else dot.style.background = 'var(--text-muted)';
          dots.appendChild(dot);
        });
      }
      
      el.appendChild(dots);
    }

    el.addEventListener('click', () => {
      calSelectedDate = parseDateStr(dateStr);
      renderCalendar();
      renderCalDayTasks(calSelectedDate);
    });
    grid.appendChild(el);
  }

  // 다음 달 빈칸
  const total = firstDay + daysInMonth;
  const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= remaining; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day other-month';
    const dn = document.createElement('div');
    dn.className = 'cal-day-num';
    dn.textContent = i;
    el.appendChild(dn);
    grid.appendChild(el);
  }
}

function renderCalDayTasks(date) {
  const dateStr = fmtDate(date);
  const tasks = (getTasks()[dateStr] || []);
  const goals = getGoals().filter(g => g.deadline === dateStr);
  const milestones = getMilestones().filter(m => m.targetDate === dateStr);
  const totalCount = tasks.length + goals.length + milestones.length;
  
  const title = `${date.getMonth()+1}월 ${date.getDate()}일 (${DOW_KO[date.getDay()]}) – 총 ${totalCount}개 항목`;
  document.getElementById('calDayTitle').textContent = title;
  const list = document.getElementById('calTaskList');
  
  if (totalCount === 0) {
    list.innerHTML = '<li class="cal-empty">이 날의 일정이나 목표/마일스톤 마감일이 없습니다</li>';
    return;
  }
  
  let html = '';
  
  // 1. 마일스톤 완료 예정일 목록 렌더링 (목표 마감일보다 상세한 내용이므로 가장 먼저 표기)
  if (milestones.length > 0) {
    html += milestones.map(m => {
      const goal = getGoals().find(g => g.id === m.goalId);
      const color = goal ? goal.color : 'var(--accent)';
      const goalTitle = goal ? goal.title : '연결된 목표 없음';
      return `
        <li class="cal-task-item" style="border-left: 4px dashed ${color}; background: rgba(255,255,255,0.02)">
          <span class="cal-task-time" style="color:${color}; font-weight:bold">📍 마일스톤</span>
          <div style="display:flex; flex-direction:column; gap:2px">
            <span style="font-weight:600">${escapeHtml(m.title)}</span>
            <span style="font-size:10px; color:var(--text-muted)">소속 목표: ${escapeHtml(goalTitle)}</span>
          </div>
          ${m.done ? '<span style="margin-left:auto;color:var(--green);font-size:11px">✓ 완료</span>' : '<span style="margin-left:auto;color:var(--text-muted);font-size:11px">진행중</span>'}
        </li>
      `;
    }).join('');
  }
  
  // 2. 목표 마감일 목록 렌더링
  if (goals.length > 0) {
    html += goals.map(g => `
      <li class="cal-task-item" style="border-left: 4px solid ${g.color}; background: rgba(255,255,255,0.03)">
        <span class="cal-task-time" style="color:${g.color}; font-weight:bold">${g.type === 'long' ? '🏆 장기목표' : '🎯 단기목표'}</span>
        <span style="font-weight:600">${escapeHtml(g.title)} 마감일</span>
        <span style="margin-left:auto; background: ${g.color}22; color:${g.color}; font-size:10px; padding:2px 6px; border-radius:10px">${g.progress}% 진행</span>
      </li>
    `).join('');
  }
  
  // 3. 오늘 할 일 목록 렌더링
  if (tasks.length > 0) {
    html += tasks.map(t => {
      const linkedGoal = t.goalId ? getGoals().find(g => g.id === t.goalId) : null;
      const goalColor = linkedGoal ? linkedGoal.color : 'var(--text-muted)';
      return `
        <li class="cal-task-item ${t.done ? 'done' : ''}">
          <span class="cal-task-time" style="color: ${goalColor}">${fmtHour(t.startHour)}</span>
          <span>${escapeHtml(t.title)}</span>
          ${t.done ? '<span style="margin-left:auto;color:var(--green);font-size:11px">✓ 완료</span>' : '<span style="margin-left:auto;color:var(--text-muted);font-size:11px">미완료</span>'}
        </li>
      `;
    }).join('');
  }
  
  list.innerHTML = html;
}

// ──────────────────────────────────────────────────────
//  ALARM
// ──────────────────────────────────────────────────────
function setupAlarm() {
  document.getElementById('saveAlarm').addEventListener('click', saveAlarmSettings);
  document.getElementById('closeAlarmNotif').addEventListener('click', closeAlarmNotif);
  document.getElementById('notifBtn').addEventListener('click', requestNotifPermission);

  // 알람 enabled 토글 변경 시 즉시 저장
  document.getElementById('alarmEnabled').addEventListener('change', () => {
    saveAlarmSettings();
    renderAlarmView();
  });

  // 알림 권한 상태 표시
  updateNotifBtnState();
}

function updateNotifBtnState() {
  const btn = document.getElementById('notifBtn');
  if ('Notification' in window && Notification.permission === 'granted') {
    btn.classList.add('granted');
    btn.title = '알림 허용됨 ✓';
  }
}

function requestNotifPermission() {
  if (!('Notification' in window)) { showToast('이 브라우저는 알림을 지원하지 않습니다.'); return; }
  if (Notification.permission === 'granted') { showToast('이미 알림이 허용되어 있습니다 ✓'); return; }
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') { updateNotifBtnState(); showToast('알림이 허용되었습니다 🔔'); }
    else { showToast('알림이 차단되었습니다. 브라우저 설정에서 변경하세요.'); }
  });
}

function renderAlarmView() {
  const setting = getAlarmSetting();
  document.getElementById('alarmEnabled').checked = setting.enabled;
  document.getElementById('alarmTime').value = setting.time;

  // 목표 미리보기
  const goals = getGoals();
  const listEl = document.getElementById('alarmGoalsList');
  if (!goals.length) {
    listEl.innerHTML = '<li class="alarm-goals-empty">목표가 없습니다. 목표를 먼저 추가하세요.</li>';
  } else {
    listEl.innerHTML = goals.map(g => `
      <li>
        <div class="alarm-goal-dot" style="background:${g.color}"></div>
        <span>${escapeHtml(g.title)}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">${g.progress}%</span>
      </li>`).join('');
  }

  // 알람 내역
  const hist = getAlarmHistory();
  const histEl = document.getElementById('alarmHistoryList');
  if (!hist.length) {
    histEl.innerHTML = '<li class="alarm-history-empty">알람 내역이 없습니다</li>';
  } else {
    histEl.innerHTML = hist.slice(-10).reverse().map(h => `
      <li class="alarm-history-item">
        <span>⏰</span>
        <span>${h.msg}</span>
        <span class="alarm-history-time" style="margin-left:auto">${h.time}</span>
      </li>`).join('');
  }
}

function saveAlarmSettings() {
  const enabled = document.getElementById('alarmEnabled').checked;
  const time = document.getElementById('alarmTime').value;
  saveAlarmSetting({ enabled, time });
  scheduleAlarmCheck();
  showToast(`알람이 저장되었습니다. (${enabled ? `매일 ${time}` : '비활성화'})`);
}

let alarmIntervalId = null;
function clearAlarmTimer() { if (alarmIntervalId) { clearInterval(alarmIntervalId); alarmIntervalId = null; } }

function scheduleAlarmCheck() {
  clearAlarmTimer();
  alarmIntervalId = setInterval(checkAlarm, 30000); // 30초마다 체크
}

function checkAlarmOnLoad() {
  // 로드 시점에 알람 확인 (오늘 이미 보낸 적 없으면 팝업)
  checkAlarm(true);
}

function checkAlarm(onLoad = false) {
  const setting = getAlarmSetting();
  if (!setting.enabled) return;

  const now = new Date();
  const [ah, am] = setting.time.split(':').map(Number);
  const isAlarmTime = now.getHours() === ah && now.getMinutes() === am;
  const todayKey = fmtDate(now);
  const lastFiredKey = userDataKey('alarm_last_fired');
  const lastFired = loadData(lastFiredKey, '');

  // 같은 날 이미 알람 발생했으면 스킵 (로드시엔 오늘 안 보냈으면 보여줌)
  if (onLoad) {
    const alarmHour = ah;
    const nowHour = now.getHours();
    // 알람 시간이 지났고 오늘 안 보냈으면 팝업
    if (lastFired === todayKey) return;
    if (nowHour < alarmHour) return;
    // 알람 시간이 지난 경우
    triggerAlarmPopup(setting);
    saveData(lastFiredKey, todayKey);
    return;
  }

  if (!isAlarmTime) return;
  if (lastFired === todayKey) return;

  triggerAlarmPopup(setting);
  saveData(lastFiredKey, todayKey);
}

function triggerAlarmPopup(setting) {
  const goals = getGoals();
  const notifGoals = document.getElementById('alarmNotifGoals');
  notifGoals.innerHTML = goals.slice(0, 5).map(g =>
    `<li><span style="color:${g.color}">●</span> ${escapeHtml(g.title)} <span style="opacity:0.6">(${g.progress}%)</span></li>`
  ).join('');

  document.getElementById('alarmNotif').classList.add('show');

  // 시스템 알림 (권한 있을 경우)
  if ('Notification' in window && Notification.permission === 'granted') {
    const topGoals = goals.slice(0, 3).map(g => `• ${g.title}`).join('\n');
    new Notification('🔔 알람 – MyPlanner', {
      body: `오늘도 목표를 향해!\n${topGoals}`,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎯</text></svg>',
    });
  }

  // 내역 저장
  const hist = getAlarmHistory();
  hist.push({ time: new Date().toLocaleString('ko-KR'), msg: `${setting.time} 알람 발생` });
  if (hist.length > 30) hist.shift();
  saveAlarmHistory(hist);

  // 5분 후 자동 닫기
  setTimeout(closeAlarmNotif, 300000);
}

function closeAlarmNotif() {
  document.getElementById('alarmNotif').classList.remove('show');
}

// ──────────────────────────────────────────────────────
//  MOBILE TABBAR
// ──────────────────────────────────────────────────────
function setupMobileTabbar() {
  // 하단 탭 클릭
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // 오버레이 클릭 시 사이드바 닫기
  const overlay = document.getElementById('sidebarOverlay');
  if (overlay) overlay.addEventListener('click', collapseSidebar);
}

// ──────────────────────────────────────────────────────
//  FAB
// ──────────────────────────────────────────────────────
function setupFAB() {
  document.getElementById('fabAddTask').addEventListener('click', () => openTaskModal(null));
}

// ──────────────────────────────────────────────────────
//  TASK MODAL
// ──────────────────────────────────────────────────────
function setupModals() {
  // Task Modal
  document.getElementById('closeTaskModal').addEventListener('click', closeTaskModal);
  document.getElementById('taskModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeTaskModal(); });
  document.getElementById('saveTaskBtn').addEventListener('click', saveTask);
  document.getElementById('deleteTaskBtn').addEventListener('click', () => {
    if (!editingTaskId) return;
    if (!confirm('이 할 일을 삭제할까요?')) return;
    deleteTask(editingTaskId);
    closeTaskModal();
  });

  // Category chips
  document.getElementById('categoryChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#categoryChips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });

  // Priority chips
  document.getElementById('priorityChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#priorityChips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });

  // Hour selectors
  const startSel = document.getElementById('taskStartHour');
  const endSel = document.getElementById('taskEndHour');
  HOURS.forEach(h => {
    const o1 = new Option(fmtHour(h), h);
    const o2 = new Option(fmtHour(h), h);
    startSel.add(o1);
    endSel.add(o2);
  });
  startSel.addEventListener('change', () => {
    if (parseInt(endSel.value) <= parseInt(startSel.value)) {
      endSel.value = Math.min(parseInt(startSel.value)+1, 23);
    }
  });

  // Goal Modal
  document.getElementById('closeGoalModal').addEventListener('click', closeGoalModal);
  document.getElementById('cancelGoalBtn').addEventListener('click', closeGoalModal);
  document.getElementById('saveGoalBtn').addEventListener('click', saveGoal);
  document.getElementById('deleteGoalBtn').addEventListener('click', () => {
    if (!editingGoalId) return;
    if (!confirm('이 목표를 삭제할까요?')) return;
    const goals = getGoals().filter(g => g.id !== editingGoalId);
    saveGoals(goals);
    closeGoalModal();
    renderGoals();
    renderGoalSummaryBar();
    showToast('목표가 삭제되었습니다.');
  });

  // Color swatches
  document.getElementById('colorSwatches').addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
  });

  // Progress range
  document.getElementById('goalProgress').addEventListener('input', (e) => {
    document.getElementById('goalProgressVal').textContent = `${e.target.value}%`;
  });

  // ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeTaskModal(); closeGoalModal(); }
  });
}

function openTaskModal(task, defaultHour = null) {
  editingTaskId = task ? task.id : null;
  const modal = document.getElementById('taskModal');
  document.getElementById('taskModalTitle').textContent = task ? '할 일 수정' : '할 일 추가';
  document.getElementById('deleteTaskBtn').style.display = task ? '' : 'none';

  // 값 채우기
  document.getElementById('taskTitle').value = task ? task.title : '';
  document.getElementById('taskNote').value = task ? (task.note || '') : '';

  // Category
  const cat = task ? task.category : 'work';
  document.querySelectorAll('#categoryChips .chip').forEach(c => c.classList.toggle('active', c.dataset.cat === cat));

  // Priority
  const pri = task ? task.priority : 'medium';
  document.querySelectorAll('#priorityChips .chip').forEach(c => c.classList.toggle('active', c.dataset.pri === pri));

  // Hour
  const startH = task ? task.startHour : (defaultHour ?? new Date().getHours());
  const endH   = task ? task.endHour   : Math.min(startH + 1, 23);
  document.getElementById('taskStartHour').value = startH;
  document.getElementById('taskEndHour').value   = endH;

  // Goal link
  const goalSel = document.getElementById('taskGoalLink');
  goalSel.innerHTML = '<option value="">목표 없음</option>';
  getGoals().forEach(g => {
    const o = new Option(`${g.type === 'long' ? '🏆' : '🎯'} ${g.title}`, g.id);
    if (task && task.goalId === g.id) o.selected = true;
    goalSel.add(o);
  });

  modal.classList.add('open');
  document.getElementById('taskTitle').focus();
}

function closeTaskModal() {
  document.getElementById('taskModal').classList.remove('open');
  editingTaskId = null;
}

function saveTask() {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { showToast('제목을 입력하세요!'); document.getElementById('taskTitle').focus(); return; }

  const category = document.querySelector('#categoryChips .chip.active')?.dataset.cat || 'work';
  const priority  = document.querySelector('#priorityChips .chip.active')?.dataset.pri  || 'medium';
  const startHour = parseInt(document.getElementById('taskStartHour').value);
  const endHour   = parseInt(document.getElementById('taskEndHour').value);
  const goalId    = document.getElementById('taskGoalLink').value;
  const note      = document.getElementById('taskNote').value.trim();

  if (endHour <= startHour) { showToast('종료 시간은 시작 시간보다 이후여야 합니다.'); return; }

  const tasks = getTasksForDate(activeDate);

  if (editingTaskId) {
    const idx = tasks.findIndex(t => t.id === editingTaskId);
    if (idx !== -1) tasks[idx] = { ...tasks[idx], title, category, priority, startHour, endHour, goalId, note };
  } else {
    tasks.push({ id: uid(), title, category, priority, startHour, endHour, goalId, note, done: false });
  }

  setTasksForDate(activeDate, tasks);
  closeTaskModal();
  renderTimeGrid();
  renderGoalSummaryBar();
  showToast(editingTaskId ? '할 일이 수정되었습니다.' : '할 일이 추가되었습니다! 🎉');
}

// ──────────────────────────────────────────────────────
//  GOAL MODAL
// ──────────────────────────────────────────────────────
function openGoalModal(goal, type) {
  editingGoalId = goal ? goal.id : null;
  editingGoalType = type;

  document.getElementById('goalModalTitle').textContent = goal ? '목표 수정' : '목표 추가';
  document.getElementById('deleteGoalBtn').style.display = goal ? '' : 'none';
  document.getElementById('goalTitle').value = goal ? goal.title : '';
  document.getElementById('goalDesc').value  = goal ? goal.desc  : '';
  document.getElementById('goalDeadline').value = goal ? goal.deadline : '';
  document.getElementById('goalProgress').value = goal ? goal.progress : 0;
  document.getElementById('goalProgressVal').textContent = `${goal ? goal.progress : 0}%`;

  // 색상 스와치 (목표 모달 전용, routine swatches 제외)
  const targetColor = goal ? goal.color : '#7c6ffd';
  document.querySelectorAll('#colorSwatches .swatch').forEach(s => s.classList.toggle('active', s.dataset.color === targetColor));

  // 마일스톤 로드
  tempMilestones = goal ? [...getMilestonesForGoal(goal.id)] : [];
  renderMilestoneList(); // 렬더링 + 진행률 동기화 포함

  document.getElementById('goalModal').classList.add('open');
  document.getElementById('goalTitle').focus();
}

function closeGoalModal() {
  document.getElementById('goalModal').classList.remove('open');
  editingGoalId = null;
}

function saveGoal() {
  const title = document.getElementById('goalTitle').value.trim();
  if (!title) { showToast('목표 제목을 입력하세요!'); document.getElementById('goalTitle').focus(); return; }

  const desc     = document.getElementById('goalDesc').value.trim();
  const deadline = document.getElementById('goalDeadline').value;
  const color    = document.querySelector('#colorSwatches .swatch.active')?.dataset.color || '#7c6ffd';
  const progress = parseInt(document.getElementById('goalProgress').value);

  const goals = getGoals();
  let savedGoalId;
  if (editingGoalId) {
    const idx = goals.findIndex(g => g.id === editingGoalId);
    if (idx !== -1) goals[idx] = { ...goals[idx], title, desc, deadline, color, progress };
    savedGoalId = editingGoalId;
  } else {
    savedGoalId = uid();
    goals.push({ id: savedGoalId, type: editingGoalType, title, desc, deadline, color, progress });
  }
  saveGoals(goals);

  // 마일스톤 저장
  const otherMilestones = getMilestones().filter(m => m.goalId !== (editingGoalId || ''));
  const withGoalId = tempMilestones.map((m, i) => ({ ...m, goalId: savedGoalId, order: i }));
  saveMilestones([...otherMilestones, ...withGoalId]);

  closeGoalModal();
  renderGoals();
  renderGoalSummaryBar();
  showToast(editingGoalId ? '목표가 수정되었습니다.' : '목표가 추가되었습니다! 🏆');
}

// ──────────────────────────────────────────────────────
//  MILESTONE
// ──────────────────────────────────────────────────────
let tempMilestones = []; // 목표 모달 열려있는 동안 임시 리스트

// 마일스톤 완료 개수 → 진행률 슬라이더 실시간 동기화
function syncProgressFromMilestones() {
  const progressInput = document.getElementById('goalProgress');
  const progressVal   = document.getElementById('goalProgressVal');
  const progressRow   = progressInput?.closest('.progress-input-row');
  if (!progressInput) return;

  if (tempMilestones.length) {
    const doneCount  = tempMilestones.filter(m => m.done).length;
    const autoValue  = Math.round((doneCount / tempMilestones.length) * 100);
    progressInput.value = autoValue;
    if (progressVal) progressVal.textContent = `${autoValue}%`;
    progressInput.disabled = true;
    if (progressRow) {
      progressRow.title = '마일스톤으로 자동 계산됩니다';
      progressRow.style.opacity = '0.6';
    }
  } else {
    progressInput.disabled = false;
    if (progressRow) { progressRow.title = ''; progressRow.style.opacity = ''; }
  }
}

function renderMilestoneList() {
  const container = document.getElementById('milestoneItems');
  if (!container) return;

  syncProgressFromMilestones();

  if (!tempMilestones.length) {
    container.innerHTML = '<div class="milestone-empty">마일스톤이 없습니다. 자동 생성하거나 직접 추가하세요.</div>';
    return;
  }

  container.innerHTML = '';
  const total = tempMilestones.length;
  const doneCount = tempMilestones.filter(m => m.done).length;

  tempMilestones.forEach((m, i) => {
    const item = document.createElement('div');
    item.className = 'milestone-item';
    item.innerHTML = `
      <button class="milestone-check ${m.done ? 'done' : ''}" data-id="${m.id}">${m.done ? '✓' : ''}</button>
      <input class="milestone-title-input ${m.done ? 'ms-done-text' : ''}" value="${escapeHtml(m.title)}" data-id="${m.id}" placeholder="${i+1}단계 내용" />
      <input type="date" class="milestone-date-input" value="${m.targetDate}" data-id="${m.id}" />
      <button class="milestone-del-btn" data-id="${m.id}" title="삭제">✕</button>`;

    // 체크 토글 → 진행률 즉시 반영
    item.querySelector('.milestone-check').addEventListener('click', () => {
      const ms = tempMilestones.find(x => x.id === m.id);
      if (ms) { ms.done = !ms.done; renderMilestoneList(); }
    });
    // 제목 편집
    item.querySelector('.milestone-title-input').addEventListener('input', (e) => {
      const ms = tempMilestones.find(x => x.id === m.id);
      if (ms) ms.title = e.target.value;
    });
    // 날짜 편집
    item.querySelector('.milestone-date-input').addEventListener('change', (e) => {
      const ms = tempMilestones.find(x => x.id === m.id);
      if (ms) ms.targetDate = e.target.value;
    });
    // 삭제 → 진행률 재계산
    item.querySelector('.milestone-del-btn').addEventListener('click', () => {
      tempMilestones = tempMilestones.filter(x => x.id !== m.id);
      renderMilestoneList();
    });
    container.appendChild(item);
  });
}

function autoGenerateMilestones() {
  const deadline = document.getElementById('goalDeadline').value;
  if (!deadline) { showToast('마감일을 먼저 설정하세요.'); return; }
  const numStr = prompt('몇 단계로 나눠질까요?', '4');
  if (!numStr) return;
  const num = Math.max(1, Math.min(20, parseInt(numStr) || 4));
  const today = new Date();
  const end = new Date(deadline + 'T00:00:00');
  const totalDays = Math.ceil((end - today) / 86400000);
  if (totalDays <= 0) { showToast('마감일이 오늘보다 이후여야 합니다.'); return; }
  const stepDays = totalDays / num;
  const goalId = editingGoalId || '_new_';
  tempMilestones = Array.from({ length: num }, (_, i) => {
    const d = new Date(today.getTime() + stepDays * (i + 1) * 86400000);
    const actual = d > end ? end : d;
    return { id: uid(), goalId, title: `${i+1}단계`, targetDate: fmtDate(actual), done: false, order: i };
  });
  renderMilestoneList(); // 자동으로 진행률 0%로 리셋
  showToast(`✅ ${num}개 마일스톤 생성 완료! (단계를 체크하면 자동으로 진행률 업게이트됩니다)`);
}

function addNewMilestone() {
  const goalId = editingGoalId || '_new_';
  const today = fmtDate(new Date());
  tempMilestones.push({ id: uid(), goalId, title: `${tempMilestones.length + 1}단계`, targetDate: today, done: false, order: tempMilestones.length });
  renderMilestoneList(); // 진행률 재계산 포함
}

// ──────────────────────────────────────────────────────
//  ROUTINE
// ──────────────────────────────────────────────────────
let editingRoutineId = null;

function setupRoutine() {
  document.getElementById('addRoutineBtn')?.addEventListener('click', () => openRoutineModal(null));
  document.getElementById('closeRoutineModal')?.addEventListener('click', closeRoutineModal);
  document.getElementById('routineModal')?.addEventListener('click', (e) => { if (e.target.id === 'routineModal') closeRoutineModal(); });
  document.getElementById('saveRoutineBtn')?.addEventListener('click', saveRoutineData);
  document.getElementById('deleteRoutineBtn')?.addEventListener('click', deleteRoutineData);

  // 요일 토글
  document.getElementById('routineDaySel')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.day-btn');
    if (btn) btn.classList.toggle('active');
  });

  // 색상 swatches
  document.getElementById('routineColorSwatches')?.addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    document.querySelectorAll('#routineColorSwatches .swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
  });
  // 시간/분 select 초기화
  const rStart    = document.getElementById('routineStartHour');
  const rEnd      = document.getElementById('routineEndHour');
  const rStartMin = document.getElementById('routineStartMin');
  const rEndMin   = document.getElementById('routineEndMin');
  const MINUTES   = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,10,...,55

  if (rStart && rEnd) {
    HOURS.forEach(h => {
      rStart.add(new Option(String(h).padStart(2, '0'), h));
      rEnd.add(new Option(String(h).padStart(2, '0'), h));
    });
    rStart.value = 9;
    rEnd.value   = 10;

    // 시작 시/분 변경 시 종료가 시작보다 늦은지 검사
    const enforceEndAfterStart = () => {
      const startTotal = parseInt(rStart.value) * 60 + parseInt(rStartMin?.value || 0);
      const endTotal   = parseInt(rEnd.value)   * 60 + parseInt(rEndMin?.value   || 0);
      if (endTotal <= startTotal) {
        const newEnd = startTotal + 30;
        rEnd.value    = Math.min(Math.floor(newEnd / 60), 23);
        if (rEndMin) rEndMin.value = newEnd % 60 < 60 ? (newEnd % 60) - (newEnd % 5) : 0;
      }
    };
    rStart.addEventListener('change', enforceEndAfterStart);
    if (rStartMin) rStartMin.addEventListener('change', enforceEndAfterStart);
  }

  if (rStartMin && rEndMin) {
    MINUTES.forEach(m => {
      rStartMin.add(new Option(String(m).padStart(2, '0'), m));
      rEndMin.add(new Option(String(m).padStart(2, '0'), m));
    });
    rStartMin.value = 0;
    rEndMin.value   = 0;
  }
  // 마일스톤 버튼
  document.getElementById('autoGenMilestone')?.addEventListener('click', autoGenerateMilestones);
  document.getElementById('addMilestoneBtn')?.addEventListener('click', addNewMilestone);
}

function renderRoutineView() {
  const routines = getRoutines();
  const list = document.getElementById('routineList');
  if (!list) return;
  const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
  if (!routines.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔄</div><div class="empty-state-text">루틴을 추가해보세요<br>매일 반복되는 일정을 오늘 타임 그리드에 자동 표시합니다</div></div>`;
    return;
  }
  list.innerHTML = '';
  routines.forEach(r => {
    const dayStr = [...r.days].sort((a,b)=>a-b).map(d => DAY_LABELS[d]).join(' ');
    const card = document.createElement('div');
    card.className = 'routine-card';
    card.innerHTML = `
      <div class="routine-card-stripe" style="background:${r.color}"></div>
      <div class="routine-card-body">
        <div class="routine-card-title">${escapeHtml(r.title)}</div>
        <div class="routine-card-meta">
          <span class="routine-time-badge">${fmtTime(r.startHour, r.startMinute)} – ${fmtTime(r.endHour, r.endMinute)}</span>
          <span class="routine-days-badge">${dayStr}</span>
        </div>
        ${r.note ? `<div class="routine-note-text">${escapeHtml(r.note)}</div>` : ''}
      </div>
      <div class="routine-card-actions">
        <button class="task-action-btn edit-btn" title="수정">✏️</button>
        <button class="task-action-btn del-btn" title="삭제">🗑️</button>
      </div>`;
    card.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); openRoutineModal(r); });
    card.querySelector('.del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`루틴 "${r.title}"을 삭제할까요?`)) return;
      saveRoutines(getRoutines().filter(x => x.id !== r.id));
      renderRoutineView();
      if (currentView === 'today') renderTimeGrid();
      showToast('루틴이 삭제되었습니다.');
    });
    card.addEventListener('click', (e) => { if (!e.target.closest('.task-action-btn')) openRoutineModal(r); });
    list.appendChild(card);
  });
}

function openRoutineModal(routine) {
  editingRoutineId = routine ? routine.id : null;
  document.getElementById('routineModalTitle').textContent = routine ? '루틴 수정' : '루틴 추가';
  document.getElementById('deleteRoutineBtn').style.display = routine ? '' : 'none';
  document.getElementById('routineTitle').value = routine ? routine.title : '';
  document.getElementById('routineNote').value  = routine ? (routine.note || '') : '';

  const sH = routine ? routine.startHour   : 9;
  const sM = routine ? (routine.startMinute ?? 0) : 0;
  const eH = routine ? routine.endHour     : 10;
  const eM = routine ? (routine.endMinute  ?? 0) : 0;
  document.getElementById('routineStartHour').value = sH;
  document.getElementById('routineStartMin').value  = sM;
  document.getElementById('routineEndHour').value   = eH;
  document.getElementById('routineEndMin').value    = eM;

  const days = routine ? routine.days : [1,2,3,4,5];
  document.querySelectorAll('.day-btn').forEach(btn => btn.classList.toggle('active', days.includes(parseInt(btn.dataset.day))));



  const color = routine ? routine.color : '#7c6ffd';
  document.querySelectorAll('#routineColorSwatches .swatch').forEach(s => s.classList.toggle('active', s.dataset.color === color));

  document.getElementById('routineModal').classList.add('open');
  document.getElementById('routineTitle').focus();
}

function closeRoutineModal() {
  document.getElementById('routineModal').classList.remove('open');
  editingRoutineId = null;
}

function saveRoutineData() {
  const title = document.getElementById('routineTitle').value.trim();
  if (!title) { showToast('루틴 이름을 입력하세요!'); return; }
  const startHour   = parseInt(document.getElementById('routineStartHour').value);
  const startMinute = parseInt(document.getElementById('routineStartMin').value);
  const endHour     = parseInt(document.getElementById('routineEndHour').value);
  const endMinute   = parseInt(document.getElementById('routineEndMin').value);
  const startTotal  = startHour * 60 + startMinute;
  const endTotal    = endHour   * 60 + endMinute;
  if (endTotal <= startTotal) { showToast('종료 시간은 시작 시간보다 이후여야 합니다.'); return; }
  const days = [...document.querySelectorAll('.day-btn.active')].map(b => parseInt(b.dataset.day));
  if (!days.length) { showToast('최소 1개 요일을 선택하세요!'); return; }
  const color    = document.querySelector('#routineColorSwatches .swatch.active')?.dataset.color || '#7c6ffd';
  const note     = document.getElementById('routineNote').value.trim();
  const routines = getRoutines();
  const data     = { title, startHour, startMinute, endHour, endMinute, days, color, note };
  if (editingRoutineId) {
    const idx = routines.findIndex(r => r.id === editingRoutineId);
    if (idx !== -1) routines[idx] = { ...routines[idx], ...data };
  } else {
    routines.push({ id: uid(), ...data });
  }
  saveRoutines(routines);

  // 오늘 플랜에 자동 추가된 항목 동기화 (수정된 경우)
  if (editingRoutineId) {
    const todayTasks = getTasksForDate(activeDate);
    const updated = todayTasks.map(t => {
      if (t.fromRoutine !== editingRoutineId) return t;
      return { ...t, title: data.title, startHour: data.startHour, startMinute: data.startMinute,
               endHour: data.endHour, endMinute: data.endMinute, color: data.color, note: data.note };
    });
    setTasksForDate(activeDate, updated);
  }

  closeRoutineModal();
  renderRoutineView();
  if (currentView === 'today') renderTimeGrid();
  showToast(editingRoutineId ? '루틴이 수정되었습니다.' : '루틴이 추가되었습니다! 🔄');
}

function deleteRoutineData() {
  if (!editingRoutineId) return;
  if (!confirm('이 루틴을 삭제할까요?')) return;
  saveRoutines(getRoutines().filter(r => r.id !== editingRoutineId));

  // 오늘 플랜에서 자동 추가된 미완료 항목 제거
  const todayTasks = getTasksForDate(activeDate);
  setTasksForDate(activeDate, todayTasks.filter(t => !(t.fromRoutine === editingRoutineId && !t.done)));

  closeRoutineModal();
  renderRoutineView();
  if (currentView === 'today') renderTimeGrid();
  showToast('루틴이 삭제되었습니다.');
}

// ──────────────────────────────────────────────────────
//  ADMIN PANEL
// ──────────────────────────────────────────────────────
function renderAdminView() {
  if (!isAdmin()) return;

  const users   = getUsers();
  const codes   = getInviteCodes();
  const userArr = Object.values(users).filter(u => u.id !== 'admin');

  const panel = document.getElementById('view-admin');
  panel.innerHTML = `
    <!-- 통계 카드 -->
    <div class="admin-stats">
      <div class="admin-stat-card">
        <div class="admin-stat-icon">👥</div>
        <div class="admin-stat-num">${userArr.length}</div>
        <div class="admin-stat-label">전체 사용자</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-icon">🎫</div>
        <div class="admin-stat-num">${codes.length}</div>
        <div class="admin-stat-label">초대 코드</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-icon">✅</div>
        <div class="admin-stat-num">${codes.reduce((s,c)=>s+c.usedBy.length,0)}</div>
        <div class="admin-stat-label">코드 사용 횟수</div>
      </div>
    </div>

    <!-- 초대 코드 관리 -->
    <div class="admin-section">
      <div class="admin-section-header">
        <h3>🎫 초대 코드 관리</h3>
        <button class="admin-btn-add" id="addCodeBtn">+ 새 코드 생성</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>코드</th><th>설명</th><th>사용 / 한도</th><th>사용자</th><th>액션</th></tr></thead>
          <tbody id="codeTableBody"></tbody>
        </table>
      </div>
    </div>

    <!-- 전체 초기화 -->
    <div class="admin-section">
      <div class="admin-section-header">
        <h3>⚠️ 데이터 초기화</h3>
        <button class="admin-btn-del" id="deleteAllUsersBtn" style="background:rgba(244,63,94,0.15);color:#f43f5e;border:1px solid rgba(244,63,94,0.3);padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">🗑️ 관리자 제외 전체 삭제</button>
      </div>
    </div>

    <!-- 사용자 목록 -->
    <div class="admin-section">
      <div class="admin-section-header">
        <h3>👥 사용자 목록</h3>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>아이디</th><th>이름</th><th>초대코드</th><th>가입일</th><th>액션</th></tr></thead>
          <tbody id="userTableBody"></tbody>
        </table>
      </div>
    </div>
  `;

  // 초대 코드 테이블
  const codeBody = document.getElementById('codeTableBody');
  codes.forEach((c, idx) => {
    const bar = Math.round((c.usedBy.length / c.maxUses) * 100);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code class="admin-code-chip">${c.code}</code>
          <button class="admin-copy-btn" title="복사" data-code="${c.code}">📋</button></td>
      <td>${escapeHtml(c.label)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="admin-mini-bar"><div class="admin-mini-fill" style="width:${bar}%"></div></div>
          <span style="font-size:12px;color:var(--text-secondary)">${c.usedBy.length} / ${c.maxUses}</span>
        </div>
      </td>
      <td style="font-size:12px;color:var(--text-muted)">${c.usedBy.join(', ') || '없음'}</td>
      <td><button class="admin-del-btn" data-idx="${idx}" title="삭제">🗑️</button></td>`;
    codeBody.appendChild(tr);
  });

  // 사용자 테이블
  const userBody = document.getElementById('userTableBody');
  userArr.forEach(u => {
    const tr = document.createElement('tr');
    const joined = u.joinedAt ? new Date(u.joinedAt).toLocaleDateString('ko-KR') : '–';
    tr.innerHTML = `
      <td><span class="admin-avatar-sm">${u.name?.[0]?.toUpperCase()||'U'}</span> ${escapeHtml(u.id)}</td>
      <td>${escapeHtml(u.name)}</td>
      <td><code class="admin-code-chip sm">${u.inviteCode || '–'}</code></td>
      <td style="font-size:12px;color:var(--text-muted)">${joined}</td>
      <td><button class="admin-del-user-btn admin-del-btn" data-uid="${u.id}" title="삭제">🗑️</button></td>`;
    userBody.appendChild(tr);
  });

  // 전체 사용자 삭제 버튼
  document.getElementById('deleteAllUsersBtn').addEventListener('click', deleteAllNonAdminUsers);

  // 이벤트
  document.getElementById('addCodeBtn').addEventListener('click', openAddCodeModal);
  document.querySelectorAll('.admin-del-btn[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      if (!confirm(`코드 "${codes[idx].code}"를 삭제할까요?`)) return;
      codes.splice(idx, 1);
      saveInviteCodes(codes);
      renderAdminView();
      showToast('코드가 삭제되었습니다.');
    });
  });
  document.querySelectorAll('.admin-del-user-btn[data-uid]').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.uid;
      if (!confirm(`사용자 "${uid}"를 삭제할까요?\n이 사용자의 모든 데이터가 삭제됩니다.`)) return;
      const users2 = getUsers();
      delete users2[uid];
      saveUsers(users2);
      // 해당 유저 데이터 삭제
      ['goals','tasks','alarm','alarm_hist','streak','alarm_last_fired','milestones','routines'].forEach(s => {
        localStorage.removeItem(`mp_data_${uid}_${s}`);
      });
      // 코드 사용자 목록에서도 제거
      const codes2 = getInviteCodes();
      codes2.forEach(c => { c.usedBy = c.usedBy.filter(u => u !== uid); });
      saveInviteCodes(codes2);
      renderAdminView();
      showToast(`${uid} 사용자가 삭제되었습니다.`);
    });
  });
  document.querySelectorAll('.admin-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard?.writeText(btn.dataset.code).then(() => showToast(`"${btn.dataset.code}" 복사됨! 📋`));
    });
  });
}

// 관리자 제외 전체 사용자 데이터 삭제
function deleteAllNonAdminUsers() {
  const users = getUsers();
  const nonAdminIds = Object.keys(users).filter(id => id !== 'admin');
  if (!nonAdminIds.length) { showToast('삭제할 사용자가 없습니다.'); return; }
  if (!confirm(`관리자를 제외한 ${nonAdminIds.length}명의 사용자와 모든 데이터를 삭제합니다.\n이 작업은 되돌릴 수 없습니다. 계속할까요?`)) return;

  const DATA_SUFFIXES = ['goals','tasks','alarm','alarm_hist','streak','alarm_last_fired','milestones','routines'];
  nonAdminIds.forEach(uid => {
    delete users[uid];
    DATA_SUFFIXES.forEach(s => localStorage.removeItem(`mp_data_${uid}_${s}`));
  });
  saveUsers(users);

  // 초대 코드 usedBy 초기화
  const codes = getInviteCodes();
  codes.forEach(c => { c.usedBy = []; });
  saveInviteCodes(codes);

  renderAdminView();
  showToast(`✅ ${nonAdminIds.length}명의 사용자 데이터가 삭제되었습니다.`);
}

// 새 초대 코드 추가 모달
function openAddCodeModal() {
  const codeVal  = prompt('생성할 초대 코드를 입력하세요\n(영문 대문자/숫자 추천, 예: FRIEND2024)');
  if (!codeVal) return;
  const code = codeVal.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,20}$/.test(code)) { alert('코드는 4~20자 영문 대문자/숫자/_/-만 가능합니다.'); return; }
  const codes = getInviteCodes();
  if (codes.find(c => c.code === code)) { alert('이미 존재하는 코드입니다.'); return; }

  const label   = prompt('코드 설명을 입력하세요 (예: 팀원용)') || '초대 코드';
  const maxUses = parseInt(prompt('최대 사용 횟수를 입력하세요', '5') || '5');

  codes.push({ code, label, usedBy: [], maxUses: isNaN(maxUses) ? 5 : maxUses, createdAt: new Date().toISOString() });
  saveInviteCodes(codes);
  renderAdminView();
  showToast(`코드 "${code}" 생성 완료! 🎫`);
}

// ──────────────────────────────────────────────────────
//  BOOTSTRAP (자동 로그인 체크)
// ──────────────────────────────────────────────────────
(function bootstrap() {
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('registerBtn').addEventListener('click', doRegister);

  // 엔터키 로그인
  ['loginId','loginPw'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  });
  ['regName','regId','regPw','regPwConfirm','regInviteCode'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') doRegister(); });
  });

  // 세션 복원 — Firebase sync 완료 후 실행
  _initReady.then(() => {
    const savedUser = currentUserKey();
    if (savedUser) {
      const users = getUsers();
      const user = users[savedUser];
      if (user) {
        document.getElementById('loginPage').style.display = 'none';
        enterApp(user);
        return;
      }
    }
    // 로그인 페이지 표시
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('appPage').style.display = 'none';
  });
})();
