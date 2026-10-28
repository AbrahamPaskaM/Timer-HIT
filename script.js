"use strict";

const settingsScreen = document.getElementById("settings-screen");
const workoutScreen = document.getElementById("workout-screen");
const doneScreen = document.getElementById("done-screen");
const settingsForm = document.getElementById("settings-form");
const workInput = document.getElementById("work-duration");
const restInput = document.getElementById("rest-duration");
const roundsInput = document.getElementById("round-count");
const prepInput = document.getElementById("prep-duration");
const soundInput = document.getElementById("sound-enabled");
const countdownInput = document.getElementById("countdown-enabled");
const transitionInput = document.getElementById("transition-enabled");
const testModeInput = document.getElementById("test-mode-toggle");
const durationEstimate = document.getElementById("duration-estimate");
const formError = document.getElementById("form-error");
const audioStatus = document.getElementById("audio-status");
const timerCard = document.getElementById("timer-card");
const timerDial = document.getElementById("timer-dial");
const dialProgress = document.getElementById("dial-progress");
const phaseLabel = document.getElementById("phase-label");
const timerValue = document.getElementById("timer-value");
const timerUnit = document.getElementById("timer-unit");
const currentRound = document.getElementById("current-round");
const totalRounds = document.getElementById("total-rounds");
const nextPhase = document.getElementById("next-phase");
const pauseButton = document.getElementById("pause-button");
const wakeStatus = document.getElementById("wake-status");
const wakeStatusText = wakeStatus.querySelector("span");
const completedRounds = document.getElementById("completed-rounds");
const sessionSaveStatus = document.getElementById("session-save-status");
const historyScreen = document.getElementById("history-screen");
const profileScreen = document.getElementById("profile-screen");
const historyList = document.getElementById("history-list");
const historyFeedback = document.getElementById("history-feedback");
const historyCount = document.getElementById("history-count");
const historyDialog = document.getElementById("history-dialog");
const detailContent = document.getElementById("detail-content");
const detailActions = document.getElementById("detail-actions");
const loadMoreButton = document.getElementById("load-more-button");

const MAX_SESSION_SECONDS = 24 * 60 * 60;
const MIN_VALID_SECONDS = 60;
const DIAL_CIRCUMFERENCE = 2 * Math.PI * 96;
const SETTING_INPUTS = new Set(["prep-duration", "work-duration", "rest-duration", "round-count"]);
const AUDIO_PREFERENCES_KEY = "hiitTimerAudioPreferences";
const activeAudioTones = new Set();
const inputRules = [
  { input: prepInput, errorId: "prep-error", helpId: "prep-help", name: "Durasi persiapan", unit: "detik", min: 0, max: 60 },
  { input: workInput, errorId: "work-error", helpId: "work-help", name: "Durasi kerja", unit: "detik", min: 1, max: 3600 },
  { input: restInput, errorId: "rest-error", helpId: "rest-help", name: "Durasi istirahat", unit: "detik", min: 1, max: 3600 },
  { input: roundsInput, errorId: "rounds-error", helpId: "round-help", name: "Jumlah ronde", unit: "ronde", min: 1, max: 100 }
];

let session = null;
let timerId = null;
let audioContext = null;
let wakeLock = null;
let wakeLockRequest = null;
let cordovaReady = !window.cordova;
let insomniaActive = false;
let countdownSecondsPlayed = new Set();
let audioGeneration = 0;
let firebaseModules = null;
let firebaseAuth = null;
let firestore = null;
let currentUser = null;
let historyRecords = [];
let historyLoadState = "idle";
let currentPage = "timer";
let firebaseInitPromise = null;
let firebaseInitTimeout = null;
let historyLoadTimeout = null;
let historyRequestId = 0;
let anonymousSignInPending = false;
let anonymousSignInAttemptId = 0;
let selectedRange = "7";
let visibleHistoryCount = 10;
let lastCompleted = null;
const pendingWorkoutSaves = new Set();
let settingUpdateTimeout = null;
let stepperPointerState = null;
let stepperInteractionsInitialized = false;
let testModeEnabled = false;
let lastStartedSettings = null;

function setWakeStatus(message) {
  wakeStatusText.textContent = message;
}

function loadAudioPreferences() {
  try {
    const stored = localStorage.getItem(AUDIO_PREFERENCES_KEY);
    if (!stored) return;
    const preferences = JSON.parse(stored);
    if (typeof preferences.master === "boolean") soundInput.checked = preferences.master;
    if (typeof preferences.countdown === "boolean") countdownInput.checked = preferences.countdown;
    if (typeof preferences.transitions === "boolean") transitionInput.checked = preferences.transitions;
  } catch (error) {
    console.warn("Preferensi audio tidak dapat dibaca:", error);
  }
}

function saveAudioPreferences() {
  try {
    localStorage.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify({
      master: soundInput.checked,
      countdown: countdownInput.checked,
      transitions: transitionInput.checked
    }));
  } catch (error) {
    console.warn("Preferensi audio tidak dapat disimpan:", error);
  }
}

loadAudioPreferences();

function getInputValue(input) {
  const rawValue = input.value.trim();
  if (rawValue === "") return null;
  if (!/^\d+$/.test(rawValue)) return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : Number.MAX_VALUE;
}

function formatInputLimit(value) {
  return new Intl.NumberFormat("id-ID").format(value);
}

function findInputRule(input) {
  return inputRules.find((rule) => rule.input === input);
}

function setInputValidity(input, commit = false) {
  const rule = findInputRule(input);
  if (!rule) return false;
  const field = input.closest(".field");
  const help = document.getElementById(rule.helpId);
  const error = document.getElementById(rule.errorId);
  let value = getInputValue(input);
  let message = "";

  if (commit && value === null) {
    value = Number(input.dataset.lastValidValue);
    input.value = String(value);
  } else if (commit && value !== null) {
    value = Math.max(rule.min, Math.min(rule.max, value));
    input.value = String(value);
  }

  if (value !== null && value < rule.min) message = `Minimal ${formatInputLimit(rule.min)} ${rule.unit}`;
  else if (value !== null && value > rule.max) message = `Maksimal ${formatInputLimit(rule.max)} ${rule.unit}`;

  if (commit && value !== null && !message) input.dataset.lastValidValue = String(value);
  if (value !== null) input.setAttribute("aria-valuenow", String(value));
  input.style.width = `${Math.max(1, String(input.value || "").length)}ch`;
  field.classList.toggle("has-error", Boolean(message));
  input.setAttribute("aria-invalid", String(Boolean(message)));
  error.textContent = message;
  help.textContent = message || `Rentang ${formatInputLimit(rule.min)}–${formatInputLimit(rule.max)} ${rule.unit}`;
  return !message && value !== null;
}

function markCustomPreset() {
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === "custom");
  });
}

function refreshSettingsSummary(immediate = false) {
  if (settingUpdateTimeout) window.clearTimeout(settingUpdateTimeout);
  const refresh = () => {
    settingUpdateTimeout = null;
    updateEstimate();
    window.HIITQuestUI?.render();
  };
  if (immediate) refresh();
  else settingUpdateTimeout = window.setTimeout(refresh, 150);
}

function applyStepperChange(button, amount) {
  const input = document.getElementById(button.dataset.for);
  const rule = findInputRule(input);
  if (!rule) return;
  const currentValue = getInputValue(input);
  const base = currentValue === null ? Number(input.dataset.lastValidValue) : currentValue;
  input.value = String(Math.max(rule.min, Math.min(rule.max, base + amount)));
  setInputValidity(input, true);
  markCustomPreset();
  formError.textContent = "";
  refreshSettingsSummary(true);
}

function stopStepperPointer(released = false) {
  if (!stepperPointerState) return;
  const state = stepperPointerState;
  if (state.startTimeout) window.clearTimeout(state.startTimeout);
  if (state.repeatTimeout) window.clearTimeout(state.repeatTimeout);
  stepperPointerState = null;
  if (released) {
    state.button.dataset.suppressPointerClick = "true";
    window.setTimeout(() => delete state.button.dataset.suppressPointerClick, 0);
  }
  if (released && !state.repeated && !state.cancelled) {
    applyStepperChange(state.button, Number(state.button.dataset.step));
  }
}

function cancelStepperPointer() {
  if (!stepperPointerState) return;
  stepperPointerState.cancelled = true;
  if (stepperPointerState.startTimeout) window.clearTimeout(stepperPointerState.startTimeout);
  if (stepperPointerState.repeatTimeout) window.clearTimeout(stepperPointerState.repeatTimeout);
}

function scheduleStepperRepeat(state) {
  const elapsed = performance.now() - state.startedAt;
  const delay = elapsed >= 1000 ? 40 : 80;
  state.repeatTimeout = window.setTimeout(() => {
    if (stepperPointerState !== state || state.cancelled) return;
    applyStepperChange(state.button, Number(state.button.dataset.step));
    scheduleStepperRepeat(state);
  }, delay);
}

function initializeSettingControls() {
  if (stepperInteractionsInitialized) return;
  stepperInteractionsInitialized = true;
  inputRules.forEach(({ input }) => {
    input.dataset.lastValidValue = input.value;
    input.style.width = `${Math.max(1, String(input.value || "").length)}ch`;
    input.addEventListener("focus", () => input.select());
    input.addEventListener("click", () => input.select());
  });
  testModeEnabled = false;
  if (testModeInput) testModeInput.checked = false;
  testModeInput?.addEventListener("change", () => {
    testModeEnabled = testModeInput.checked;
    renderHistoryStats();
    renderHistoryList();
    updateEstimate();
    window.HIITQuestUI?.render();
  });

  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(".step");
    if (!button || button.disabled || !settingsForm.contains(button)) return;
    event.preventDefault();
    stopStepperPointer(false);
    const state = {
      button,
      pointerId: event.pointerId,
      startedAt: performance.now(),
      repeated: false,
      cancelled: false,
      startTimeout: null,
      repeatTimeout: null
    };
    stepperPointerState = state;
    state.startTimeout = window.setTimeout(() => {
      if (stepperPointerState !== state || state.cancelled) return;
      state.repeated = true;
      applyStepperChange(button, Number(button.dataset.step));
      scheduleStepperRepeat(state);
    }, 400);
  });
  document.addEventListener("pointerup", (event) => {
    if (!stepperPointerState || stepperPointerState.pointerId !== event.pointerId) return;
    stopStepperPointer(true);
  });
  document.addEventListener("pointercancel", (event) => {
    if (stepperPointerState && stepperPointerState.pointerId === event.pointerId) {
      stepperPointerState.cancelled = true;
      stopStepperPointer(true);
    }
  });
  document.addEventListener("pointermove", (event) => {
    if (!stepperPointerState || stepperPointerState.pointerId !== event.pointerId) return;
    const rect = stepperPointerState.button.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      cancelStepperPointer();
    }
  });
  document.addEventListener("pointerout", (event) => {
    const button = event.target.closest(".step");
    if (!button || !stepperPointerState || stepperPointerState.button !== button || button.contains(event.relatedTarget)) return;
    cancelStepperPointer();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".step");
    if (!button) return;
    if (button.dataset.suppressPointerClick === "true" || event.detail > 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    applyStepperChange(button, Number(button.dataset.step));
  }, true);
  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!SETTING_INPUTS.has(input.id)) return;
    const filtered = input.value.replace(/\D/g, "");
    if (filtered !== input.value) {
      const caret = input.selectionStart;
      input.value = filtered;
      if (caret !== null) input.setSelectionRange(Math.max(0, caret - 1), Math.max(0, caret - 1));
    }
    setInputValidity(input);
    if (getInputValue(input) !== null && setInputValidity(input)) input.dataset.lastValidValue = input.value;
    markCustomPreset();
    formError.textContent = "";
    refreshSettingsSummary(false);
  });
  document.addEventListener("change", (event) => {
    if (!SETTING_INPUTS.has(event.target.id)) return;
    setInputValidity(event.target, true);
    refreshSettingsSummary(true);
  });
  document.addEventListener("focusout", (event) => {
    if (!SETTING_INPUTS.has(event.target.id)) return;
    setInputValidity(event.target, true);
    refreshSettingsSummary(true);
  });
  document.addEventListener("keydown", (event) => {
    const input = event.target;
    if (!SETTING_INPUTS.has(input.id)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      setInputValidity(input, true);
      refreshSettingsSummary(true);
      input.blur();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
    const rule = findInputRule(input);
    const current = getInputValue(input);
    const base = current === null ? Number(input.dataset.lastValidValue) : current;
    input.value = String(Math.max(rule.min, Math.min(rule.max, base + delta)));
    setInputValidity(input, true);
    markCustomPreset();
    refreshSettingsSummary(true);
  });
}

function getSettings() {
  const prepSeconds = getInputValue(prepInput);
  const workSeconds = getInputValue(workInput);
  const restSeconds = getInputValue(restInput);
  const rounds = getInputValue(roundsInput);
  if (prepSeconds === null || workSeconds === null || restSeconds === null || rounds === null) return null;

  const totalSeconds = workSeconds * rounds + restSeconds * (rounds - 1) + prepSeconds;
  return { prepSeconds, workSeconds, restSeconds, rounds, totalSeconds };
}

function validateSettings() {
  let isValid = true;
  for (const rule of inputRules) {
    const value = getInputValue(rule.input);
    const valid = setInputValidity(rule.input);
    isValid = isValid && value !== null && valid;
  }

  if (isValid) {
    const prepSeconds = getInputValue(prepInput);
    const workSeconds = getInputValue(workInput);
    const restSeconds = getInputValue(restInput);
    const rounds = getInputValue(roundsInput);
    if (prepSeconds !== null && workSeconds !== null && restSeconds !== null && rounds !== null) {
      const totalSeconds = workSeconds * rounds + restSeconds * (rounds - 1) + prepSeconds;
      if (totalSeconds > MAX_SESSION_SECONDS) {
        formError.textContent = "Total sesi tidak boleh lebih dari 24 jam. Kurangi durasi atau jumlah ronde.";
        return false;
      }
    }
  }

  formError.textContent = "";
  return isValid;
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function updateEstimate() {
  const settings = getSettings();
  const valuesAreInRange = inputRules.every(({ input, min, max }) => {
    const value = getInputValue(input);
    return value !== null && value >= min && value <= max;
  });

  if (!settings || !valuesAreInRange || settings.totalSeconds > MAX_SESSION_SECONDS) {
    durationEstimate.textContent = "--:--";
  } else {
    durationEstimate.textContent = formatDuration(settings.totalSeconds);
  }
  const hint = document.getElementById("work-validity-hint");
  const work = getInputValue(workInput);
  const rounds = getInputValue(roundsInput);
  const workTotal = work !== null && rounds !== null ? work * rounds : null;
  hint.hidden = testModeEnabled || workTotal === null || workTotal >= MIN_VALID_SECONDS;
}

function renderPage() {
  const isTimerPage = currentPage === "timer";
  const isJourneyPage = currentPage === "journey" || currentPage === "statistics";
  const isProfilePage = currentPage === "profile";

  settingsScreen.hidden = !isTimerPage || Boolean(session);
  workoutScreen.hidden = !isTimerPage || !Boolean(session && session.phase !== "done");
  doneScreen.hidden = !isTimerPage || !Boolean(session && session.phase === "done");
  historyScreen.hidden = !isJourneyPage;
  if (profileScreen) profileScreen.hidden = !isProfilePage;
  document.body.classList.toggle("session-overlay", !workoutScreen.hidden || !doneScreen.hidden);

  document.querySelectorAll(".nav-link").forEach((link) => {
    const isActive = link.dataset.screen === (isJourneyPage ? "journey" : isProfilePage ? "profile" : "timer");
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function isSessionRunning() {
  return Boolean(session && session.phase !== "paused" && session.phase !== "done");
}

function getPhaseDurationMs(phase) {
  if (phase === "paused") phase = session.pausedPhase;
  if (phase === "prep") return session.settings.prepSeconds * 1000;
  if (phase === "work") return session.settings.workSeconds * 1000;
  return session.settings.restSeconds * 1000;
}

function describeNextPhase() {
  const phase = session.phase === "paused" ? session.pausedPhase : session.phase;
  if (phase === "prep") return "KERJA";
  if (phase === "work") return session.round < session.settings.rounds ? "ISTIRAHAT" : "SELESAI";
  if (phase === "rest") return "KERJA";
  return "—";
}

function renderTimer(now = performance.now()) {
  if (!session) return;
  const durationMs = getPhaseDurationMs(session.phase);
  const remainingMs = session.phase === "paused" ? session.remainingMs : Math.max(0, session.deadline - now);
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const remainingFraction = durationMs > 0 ? Math.min(1, Math.max(0, remainingMs / durationMs)) : 0;
  const elapsedPercent = Math.round((1 - remainingFraction) * 100);

  timerCard.dataset.phase = session.phase;
  if (workoutScreen) workoutScreen.dataset.phase = session.phase;
  currentRound.textContent = String(Math.max(1, Math.min(session.round, session.settings.rounds)));
  totalRounds.textContent = String(session.settings.rounds);
  timerValue.textContent = String(remainingSeconds);
  timerValue.setAttribute("aria-label", `${remainingSeconds} detik tersisa`);
  const activePhase = session.phase === "paused" ? session.pausedPhase : session.phase;
  timerUnit.textContent = activePhase === "prep" ? "Detik persiapan" : "Detik";
  nextPhase.textContent = describeNextPhase();
  dialProgress.style.strokeDashoffset = String(DIAL_CIRCUMFERENCE * (1 - remainingFraction));
  timerDial.setAttribute("aria-valuenow", String(elapsedPercent));
  timerDial.setAttribute("data-warning", String(session.phase !== "paused" && remainingSeconds > 0 && remainingSeconds <= 3));
  const completedRoundCount = Math.max(0, Math.min(session.round - 1, session.settings.rounds));
  const roundTrack = document.getElementById("round-track");
  const trackState = `${session.settings.rounds}-${completedRoundCount}-${session.phase}`;
  if (roundTrack && roundTrack.dataset.state !== trackState) {
    roundTrack.dataset.state = trackState;
    roundTrack.setAttribute("aria-label", `Progres ${completedRoundCount} dari ${session.settings.rounds} ronde selesai`);
    roundTrack.replaceChildren(...Array.from({ length: session.settings.rounds }, (_, index) => {
      const dot = document.createElement("i");
      dot.className = `round-dot${index < completedRoundCount ? " done" : index === completedRoundCount ? " current" : ""}`;
      dot.setAttribute("aria-hidden", "true");
      return dot;
    }));
  }

  if (session.phase === "prep") phaseLabel.textContent = "PERSIAPAN";
  else if (session.phase === "work") phaseLabel.textContent = "KERJA";
  else if (session.phase === "rest") phaseLabel.textContent = "ISTIRAHAT";
  else if (session.phase === "paused") phaseLabel.textContent = "DIJEDA";

  pauseButton.textContent = session.phase === "paused" ? "Lanjut" : "Jeda";
}

async function initAudio() {
  if (!soundInput.checked) return null;
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    audioStatus.textContent = "Audio tidak didukung browser ini; timer tetap berjalan.";
    console.warn("Web Audio API tidak tersedia di browser ini.");
    return null;
  }

  try {
    if (!audioContext || audioContext.state === "closed") {
      audioContext = new AudioContextConstructor();
    }
    const context = audioContext;
    if (context.state === "suspended") await context.resume();
    if (audioContext !== context) return null;
    if (context.state !== "running") {
      audioStatus.textContent = "Audio belum diizinkan browser. Coba mulai ulang sesi.";
      return null;
    }
    audioStatus.textContent = "";
    return context;
  } catch (error) {
    audioStatus.textContent = "Audio tidak dapat diaktifkan. Timer tetap berjalan.";
    console.warn("AudioContext tidak dapat diaktifkan:", error);
    return null;
  }
}

function scheduleTone(context, note, generation) {
  if (generation !== audioGeneration || context.state !== "running") return;

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startAt = context.currentTime + (note.delay || 0);
  const duration = note.duration;
  const attack = Math.min(0.014, duration / 5);
  const peakAt = startAt + duration * 0.45;
  const endAt = startAt + duration;

  oscillator.type = note.type || "sine";
  oscillator.frequency.setValueAtTime(note.frequency, startAt);
  if (note.peakFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(note.peakFrequency, startAt + duration * 0.32);
    oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency || note.frequency, endAt);
  } else if (note.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency, endAt);
  }

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(note.volume, startAt + attack);
  gain.gain.setValueAtTime(note.volume, peakAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
  oscillator.connect(gain);
  gain.connect(context.destination);
  const tone = { oscillator, gain };
  activeAudioTones.add(tone);
  oscillator.addEventListener("ended", () => {
    activeAudioTones.delete(tone);
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
  oscillator.start(startAt);
  oscillator.stop(endAt + 0.01);
}

async function playNotes(notes, isEnabled = () => true) {
  if (!soundInput.checked || !isEnabled()) return;
  const generation = audioGeneration;
  const context = await initAudio();
  if (!context || generation !== audioGeneration || !soundInput.checked || !isEnabled()) return;

  try {
    for (const note of notes) scheduleTone(context, note, generation);
  } catch (error) {
    audioStatus.textContent = "Suara tidak dapat diputar. Timer tetap berjalan.";
    console.warn("Nada Web Audio tidak dapat dijadwalkan:", error);
  }
}

function playCountdownBeep(number) {
  if (!countdownInput.checked || number < 1 || number > 3) return;
  const frequency = 620 + (3 - number) * 90;
  void playNotes([{
    frequency,
    endFrequency: frequency * 1.04,
    duration: 0.105,
    volume: 0.12
  }], () => countdownInput.checked);
}

function playPhaseTransitionWhistle() {
  if (!transitionInput.checked) return;
  void playNotes([
    { frequency: 1050, peakFrequency: 1580, endFrequency: 1280, duration: 0.48, volume: 0.095 },
    { frequency: 1480, peakFrequency: 2050, endFrequency: 1650, duration: 0.42, delay: 0.025, volume: 0.045 }
  ], () => transitionInput.checked);
}

function playWorkoutCompleteSound() {
  if (!transitionInput.checked) return;
  void playNotes([
    { frequency: 659, duration: 0.22, volume: 0.1 },
    { frequency: 784, duration: 0.22, delay: 0.16, volume: 0.1 },
    { frequency: 988, duration: 0.34, delay: 0.32, volume: 0.11 }
  ], () => transitionInput.checked);
}

function stopAudioSounds() {
  if (!audioContext || activeAudioTones.size === 0) return;
  const now = audioContext.currentTime;
  for (const { oscillator, gain } of activeAudioTones) {
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0.0001, now, 0.008);
      oscillator.stop(now + 0.04);
    } catch (error) {
      console.warn("Nada aktif tidak dapat dihentikan:", error);
    }
  }
}

function closeAudioContext() {
  audioGeneration += 1;
  stopAudioSounds();
  if (!audioContext || audioContext.state === "closed") {
    audioContext = null;
    return;
  }
  const contextToClose = audioContext;
  audioContext = null;
  activeAudioTones.clear();
  contextToClose.close().catch((error) => {
    console.warn("AudioContext tidak dapat ditutup:", error);
  });
}

async function requestWakeLock() {
  if (!isSessionRunning() || document.visibilityState !== "visible") return;

  if (window.cordova) {
    if (!cordovaReady) return;
    const insomnia = window.plugins && window.plugins.insomnia;
    if (!insomnia || typeof insomnia.keepAwake !== "function") {
      setWakeStatus("Keep-awake Cordova tidak terpasang; timer tetap berjalan.");
      return;
    }
    try {
      insomnia.keepAwake();
      insomniaActive = true;
      setWakeStatus("Layar dijaga tetap menyala selama latihan.");
    } catch (error) {
      console.warn("Plugin keep-awake gagal diaktifkan:", error);
      setWakeStatus("Keep-awake tidak tersedia; timer tetap berjalan.");
    }
    return;
  }

  const screenWakeLock = navigator.wakeLock;
  if (!screenWakeLock || typeof screenWakeLock.request !== "function") {
    setWakeStatus("Fitur menjaga layar tidak tersedia di browser ini.");
    return;
  }
  if (wakeLock && !wakeLock.released) return;
  if (wakeLockRequest) return;

  try {
    const request = screenWakeLock.request("screen");
    wakeLockRequest = request;
    const requestedLock = await request;
    if (wakeLockRequest === request) wakeLockRequest = null;
    if (!isSessionRunning() || document.visibilityState !== "visible") {
      await requestedLock.release();
      return;
    }
    wakeLock = requestedLock;
    setWakeStatus("Layar dijaga tetap menyala selama latihan.");
    requestedLock.addEventListener("release", () => {
      if (wakeLock === requestedLock) wakeLock = null;
      if (isSessionRunning() && document.visibilityState === "visible") {
        requestWakeLock();
      }
    }, { once: true });
  } catch (error) {
    wakeLockRequest = null;
    console.warn("Screen Wake Lock tidak dapat diaktifkan:", error);
    setWakeStatus("Izin menjaga layar ditolak; timer tetap berjalan.");
  }
}

async function releaseWakeLock() {
  if (insomniaActive) {
    const insomnia = window.plugins && window.plugins.insomnia;
    insomniaActive = false;
    if (insomnia && typeof insomnia.allowSleepAgain === "function") {
      try {
        insomnia.allowSleepAgain();
      } catch (error) {
        console.warn("Plugin keep-awake gagal dinonaktifkan:", error);
      }
    }
  }

  const currentLock = wakeLock;
  wakeLock = null;
  if (currentLock && !currentLock.released) {
    try {
      await currentLock.release();
    } catch (error) {
      console.warn("Screen Wake Lock tidak dapat dilepas:", error);
    }
  }
  setWakeStatus("");
}

function enterPhase(phase, deadline, playWhistle = true) {
  session.phase = phase;
  session.remainingMs = getPhaseDurationMs(phase);
  session.deadline = deadline + session.remainingMs;
  countdownSecondsPlayed = new Set();

  if (workoutScreen) {
    workoutScreen.dataset.phase = phase;
    workoutScreen.classList.remove("is-sweeping");
    void workoutScreen.offsetWidth;
    workoutScreen.classList.add("is-sweeping");
  }

  dialProgress.style.transition = "none";
  dialProgress.style.strokeDashoffset = "0";
  void dialProgress.offsetWidth;
  dialProgress.style.transition = "stroke-dashoffset 0.25s linear, stroke 0.4s ease";

  renderTimer();
  timerCard.classList.remove("phase-enter");
  void timerCard.offsetWidth;
  timerCard.classList.add("phase-enter");
  if (playWhistle) playPhaseTransitionWhistle();
}

function setSessionSaveStatus(message, state = "saved") {
  const text = sessionSaveStatus.querySelector("span");
  text.textContent = message;
  sessionSaveStatus.dataset.state = state;
  // Hapus tombol retry lama jika ada
  const oldRetry = sessionSaveStatus.querySelector(".save-retry-btn");
  if (oldRetry) oldRetry.remove();
}

function showSaveRetryButton() {
  const existing = sessionSaveStatus.querySelector(".save-retry-btn");
  if (existing) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "save-retry-btn";
  btn.textContent = "Coba lagi";
  btn.style.cssText = "margin-left:4px;padding:2px 8px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;font-size:12px;cursor:pointer;font-weight:800";
  btn.addEventListener("click", () => {
    if (!session) return;
    setSessionSaveStatus("Menyimpan...", "pending");
    const timeout = window.setTimeout(() => {
      setSessionSaveStatus("Belum tersimpan - ", "error");
      showSaveRetryButton();
    }, 8000);
    session.recordSaving = false;
    void saveWorkoutRecord(session, "completed", session.settings.rounds).then(() => {
      window.clearTimeout(timeout);
      clearCachedSession();
      session._cloudSaved = true;
      setSessionSaveStatus("Tersimpan ke riwayat", "saved");
    }).catch(() => {
      window.clearTimeout(timeout);
      setSessionSaveStatus("Belum tersimpan - ", "error");
      showSaveRetryButton();
    });
  }, { once: true });
  sessionSaveStatus.appendChild(btn);
}

function animateDoneRewards() {
  const reward = document.getElementById("earned-xp");
  const finalValue = Number(reward.textContent.replace(/[^\d]/g, "")) || 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    reward.textContent = `+${finalValue}`;
    document.getElementById("done-level-fill").style.width = `${(window.HIITQuest.getProgress().totalXp % 100)}%`;
    return;
  }
  const startedAt = performance.now();
  const animate = (now) => {
    const progress = Math.min(1, (now - startedAt) / 600);
    reward.textContent = `+${Math.round(finalValue * progress)}`;
    if (progress < 1) requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
  const fill = document.getElementById("done-level-fill");
  const current = window.HIITQuest.getProgress().totalXp % 100;
  requestAnimationFrame(() => { fill.style.width = `${current}%`; });
}

function launchConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.getElementById("confetti-canvas");
  const context = canvas.getContext("2d");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  context.scale(ratio, ratio);
  const rootStyles = getComputedStyle(document.documentElement);
  const colors = ["--green", "--blue", "--orange", "--yellow", "--purple"]
    .map((token) => rootStyles.getPropertyValue(token).trim())
    .filter(Boolean);
  const pieces = Array.from({ length: 54 }, () => ({
    x: Math.random() * bounds.width,
    y: -Math.random() * bounds.height * 0.45,
    size: 4 + Math.random() * 6,
    speed: 1.8 + Math.random() * 3.2,
    drift: -1.2 + Math.random() * 2.4,
    rotate: Math.random() * Math.PI,
    color: colors[Math.floor(Math.random() * colors.length)]
  }));
  const start = performance.now();
  const draw = (now) => {
    const elapsed = now - start;
    context.clearRect(0, 0, bounds.width, bounds.height);
    for (const piece of pieces) {
      piece.y += piece.speed;
      piece.x += piece.drift;
      piece.rotate += 0.045;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.rotate);
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 1.5);
      context.restore();
    }
    if (elapsed < 1500) requestAnimationFrame(draw);
    else context.clearRect(0, 0, bounds.width, bounds.height);
  };
  requestAnimationFrame(draw);
}

function cachePendingSession(workoutSession) {
  try {
    const pending = {
      historyId: workoutSession.historyId,
      status: "completed",
      startedAt: workoutSession.startedAt.toISOString(),
      workSeconds: workoutSession.settings.workSeconds,
      restSeconds: workoutSession.settings.restSeconds,
      rounds: workoutSession.settings.rounds,
      activeElapsedMs: workoutSession.activeElapsedMs
    };
    localStorage.setItem("hiit_pending_session", JSON.stringify(pending));
  } catch (e) {
    // localStorage not available
  }
}

function clearCachedSession() {
  try { localStorage.removeItem("hiit_pending_session"); } catch (e) {}
}

function finishSession(playCompletionSound = true) {
  clearInterval(timerId);
  timerId = null;
  if (workoutScreen) workoutScreen.classList.remove("is-sweeping");
  session.activeElapsedMs += Math.max(0, performance.now() - session.activeStartedAt);
  session.activeStartedAt = null;
  session.phase = "done";
  timerCard.dataset.phase = "done";
  lastCompleted = {
    status: "completed",
    startedAt: session.startedAt,
    actualDurationSeconds: Math.max(0, Math.round(session.activeElapsedMs / 1000)),
    workDuration: session.settings.workSeconds,
    completedRounds: session.settings.rounds,
    totalRounds: session.settings.rounds,
    levelBefore: session.levelBefore
  };

  // P0 FIX: cache dulu ke localStorage agar data tidak hilang jika offline
  cachePendingSession(session);

  // Tampilkan done-screen SEGERA (<400ms, optimistic UI)
  setSessionSaveStatus("Menyimpan...", "pending");
  renderPage();
  window.dispatchEvent(new CustomEvent("hiit-session-finished"));
  animateDoneRewards();
  if (isValidRecord(lastCompleted)) launchConfetti();
  releaseWakeLock();
  if (playCompletionSound) playWorkoutCompleteSound();
  window.setTimeout(closeAudioContext, 900);

  // Simpan ke cloud di background (non-blocking), timeout 8 detik
  const saveTimeout = window.setTimeout(() => {
    if (!session || session._cloudSaved) return;
    setSessionSaveStatus("Belum tersimpan - ", "error");
    showSaveRetryButton();
  }, 8000);
  const sessionRef = session;
  void saveWorkoutRecord(session, "completed", session.settings.rounds).then(() => {
    window.clearTimeout(saveTimeout);
    clearCachedSession();
    sessionRef._cloudSaved = true;
    setSessionSaveStatus("Tersimpan ke riwayat", "saved");
  }).catch(() => {
    window.clearTimeout(saveTimeout);
    setSessionSaveStatus("Belum tersimpan - ", "error");
    showSaveRetryButton();
  });
}

function advancePhase(previousDeadline, playPhaseSound) {
  if (session.phase === "prep") {
    session.round = 1;
    enterPhase("work", previousDeadline, playPhaseSound);
  } else if (session.phase === "work") {
    if (session.round >= session.settings.rounds) {
      finishSession(playPhaseSound);
    } else {
      enterPhase("rest", previousDeadline, playPhaseSound);
    }
  } else if (session.phase === "rest") {
    session.round += 1;
    enterPhase("work", previousDeadline, playPhaseSound);
  }
}

function playCountdownForCurrentPhase(now) {
  if (!soundInput.checked || !countdownInput.checked) return;
  if (session.phase !== "work" && session.phase !== "rest" && session.phase !== "prep") return;
  if (document.visibilityState !== "visible") return;

  const secondsRemaining = Math.ceil(Math.max(0, session.deadline - now) / 1000);
  if (secondsRemaining < 1 || secondsRemaining > 3 || countdownSecondsPlayed.has(secondsRemaining)) return;
  countdownSecondsPlayed.add(secondsRemaining);
  playCountdownBeep(secondsRemaining);
}

function tick() {
  if (!isSessionRunning()) return;

  const now = performance.now();
  // Deadline absolut mencegah keterlambatan interval menggeser waktu dan urutan fase.
  while (isSessionRunning() && now >= session.deadline) {
    const previousDeadline = session.deadline;
    const canPlayPhaseSound = document.visibilityState === "visible" && now - previousDeadline <= 1000;
    advancePhase(previousDeadline, canPlayPhaseSound);
  }

  if (isSessionRunning()) {
    renderTimer(now);
    playCountdownForCurrentPhase(now);
  }
}

function startTicker() {
  if (timerId !== null) clearInterval(timerId);
  timerId = window.setInterval(tick, 100);
  tick();
}

function startSession(settings) {
  lastStartedSettings = { ...settings };
  clearInterval(timerId);
  timerId = null;
  closeAudioContext();
  countdownSecondsPlayed = new Set();
  const initialPhase = settings.prepSeconds > 0 ? "prep" : "work";
  const initialDuration = settings.prepSeconds > 0 ? settings.prepSeconds : settings.workSeconds;
  session = {
    settings,
    startedAt: new Date(),
    soundPreferences: {
      enabled: soundInput.checked,
      countdown: countdownInput.checked,
      transitions: transitionInput.checked
    },
    phase: initialPhase,
    round: settings.prepSeconds > 0 ? 0 : 1,
    deadline: performance.now() + initialDuration * 1000,
    remainingMs: initialDuration * 1000
  };
  session.historyId = window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  session.activeStartedAt = performance.now();
  session.activeElapsedMs = 0;
  session.levelBefore = window.HIITQuest.getProgress().level;

  if (workoutScreen) {
    workoutScreen.dataset.phase = initialPhase;
    workoutScreen.classList.remove("is-sweeping");
    void workoutScreen.offsetWidth;
    workoutScreen.classList.add("is-sweeping");
  }

  dialProgress.style.transition = "none";
  dialProgress.style.strokeDashoffset = "0";
  void dialProgress.offsetWidth;
  dialProgress.style.transition = "stroke-dashoffset 0.25s linear, stroke 0.4s ease";

  renderPage();
  renderTimer();
  void initAudio();
  requestWakeLock();
  startTicker();
}

function resetToSettings() {
  const stopDialog = document.getElementById("stop-confirmation-modal");
  if (stopDialog.open) stopDialog.close();
  if (workoutScreen) workoutScreen.classList.remove("is-sweeping");
  if (session && session.phase !== "done") void saveWorkoutRecord(session, "cancelled", getCompletedRounds(session));
  clearInterval(timerId);
  timerId = null;
  session = null;
  countdownSecondsPlayed = new Set();
  releaseWakeLock();
  closeAudioContext();
  renderPage();
}

function pauseOrResume() {
  if (!session || session.phase === "done") return;

  if (session.phase === "paused") {
    // Lanjutkan dari sisa waktu yang disimpan, bukan mengulang durasi fase.
    session.deadline = performance.now() + session.remainingMs;
    session.phase = session.pausedPhase;
    session.activeStartedAt = performance.now();
    delete session.pausedPhase;
    renderTimer();
    requestWakeLock();
    startTicker();
    return;
  }

  session.activeElapsedMs += Math.max(0, performance.now() - session.activeStartedAt);
  session.remainingMs = Math.max(0, session.deadline - performance.now());
  session.pausedPhase = session.phase;
  session.phase = "paused";
  clearInterval(timerId);
  timerId = null;
  renderTimer();
  releaseWakeLock();
}

function goBackToSettings() {
  if (session && session.phase !== "done") {
    const shouldLeave = window.confirm("Latihan yang sedang berlangsung akan dihentikan. Kembali ke pengaturan?");
    if (!shouldLeave) return;
  }
  if (session && session.phase !== "done") void saveWorkoutRecord(session, "cancelled", getCompletedRounds(session));
  resetToSettings();
}

function isFirebaseConfigured(config) {
  return Boolean(config && config.apiKey && config.authDomain && config.projectId && config.appId && !Object.values(config).some((value) => String(value).includes("YOUR_")));
}

function setHistoryFeedback(message, retryAction) {
  historyFeedback.replaceChildren();
  const isLoading = historyLoadState === "connecting" || historyLoadState === "loading";
  historyFeedback.toggleAttribute("data-loading", isLoading);
  historyFeedback.setAttribute("aria-busy", String(isLoading));
  if (!message) return;
  const copy = document.createElement("span");
  copy.textContent = message;
  historyFeedback.append(copy);
  if (retryAction) {
    const retryButton = document.createElement("button");
    retryButton.className = "text-button retry-button";
    retryButton.type = "button";
    retryButton.textContent = "Coba lagi";
    retryButton.addEventListener("click", retryAction, { once: true });
    historyFeedback.append(retryButton);
  }
}

function getCompletedRounds(workoutSession) {
  if (workoutSession.phase === "done") return workoutSession.settings.rounds;
  const activePhase = workoutSession.phase === "paused" ? workoutSession.pausedPhase : workoutSession.phase;
  if (activePhase === "prep") return 0;
  if (activePhase === "rest") return Math.min(workoutSession.round, workoutSession.settings.rounds);
  return Math.max(0, Math.min(workoutSession.round - 1, workoutSession.settings.rounds));
}

async function saveWorkoutRecord(workoutSession, status, roundsCompleted) {
  if (!workoutSession || workoutSession.recordSaved || workoutSession.recordSaving) return;

  if (!navigator.onLine) {
    if (status === "completed") {
      setSessionSaveStatus("Belum tersimpan - ", "error");
      showSaveRetryButton();
    }
    throw new Error("Offline");
  }

  if (!firebaseModules || !firestore || !currentUser) {
    if (isFirebaseConfigured(window.HIIT_FIREBASE_CONFIG)) {
      if (workoutSession.recordQueued) return;
      workoutSession.recordQueued = true;
      pendingWorkoutSaves.add({ workoutSession, status, roundsCompleted });
      if (status === "completed") setSessionSaveStatus("Menyimpan...", "pending");
      void initializeFirebase();
      return;
    }
    const message = "Sesi ini belum tersimpan ke cloud. Periksa konfigurasi Firebase dan autentikasi.";
    if (status === "completed") {
      setSessionSaveStatus("Belum tersimpan - ", "error");
      showSaveRetryButton();
    }
    setHistoryFeedback(message);
    throw new Error("Firebase unconfigured");
  }

  workoutSession.recordSaving = true;
  if (status === "completed") setSessionSaveStatus("Menyimpan...", "pending");
  const endedAt = new Date();
  const activeMs = workoutSession.activeElapsedMs + (workoutSession.phase === "paused" || workoutSession.phase === "done" ? 0 : Math.max(0, performance.now() - workoutSession.activeStartedAt));
  const record = {
    name: "Latihan HIIT",
    status,
    startedAt: workoutSession.startedAt,
    completedAt: endedAt,
    actualDurationSeconds: Math.max(0, Math.round(activeMs / 1000)),
    workDuration: workoutSession.settings.workSeconds,
    restDuration: workoutSession.settings.restSeconds,
    preparationDuration: workoutSession.settings.prepSeconds,
    totalRounds: workoutSession.settings.rounds,
    completedRounds: roundsCompleted,
    sound: {
      enabled: workoutSession.soundPreferences.enabled,
      countdown: workoutSession.soundPreferences.countdown,
      transitions: workoutSession.soundPreferences.transitions
    }
  };

  try {
    const { doc, serverTimestamp, setDoc } = firebaseModules;
    record.createdAt = serverTimestamp();
    await setDoc(doc(firestore, "users", currentUser.uid, "workoutHistory", workoutSession.historyId), record);
    workoutSession.recordSaved = true;
    workoutSession._cloudSaved = true;
    if (status === "completed") {
      setSessionSaveStatus("Tersimpan ke riwayat", "saved");
    }
    setHistoryFeedback("Sesi berhasil disimpan ke riwayat cloud.");
    retryHistoryLoad();
  } catch (error) {
    workoutSession.recordSaving = false;
    console.error("Riwayat latihan tidak dapat disimpan:", error);
    if (status === "completed") {
      setSessionSaveStatus("Belum tersimpan - ", "error");
      showSaveRetryButton();
    }
    setHistoryFeedback("Sesi tidak dapat disimpan. Periksa koneksi dan aturan Firestore.", retryHistoryLoad);
    throw error;
  }
}

window.addEventListener("online", () => {
  if (session && !session._cloudSaved) {
    setSessionSaveStatus("Menyimpan...", "pending");
    session.recordSaving = false;
    void saveWorkoutRecord(session, "completed", session.settings.rounds).then(() => {
      setSessionSaveStatus("Tersimpan ke riwayat", "saved");
      clearCachedSession();
      session._cloudSaved = true;
    }).catch(() => {
      setSessionSaveStatus("Belum tersimpan - ", "error");
      showSaveRetryButton();
    });
  }
});

function flushPendingWorkoutSaves() {
  if (!currentUser || !firestore || !firebaseModules) return;
  const pending = [...pendingWorkoutSaves];
  pendingWorkoutSaves.clear();
  for (const item of pending) {
    item.workoutSession.recordQueued = false;
    void saveWorkoutRecord(item.workoutSession, item.status, item.roundsCompleted);
  }
}

function parseHistoryRecord(id, data) {
  if (!data || (data.status !== "completed" && data.status !== "cancelled")) return null;
  const startedAt = data.startedAt && typeof data.startedAt.toDate === "function" ? data.startedAt.toDate() : (data.startedAt instanceof Date ? data.startedAt : null);
  if (!startedAt || Number.isNaN(startedAt.getTime())) return null;

  const numericFields = [
    "actualDurationSeconds", "workDuration", "restDuration", "preparationDuration",
    "totalRounds", "completedRounds"
  ];
  const parsed = {};
  for (const field of numericFields) {
    const value = data[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) parsed[field] = value;
  }

  return {
    id,
    name: typeof data.name === "string" && data.name.trim() ? data.name : "Latihan HIIT",
    status: data.status,
    startedAt,
    completedAt: data.completedAt && typeof data.completedAt.toDate === "function" ? data.completedAt.toDate() : null,
    ...parsed,
    sound: data.sound && typeof data.sound === "object" ? data.sound : null
  };
}

function formatDateTime(date, includeTime = true) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {})
  }).format(date);
}

function formatCompactDuration(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  if (hours > 0) return `${hours} j${minutes ? ` ${minutes} mnt` : ""}`;
  if (minutes > 0) return `${minutes} mnt${remainingSeconds ? ` ${remainingSeconds} dtk` : ""}`;
  return `${wholeSeconds} dtk`;
}

function formatClockDuration(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getLocalDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getWorkSeconds(record) {
  return Math.max(0, (record.workDuration || 0) * (record.completedRounds || 0));
}

function isValidRecord(record) {
  return testModeEnabled || getWorkSeconds(record) >= MIN_VALID_SECONDS;
}

function getRecordXp(record) {
  return record.status === "completed" && isValidRecord(record)
    ? 20 + (record.completedRounds || 0) * 10
    : 0;
}

function getDateRangeRecords(records = historyRecords, range = selectedRange) {
  if (range === "all") return records;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (Number(range) - 1));
  return records.filter((record) => record.startedAt >= start);
}

function getLongestStreak(records) {
  const dates = [...new Set(records.filter(isValidRecord).map((record) => getLocalDateKey(record.startedAt)))].sort();
  let longest = 0;
  let current = 0;
  let previous = null;
  for (const key of dates) {
    const [year, month, day] = key.split("-").map(Number);
    const date = Date.UTC(year, month - 1, day);
    current = previous !== null && date - previous === 86400000 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = date;
  }
  return longest;
}

function renderActivityChart() {
  const container = document.getElementById("activity-chart");
  const now = new Date();
  const todayKey = getLocalDateKey(now);
  const totals = new Map();
  for (const record of historyRecords) {
    const key = getLocalDateKey(record.startedAt);
    totals.set(key, (totals.get(key) || 0) + (record.actualDurationSeconds || 0));
  }
  const values = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index));
    const key = getLocalDateKey(date);
    return { date, key, seconds: totals.get(key) || 0 };
  });
  const maximumSeconds = Math.max(0, ...values.map((value) => value.seconds));
  const useMinutes = maximumSeconds >= 120;
  const scaleMaximum = Math.max(1, maximumSeconds);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 -24 700 184");
  svg.setAttribute("role", "presentation");
  svg.setAttribute("aria-hidden", "true");
  const baseline = 138;
  const maxBarHeight = 108;
  const slotWidth = 100;
  if (useMinutes) {
    const target = document.createElementNS(svg.namespaceURI, "line");
    const targetY = Math.max(26, baseline - (600 / scaleMaximum) * maxBarHeight);
    target.setAttribute("x1", "18");
    target.setAttribute("x2", "682");
    target.setAttribute("y1", String(targetY));
    target.setAttribute("y2", String(targetY));
    target.setAttribute("class", "chart-target-line");
    svg.append(target);
  }
  values.forEach((value, index) => {
    const group = document.createElementNS(svg.namespaceURI, "g");
    const barHeight = value.seconds ? Math.max(6, (value.seconds / scaleMaximum) * maxBarHeight) : 6;
    const x = index * slotWidth + 25;
    const y = baseline - barHeight;
    const bar = document.createElementNS(svg.namespaceURI, "rect");
    bar.setAttribute("x", String(x));
    bar.setAttribute("y", String(y));
    bar.setAttribute("width", "50");
    bar.setAttribute("height", String(barHeight));
    bar.setAttribute("rx", "13");
    bar.setAttribute("class", `chart-bar${value.seconds ? value.key === todayKey ? " today" : " active" : " empty"}`);
    // P2: label nilai hanya untuk hari dengan data > 0; hari kosong tidak tampilkan "0 dtk"
    const labelItems = [bar];
    if (value.seconds > 0) {
      const amount = document.createElementNS(svg.namespaceURI, "text");
      amount.setAttribute("x", String(x + 25));
      amount.setAttribute("y", String(Math.max(-16, y - 9)));
      amount.setAttribute("text-anchor", "middle");
      amount.setAttribute("class", "chart-value");
      amount.textContent = useMinutes
        ? `${(value.seconds / 60).toFixed(value.seconds % 60 ? 1 : 0)} mnt`
        : `${Math.floor(value.seconds)} dtk`;
      labelItems.push(amount);
    }
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", String(x + 25));
    label.setAttribute("y", "154");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "chart-day");
    label.textContent = new Intl.DateTimeFormat("id-ID", { weekday: "short" }).format(value.date);
    labelItems.push(label);
    group.append(...labelItems);
    svg.append(group);
  });
  container.replaceChildren(svg);
}

function renderHistoryStats() {
  if (historyLoadState !== "ready") {
    resetHistoryStats();
    return;
  }
  const records = getDateRangeRecords();
  const totalDurationSeconds = records.reduce((sum, record) => sum + (record.actualDurationSeconds || 0), 0);
  const totalXp = records.reduce((sum, record) => sum + getRecordXp(record), 0);
  const validSessions = records.filter(isValidRecord).length;
  document.getElementById("stat-activities").textContent = String(records.length);
  document.getElementById("stat-valid-caption").textContent = `${validSessions} sah untuk streak`;
  document.getElementById("stat-duration").textContent = formatCompactDuration(totalDurationSeconds) || "0 dtk";
  document.getElementById("stat-total-xp").textContent = String(totalXp);
  document.getElementById("stat-longest-streak").textContent = String(getLongestStreak(records));
  renderActivityChart();
}

function makeHistoryIcon(record) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const isTabata = record.workDuration === 20 && record.restDuration === 10;
  const isBeginner = record.workDuration === 30 && record.restDuration === 30;
  const isStrong = record.workDuration === 45 && record.restDuration === 15;
  const shape = isTabata
    ? { d: "M12 2 Q12 12 2 12 Q12 12 12 22 Q12 12 22 12 Q12 12 12 2 Z", fill: "currentColor", stroke: "none" }
    : isBeginner
      ? { d: "M12 3 L4 6.5 V12 C4 17 7.5 20.5 12 22 C16.5 20.5 20 17 20 12 V6.5 L12 3 Z M9 12 L11 14 L15 10", fill: "none", stroke: "currentColor" }
      : isStrong
        ? { d: "M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12", fill: "none", stroke: "currentColor" }
        : { d: "M4 7h16M4 17h16M8 4v6M16 14v6", fill: "none", stroke: "currentColor" };
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", shape.d);
  path.setAttribute("fill", shape.fill);
  path.setAttribute("stroke", shape.stroke || "currentColor");
  if (shape.stroke !== "none") {
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  svg.append(path);
  return svg;
}

function renderHistoryList() {
  historyList.replaceChildren();
  if (historyLoadState !== "ready") {
    loadMoreButton.hidden = true;
    return;
  }
  const filtered = getDateRangeRecords().slice().sort((first, second) => second.startedAt - first.startedAt);
  historyCount.textContent = `${filtered.length} aktivitas`;
  if (filtered.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = historyRecords.length === 0 ? "history-empty" : "history-range-empty";
    if (historyRecords.length > 0) {
      const message = document.createElement("p");
      message.textContent = "Tidak ada sesi pada rentang ini.";
      emptyState.append(message);
      historyList.append(emptyState);
      loadMoreButton.hidden = true;
      return;
    }
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 100 100");
    icon.setAttribute("width", "120");
    icon.setAttribute("height", "120");
    icon.setAttribute("class", "empty-mascot");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<path d="M50 8 C53 19, 63 26, 68 28 C74 30, 80 25, 76 37 C85 43, 89 54, 88 67 C87 81, 74 92, 50 92 C26 92, 13 81, 12 67 C11 55, 17 45, 26 39 C24 33, 27 27, 33 26 C36 31, 41 33, 42 27 C44 20, 47 12, 50 8 Z" fill="var(--orange)" stroke="var(--orange-shadow)" stroke-width="3" stroke-linejoin="round"/><path d="M50 42 C56 48, 64 54, 66 63 C69 74, 62 84, 50 84 C38 84, 31 74, 34 63 C36 54, 44 48, 50 42 Z" fill="var(--yellow)"/><ellipse cx="32" cy="69" rx="5" ry="3.2" fill="var(--orange-shadow)" opacity="0.35"/><ellipse cx="68" cy="69" rx="5" ry="3.2" fill="var(--orange-shadow)" opacity="0.35"/><g fill="var(--button-text)"><ellipse cx="38" cy="63" rx="4.5" ry="5.5"/><ellipse cx="62" cy="63" rx="4.5" ry="5.5"/></g><circle cx="36.5" cy="61" r="1.8" fill="#FFFFFF"/><circle cx="60.5" cy="61" r="1.8" fill="#FFFFFF"/><circle cx="39.5" cy="64.5" r="0.8" fill="#FFFFFF"/><circle cx="63.5" cy="64.5" r="0.8" fill="#FFFFFF"/><path d="M44 72 Q50 78 56 72" fill="none" stroke="var(--button-text)" stroke-width="3" stroke-linecap="round"/>';
    const title = document.createElement("h3");
    title.textContent = "Belum ada jejak latihan";
    const startButton = document.createElement("button");
    startButton.className = "button primary";
    startButton.type = "button";
    startButton.textContent = "MULAI LATIHAN";
    startButton.addEventListener("click", () => navigateTo("timer"));
    emptyState.append(icon, title, startButton);
    historyList.append(emptyState);
    loadMoreButton.hidden = true;
    return;
  }

  const visible = filtered.slice(0, visibleHistoryCount);
  let currentGroup = "";
  const now = new Date();
  const todayKey = getLocalDateKey(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = getLocalDateKey(yesterday);
  for (const record of visible) {
    const groupKey = getLocalDateKey(record.startedAt);
    if (groupKey !== currentGroup) {
      currentGroup = groupKey;
      const heading = document.createElement("h3");
      heading.className = "history-date-heading";
      heading.textContent = groupKey === todayKey ? "Hari ini" : groupKey === yesterdayKey
        ? "Kemarin"
        : new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short" }).format(record.startedAt);
      historyList.append(heading);
    }
    const card = document.createElement("article");
    card.className = "history-item";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Detail ${record.name}`);
    card.addEventListener("click", () => showHistoryDetail(record));
    card.addEventListener("keydown", (event) => {
      if (event.target === card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        showHistoryDetail(record);
      }
    });
    const icon = makeHistoryIcon(record);
    icon.classList.add("history-icon", `preset-icon-${record.workDuration === 20 && record.restDuration === 10 ? "tabata" : record.workDuration === 30 && record.restDuration === 30 ? "beginner" : record.workDuration === 45 && record.restDuration === 15 ? "strong" : "custom"}`);
    const body = document.createElement("div");
    body.className = "history-item-body";
    const title = document.createElement("h3");
    const presetName = record.workDuration === 20 && record.restDuration === 10 ? "Tabata"
      : record.workDuration === 30 && record.restDuration === 30 ? "Pemula"
      : record.workDuration === 45 && record.restDuration === 15 ? "Kuat"
      : "Kustom";
    const interval = record.workDuration !== undefined && record.restDuration !== undefined
      ? ` ${record.workDuration}/${record.restDuration}` : "";
    title.textContent = `${presetName}${interval} - ${record.totalRounds || 0} ronde`;
    const description = document.createElement("p");
    description.className = "history-item-description";
    const duration = formatClockDuration(record.actualDurationSeconds || 0);
    const rounds = `${record.completedRounds || 0}/${record.totalRounds || 0} ronde`;
    description.textContent = `${duration} - ${rounds}`;
    body.append(title, description);
    const badge = document.createElement("span");
    const xp = getRecordXp(record);
    badge.className = xp ? "history-xp-badge" : `history-status-badge${record.status === "completed" ? " too-short" : ""}`;
    badge.textContent = xp ? `+${xp} XP` : record.status === "completed"
      ? isValidRecord(record) ? "+0 XP" : "Terlalu singkat"
      : "Belum tuntas";
    card.append(icon, body, badge);
    historyList.append(card);
  }
  loadMoreButton.hidden = visible.length >= filtered.length;
}

function renderDetailRow(label, value) {
  if (value === null || value === undefined || value === "") return;
  const row = document.createElement("div");
  row.className = "detail-row";
  const rowLabel = document.createElement("span");
  rowLabel.textContent = label;
  const rowValue = document.createElement("strong");
  rowValue.textContent = value;
  row.append(rowLabel, rowValue);
  detailContent.append(row);
}

function showHistoryDetail(record) {
  const preset = record.workDuration === 20 && record.restDuration === 10 ? "Tabata"
    : record.workDuration === 30 && record.restDuration === 30 ? "Pemula"
    : record.workDuration === 45 && record.restDuration === 15 ? "Kuat" : "Kustom";
  document.getElementById("detail-title").textContent = `${preset} · ${record.totalRounds || 0} ronde`;
  detailContent.replaceChildren();
  renderDetailRow("Tanggal", formatDateTime(record.startedAt));
  renderDetailRow("Durasi latihan", formatCompactDuration(record.actualDurationSeconds || 0));
  renderDetailRow("Persiapan", record.preparationDuration !== undefined ? `${record.preparationDuration} detik` : null);
  renderDetailRow("Durasi KERJA", record.workDuration !== undefined ? `${record.workDuration} detik` : null);
  renderDetailRow("Durasi ISTIRAHAT", record.restDuration !== undefined ? `${record.restDuration} detik` : null);
  renderDetailRow("Ronde direncanakan", record.totalRounds);
  renderDetailRow("Ronde selesai", record.completedRounds);
  renderDetailRow("Status", record.status === "completed" ? "Selesai" : "Belum tuntas");
  renderDetailRow("XP didapat", `+${getRecordXp(record)} XP`);
  if (record.sound) {
    const soundDetails = [
      typeof record.sound.enabled === "boolean" ? `Suara ${record.sound.enabled ? "aktif" : "nonaktif"}` : null,
      typeof record.sound.countdown === "boolean" ? `Countdown ${record.sound.countdown ? "aktif" : "nonaktif"}` : null,
      typeof record.sound.transitions === "boolean" ? `Peluit ${record.sound.transitions ? "aktif" : "nonaktif"}` : null
    ].filter(Boolean);
    if (soundDetails.length) renderDetailRow("Pengaturan suara", soundDetails.join(" · "));
  }
  detailActions.replaceChildren();
  const repeatButton = document.createElement("button");
  repeatButton.className = "button primary full";
  repeatButton.type = "button";
  repeatButton.textContent = "Ulangi latihan ini";
  repeatButton.addEventListener("click", () => {
    prepInput.value = String(record.preparationDuration !== undefined ? record.preparationDuration : 3);
    workInput.value = String(record.workDuration || 30);
    restInput.value = String(record.restDuration || 15);
    roundsInput.value = String(record.totalRounds || 8);
    for (const input of [prepInput, workInput, restInput, roundsInput]) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    historyDialog.close();
    navigateTo("timer");
  });
  const deleteButton = document.createElement("button");
  deleteButton.className = "text-button delete-history-button";
  deleteButton.type = "button";
  deleteButton.textContent = "Hapus sesi";
  deleteButton.addEventListener("click", () => deleteHistoryRecord(record));
  detailActions.append(repeatButton, deleteButton);
  if (typeof historyDialog.showModal === "function") historyDialog.showModal();
  else historyDialog.setAttribute("open", "");
}

async function deleteHistoryRecord(record) {
  if (!currentUser || !firebaseModules || !firestore) {
    setHistoryFeedback("Autentikasi Firebase belum siap untuk menghapus riwayat cloud.");
    return;
  }
  if (!window.confirm("Hapus riwayat latihan ini? Tindakan ini tidak dapat dibatalkan.")) return;
  try {
    const { deleteDoc, doc } = firebaseModules;
    await deleteDoc(doc(firestore, "users", currentUser.uid, "workoutHistory", record.id));
    setHistoryFeedback("Riwayat latihan berhasil dihapus.");
    loadHistory();
  } catch (error) {
    console.error("Riwayat latihan tidak dapat dihapus:", error);
    setHistoryFeedback("Riwayat tidak dapat dihapus. Periksa koneksi dan aturan Firestore.", retryHistoryLoad);
  }
}

function loadHistory() {
  if (!currentUser || !firestore || !firebaseModules) {
    historyLoadState = "error";
    historyCount.textContent = "Riwayat belum tersedia";
    setHistoryFeedback("Autentikasi atau koneksi Firebase belum siap.", retryHistoryLoad);
    return;
  }

  const requestId = ++historyRequestId;
  if (historyLoadTimeout) window.clearTimeout(historyLoadTimeout);
  historyLoadState = "loading";
  historyRecords = [];
  resetHistoryStats();
  setHistoryFeedback("Memuat riwayat latihan…");
  historyList.replaceChildren();
  historyCount.textContent = "Memuat…";

  historyLoadTimeout = window.setTimeout(() => {
    if (requestId !== historyRequestId || historyLoadState !== "loading") return;
    historyLoadTimeout = null;
    historyLoadState = "error";
    historyCount.textContent = "Riwayat belum tersedia";
    setHistoryFeedback("Permintaan riwayat terlalu lama. Periksa koneksi dan akses Firestore, lalu coba lagi.", retryHistoryLoad);
  }, 12000);

  void (async () => {
    try {
      const { collection, getDocs, orderBy, query } = firebaseModules;
      const recordsQuery = query(
        collection(firestore, "users", currentUser.uid, "workoutHistory"),
        orderBy("startedAt", "desc")
      );
      const snapshot = await getDocs(recordsQuery);
      if (requestId !== historyRequestId || historyLoadState !== "loading") return;
      if (historyLoadTimeout) window.clearTimeout(historyLoadTimeout);
      historyLoadTimeout = null;
      historyRecords = snapshot.docs
        .map((document) => parseHistoryRecord(document.id, document.data()))
        .filter(Boolean)
        .sort((first, second) => second.startedAt - first.startedAt);
      historyLoadState = "ready";
      const rejectedCount = snapshot.size - historyRecords.length;
      setHistoryFeedback(rejectedCount > 0
        ? `${rejectedCount} catatan tidak dapat dibaca karena format datanya tidak lengkap.`
        : "");
      renderHistoryStats();
      renderHistoryList();
      window.dispatchEvent(new CustomEvent("hiit-history-updated"));
    } catch (error) {
      if (requestId !== historyRequestId) return;
      if (historyLoadTimeout) window.clearTimeout(historyLoadTimeout);
      historyLoadTimeout = null;
      historyLoadState = "error";
      historyRecords = [];
      historyCount.textContent = "Riwayat tidak tersedia";
      setHistoryFeedback(getHistoryErrorMessage(error), retryHistoryLoad);
    }
  })();
}

function resetHistoryStats() {
  document.getElementById("stat-activities").textContent = "—";
  document.getElementById("stat-valid-caption").textContent = "— sah untuk streak";
  document.getElementById("stat-duration").textContent = "—";
  document.getElementById("stat-total-xp").textContent = "—";
  document.getElementById("stat-longest-streak").textContent = "—";
  document.getElementById("activity-chart").replaceChildren();
  historyList.replaceChildren();
  loadMoreButton.hidden = true;
}

function navigateTo(destination) {
  const pages = ["timer", "journey", "profile", "history", "statistics"];
  if (!pages.includes(destination)) return;
  currentPage = destination;
  renderPage();
  if (["journey", "history", "statistics"].includes(destination)) {
    retryHistoryLoad();
    renderHistoryStats();
    renderHistoryList();
  }
}

async function initializeFirebase() {
  const config = window.HIIT_FIREBASE_CONFIG;
  if (!isFirebaseConfigured(config)) {
    historyLoadState = "unconfigured";
    historyCount.textContent = "Cloud belum diatur";
    resetHistoryStats();
    setHistoryFeedback("Firebase belum dikonfigurasi. Isi firebase-config.js untuk mengaktifkan riwayat cloud.");
    return;
  }

  if (firebaseModules && firebaseAuth && firestore) {
    if (currentUser) loadHistory();
    else void loginAnonim();
    return;
  }
  if (firebaseInitPromise) return firebaseInitPromise;

  historyLoadState = "connecting";
  historyCount.textContent = "Menghubungkan…";
  setHistoryFeedback("Menghubungkan ke Firebase…");
  firebaseInitPromise = (async () => {
    if (firebaseInitTimeout) window.clearTimeout(firebaseInitTimeout);
    firebaseInitTimeout = window.setTimeout(() => {
      if (historyLoadState !== "connecting") return;
      historyLoadState = "error";
      historyCount.textContent = "Firebase belum tersedia";
      setHistoryFeedback("Firebase belum merespons. Periksa koneksi, konfigurasi, dan Anonymous sign-in.", retryHistoryLoad);
    }, 12000);

    try {
      const version = "13.1.0";
      const [appModule, authModule, firestoreModule] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
      ]);
      firebaseModules = { ...authModule, ...firestoreModule };
      const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(config);
      firebaseAuth = authModule.getAuth(app);
      firestore = firestoreModule.getFirestore(app);
      authModule.onAuthStateChanged(firebaseAuth, (user) => {
        const userChanged = currentUser?.uid !== user?.uid;
        currentUser = user;
        if (firebaseInitTimeout) window.clearTimeout(firebaseInitTimeout);
        firebaseInitTimeout = null;
        if (user) {
          console.log("User ID:", user.uid, "Apakah Anonim?", user.isAnonymous);
          if (userChanged || ["idle", "error", "connecting", "unconfigured"].includes(historyLoadState)) loadHistory();
          flushPendingWorkoutSaves();
        } else {
          console.log("Pengguna sudah sign-out");
          historyLoadState = "connecting";
          historyCount.textContent = "Menyiapkan riwayat…";
          setHistoryFeedback("Menyiapkan riwayat pribadi…");
          void loginAnonim();
        }
      }, (error) => {
        console.error("Status autentikasi Firebase gagal diperiksa:", error);
        if (firebaseInitTimeout) window.clearTimeout(firebaseInitTimeout);
        firebaseInitTimeout = null;
        historyLoadState = "error";
        historyCount.textContent = "Autentikasi gagal";
        setHistoryFeedback("Status autentikasi tidak dapat diperiksa. Coba lagi.", retryHistoryLoad);
      });
    } catch (error) {
      console.error("Firebase gagal diinisialisasi:", error);
      if (firebaseInitTimeout) window.clearTimeout(firebaseInitTimeout);
      firebaseInitTimeout = null;
      historyLoadState = "error";
      historyCount.textContent = "Firebase tidak tersedia";
      setHistoryFeedback("Firebase tidak dapat dihubungkan. Periksa koneksi dan konfigurasi Firebase.", retryHistoryLoad);
    }
  })();
  try {
    await firebaseInitPromise;
  } finally {
    firebaseInitPromise = null;
  }
}

async function loginAnonim() {
  if (!firebaseAuth || !firebaseModules || anonymousSignInPending) return;
  anonymousSignInPending = true;
  const attemptId = ++anonymousSignInAttemptId;
  historyLoadState = "connecting";
  historyCount.textContent = "Menyiapkan riwayat…";
  setHistoryFeedback("Menyiapkan riwayat pribadi…");
  if (firebaseInitTimeout) window.clearTimeout(firebaseInitTimeout);
  firebaseInitTimeout = window.setTimeout(() => {
    if (attemptId !== anonymousSignInAttemptId || historyLoadState !== "connecting") return;
    anonymousSignInPending = false;
    historyLoadState = "error";
    historyCount.textContent = "Autentikasi belum tersedia";
    setHistoryFeedback("Firebase Authentication belum merespons. Aktifkan Anonymous sign-in, periksa koneksi, lalu coba lagi.", retryHistoryLoad);
  }, 12000);
  try {
    const credential = await firebaseModules.signInAnonymously(firebaseAuth);
    if (attemptId !== anonymousSignInAttemptId) return;
    console.log("Berhasil masuk secara anonim!");
    const userChanged = currentUser?.uid !== credential.user.uid;
    currentUser = credential.user;
    if (firebaseInitTimeout) window.clearTimeout(firebaseInitTimeout);
    firebaseInitTimeout = null;
    if (userChanged || ["idle", "error", "connecting", "unconfigured"].includes(historyLoadState)) loadHistory();
    flushPendingWorkoutSaves();
  } catch (error) {
    if (attemptId !== anonymousSignInAttemptId) return;
    console.error("Autentikasi anonim Firebase gagal:", error);
    if (firebaseInitTimeout) window.clearTimeout(firebaseInitTimeout);
    firebaseInitTimeout = null;
    historyLoadState = "error";
    historyCount.textContent = "Login anonim gagal";
    const authErrorMessages = {
      "auth/configuration-not-found": "Firebase Authentication belum dikonfigurasi untuk proyek ini. Aktifkan Authentication di Firebase Console, lalu coba lagi.",
      "auth/operation-not-allowed": "Login anonim belum diaktifkan. Buka Firebase Console → Authentication → Sign-in method, aktifkan Anonymous, lalu coba lagi."
    };
    const message = authErrorMessages[error?.code]
      || "Login anonim gagal. Periksa konfigurasi Firebase Authentication dan koneksi internet, lalu coba lagi.";
    setHistoryFeedback(message, retryHistoryLoad);
  } finally {
    if (attemptId === anonymousSignInAttemptId) anonymousSignInPending = false;
  }
}

function retryHistoryLoad() {
  if (currentUser && firestore && firebaseModules) {
    loadHistory();
    return;
  }
  if (firebaseAuth && firebaseModules) {
    void loginAnonim();
    return;
  }
  void initializeFirebase();
}

function getHistoryErrorMessage(error) {
  console.error("Riwayat latihan tidak dapat dimuat:", error);
  if (error && error.code === "permission-denied") {
    return "Firestore menolak akses. Publikasikan Security Rules yang mengizinkan pengguna login membaca users/{uid}/workoutHistory pada proyek Firebase yang sama.";
  }
  if (error && error.code === "failed-precondition") {
    return "Firestore belum siap menjalankan kueri ini. Periksa indeks dan konfigurasi koleksi.";
  }
  if (error && ["unavailable", "deadline-exceeded", "network-request-failed"].includes(error.code)) {
    return "Riwayat tidak dapat dijangkau. Periksa koneksi internet, lalu coba lagi.";
  }
  if (error && error.code === "unauthenticated") {
    return "Sesi Firebase berakhir. Coba ulangi untuk membuat sesi anonim baru.";
  }
  return "Riwayat gagal dimuat. Periksa koneksi, Firebase Authentication, dan Firestore Security Rules.";
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (session && session.phase !== "done") return;
  if (!validateSettings()) {
    const firstInvalidInput = inputRules.find(({ input }) => input.getAttribute("aria-invalid") === "true");
    if (firstInvalidInput) firstInvalidInput.input.focus();
    return;
  }
  const settings = getSettings();
  if (settings) startSession(settings);
});

for (const input of [soundInput, countdownInput, transitionInput]) {
  input.addEventListener("change", () => {
    saveAudioPreferences();
    if (!soundInput.checked) {
      stopAudioSounds();
      audioStatus.textContent = "";
    }
  });
}

pauseButton.addEventListener("click", pauseOrResume);
const stopConfirmation = document.getElementById("stop-confirmation-modal");
const openStopConfirmation = () => stopConfirmation.showModal();
document.getElementById("reset-button").addEventListener("click", openStopConfirmation);
document.getElementById("close-workout-button").addEventListener("click", openStopConfirmation);
document.getElementById("continue-workout-button").addEventListener("click", () => stopConfirmation.close());
document.getElementById("confirm-stop-button").addEventListener("click", resetToSettings);
document.getElementById("back-button").addEventListener("click", goBackToSettings);
document.getElementById("done-settings-button").addEventListener("click", resetToSettings);
const doneRestartButton = document.getElementById("done-restart-button");
if (doneRestartButton) {
  doneRestartButton.addEventListener("click", () => {
    const settingsToUse = lastStartedSettings || getSettings();
    resetToSettings();
    if (settingsToUse) startSession(settingsToUse);
  });
}
document.querySelectorAll("[data-screen]").forEach((button) => {
  button.addEventListener("click", () => navigateTo(button.dataset.screen));
});
document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => {
  selectedRange = button.dataset.range;
  visibleHistoryCount = 10;
  document.querySelectorAll("[data-range]").forEach((rangeButton) => {
    const active = rangeButton === button;
    rangeButton.classList.toggle("active", active);
    rangeButton.setAttribute("aria-pressed", String(active));
  });
  renderHistoryStats();
  renderHistoryList();
}));
loadMoreButton.addEventListener("click", () => {
  visibleHistoryCount += 10;
  renderHistoryList();
});
document.getElementById("close-detail-button").addEventListener("click", () => historyDialog.close());
historyDialog.addEventListener("click", (event) => {
  if (event.target === historyDialog) historyDialog.close();
});
document.addEventListener("visibilitychange", () => {
  if (!isSessionRunning()) return;
  if (document.visibilityState === "visible") requestWakeLock();
  else releaseWakeLock();
});

document.addEventListener("deviceready", () => {
  cordovaReady = true;
  if (isSessionRunning()) requestWakeLock();
}, false);

window.addEventListener("pagehide", () => {
  clearInterval(timerId);
  timerId = null;
  releaseWakeLock();
  closeAudioContext();
});

window.addEventListener("pageshow", () => {
  if (isSessionRunning()) {
    requestWakeLock();
    startTicker();
  }
});

window.addEventListener("hiit-history-updated", () => {
  renderHistoryStats();
  renderHistoryList();
  if (!lastCompleted || lastCompleted.levelBefore === undefined) return;
  const progress = window.HIITQuest.getProgress();
  if (progress.level > lastCompleted.levelBefore && !lastCompleted.levelUpShown) {
    lastCompleted.levelUpShown = true;
    document.getElementById("new-level").textContent = String(progress.level);
    document.getElementById("level-up-modal").showModal();
  }
});

initializeSettingControls();
updateEstimate();
window.HIITQuest = {
  MIN_VALID_SECONDS,
  isValidRecord,
  get testModeEnabled() { return testModeEnabled; },
  getHistoryRecords: () => historyRecords.slice(),
  getProgress: () => {
    const validDates = [...new Set(historyRecords.filter(isValidRecord).map((record) => getLocalDateKey(record.startedAt)))].sort();
    const longestStreak = getLongestStreak(historyRecords);
    const today = getLocalDateKey(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = getLocalDateKey(yesterdayDate);
    let streak = 0;
    if (validDates.length) {
      const latest = validDates[validDates.length - 1];
      if (latest === today || latest === yesterday) {
        let cursor = new Date(`${latest}T00:00:00`);
        const validSet = new Set(validDates);
        while (validSet.has(getLocalDateKey(cursor))) {
          streak += 1;
          cursor.setDate(cursor.getDate() - 1);
        }
      }
    }
    const totalXp = historyRecords.reduce((sum, record) => sum + getRecordXp(record), 0);
    return { totalXp, level: Math.floor(totalXp / 100) + 1, levelXp: totalXp % 100, longestStreak, streak, validDates };
  },
  get lastCompleted() { return lastCompleted; },
  formatClock: formatClockDuration
};
void initializeFirebase();
