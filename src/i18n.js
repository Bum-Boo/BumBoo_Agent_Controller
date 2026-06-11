// Centralized i18n. ko + en are complete; zh + ja keep the original keys and
// fall back to English for newer keys via the merge in makeStrings().

export const languageOptions = [
  { value: 'ko', label: '한국어' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' }
];

const en = {
  appName: 'Hermes Lab',
  subtitle: 'Local WSL control center',
  connected: 'Connected',
  partial: 'Partial',
  stopped: 'Stopped',
  checking: 'Checking local lab status',
  readyMessage: 'Hermes is online and ready.',
  partialMessage: 'WSL is running, but Hermes is not fully connected.',
  stoppedMessage: 'Hermes is off. WSL Ubuntu is stopped.',
  starting: 'Starting WSL and Hermes...',
  stopping: 'Stopping Hermes and Ubuntu WSL...',
  stoppedClean: 'Hermes stopped cleanly.',
  startSent: 'Start command sent. Refreshing status.',
  wslUbuntu: 'WSL Ubuntu',
  dashboard: 'Dashboard',
  gateway: 'Gateway',
  codexOAuth: 'Codex OAuth',
  running: 'Running',
  online: 'Online',
  offline: 'Offline',
  active: 'Active',
  loggedIn: 'Logged in',
  wslOff: 'WSL off',
  unknown: 'Unknown',
  start: 'Start',
  stop: 'Stop',
  labFolder: 'Lab Folder',
  refresh: 'Refresh status',
  settings: 'Settings',
  settingsSubtitle: 'Only local controller behavior changes here.',
  launchOnStartup: 'Launch on startup',
  launchOnStartupHint: 'Start the controller minimized to the tray after Windows sign-in.',
  language: 'Language',
  languageHint: 'Choose the controller display language.',
  localOnly: 'Local only',
  lastChecked: 'Last checked',

  // Tabs
  tabStatus: 'Status',
  tabProfiles: 'Profiles',
  tabGateways: 'Gateways',
  tabLogs: 'Logs',
  tabDiagnostics: 'Diagnostics',
  tabSettings: 'Settings',

  // Mode
  userMode: 'User mode',
  serverMode: 'Server mode',
  serverModeManual: 'Server mode · manual',
  serverModeAuto: 'Server mode · auto',
  switching: 'Switching…',
  enterServerMode: 'Enter server mode',
  exitServerMode: 'Return to user mode',
  modeUserDesc: 'Full performance. The machine follows your normal power plan.',
  modeManualDesc: 'Low-power plan is on by your choice. It stays until you exit.',
  modeAutoDesc: 'Idle-triggered low-power plan. It returns to user mode on input.',
  serverModeTitle: 'Server mode',
  serverModeHint: 'Caps CPU, keeps the system awake for WSL, and can turn off the display.',
  autoSwitchIn: 'Auto server mode in',
  autoSwitchOff: 'Auto server mode is off',
  idleFor: 'Idle for',
  powerPlan: 'Power plan',
  cpuCap: 'CPU cap',
  suspendBlocked: 'Sleep blocked for WSL',
  modeHistory: 'Mode history',
  historyEmpty: 'No mode changes yet.',

  // Profiles
  profilesSubtitle: 'Hermes profiles and their gateway state.',
  model: 'Model',
  alias: 'Alias',
  distribution: 'Distribution',
  setDefault: 'Set default',
  current: 'Current',
  profileReload: 'Reload profiles',
  profilesEmpty: 'No profiles found.',
  defaultSet: 'Default profile updated.',
  platforms: 'Platforms',
  disconnected: 'Disconnected',
  noPlatform: 'No platform',
  onlyRunning: 'Show running only',

  // Gateways
  gatewaysSubtitle: 'Messaging gateway state per profile.',
  gatewayRunning: 'Running',
  gatewayStopped: 'Stopped',
  startGateway: 'Start',
  stopGateway: 'Stop',
  restartGateway: 'Restart',
  gatewayReload: 'Reload gateways',
  gatewaysEmpty: 'No gateways found.',
  gatewayNote: 'Actions apply to the active gateway service.',

  // Diagnostics
  diagnosticsSubtitle: 'Power and WSL diagnostics. Read-only.',
  activePlan: 'Active power plan',
  allPlans: 'Power plans',
  wslLimits: 'WSL limits (.wslconfig)',
  memory: 'Memory',
  processors: 'Processors',
  swap: 'Swap',
  notSet: 'default',
  wslConfigMissing: 'No .wslconfig found — WSL uses defaults (50% RAM, all cores).',
  sleepBlockers: 'Sleep / display blockers',
  noBlockers: 'Nothing is blocking sleep.',
  checkRequestsAdmin: 'Check with admin',
  requiresAdmin: 'powercfg /requests needs admin. Click to elevate (one UAC prompt).',
  elevationCancelled: 'Admin check was cancelled. Click again to retry.',
  elevationFailed: 'Admin check returned nothing. Click to retry.',
  reload: 'Reload',

  // Settings (power)
  powerSettings: 'Power & server mode',
  powerSettingsSubtitle: 'How the machine behaves as a low-power WSL server.',
  autoServerMode: 'Auto server mode on idle',
  autoServerModeHint: 'Switch to low-power server mode after no input for the threshold below.',
  idleThreshold: 'Idle threshold',
  idleThresholdHint: 'Minutes of no keyboard/mouse before auto server mode.',
  cpuCapLabel: 'Server mode CPU cap',
  cpuCapHint: 'Maximum CPU in server mode. Lower = cooler and quieter.',
  displayOff: 'Turn off display in server mode',
  displayOffHint: 'Blank the monitor when entering server mode. WSL keeps running.',
  minutesUnit: 'min',
  percentUnit: '%'
};

const ko = {
  appName: 'Hermes Lab',
  subtitle: '로컬 WSL 제어 센터',
  connected: '연결됨',
  partial: '부분 연결',
  stopped: '중지됨',
  checking: '로컬 lab 상태 확인 중',
  readyMessage: 'Hermes가 온라인 상태이며 사용할 준비가 됐습니다.',
  partialMessage: 'WSL은 실행 중이지만 Hermes 연결이 아직 완전하지 않습니다.',
  stoppedMessage: 'Hermes가 꺼져 있습니다. Ubuntu WSL도 중지된 상태입니다.',
  starting: 'WSL과 Hermes를 시작하는 중...',
  stopping: 'Hermes와 Ubuntu WSL을 중지하는 중...',
  stoppedClean: 'Hermes가 정상적으로 중지됐습니다.',
  startSent: '시작 명령을 보냈습니다. 상태를 다시 확인 중입니다.',
  wslUbuntu: 'WSL Ubuntu',
  dashboard: '대시보드',
  gateway: '게이트웨이',
  codexOAuth: 'Codex OAuth',
  running: '실행 중',
  online: '온라인',
  offline: '오프라인',
  active: '활성',
  loggedIn: '로그인됨',
  wslOff: 'WSL 꺼짐',
  unknown: '알 수 없음',
  start: '시작',
  stop: '중지',
  labFolder: 'Lab 폴더',
  refresh: '새로고침',
  settings: '설정',
  settingsSubtitle: '로컬 컨트롤러 동작만 바꿉니다.',
  launchOnStartup: '컴퓨터 시작 시 실행',
  launchOnStartupHint: 'Windows 로그인 후 컨트롤러를 트레이에 최소화해서 띄웁니다.',
  language: '언어',
  languageHint: '컨트롤러 표시 언어를 선택합니다.',
  localOnly: '로컬 전용',
  lastChecked: '마지막 확인',

  tabStatus: '상태',
  tabProfiles: '프로필',
  tabGateways: '게이트웨이',
  tabLogs: '로그',
  tabDiagnostics: '진단',
  tabSettings: '설정',

  userMode: '사용자 모드',
  serverMode: '서버 모드',
  serverModeManual: '서버 모드 · 수동',
  serverModeAuto: '서버 모드 · 자동',
  switching: '전환 중…',
  enterServerMode: '서버 모드 진입',
  exitServerMode: '사용자 모드 복귀',
  modeUserDesc: '풀 성능. 평소 전원 플랜을 따릅니다.',
  modeManualDesc: '직접 켠 저전력 플랜입니다. 끌 때까지 유지됩니다.',
  modeAutoDesc: 'idle로 켜진 저전력 플랜입니다. 입력이 감지되면 사용자 모드로 복귀합니다.',
  serverModeTitle: '서버 모드',
  serverModeHint: 'CPU를 제한하고, WSL을 위해 시스템 절전을 막고, 화면을 끌 수 있습니다.',
  autoSwitchIn: '자동 서버 모드까지',
  autoSwitchOff: '자동 서버 모드 꺼짐',
  idleFor: '유휴 시간',
  powerPlan: '전원 플랜',
  cpuCap: 'CPU 상한',
  suspendBlocked: 'WSL용 절전 차단 중',
  modeHistory: '모드 히스토리',
  historyEmpty: '아직 모드 변경 기록이 없습니다.',

  profilesSubtitle: 'Hermes 프로필과 게이트웨이 상태.',
  model: '모델',
  alias: '별칭',
  distribution: '배포판',
  setDefault: '기본으로',
  current: '현재',
  profileReload: '프로필 새로고침',
  profilesEmpty: '프로필을 찾을 수 없습니다.',
  defaultSet: '기본 프로필이 변경됐습니다.',
  platforms: '플랫폼',
  disconnected: '연결 안 됨',
  noPlatform: '플랫폼 없음',
  onlyRunning: '실행 중만 보기',

  gatewaysSubtitle: '프로필별 메시징 게이트웨이 상태.',
  gatewayRunning: '실행 중',
  gatewayStopped: '중지됨',
  startGateway: '시작',
  stopGateway: '중지',
  restartGateway: '재시작',
  gatewayReload: '게이트웨이 새로고침',
  gatewaysEmpty: '게이트웨이를 찾을 수 없습니다.',
  gatewayNote: '동작은 활성 게이트웨이 서비스에 적용됩니다.',

  diagnosticsSubtitle: '전원 및 WSL 진단. 읽기 전용.',
  activePlan: '활성 전원 플랜',
  allPlans: '전원 플랜 목록',
  wslLimits: 'WSL 제한 (.wslconfig)',
  memory: '메모리',
  processors: '프로세서',
  swap: '스왑',
  notSet: '기본값',
  wslConfigMissing: '.wslconfig 없음 — WSL이 기본값 사용 (RAM 50%, 전체 코어).',
  sleepBlockers: '절전 / 화면 차단 요소',
  noBlockers: '절전을 막는 항목이 없습니다.',
  checkRequestsAdmin: '관리자로 확인',
  requiresAdmin: 'powercfg /requests는 관리자 권한이 필요합니다. 클릭하면 승격됩니다 (UAC 1회).',
  elevationCancelled: '관리자 확인이 취소됐습니다. 다시 클릭하면 재시도합니다.',
  elevationFailed: '관리자 확인 결과가 비어 있습니다. 다시 클릭해 재시도하세요.',
  reload: '새로고침',

  powerSettings: '전원 및 서버 모드',
  powerSettingsSubtitle: '저전력 WSL 서버로서의 동작 방식.',
  autoServerMode: 'idle 시 자동 서버 모드',
  autoServerModeHint: '아래 임계값 동안 입력이 없으면 저전력 서버 모드로 전환합니다.',
  idleThreshold: 'idle 임계값',
  idleThresholdHint: '자동 서버 모드까지 키보드/마우스 무입력 분.',
  cpuCapLabel: '서버 모드 CPU 상한',
  cpuCapHint: '서버 모드의 최대 CPU. 낮을수록 시원하고 조용합니다.',
  displayOff: '서버 모드에서 화면 끄기',
  displayOffHint: '서버 모드 진입 시 모니터를 끕니다. WSL은 계속 실행됩니다.',
  minutesUnit: '분',
  percentUnit: '%'
};

const zh = {
  appName: 'Hermes Lab',
  subtitle: '本地 WSL 控制中心',
  connected: '已连接',
  partial: '部分连接',
  stopped: '已停止',
  checking: '正在检查本地 lab 状态',
  readyMessage: 'Hermes 已在线，可以使用。',
  partialMessage: 'WSL 正在运行，但 Hermes 尚未完全连接。',
  stoppedMessage: 'Hermes 已关闭。Ubuntu WSL 也处于停止状态。',
  starting: '正在启动 WSL 和 Hermes...',
  stopping: '正在停止 Hermes 和 Ubuntu WSL...',
  stoppedClean: 'Hermes 已正常停止。',
  startSent: '启动命令已发送。正在刷新状态。',
  wslUbuntu: 'WSL Ubuntu',
  dashboard: '仪表板',
  gateway: '网关',
  codexOAuth: 'Codex OAuth',
  running: '运行中',
  online: '在线',
  offline: '离线',
  active: '活动',
  loggedIn: '已登录',
  wslOff: 'WSL 已关闭',
  unknown: '未知',
  start: '启动',
  stop: '停止',
  labFolder: 'Lab 文件夹',
  refresh: '刷新',
  settings: '设置',
  settingsSubtitle: '仅更改本地控制器行为。',
  launchOnStartup: '开机时启动',
  launchOnStartupHint: 'Windows 登录后在托盘中最小化启动控制器。',
  language: '语言',
  languageHint: '选择控制器显示语言。',
  localOnly: '仅限本地',
  lastChecked: '上次检查',

  tabStatus: '状态',
  tabProfiles: '配置',
  tabGateways: '网关',
  tabDiagnostics: '诊断',
  tabSettings: '设置',

  userMode: '用户模式',
  serverMode: '服务器模式',
  enterServerMode: '进入服务器模式',
  exitServerMode: '返回用户模式',
  serverModeTitle: '服务器模式',
  powerSettings: '电源与服务器模式'
};

const ja = {
  appName: 'Hermes Lab',
  subtitle: 'ローカル WSL コントロールセンター',
  connected: '接続済み',
  partial: '一部接続',
  stopped: '停止中',
  checking: 'ローカル lab の状態を確認中',
  readyMessage: 'Hermes はオンラインで使用できます。',
  partialMessage: 'WSL は実行中ですが、Hermes はまだ完全には接続されていません。',
  stoppedMessage: 'Hermes はオフです。Ubuntu WSL も停止しています。',
  starting: 'WSL と Hermes を起動中...',
  stopping: 'Hermes と Ubuntu WSL を停止中...',
  stoppedClean: 'Hermes は正常に停止しました。',
  startSent: '起動コマンドを送信しました。状態を更新しています。',
  wslUbuntu: 'WSL Ubuntu',
  dashboard: 'ダッシュボード',
  gateway: 'ゲートウェイ',
  codexOAuth: 'Codex OAuth',
  running: '実行中',
  online: 'オンライン',
  offline: 'オフライン',
  active: '有効',
  loggedIn: 'ログイン済み',
  wslOff: 'WSL オフ',
  unknown: '不明',
  start: '起動',
  stop: '停止',
  labFolder: 'Lab フォルダ',
  refresh: '更新',
  settings: '設定',
  settingsSubtitle: 'ローカルコントローラーの動作だけを変更します。',
  launchOnStartup: 'PC 起動時に実行',
  launchOnStartupHint: 'Windows ログイン後、コントローラーをトレイに最小化して起動します。',
  language: '言語',
  languageHint: 'コントローラーの表示言語を選択します。',
  localOnly: 'ローカルのみ',
  lastChecked: '最終確認',

  tabStatus: 'ステータス',
  tabProfiles: 'プロファイル',
  tabGateways: 'ゲートウェイ',
  tabDiagnostics: '診断',
  tabSettings: '設定',

  userMode: 'ユーザーモード',
  serverMode: 'サーバーモード',
  enterServerMode: 'サーバーモードに入る',
  exitServerMode: 'ユーザーモードに戻る',
  serverModeTitle: 'サーバーモード',
  powerSettings: '電源とサーバーモード'
};

const strings = { en, ko, zh, ja };

// Merge with English so any missing localized key gracefully falls back.
export function makeStrings(language) {
  return { ...en, ...(strings[language] || {}) };
}

export function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function messageKeyForStatus(status) {
  if (status.ready) return 'readyMessage';
  if (status.wslRunning) return 'partialMessage';
  return 'stoppedMessage';
}

export function serviceLabel(value, t) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'active') return t.active;
  if (normalized === 'logged in') return t.loggedIn;
  if (normalized === 'wsl off') return t.wslOff;
  if (!value || normalized === 'unknown') return t.unknown;
  return value;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m <= 0) return `${rem}s`;
  if (m < 60) return `${m}m ${String(rem).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}
