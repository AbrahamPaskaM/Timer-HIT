"use strict";

const $ = (id) => document.getElementById(id);
const DAY_MS = 24 * 60 * 60 * 1000;
const localDateKey = (date) => {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
};
const getRecords = () => window.HIITQuest?.getHistoryRecords() || [];
const isValidWorkout = (record) => window.HIITQuest?.isValidRecord(record)
  ?? (record.workDuration || 0) * (record.completedRounds || 0) >= window.HIITQuest.MIN_VALID_SECONDS;
const earnedXp = (record) => record.status === "completed" && isValidWorkout(record)
  ? 20 + (record.completedRounds || 0) * 10
  : 0;

function getProgress(records = getRecords()) {
  const validDates = [...new Set(records.filter(isValidWorkout).map((record) => localDateKey(record.startedAt)))].sort();
  let longest = 0;
  let run = 0;
  let previous = null;
  for (const dateKey of validDates) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = Date.UTC(year, month - 1, day);
    run = previous !== null && date - previous === DAY_MS ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  const todayKey = localDateKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const lastActive = validDates[validDates.length - 1];
  const streak = lastActive === todayKey || lastActive === localDateKey(yesterday) ? run : 0;
  const totalXp = records.reduce((sum, record) => sum + earnedXp(record), 0);
  return { totalXp, level: Math.floor(totalXp / 100) + 1, levelXp: totalXp % 100, longestStreak: longest, streak, validDates };
}

function renderWeek(records, animateDate = null) {
  const week = $("week-dots");
  if (!week) return;
  const dates = new Set(records.filter(isValidWorkout).map((record) => localDateKey(record.startedAt)));
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  week.replaceChildren();
  ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].forEach((label, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    const key = localDateKey(date);
    const isToday = key === localDateKey(now);
    const completed = dates.has(key);
    const day = document.createElement("span");
    day.className = `day${completed ? " done" : isToday ? " today" : ""}${key === animateDate && completed ? " day-pop" : ""}`;
    day.setAttribute("aria-label", `${label}${isToday ? ", hari ini" : ""}${completed ? ", latihan sah" : ""}`);
    day.innerHTML = `${label}<i>${completed ? '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2 C13 5, 16 7, 17 8 C19 10, 20 12, 20 15 C20 19, 16.5 22, 12 22 C7.5 22, 4 19, 4 15 C4 12, 5.5 9.5, 7.5 8 C7.2 9.5, 8 11, 9 11.5 C9 9, 10 5, 12 2 Z"/></svg>' : ""}</i>`;
    week.append(day);
  });
}

function renderPreviewXp(records) {
  const progress = getProgress(records);
  const reward = isValidWorkout({ workDuration: Number($("work-duration").value), completedRounds: Number($("round-count").value) })
    ? 20 + Number($("round-count").value) * 10
    : 0;
  const start = progress.levelXp;
  const end = Math.min(100, start + reward);
  $("xp-preview-label").textContent = `${start} → ${end} / 100 XP`;
  $("xp-current-fill").style.width = `${start}%`;
  $("xp-preview-fill").style.left = `${start}%`;
  $("xp-preview-fill").style.width = `${Math.max(0, end - start)}%`;
  $("xp-text").textContent = `${progress.levelXp} / 100 XP`;
  $("level-badge").textContent = `LV ${progress.level}`;
  $("profile-level").textContent = `Level ${progress.level} · ${progress.level < 3 ? "Pemula berani" : "Penjaga api"}`;
  $("profile-total-xp").textContent = String(progress.totalXp);
  $("profile-xp-fill").style.width = `${progress.levelXp}%`;
  $("profile-xp-caption").textContent = `${progress.levelXp} / 100 XP - ${100 - progress.levelXp} XP lagi ke Level ${progress.level + 1}`;
  $("potential-xp").textContent = String(reward);
  $("weekly-message").textContent = progress.streak
    ? `${progress.streak} hari berturut-turut. Mantap!`
    : "Nyalakan api pertamamu!";
  $("streak-count").textContent = String(progress.streak);
  $("streak-warning").hidden = !(progress.streak >= 3 && !progress.validDates.includes(localDateKey(new Date())) && new Date().getHours() >= 18);
  $("done-streak").textContent = String(progress.streak);
  $("done-xp-level-label").textContent = `${progress.levelXp} / 100 XP`;
  $("done-next-level").textContent = `Menuju Level ${progress.level + 1}`;
  $("done-level-fill").style.width = `${progress.levelXp}%`;
  renderWeek(records, document.body.dataset.popDate || null);
}

function badgeIcon(pathData, locked = false) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", "currentColor");
  if (locked) path.setAttribute("class", "badge-silhouette");
  svg.append(path);
  if (locked) {
    const lock = document.createElementNS(svg.namespaceURI, "path");
    // Proportional lock icon inside 40x40 viewBox
    lock.setAttribute("d", "M26 21a4 4 0 0 1 8 0v3h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H25a2 2 0 0 1-2-2V26a2 2 0 0 1 2-2h1v-3Zm2.5 3h5v-3a2.5 2.5 0 0 0-5 0v3Zm2 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z");
    lock.setAttribute("fill", "var(--badge-text, #FFC800)");
    lock.setAttribute("class", "badge-lock-icon");
    svg.append(lock);
  }
  return svg;
}

function renderBadges(records, progress) {
  const badges = $("profile-badges");
  const validMissions = records.filter((record) => record.status === "completed" && isValidWorkout(record));
  const completeCount = validMissions.length;
  const workMinutes = Math.floor(records.filter(isValidWorkout).reduce((sum, record) => sum + (record.workDuration || 0) * (record.completedRounds || 0), 0) / 60);
  const definitions = [
    { name: "Api Pertama", requirement: "Selesaikan 1 misi", current: completeCount, target: 1, icon: "M20 3 C21.8 8, 26.5 11.2, 28.5 13 C31.8 16.5, 34 20, 34 25 C34 32.5, 27.8 37, 20 37 C12.2 37, 6 32.5, 6 25 C6 20, 8.5 15.5, 12.2 13 C11.8 15.5, 13 18, 14.8 19 C14.8 15, 16.5 8, 20 3 Z", color: "var(--orange)" },
    { name: "7 Hari Beruntun", requirement: "Latihan 7 hari berturut-turut", current: progress.longestStreak, target: 7, icon: "M22 3 L8 21 H18 L15 37 L32 17 H20 L24 3 Z", color: "var(--green)" },
    { name: "100 Menit", requirement: "Akumulasi 100 menit kerja", current: workMinutes, target: 100, icon: "M20 4 C18.9 4 18 4.9 18 6 V7.1 C11.2 7.8 6 13.5 6 20.5 C6 28 12.3 34 20 34 C27.7 34 34 28 34 20.5 C34 13.5 28.8 7.8 22 7.1 V6 C22 4.9 21.1 4 20 4 Z M20 10 C25.5 10 30 14.7 30 20.5 C30 26.3 25.5 31 20 31 C14.5 31 10 26.3 10 20.5 C10 14.7 14.5 10 20 10 Z M19 13 H21 V21 H25 V23 H19 Z M29.5 8.5 L32 6 L33.5 7.5 L31 10 Z", color: "var(--blue)" },
    { name: "10 Misi", requirement: "Selesaikan 10 misi", current: completeCount, target: 10, icon: "M12 6 H28 V18 C28 22.4 24.4 26 20 26 C15.6 26 12 22.4 12 18 V6 Z M12 9 H8 C6.9 9 6 9.9 6 11 C6 14.5 8.5 16.5 12 16.5 V14 C9.5 14 8.5 13 8.5 11 H12 V9 Z M28 9 H32 C33.1 9 34 9.9 34 11 C34 14.5 31.5 16.5 28 16.5 V14 C30.5 14 31.5 13 31.5 11 H28 V9 Z M18 26 H22 V31 H18 Z M13 31 H27 V34 H13 Z", color: "var(--purple)" }
  ];
  badges.replaceChildren();
  for (const item of definitions) {
    const unlocked = item.current >= item.target;
    const card = document.createElement("article");
    card.className = `badge-card${unlocked ? " unlocked" : " locked"}`;
    card.style.setProperty("--badge-color", item.color);
    const icon = badgeIcon(item.icon, !unlocked);
    const title = document.createElement("strong");
    title.textContent = item.name;
    const requirement = document.createElement("span");
    requirement.textContent = unlocked ? item.requirement : `${item.current} / ${item.target} ${item.name === "7 Hari Beruntun" ? "hari" : item.name === "100 Menit" ? "mnt" : "misi"}`;
    card.append(icon, title, requirement);
    if (!unlocked) {
      const track = document.createElement("i");
      const fill = document.createElement("b");
      fill.style.width = `${Math.min(100, item.current / item.target * 100)}%`;
      track.append(fill);
      card.append(track);
    }
    badges.append(card);
  }
}

function renderGame() {
  const records = getRecords();
  const progress = getProgress(records);
  $("weekly-message").textContent = progress.streak
    ? `${progress.streak} hari berturut-turut. Mantap!`
    : "Nyalakan api pertamamu!";
  $("streak-count").textContent = String(progress.streak);
  renderPreviewXp(records);
  renderBadges(records, progress);
  const weekCount = records.filter((record) => {
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    return record.startedAt >= monday && isValidWorkout(record);
  }).length;
  const subtitle = $("journey-subtitle");
  if (subtitle) subtitle.textContent = weekCount ? `Minggu ini kamu latihan ${weekCount} kali, keren!` : "Ayo nyalakan api pertamamu minggu ini";
  if ($("done-duration") && window.HIITQuest?.lastCompleted) {
    const completed = window.HIITQuest.lastCompleted;
    const valid = isValidWorkout(completed);
    const stopped = completed.status === "cancelled";
    $("done-screen").dataset.valid = String(valid);
    // P1: eyebrow label bermakna sesuai jenis sesi
    let eyebrow, title, message;
    if (stopped) {
      eyebrow = "LATIHAN BERHENTI";
      title = "Sesi dihentikan";
      message = "Latihan dihentikan sebelum selesai.";
    } else if (!valid) {
      eyebrow = "SESI SINGKAT";
      title = "Sesi tercatat";
      message = "Latihan di bawah 1 menit kerja tidak menambah XP atau streak.";
    } else {
      eyebrow = "MISI SELESAI";
      title = "Hebat, jagoan!";
      message = "Kamu menuntaskan latihanmu. Apimu makin besar!";
    }
    $("done-eyebrow").textContent = eyebrow;
    $("done-title").textContent = title;
    $("done-duration").textContent = window.HIITQuest.formatClock(completed.actualDurationSeconds);
    $("completed-rounds").textContent = `${completed.completedRounds}/${completed.totalRounds} ronde`;
    const xp = earnedXp(completed);
    $("earned-xp").textContent = `+${xp}`;
    $("done-message").textContent = message;
  }
}

function setPage(page) {
  if (typeof window.navigateTo === "function") {
    window.navigateTo(page);
    return;
  }
  $("settings-screen").hidden = page !== "timer";
  $("workout-screen").hidden = true;
  $("done-screen").hidden = true;
  $("history-screen").hidden = page !== "journey";
  $("profile-screen").hidden = page !== "profile";
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("is-active", button.dataset.screen === page));
}

document.addEventListener("DOMContentLoaded", () => {
  renderGame();
  document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.preset === "tabata") { $("work-duration").value = 20; $("rest-duration").value = 10; }
    if (button.dataset.preset === "beginner") { $("work-duration").value = 30; $("rest-duration").value = 30; }
    if (button.dataset.preset === "strong") { $("work-duration").value = 45; $("rest-duration").value = 15; }
    if (button.dataset.preset !== "custom") ["work-duration", "rest-duration"].forEach((id) => $(id).dispatchEvent(new Event("input", { bubbles: true })));
    document.querySelectorAll(".preset-button").forEach((preset) => preset.classList.toggle("active", preset === button));
  }));
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".nav-link");
    if (!button || !["journey", "profile"].includes(button.dataset.screen)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setPage(button.dataset.screen);
  }, true);
  $("done-settings-button").addEventListener("click", () => setPage("timer"));
  if ($("done-restart-button")) $("done-restart-button").addEventListener("click", () => setPage("timer"));
  $("close-level-up").addEventListener("click", () => $("level-up-modal").close());
  window.addEventListener("hiit-history-updated", () => {
    const completed = window.HIITQuest?.lastCompleted;
    if (completed && isValidWorkout(completed) && !completed.streakPopPlayed) {
      completed.streakPopPlayed = true;
      const key = localDateKey(completed.startedAt);
      document.body.dataset.popDate = key;
      window.setTimeout(() => {
        delete document.body.dataset.popDate;
        renderGame();
      }, 350);
    }
    renderGame();
  });
  window.addEventListener("hiit-session-finished", renderGame);
  new MutationObserver(() => {
    const phase = $("timer-card").dataset.phase;
    $("workout-cheer").textContent = phase === "rest" ? "Tarik napas. Kamu pantas istirahat!" : phase === "work" ? "Ayo! Apimu lagi membara." : "Persiapan dulu, jagoan!";
    if ($("vibration-toggle").checked && navigator.vibrate && ["work", "rest"].includes(phase)) navigator.vibrate(40);
  }).observe($("timer-card"), { attributes: true, attributeFilter: ["data-phase"] });
});

window.HIITQuestUI = { render: renderGame, progress: getProgress };
