import { html, useState, useEffect, useRef, cx } from '../lib.js';
import { useApp } from '../store.js';
import { patchPomodoro } from '../actions.js';
import { notify } from '../storage.js';
import { todayStr, pad } from '../util/date.js';
import { Popup, popoverPlacement } from './Popup.js';
import { Field, Toggle } from './controls.js';
import { IconButton } from './icons.js';

const PHASE_LABEL = { focus: '집중', short: '짧은 휴식', long: '긴 휴식' };

function duration(p, phase = p.phase) {
  return (phase === 'focus' ? p.focus : phase === 'short' ? p.short : p.long) * 60000;
}

/**
 * 탁상시계 알람 '따르르릉': 망치가 종 두 개를 번갈아 빠르게 친다 (1초 울림 + 쉼, 세 번).
 * 종 한 번 = 배음이 어긋난 사인파 몇 개가 짧게 울리고 사라지는 소리
 */
function ring() {
  try {
    const ctx = new AudioContext();
    const out = ctx.createGain();
    out.gain.value = 0.16;
    out.connect(ctx.destination);
    const BELLS = [2350, 2620]; // 왼쪽 · 오른쪽 종
    const PARTIALS = [[1, 1], [2.76, 0.45], [5.4, 0.2]]; // 종소리 배음 (배수, 세기)
    const strike = (t, f, v) => {
      for (const [k, a] of PARTIALS) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f * k;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(a * v, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 / k + 0.04);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.2);
      }
    };
    const t0 = ctx.currentTime + 0.05;
    for (let burst = 0; burst < 3; burst++) {
      for (let i = 0; i < 20; i++) strike(t0 + burst * 1.4 + i * 0.05, BELLS[i % 2], 0.75 + Math.random() * 0.25);
    }
    setTimeout(() => ctx.close(), 4600);
  } catch { /* 오디오 불가 */ }
}

function nextState(p, { silent, count = true } = {}) {
  const today = todayStr();
  let { round, doneCount } = p;
  if (p.doneDate !== today) doneCount = 0;
  let phase;
  if (p.phase === 'focus') {
    if (count) doneCount += 1;
    phase = round % p.longEvery === 0 ? 'long' : 'short';
  } else {
    phase = 'focus';
    round = p.phase === 'long' ? 1 : round + 1;
  }
  const dur = duration(p, phase);
  if (!silent) {
    const msg = p.phase === 'focus' ? `집중 시간이 끝났습니다. ${PHASE_LABEL[phase]}을 시작하세요.` : '휴식이 끝났습니다. 다시 집중해 볼까요?';
    notify('뽀모도로', msg);
    if (p.sound) ring();
  }
  return {
    phase, round, doneCount, doneDate: today, remaining: dur,
    running: p.autoNext && !silent, endAt: p.autoNext && !silent ? Date.now() + dur : 0,
  };
}

function Settings({ p, onClose, placement }) {
  const [f, setF] = useState({ focus: p.focus, short: p.short, long: p.long, longEvery: p.longEvery, autoNext: p.autoNext, sound: p.sound });
  const num = (key, label, min, max) => html`<${Field} label=${label} inline>${(id) => html`<input id=${id} type="number" class="input input-sm num"
      min=${min} max=${max} value=${f[key]} onInput=${(e) => setF({ ...f, [key]: Math.min(max, Math.max(min, +e.currentTarget.value || min)) })} />`}<//>`;
  function save(e) {
    e.preventDefault();
    patchPomodoro((cur) => {
      const next = { ...f };
      if (!cur.running) next.remaining = duration({ ...cur, ...f });
      return next;
    });
    onClose();
  }
  return html`<${Popup} title="타이머 설정" onClose=${onClose} className="pomo-settings" popover=${placement}>
    <form class="pomo-form" onSubmit=${save}>
      ${num('focus', '집중(분)', 1, 180)}
      ${num('short', '짧은 휴식', 1, 60)}
      ${num('long', '긴 휴식', 1, 90)}
      ${num('longEvery', '긴 휴식 주기', 2, 12)}
      <${Toggle} label="자동 시작" checked=${f.autoNext} onChange=${(v) => setF({ ...f, autoNext: v })} />
      <${Toggle} label="알림음" checked=${f.sound} onChange=${(v) => setF({ ...f, sound: v })} />
      <div class="pomo-form-actions">
        <button type="button" class="btn btn-sm" onClick=${onClose}>취소</button>
        <button type="submit" class="btn btn-primary btn-sm">저장</button>
      </div>
    </form>
  <//>`;
}

export function Pomodoro() {
  const { pomodoro: p } = useApp();
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const lastDone = useRef(0);

  // 초가 바뀌는 순간에만 다시 그린다(1초에 한 번) — 부하를 줄이기 위해 짧은 간격으로 돌리지 않음
  useEffect(() => {
    if (!p.running) return undefined;
    let t;
    const tick = () => {
      setNow(Date.now());
      t = setTimeout(tick, Math.max(20, ((p.endAt - Date.now()) % 1000) + 20));
    };
    tick();
    return () => clearTimeout(t);
  }, [p.running, p.endAt]);

  // 설정 창은 위젯 옆 빈 쪽(오른쪽 → 왼쪽 → 아래)에 띄운다
  const ref = useRef(null);
  const [placement, setPlacement] = useState(null);
  function openSettings() {
    setPlacement(popoverPlacement(ref.current, 20));
    setOpen(true);
  }

  const total = duration(p);
  const remaining = p.running ? Math.max(0, p.endAt - now) : p.remaining;

  useEffect(() => {
    if (!p.running || p.endAt > Date.now() || lastDone.current === p.endAt) return;
    lastDone.current = p.endAt;
    const late = Date.now() - p.endAt > 60000; // 앱이 꺼져 있던 동안 끝난 경우 조용히 넘김
    const next = nextState(p, { silent: late });
    patchPomodoro(next);
    setAnnounce(`${PHASE_LABEL[next.phase]} 단계입니다.`);
  }, [remaining <= 0, p.running, p.endAt]);

  const start = () => patchPomodoro({ running: true, endAt: Date.now() + (p.remaining > 0 ? p.remaining : total) });
  const pause = () => patchPomodoro({ running: false, remaining: Math.max(0, p.endAt - Date.now()), endAt: 0 });
  const reset = () => patchPomodoro({ running: false, endAt: 0, remaining: total });
  const skip = () => {
    const next = nextState({ ...p, autoNext: false }, { silent: true, count: false });
    patchPomodoro(next);
    setAnnounce(`${PHASE_LABEL[next.phase]} 단계로 넘어갔습니다.`);
  };

  const sec = Math.ceil(remaining / 1000);
  const mm = pad(Math.floor(sec / 60));
  const ss = pad(sec % 60);
  const progress = total ? 1 - remaining / total : 0;
  const todayCount = p.doneDate === todayStr() ? p.doneCount : 0;

  return html`<section ref=${ref} class=${cx('widget w-pomodoro', 'phase-' + p.phase, p.running && 'is-running')} aria-labelledby="pomo-title">
    <div class="pomo-info">
      <h2 class="w-title" id="pomo-title">POMODORO</h2>
      <p class="pomo-phase"><span class="phase-dot" aria-hidden="true"></span>${PHASE_LABEL[p.phase]}
        <span class="pomo-round num" aria-label=${`${p.round}번째 세트`}>${p.round}/${p.longEvery}</span></p>
    </div>
    <div class="pomo-time num" role="timer" aria-live="off" aria-label=${`남은 시간 ${Math.floor(sec / 60)}분 ${sec % 60}초`}>${mm}:${ss}</div>
    <div class="pomo-ctrl">
      ${p.running
        ? html`<${IconButton} icon="pause" label="일시정지" onClick=${pause} className="pomo-main-btn" />`
        : html`<${IconButton} icon="play" label="시작" onClick=${start} className="pomo-main-btn" filled />`}
      <${IconButton} icon="reset" label="다시 시작" onClick=${reset} />
      <${IconButton} icon="skip" label="다음 단계로" onClick=${skip} />
      <${IconButton} icon="gear" label="타이머 설정" onClick=${openSettings} aria-expanded=${String(open)} />
    </div>
    <div class="pomo-foot">
      <div class="pomo-progress" role="progressbar" aria-label="진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(progress * 100)}>
        <span style=${{ transform: `scaleX(${progress})` }}></span>
      </div>
      <span class="pomo-count num" title="오늘 완료한 집중 횟수">오늘 ${todayCount}회</span>
    </div>
    <p class="sr-only" aria-live="polite">${announce}</p>
    ${open && html`<${Settings} p=${p} placement=${placement} onClose=${() => setOpen(false)} />`}
  </section>`;
}
