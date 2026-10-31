# 클라우드 세션 보고서 — Hermes 컨트롤러 핵심 흐름 (2026-10-31)

브랜치: `claude/hermes-controller-completion-5kua3j` (기반: `claude/hermes-controller-core-flow-ns7xk2` @ `70ba059`).
이전 세션이 사용량 한도로 중단되어 보고서 없이 끝났고, 이번 세션이 검증·보완·보고서를 마무리했다.

## 1. 요약

- 원래 범위(가짜 Hermes 하네스, 요청/시작 중/실행/실패 UI 상태, 설정 백업·복원·롤백, xvfb Electron 테스트)는 이전 세션 커밋으로 대부분 구현되어 있었고, 이번 세션에서 전부 재실행해 통과를 확인했다.
- 이번 세션에서 결함 1건(재시작 중 동시 요청 경쟁 조건)을 재현·수정하고, 그에 따른 UI 토스트 오표시를 함께 고쳤다. 각각 회귀 테스트를 추가했다.
- 저장소에는 lint / type-check 스크립트가 없다(`package.json` scripts: `dev`, `electron`, `start`, `build`, `dist`, `pack`, `test`, `test:e2e`). 실제로 존재하는 test / build / e2e만 실행했다.

## 2. 명령과 결과 (이 VM, Node v22.23.4)

| 명령 | `main` (`4398c5a`) | 이전 세션 끝 (`70ba059`) | 이번 세션 끝 |
|---|---|---|---|
| `npm ci` | — | 성공 (lockfile 변경 없음) | 동일 |
| `npm test` (`node --test test/*.test.cjs test/*.test.mjs`) | 스크립트·테스트 없음 (0개) | 70 통과 / 0 실패 | **71 통과 / 0 실패** |
| `npm run build` (vite) | 성공 | 성공 | 성공 |
| `npm run test:e2e` (build + `xvfb-run -a node --test test/e2e/electron-flow.e2e.cjs`) | 없음 | 10 통과 / 0 실패 | **10 통과 / 0 실패** (2회 연속) |

참고: `npm ci` 후 Electron 바이너리가 받아지지 않아 `node node_modules/electron/install.js`로 내려받았다(의존성 버전 변경 없음). e2e의 Playwright는 의존성이 아니라 전역 설치본을 쓴다(`test/e2e/electron-flow.e2e.cjs:18`), 없으면 skip.
이번 세션의 `npm test` 증가분(+1)은 `test/gateway-lifecycle.test.cjs`의 회귀 테스트이고, 토스트 회귀 검증은 기존 테스트(`test/gateway-phase.test.mjs:53`)에 단언을 추가했다.

## 3. 이전 세션 커밋 검증

모든 커밋을 `git log --stat main..claude/hermes-controller-core-flow-ns7xk2`와 diff로 읽고, 위 전체 스위트를 재실행해 확인했다. 개별 확인 방법:

| 커밋 | 내용 | 확인 방법 |
|---|---|---|
| `a69856f`, `c46ccd2`, `0396562`, `f92e6a4`, `87a5ae8` | 가짜 `wsl.exe`/`powershell.exe`/`hermes`/`systemctl` + tmux 격리 소켓 하네스 (`test/harness/`) | 모든 adapter/service/lifecycle/e2e 테스트가 이 하네스로 실제 자식 프로세스를 띄워 통과 |
| `999f1cb` | `shellQuote` 수정, `hermesCommand` 반영, 경로 인용, 프로필 이름 검증 (`electron/shell.cjs:12`, `electron/hermes-adapter.cjs:21`) | `test/shell.test.cjs`, `test/adapter-flow.test.cjs`의 regression 3건 통과 |
| `e105b19` | 전체 스택 시작/정지를 실제 상태로 확인 (`electron/service-control.cjs:133`, `:154`) | `test/service-control.test.cjs` 15건 통과 |
| `9e458bf` | 게이트웨이 라이프사이클 (`electron/gateway-lifecycle.cjs`), watchdog 오탐 방지 | `test/gateway-lifecycle.test.cjs`, `test/gateway-watchdog.test.cjs` 통과 |
| `b4824c1` | 설정 백업/복원/롤백 (`electron/settings-store.cjs`), auto-restart 설정 저장 | `test/settings-store.test.cjs` 7건, `test/app-settings.test.cjs` 통과 |
| `92421a6` | main 프로세스 연결, stackHold로 정지 후 WSL 재부팅 방지 (`electron/main.cjs:40`, `:737`) | e2e "whole stack stop" 통과 |
| `20361d3` | UI 단계 표시·토스트·Status 메시지 (`src/gateway-phase.mjs`) | `test/gateway-phase.test.mjs` 통과, e2e에서 실제 화면 확인 |
| `70ba059` | xvfb Electron e2e 9개 시나리오 | 위 표대로 10/10 통과 |

## 4. 발견 사항 (분류 포함)

### 이전 세션이 찾아 고친 것 — 검증된 결함 (verified defect, 수정·회귀 테스트 있음)

1. `shellQuote`가 작은따옴표를 `'''`로 만들어 `'` 포함 경로가 깨짐 — `electron/shell.cjs:12`, `test/shell.test.cjs`.
2. 어댑터가 `hermesCommand`를 무시하고, `labRoot`/`hermesHome`을 인용 없이 삽입(공백 경로 전부 실패) — `electron/hermes-adapter.cjs`, `test/adapter-flow.test.cjs`.
3. 렌더러가 넘긴 프로필 이름이 검증 없이 tmux 명령에 삽입되어 셸 주입 가능 — `electron/hermes-adapter.cjs:21`.
4. `'not logged in'`이 `/logged in/`에 걸려 로그인 상태로 표시 — `electron/service-control.cjs:94`.
5. 설정 화면의 auto-restart 토글이 저장되지 않음 — `electron/app-settings.cjs:33`.
6. watchdog 폴링의 `wsl -d`가 정지된 배포판을 다시 부팅해 "Hermes 정지"가 무효화되고 모든 게이트웨이가 crash로 보고됨 — `electron/main.cjs:737`, `test/service-control.test.cjs`.
7. 재시작 중 stop→start 사이에 폴링이 걸리면 crash로 오탐 — `electron/gateway-watchdog.cjs:62`.
8. UI가 "시작 요청 보냄"과 "실행 중"을 구분하지 않고, 정지 시 WSL이 살아 있어도 "깨끗이 정지"라고 표시 — `src/gateway-phase.mjs:68`.

### 이번 세션 — 검증된 결함 (verified defect)

9. **재시작 경쟁 조건.** `restart()`가 busy 검사 후 전이 단계에 들어가기 전에 `isRunning()`(Hermes 목록 조회, 실제로는 `wsl` 호출이라 수백 ms~수 초)을 기다렸다. 그 사이 들어온 start/restart가 busy 검사를 통과해 같은 게이트웨이에 두 작업이 동시에 실행됐다. 재현: 회귀 테스트가 수정 전 `expected: true, actual: false`로 실패.
   수정: 이름별 예약(`inFlight`)을 첫 await 이전에 동기적으로 잡고, `observe()`도 예약된 이름은 건너뛴다 — `electron/gateway-lifecycle.cjs:39`, `:61`, `:140`, `:179`. 테스트: `test/gateway-lifecycle.test.cjs` "restart is busy from the first await…".
10. **(9의 후속) busy 토스트 오표시.** 예약 중에는 단계가 아직 `stopped` 같은 휴지 단계일 수 있어 "이미 정지됨 상태예요"라고 잘못 안내함. 전이 단계가 아니면 "이미 다른 요청을 처리 중이에요"로 표시 — `src/gateway-phase.mjs:53`, 테스트 `test/gateway-phase.test.mjs:61`.

### 정적 위험 (static risk, 미수정)

- 백업 정리(`MAX_BACKUPS = 30`, `electron/settings-store.cjs:26`, `:129`)가 복원 때마다 만드는 `pre-restore` 백업도 같이 센다. 복원을 반복하면 사용자의 수동 백업이 오래된 순으로 밀려 지워지고, 30개가 꽉 찬 상태에서 가장 오래된 백업을 복원하면 그 백업 자체가 정리될 수 있다. 데이터 손실은 아니지만(복원 직전 상태는 남음) 종류별 보존 한도를 두는 편이 안전하다.
- 재시작의 상태 확인 단계(9번 수정 이후 예약 구간)는 UI에 별도 단계 이벤트가 없어 버튼이 잠기지 않는다. 백엔드가 busy로 거절하므로 안전하지만, 원하면 `restart-requested` 단계를 추가할 수 있다.
- e2e는 전역 Playwright에 의존한다(의존성 추가 금지 조건 때문). 개발자 PC에는 보통 없으므로 그 경우 skip된다.

### 이미 대응됨 / 문제 아님

- 설정 파일 손상: 원자적 쓰기 + `.bak` 폴백으로 이미 대응됨 (`electron/settings-store.cjs:33`, `:54`).
- 연결 설정 저장 실패 시 롤백: 트랜잭션으로 이미 대응됨 (`electron/main.cjs:574`).
- 복원 후 적용 실패 시 `pre-restore` 백업으로 되돌림: 이미 대응됨 (`electron/main.cjs:597`), e2e "rollback on a failed restore"로 확인.

## 5. 이 VM에서 검증하지 못한 것

- **실제 Windows + WSL2**: `wsl.exe`/`powershell.exe`는 Linux에서 동작을 흉내 낸 가짜다(UTF-16 출력, `$` 제거 흉내 포함). 실제 WSL의 타이밍, `wsl --terminate`/`--shutdown` 동작, 인코딩, 경로(`\\wsl$\…` UNC) 처리는 미검증.
- **실제 Hermes Agent / 게이트웨이**: 가짜 `hermes` CLI의 출력 형식이 실제 버전과 다를 수 있다. 실제 `profile list` 출력·로그 형식·`--replace` 동작 확인 필요.
- **대시보드 예약 작업(Task Scheduler)**, 전원 관리 도우미(PS1), WSL 메모리 설정(`.wslconfig`), 트레이 아이콘, 최소화 실행 `.cmd` 파일.
- **Windows 패키징**: `npm run dist`(NSIS/portable)는 실행하지 않음.
- **외부 서비스**(Telegram 등 게이트웨이 플랫폼): 호출하지 않았고 모두 가짜 데이터.
- macOS / 실제 디스플레이 GUI: xvfb 헤드리스 렌더링만 확인.

## 6. 소유자 다음 단계

1. Windows PC에서 `npm ci && npm run build && npm start` 후: 연결 테스트 → Hermes 시작 → 게이트웨이 시작(“시작 요청됨 → 시작 중… → 실행 중” 순서 확인) → 정지 → 재시작 → "Hermes 정지" 후 1분 동안 WSL이 다시 켜지지 않는지(`wsl -l -v`) 확인.
2. 일부러 잘못된 토큰의 프로필을 시작해 "실패"와 로그 사유가 표시되는지, 고친 뒤 다시 시작하면 해제되는지 확인.
3. 설정 탭에서 백업 → 설정 변경 → 복원, 그리고 백업 파일을 일부러 손상시켜 복원이 거절되고 현재 설정이 유지되는지 확인.
4. 실제 `hermes profile list` 출력을 가짜 `test/harness/wsl-bin/hermes`와 비교해 차이가 있으면 하네스를 맞춘다.
5. 정적 위험의 백업 보존 정책(수동/`pre-restore` 분리) 반영 여부 결정.
6. CI에 `npm test`를 추가하는 것을 권장(현재 Windows 빌드 워크플로만 있음). e2e를 CI에서 돌리려면 Playwright를 devDependency로 추가할지 결정 필요.
