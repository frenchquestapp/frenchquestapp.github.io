let questions = [];

const missionConfigs = {
  coffee_shop: {
    id: "coffee_shop",
    title: "Coffee Shop",
    dataPath: "./data/coffee_shop.json",
    sequenceLabel: "Mission 1",
    scenarioZh: "咖啡店",
    nextMissionId: "grocery_store",
    nextMissionLabel: "Grocery Store 已上線，可以繼續挑戰。",
    retakeRandomization: "global"
  },
  grocery_store: {
    id: "grocery_store",
    title: "Grocery Store",
    dataPath: "./data/grocery_store.json",
    sequenceLabel: "Mission 2",
    scenarioZh: "超市",
    nextMissionId: "banking",
    nextMissionLabel: "Banking — coming soon.",
    retakeRandomization: "section"
  }
};

const runtimeParams = new URLSearchParams(window.location.search);
const runtimeConfig = window.frenchQuestRuntime || {};
const runtimeEnvironment = runtimeConfig.environment || runtimeParams.get("environment") || runtimeParams.get("env") || "production";
const isReviewEnvironment = Boolean(runtimeConfig.reviewMode) || ["staging", "review", "integrated-staging"].includes(runtimeEnvironment);
const publicMissionIds = Array.isArray(runtimeConfig.publicMissions)
  ? runtimeConfig.publicMissions
  : (isReviewEnvironment ? ["coffee_shop", "grocery_store"] : ["coffee_shop"]);
const requestedMissionId = runtimeParams.get("mission");
const shouldAutoStartMission = runtimeParams.get("start") === "1";
const requestedMissionIsPlayable = missionConfigs[requestedMissionId] && publicMissionIds.includes(requestedMissionId);
const missionId = requestedMissionIsPlayable ? requestedMissionId : "coffee_shop";
const missionConfig = missionConfigs[missionId];
const progressStoragePrefix = runtimeConfig.progressStoragePrefix || "";
const baseStorageKey = missionId === "coffee_shop"
  ? "frenchQuestProgressV03"
  : `frenchQuestProgressV03_${missionId}`;
const storageKey = `${progressStoragePrefix}${baseStorageKey}`;
maybeMigrateEarlyAccessGroceryProgress();
const visitorIdStorageKey = "frenchQuestVisitorIdV1";
const xpPerCorrect = 10;
const waitlistUrl = "https://forms.gle/cgmTvvnV7hXWH4gQ8";
const feedbackUrl = "#";
const skillPerformanceLabels = {
  vocabulary: "Vocabulary",
  situation: "Situation",
  expression: "Expression",
  reading: "Reading"
};
const completeSkillPerformanceLabels = {
  vocabulary: "字彙",
  situation: "情境理解",
  expression: "回應理解",
  reading: "閱讀理解"
};

const defaultProgress = {
  totalXp: 0,
  readiness: 0,
  lastAttempt: null,
  lastMissionAttempt: null,
  lastReviewAttempt: null,
  completedMissions: [],
  wrongQuestionIds: [],
  guessedQuestionIds: [],
  activeSession: null,
  skillXp: {
    vocabulary: 0,
    reading: 0,
    situation: 0,
    expression: 0
  }
};

const state = {
  screen: "loading",
  currentQuestion: 0,
  selectedAnswer: null,
  guessedCurrent: false,
  answers: [],
  activeQuestions: [],
  reviewMode: false,
  missionMode: "normal",
  attemptId: "",
  xp: 0,
  readiness: 0,
  missionLoaded: false,
  errorMessage: "",
  questionStartTime: null,
  missionStartTime: null,
  progress: loadProgress()
};

const app = document.getElementById("app");
let pageViewTracked = false;

function getFreshDefaultProgress() {
  return JSON.parse(JSON.stringify(defaultProgress));
}

function maybeMigrateEarlyAccessGroceryProgress() {
  if (!runtimeConfig.migrateEarlyAccessGroceryProgress) return;
  if (missionId !== "grocery_store") return;
  if (progressStoragePrefix) return;

  try {
    if (localStorage.getItem(storageKey)) return;

    const earlyAccessStorageKey = `earlyAccess_${baseStorageKey}`;
    const earlyAccessProgress = localStorage.getItem(earlyAccessStorageKey);
    if (!earlyAccessProgress) return;

    JSON.parse(earlyAccessProgress);
    localStorage.setItem(storageKey, earlyAccessProgress);
  } catch (error) {
    console.warn("Early Access Grocery progress migration skipped:", error);
  }
}

function loadProgress() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return getFreshDefaultProgress();

    const parsed = JSON.parse(saved);
    const progress = {
      ...getFreshDefaultProgress(),
      ...parsed,
      skillXp: {
        ...defaultProgress.skillXp,
        ...(parsed.skillXp || {})
      },
      wrongQuestionIds: parsed.wrongQuestionIds || [],
      guessedQuestionIds: parsed.guessedQuestionIds || [],
      completedMissions: parsed.completedMissions || [],
      activeSession: parsed.activeSession || null
    };

    if (!progress.lastMissionAttempt && parsed.lastAttempt?.mission !== "Coffee Shop Review") {
      progress.lastMissionAttempt = parsed.lastAttempt || null;
    }

    if (!progress.lastReviewAttempt && parsed.lastAttempt?.mission === "Coffee Shop Review") {
      progress.lastReviewAttempt = parsed.lastAttempt;
    }

    return progress;
  } catch (error) {
    console.error("Progress loading failed:", error);
    return getFreshDefaultProgress();
  }
}

function saveProgress() {
  localStorage.setItem(storageKey, JSON.stringify(state.progress));
}

function createAttemptId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `attempt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getVisitorId() {
  try {
    const savedVisitorId = localStorage.getItem(visitorIdStorageKey);
    if (savedVisitorId) return savedVisitorId;

    const visitorId = createAttemptId();
    localStorage.setItem(visitorIdStorageKey, visitorId);
    return visitorId;
  } catch (error) {
    return "";
  }
}

function getAnalyticsUrl() {
  if (isReviewEnvironment || runtimeConfig.disableAnalytics) return "";
  return window.frenchQuestLinks?.analytics || "";
}

function trackAnalyticsEvent(eventName, payload = {}) {
  const analyticsUrl = getAnalyticsUrl();
  if (!analyticsUrl) return;

  fetch(analyticsUrl, {
    method: "POST",
    mode: "no-cors",
    keepalive: true,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      timestamp: payload.timestamp || new Date().toISOString(),
      event_name: eventName,
      visitor_id: getVisitorId(),
      attempt_id: payload.attemptId || "",
      mission_id: payload.missionId || "",
      page: payload.page || runtimeConfig.analyticsCohort || "",
      question_id: payload.questionId || "",
      question_position: payload.questionPosition ?? "",
      mission_mode: payload.missionMode || "",
      score: payload.score ?? "",
      total_questions: payload.totalQuestions ?? "",
      duration_seconds: payload.durationSeconds ?? ""
    })
  }).catch(() => {});
}

function getAttemptIdForExternalAction(options = {}) {
  if (options.attemptScope === "last-mission") {
    return getValidAttempt(state.progress.lastMissionAttempt)?.attemptId || "";
  }

  if (options.attemptScope === "active") {
    return state.progress.activeSession?.attemptId || "";
  }

  return "";
}

function trackExternalAction(type, options = {}) {
  const eventName = type === "waitlist"
    ? "early_access_clicked"
    : type === "feedback"
      ? "feedback_clicked"
      : "";
  if (!eventName) return;

  const attemptId = getAttemptIdForExternalAction(options);
  trackAnalyticsEvent(eventName, {
    attemptId,
    missionId: attemptId ? missionId : ""
  });
}

window.trackFrenchQuestExternalAction = trackExternalAction;

function trackPageViewOnce() {
  if (pageViewTracked) return;
  pageViewTracked = true;
  trackAnalyticsEvent("page_view", {
    page: runtimeConfig.analyticsPage || "home"
  });
}

function removeStartParamFromUrl() {
  if (!runtimeParams.has("start")) return;
  const params = new URLSearchParams(window.location.search);
  params.delete("start");
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);
}

function isValidActiveSession(session) {
  if (!session || session.version !== 1) return false;
  if (session.missionId !== missionId || session.mode !== "mission") return false;
  if (!["question", "feedback"].includes(session.screen)) return false;
  if (!Array.isArray(session.activeQuestions) || session.activeQuestions.length === 0) return false;
  if (!Array.isArray(session.answers)) return false;
  if (!Number.isInteger(session.currentQuestion)) return false;
  if (session.currentQuestion < 0 || session.currentQuestion >= session.activeQuestions.length) return false;

  const knownQuestionIds = new Set(questions.map((question) => question.id));
  const hasValidQuestions = session.activeQuestions.every((question) => (
    question &&
    knownQuestionIds.has(question.id) &&
    Array.isArray(question.options) &&
    Number.isInteger(question.correctIndexOverride)
  ));
  if (!hasValidQuestions) return false;

  if (session.screen === "feedback" && session.answers.length !== session.currentQuestion + 1) return false;
  if (session.screen === "question" && session.answers.length > session.currentQuestion) return false;

  return true;
}

function saveActiveSession() {
  if (state.reviewMode || !["question", "feedback"].includes(state.screen) || state.activeQuestions.length === 0) return;

  const now = new Date().toISOString();
  const existingSession = state.progress.activeSession;
  const attemptId = state.attemptId || existingSession?.attemptId || createAttemptId();
  const isSameAttempt = existingSession?.attemptId === attemptId;
  const existingAnalytics = isSameAttempt ? existingSession?.analytics : null;

  state.attemptId = attemptId;
  state.progress.activeSession = {
    version: 1,
    missionId,
    mode: "mission",
    attemptId,
    screen: state.screen,
    currentQuestion: state.currentQuestion,
    selectedAnswer: state.selectedAnswer,
    guessedCurrent: state.guessedCurrent,
    answers: state.answers,
    activeQuestions: state.activeQuestions,
    xp: state.xp,
    missionMode: state.missionMode,
    analytics: {
      missionStartedSent: Boolean(existingAnalytics?.missionStartedSent),
      missionCompletedSent: Boolean(existingAnalytics?.missionCompletedSent),
      questionAnsweredKeys: Array.isArray(existingAnalytics?.questionAnsweredKeys)
        ? existingAnalytics.questionAnsweredKeys
        : []
    },
    startedAt: isSameAttempt ? existingSession.startedAt || now : now,
    updatedAt: now
  };
  saveProgress();
}

function clearActiveSession() {
  state.progress.activeSession = null;
}

function restoreActiveSession() {
  const session = state.progress.activeSession;
  if (!isValidActiveSession(session)) {
    if (session) {
      clearActiveSession();
      saveProgress();
    }
    return false;
  }

  state.screen = session.screen;
  state.currentQuestion = session.currentQuestion;
  state.selectedAnswer = session.selectedAnswer;
  state.guessedCurrent = Boolean(session.guessedCurrent);
  state.answers = session.answers;
  state.activeQuestions = session.activeQuestions;
  state.reviewMode = false;
  state.missionMode = session.missionMode || "normal";
  state.attemptId = session.attemptId || createAttemptId();
  state.xp = Number(session.xp) || 0;
  state.missionStartTime = session.startedAt ? Date.parse(session.startedAt) : Date.now();
  state.questionStartTime = Date.now();
  saveActiveSession();
  return true;
}

function updateActiveSessionAnalyticsFlag(flagName) {
  const session = state.progress.activeSession;
  if (!session || session.attemptId !== state.attemptId) return false;

  session.analytics = {
    ...session.analytics,
    missionStartedSent: Boolean(session.analytics?.missionStartedSent),
    missionCompletedSent: Boolean(session.analytics?.missionCompletedSent),
    [flagName]: true
  };
  saveProgress();
  return true;
}

function trackMissionStartedOnce() {
  const session = state.progress.activeSession;
  if (!session || session.analytics?.missionStartedSent) return;

  updateActiveSessionAnalyticsFlag("missionStartedSent");
  trackAnalyticsEvent("mission_started", {
    attemptId: session.attemptId,
    missionId,
    missionMode: session.missionMode || "normal"
  });
}

function trackMissionCompletedOnce({ score, totalQuestions, durationSeconds }) {
  const session = state.progress.activeSession;
  if (!session || session.analytics?.missionCompletedSent) return;

  updateActiveSessionAnalyticsFlag("missionCompletedSent");
  trackAnalyticsEvent("mission_completed", {
    attemptId: session.attemptId,
    missionId,
    missionMode: session.missionMode || "normal",
    score,
    totalQuestions,
    durationSeconds
  });
}

function getCurrentMissionMode() {
  if (state.reviewMode) return "review";
  return state.missionMode || "normal";
}

function trackQuestionAnsweredOnce(question, questionPosition) {
  const questionAnsweredKey = `${questionPosition}:${question.id}`;
  const session = state.progress.activeSession;

  if (!state.reviewMode && session?.attemptId === state.attemptId) {
    const answeredKeys = Array.isArray(session.analytics?.questionAnsweredKeys)
      ? session.analytics.questionAnsweredKeys
      : [];
    if (answeredKeys.includes(questionAnsweredKey)) return;

    session.analytics = {
      ...session.analytics,
      missionStartedSent: Boolean(session.analytics?.missionStartedSent),
      missionCompletedSent: Boolean(session.analytics?.missionCompletedSent),
      questionAnsweredKeys: [...answeredKeys, questionAnsweredKey]
    };
    saveProgress();
  }

  trackAnalyticsEvent("question_answered", {
    attemptId: state.attemptId || "",
    missionId,
    questionId: question.id,
    questionPosition,
    missionMode: getCurrentMissionMode()
  });
}

function uniqueIds(ids) {
  return [...new Set(ids.filter(Boolean))];
}

function getValidAttempt(attempt) {
  return attempt && Number(attempt.total) > 0 ? attempt : null;
}

async function loadMissionData() {
  try {
    const response = await fetch(missionConfig.dataPath);
    if (!response.ok) throw new Error("Mission data request failed.");

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Mission data is empty.");
    }

    questions = data;
    state.missionLoaded = true;
    state.readiness = state.progress.readiness || 0;
    const restored = restoreActiveSession();

    if (shouldAutoStartMission) removeStartParamFromUrl();

    if (!restored && shouldAutoStartMission && isMissionPlayable(missionId)) {
      startMission({ randomizeQuestions: false, randomizeOptions: false, reviewMode: false });
      return;
    }

    state.screen = restored ? state.screen : "home";
    render();
  } catch (error) {
    console.error("Mission loading failed:", error);
    state.missionLoaded = false;
    state.errorMessage = error instanceof Error ? error.message : String(error);
    state.screen = "error";
    render();
  }
}

function render() {
  if (state.screen === "loading") renderLoading();
  if (state.screen === "error") renderError();
  if (state.screen === "home") renderHome();
  if (state.screen === "question") renderQuestion();
  if (state.screen === "feedback") renderFeedback();
  if (state.screen === "complete") renderComplete();
}

function renderLoading() {
  app.innerHTML = `
    <section class="panel mission-card">
      <p class="eyebrow">${isReviewEnvironment ? "Review Staging" : "Loading Mission"}</p>
      <h2>${missionConfig.title}</h2>
      <p>Preparing your TEF Canada practice mission.</p>
    </section>
  `;
}

function renderError() {
  app.innerHTML = `
    <section class="panel mission-card">
      <p class="eyebrow">Mission Data</p>
      <h2>Unable to load</h2>
      <p>Unable to load mission data. Please try again.</p>
      <p>Debug: ${state.errorMessage}</p>
    </section>
  `;
}

function getActiveQuestions() {
  return state.activeQuestions.length ? state.activeQuestions : questions;
}

function getScore() {
  return state.answers.filter((answer) => answer.isCorrect).length;
}

function getWrongAnswers() {
  return state.answers.filter((answer) => !answer.isCorrect);
}

function getGuessedAnswers() {
  return state.answers.filter((answer) => answer.guessed);
}

function getTotalAnswerTimeMs() {
  return state.answers.reduce((total, answer) => total + (answer.timeSpentMs || 0), 0);
}

function calculateSkillPerformance(answers) {
  const performance = Object.fromEntries(
    Object.keys(skillPerformanceLabels).map((skill) => [
      skill,
      { correct: 0, total: 0, percent: null }
    ])
  );

  answers.forEach((answer) => {
    const skill = answer.skill || "vocabulary";
    if (!performance[skill]) return;
    performance[skill].total += 1;
    if (answer.isCorrect) performance[skill].correct += 1;
  });

  Object.values(performance).forEach((result) => {
    result.percent = result.total ? Math.round((result.correct / result.total) * 100) : null;
  });

  return performance;
}

function getSkillPerformanceTiles(skillPerformance, labels = skillPerformanceLabels) {
  if (!skillPerformance) return [];

  return Object.entries(labels).map(([skill, label]) => {
    const result = skillPerformance[skill] || { correct: 0, total: 0, percent: null };
    return {
      label,
      value: result.total ? `${result.percent}%` : "Not practiced"
    };
  });
}

function getCorrectIndex(question) {
  if (typeof question.correctIndexOverride === "number") return question.correctIndexOverride;
  if (typeof question.answer === "number") return question.answer;

  const answerMap = {
    A: 0,
    B: 1,
    C: 2,
    D: 3
  };

  return answerMap[String(question.answer).trim().toUpperCase()];
}

function shuffleArray(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function shuffleQuestionsWithinSections(items) {
  const sections = [];

  items.forEach((question) => {
    const previousSection = sections[sections.length - 1];
    if (!previousSection || previousSection.part !== question.part) {
      sections.push({ part: question.part, questions: [question] });
      return;
    }

    previousSection.questions.push(question);
  });

  return sections.flatMap((section) => shuffleArray(section.questions));
}

function prepareQuestionForSession(question, randomizeOptions = false) {
  if (!randomizeOptions) {
    return {
      ...question,
      options: [...question.options],
      correctIndexOverride: getCorrectIndex(question)
    };
  }

  const correctOption = question.options[getCorrectIndex(question)];
  const shuffledOptions = shuffleArray(question.options);

  return {
    ...question,
    options: shuffledOptions,
    correctIndexOverride: shuffledOptions.indexOf(correctOption)
  };
}

function prepareQuestionsForSession(sourceQuestions, { randomizeQuestions = false, randomizeOptions = false, randomizeWithinSections = false } = {}) {
  const prepared = sourceQuestions.map((question) => prepareQuestionForSession(question, randomizeOptions));
  if (randomizeQuestions && randomizeWithinSections) return shuffleQuestionsWithinSections(prepared);
  return randomizeQuestions ? shuffleArray(prepared) : prepared;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round((milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function getReviewQuestions() {
  const ids = uniqueIds([
    ...state.progress.wrongQuestionIds,
    ...state.progress.guessedQuestionIds
  ]);

  return questions.filter((question) => ids.includes(question.id));
}

function getResumeLabel() {
  const session = state.progress.activeSession;
  if (!isValidActiveSession(session)) return "";
  return `繼續 ${missionConfig.title}（第 ${session.currentQuestion + 1} 題）`;
}

function handleExternalAction(type, options = {}) {
  trackExternalAction(type, options);

  if (type === "waitlist" && waitlistUrl !== "#") {
    window.open(waitlistUrl, "_blank", "noopener,noreferrer");
    return;
  }

  if (type === "feedback" && feedbackUrl !== "#") {
    window.open(feedbackUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const message = type === "waitlist"
    ? "Waitlist form is coming next. For now, French Quest is in private testing."
    : "Feedback form is coming next. For now, please send feedback directly to Shanna.";

  alert(message);
}

function attachLaunchButtons() {
  document.querySelectorAll("[data-action='waitlist']").forEach((button) => {
    button.addEventListener("click", () => handleExternalAction("waitlist", { attemptScope: button.dataset.attemptScope || "" }));
  });

  document.querySelectorAll("[data-action='feedback']").forEach((button) => {
    button.addEventListener("click", () => handleExternalAction("feedback", { attemptScope: button.dataset.attemptScope || "" }));
  });
}

function getMissionUrl(targetMissionId, options = {}) {
  const params = new URLSearchParams(window.location.search);
  params.set("mission", targetMissionId);
  if (options.start) params.set("start", "1");
  if (!options.start) params.delete("start");
  if (isReviewEnvironment && !params.get("environment")) params.set("environment", runtimeEnvironment);
  return `${window.location.pathname}?${params.toString()}`;
}

function isMissionPlayable(targetMissionId) {
  return publicMissionIds.includes(targetMissionId);
}

function startOrOpenMission(targetMissionId, options = {}) {
  if (targetMissionId === missionId) {
    if (!options.forceNew && restoreActiveSession()) {
      render();
      return;
    }

    startMission(options);
    return;
  }

  window.location.href = getMissionUrl(targetMissionId, { start: true });
}

function renderStagingNotice() {
  if (!isReviewEnvironment) return "";

  return `
    <section class="panel info-panel">
      <p class="eyebrow">Review Staging</p>
      <h2>Integrated mission review site.</h2>
      <p>這是 Coffee Shop + Grocery Store 的整合測試站，與 production 分離，不會送出正式 analytics。</p>
    </section>
  `;
}

function renderHome() {
  const lastMissionAttempt = getValidAttempt(state.progress.lastMissionAttempt);
  const lastReviewAttempt = getValidAttempt(state.progress.lastReviewAttempt);
  const skillTiles = getSkillPerformanceTiles(lastMissionAttempt?.skillPerformance);
  const reviewCount = getReviewQuestions().length;
  const isGroceryPlayable = isMissionPlayable("grocery_store");
  const currentMissionLabel = missionId === "grocery_store" ? "Grocery Store" : "Coffee Shop";
  const resumeLabel = getResumeLabel();

  app.innerHTML = `
    <section class="panel launch-hero">
      <p class="eyebrow">${isReviewEnvironment ? "Review Staging" : "Launch Version 1"}</p>
      <h2>Practice French for TEF Canada through real-life Canadian scenarios.</h2>
      <p class="launch-copy">為中文使用者設計的 TEF Canada 法文情境練習工具。</p>
      <p class="launch-copy">從零開始的 TEF Canada 情境入門；更高程度內容陸續推出。</p>
      <p class="launch-copy">French Quest helps TEF Canada learners practice everyday French for real situations: ordering coffee, shopping for groceries, and visiting a bank.</p>
      <div class="launch-points">
        <span>Original TEF-style questions</span>
        <span>Wrong-answer review</span>
        <span>Guessed-question tracking</span>
        <span>Timed practice</span>
      </div>
      <div class="actions launch-actions">
        <button class="primary-btn" id="heroStartMission" ${state.missionLoaded ? "" : "disabled"}>開始第一個任務</button>
        <button class="secondary-btn" data-action="waitlist">加入搶先體驗</button>
      </div>
    </section>

    <section class="screen home-grid">
      <div class="panel journey">
        <div class="journey-title">
          <div>
            <p class="eyebrow">Canada Journey</p>
            <h2>Canada</h2>
          </div>
          <div class="leaf" aria-hidden="true">MAPLE</div>
        </div>

        <div class="route" aria-label="Canada Journey">
          <div class="route-stop">
            <div class="route-icon" aria-hidden="true">CA</div>
            <p class="route-name">Canada</p>
            <span class="route-state">Start</span>
          </div>
          <div class="route-arrow" aria-hidden="true">|</div>
          <div class="route-stop ready">
            <div class="route-icon" aria-hidden="true">CUP</div>
            <p class="route-name">Coffee Shop Mission</p>
            <span class="route-state">Ready</span>
          </div>
          <div class="route-arrow" aria-hidden="true">|</div>
          <div class="route-stop ${isGroceryPlayable ? "ready" : ""}">
            <div class="route-icon" aria-hidden="true">BAG</div>
            <div>
              <p class="route-name">Grocery Store</p>
              <p class="route-preview">Practice grocery signs, discounts, checkout, and simple staff questions.</p>
              <ul class="route-preview-list">
                <li>discounts</li>
                <li>self-checkout</li>
                <li>reusable bags</li>
              </ul>
            </div>
            <span class="route-state">${isGroceryPlayable ? "Ready" : "Coming Soon"}</span>
          </div>
          <div class="route-arrow" aria-hidden="true">|</div>
          <div class="route-stop">
            <div class="route-icon" aria-hidden="true">$</div>
            <div>
              <p class="route-name">Banking</p>
              <p class="route-preview">Practice French for everyday banking situations, account services, and questions at the service counter.</p>
              <ul class="route-preview-list">
                <li>appointments</li>
                <li>cards and accounts</li>
                <li>documents</li>
              </ul>
            </div>
            <span class="route-state">Coming Soon</span>
          </div>
        </div>

        <div class="actions">
          ${missionId === "coffee_shop" && resumeLabel
            ? `<button class="primary-btn" id="continueMission">${resumeLabel}</button>`
            : `<button class="primary-btn" id="startCoffeeMission">開始 Coffee Shop 任務</button>`}
          ${isGroceryPlayable ? `<button class="primary-btn" id="startGroceryMission">開始 Grocery Store 任務</button>` : ""}
          ${lastMissionAttempt ? `<button class="secondary-btn" id="retakeMission">重新挑戰 ${currentMissionLabel}</button>` : ""}
          ${reviewCount ? `<button class="secondary-btn" id="reviewMission">複習 ${reviewCount} 題待加強</button>` : ""}
        </div>
      </div>

      <div class="panel progress-panel" style="display: flex; flex-direction: column; gap: 16px;">
        <div class="stat-card">
          <span class="stat-label">Total XP</span>
          <strong>${state.progress.totalXp || 0}</strong>
          <p class="next-step">Accumulated practice reward.</p>
        </div>
        ${skillTiles.length ? `
          <p class="next-step">Skill performance from your latest full mission.</p>
          <div class="skill-grid">
            ${skillTiles.map((tile) => `
              <div class="skill-tile">
                <span>${tile.label}</span>
                <strong>${tile.value}</strong>
              </div>
            `).join("")}
          </div>
        ` : `
          <p class="next-step">Complete a full mission to see skill performance.</p>
        `}
        ${lastMissionAttempt ? `
          <div class="stat-card">
            <span class="stat-label">Last Mission Attempt</span>
            <strong>${lastMissionAttempt.score} / ${lastMissionAttempt.total}</strong>
            <p class="next-step">${currentMissionLabel} · ${formatDateTime(lastMissionAttempt.completedAt)} · Wrong: ${lastMissionAttempt.wrongCount} · Guessed: ${lastMissionAttempt.guessedCount} · Time: ${formatDuration(lastMissionAttempt.totalTimeMs)}</p>
          </div>
        ` : `
          <p class="next-step">Start your first mission to build your TEF profile.</p>
        `}
        ${lastReviewAttempt ? `
          <div class="stat-card">
            <span class="stat-label">Last Review</span>
            <strong>${lastReviewAttempt.score} / ${lastReviewAttempt.total}</strong>
            <p class="next-step">${formatDateTime(lastReviewAttempt.completedAt)} · Wrong: ${lastReviewAttempt.wrongCount} · Guessed: ${lastReviewAttempt.guessedCount} · Time: ${formatDuration(lastReviewAttempt.totalTimeMs)}</p>
          </div>
        ` : ""}
      </div>
    </section>

    <section class="screen launch-grid">
      ${renderStagingNotice()}
      <div class="panel info-panel">
        <p class="eyebrow">About French Quest</p>
        <h2>Built for practical TEF Canada preparation.</h2>
        <p>French Quest is for learners who want more than grammar drills. Each mission uses simple real-life situations to practice vocabulary, reading, responses, and test-style thinking.</p>
      </div>

      <div class="panel info-panel">
        <p class="eyebrow">Early Access</p>
        <h2>Get new missions when they launch.</h2>
        <p>Grocery Store is now available. Banking is coming next. Join the early access list to get updates when new TEF practice missions are added.</p>
        <p>目前 Coffee Shop 與 Grocery Store 開放免費體驗；更多任務與進階功能將陸續推出。</p>
        <p>本站僅記錄匿名使用統計，不包含姓名或 Email，用來提升內容與使用體驗。</p>
        <p>Your email will only be used for French Quest updates. 有任何問題，歡迎來信 <a href="mailto:bonjour.frenchquest@gmail.com">bonjour.frenchquest@gmail.com</a>。</p>
        <div class="actions">
          <button class="primary-btn" data-action="waitlist">加入搶先體驗名單</button>
        </div>
      </div>

      <div class="panel info-panel disclaimer-panel">
        <p class="eyebrow">Disclaimer</p>
        <h2>Independent practice tool.</h2>
        <p>French Quest is an independent TEF Canada practice tool. All questions are original and created for learning purposes. French Quest is not affiliated with or endorsed by TEF, Le français des affaires, or any official testing organization. Practice progress indicators are for practice only and do not guarantee official scores.</p>
      </div>
    </section>
  `;

  trackPageViewOnce();
  attachLaunchButtons();

  if (state.missionLoaded) {
    document.getElementById("heroStartMission").addEventListener("click", () => startOrOpenMission(missionId, { randomizeQuestions: false, randomizeOptions: false, reviewMode: false }));
    const continueButton = document.getElementById("continueMission");
    if (continueButton) continueButton.addEventListener("click", () => startOrOpenMission(missionId, { randomizeQuestions: false, randomizeOptions: false, reviewMode: false }));

    const coffeeButton = document.getElementById("startCoffeeMission");
    if (coffeeButton) coffeeButton.addEventListener("click", () => startOrOpenMission("coffee_shop", { randomizeQuestions: false, randomizeOptions: false, reviewMode: false }));

    const groceryButton = document.getElementById("startGroceryMission");
    if (groceryButton) groceryButton.addEventListener("click", () => startOrOpenMission("grocery_store", { randomizeQuestions: false, randomizeOptions: false, reviewMode: false }));

    const retakeButton = document.getElementById("retakeMission");
    if (retakeButton) retakeButton.addEventListener("click", () => startMission({ randomizeQuestions: true, randomizeOptions: true, reviewMode: false }));

    const reviewButton = document.getElementById("reviewMission");
    if (reviewButton) reviewButton.addEventListener("click", startReviewMode);
  }
}

function startMission({ randomizeQuestions = false, randomizeOptions = false, reviewMode = false } = {}) {
  if (!state.missionLoaded || questions.length === 0) return;

  state.screen = "question";
  state.currentQuestion = 0;
  state.selectedAnswer = null;
  state.guessedCurrent = false;
  state.answers = [];
  state.xp = 0;
  state.reviewMode = reviewMode;
  state.missionMode = reviewMode ? "review" : (randomizeQuestions ? "retake" : "normal");
  state.attemptId = reviewMode ? "" : createAttemptId();
  state.activeQuestions = prepareQuestionsForSession(questions, {
    randomizeQuestions,
    randomizeOptions,
    randomizeWithinSections: !reviewMode && randomizeQuestions && missionConfig.retakeRandomization === "section"
  });
  state.missionStartTime = Date.now();
  state.questionStartTime = Date.now();
  saveActiveSession();
  trackMissionStartedOnce();
  render();
}

function startReviewMode() {
  const reviewQuestions = getReviewQuestions();
  if (!reviewQuestions.length) return;

  state.screen = "question";
  state.currentQuestion = 0;
  state.selectedAnswer = null;
  state.guessedCurrent = false;
  state.answers = [];
  state.xp = 0;
  state.reviewMode = true;
  state.missionMode = "review";
  state.attemptId = "";
  state.activeQuestions = prepareQuestionsForSession(reviewQuestions, { randomizeQuestions: true, randomizeOptions: true });
  state.missionStartTime = Date.now();
  state.questionStartTime = Date.now();
  render();
}

function renderQuestion() {
  const activeQuestions = getActiveQuestions();
  const question = activeQuestions[state.currentQuestion];
  const progress = (state.currentQuestion / activeQuestions.length) * 100;

  app.innerHTML = `
    <section class="panel mission-card">
      <div class="mission-head">
        <div>
          <p class="eyebrow">${state.reviewMode ? "Review Mode" : missionConfig.sequenceLabel}</p>
          <h2>${missionConfig.title}</h2>
        </div>
        <span class="pill">XP ${state.xp}</span>
      </div>

      <div class="question-meta">
        <span class="pill">Question ${state.currentQuestion + 1} / ${activeQuestions.length}</span>
        <span class="pill">${state.reviewMode ? "待加強題目" : "Canadian daily life"}</span>
      </div>

      <div class="meter" aria-label="Mission progress">
        <div class="meter-fill" style="--value: ${progress}%"></div>
      </div>

      <p class="question-text">${question.question}</p>

      <div class="options">
        ${question.options.map((option, index) => `
          <button class="option ${state.selectedAnswer === index ? "selected" : ""}" data-option="${index}" type="button">
            ${option}
          </button>
        `).join("")}
      </div>

      <div class="actions">
        <button class="secondary-btn" id="missionMap" type="button">回任務地圖</button>
        <button class="secondary-btn" id="guessToggle" type="button">${state.guessedCurrent ? "Marked as guessed" : "I guessed this"}</button>
        <button class="primary-btn" id="submitAnswer" ${state.selectedAnswer === null ? "disabled" : ""}>Submit</button>
      </div>
    </section>
  `;

  document.querySelectorAll(".option").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAnswer = Number(button.dataset.option);
      saveActiveSession();
      renderQuestion();
    });
  });

  document.getElementById("guessToggle").addEventListener("click", () => {
    state.guessedCurrent = !state.guessedCurrent;
    saveActiveSession();
    renderQuestion();
  });

  document.getElementById("missionMap").addEventListener("click", returnToJourneyMap);
  document.getElementById("submitAnswer").addEventListener("click", submitAnswer);
}

function submitAnswer() {
  const activeQuestions = getActiveQuestions();
  const question = activeQuestions[state.currentQuestion];
  const correctIndex = getCorrectIndex(question);
  const isCorrect = state.selectedAnswer === correctIndex;
  const timeSpentMs = Date.now() - (state.questionStartTime || Date.now());

  state.answers.push({
    questionId: question.id,
    skill: question.skill,
    isCorrect,
    guessed: state.guessedCurrent,
    selectedIndex: state.selectedAnswer,
    correctIndex,
    timeSpentMs
  });

  if (isCorrect) state.xp += xpPerCorrect;
  state.screen = "feedback";
  saveActiveSession();
  trackQuestionAnsweredOnce(question, state.currentQuestion + 1);
  render();
}

function renderFeedback() {
  const activeQuestions = getActiveQuestions();
  const question = activeQuestions[state.currentQuestion];
  const answer = state.answers[state.answers.length - 1];
  const correctIndex = getCorrectIndex(question);
  const correctAnswer = question.options[correctIndex];
  const selectedAnswer = question.options[answer.selectedIndex];
  const earnedXp = answer.isCorrect ? xpPerCorrect : 0;

  app.innerHTML = `
    <section class="panel mission-card">
      <div class="mission-head">
        <div>
          <p class="eyebrow">${state.reviewMode ? "Review Mode" : `${missionConfig.sequenceLabel}: ${missionConfig.title}`}</p>
          <h2>${answer.isCorrect ? "Correct" : "Incorrect"}</h2>
          <div class="review-line">
            <p><strong>Question:</strong> ${question.question}</p>
            <p><strong>Your answer:</strong> ${selectedAnswer}</p>
            <p><strong>Time spent:</strong> ${formatDuration(answer.timeSpentMs)}</p>
            ${answer.guessed ? `<p><strong>Marked:</strong> Guessed / Not sure</p>` : ""}
          </div>
        </div>
        <span class="pill">XP ${state.xp}</span>
      </div>

      <div class="feedback-result ${answer.isCorrect ? "correct" : "incorrect"}">
        +${earnedXp} XP
      </div>

      ${answer.isCorrect ? "" : `<p><strong>Correct answer:</strong> ${correctAnswer}</p>`}

      <div class="options" aria-label="Answered options">
        ${question.options.map((option, index) => {
          const className = index === correctIndex ? "correct" : index === answer.selectedIndex ? "wrong" : "";
          return `<button class="option ${className}" type="button" disabled>${option}</button>`;
        }).join("")}
      </div>

      <div class="learning-notes">
        <div class="note">
          <span>Vocabulary</span>
          <div class="note-content">${question.vocabulary}</div>
        </div>
        <div class="note">
          <span>Pattern</span>
          <div class="note-content">${question.pattern}</div>
        </div>
        <div class="note">
          <span>TEF Tip</span>
          <div class="note-content">${question.tef_tip || ""}</div>
        </div>
      </div>

      <div class="actions">
        <button class="secondary-btn" id="missionMap" type="button">回任務地圖</button>
        <button class="primary-btn" id="nextQuestion">Next Question</button>
      </div>
    </section>
  `;

  document.getElementById("missionMap").addEventListener("click", returnToJourneyMap);
  document.getElementById("nextQuestion").addEventListener("click", nextQuestion);
}

function returnToJourneyMap() {
  saveActiveSession();
  state.screen = "home";
  state.activeQuestions = [];
  state.reviewMode = false;
  state.questionStartTime = null;
  state.missionStartTime = null;
  render();
}

function nextQuestion() {
  const activeQuestions = getActiveQuestions();

  if (state.currentQuestion === activeQuestions.length - 1) {
    finishMission();
    return;
  }

  state.currentQuestion += 1;
  state.selectedAnswer = null;
  state.guessedCurrent = false;
  state.questionStartTime = Date.now();
  state.screen = "question";
  saveActiveSession();
  render();
}

function finishMission() {
  const activeQuestions = getActiveQuestions();
  const score = getScore();
  const wrongAnswers = getWrongAnswers();
  const guessedAnswers = getGuessedAnswers();
  const correctAnswerIds = state.answers
    .filter((answer) => answer.isCorrect)
    .map((answer) => answer.questionId);
  const totalTimeMs = getTotalAnswerTimeMs();
  const averageTimeMs = activeQuestions.length ? totalTimeMs / activeQuestions.length : 0;
  const readinessGain = Math.round((score / activeQuestions.length) * 2);
  const skillPerformance = calculateSkillPerformance(state.answers);
  const attemptId = state.reviewMode ? "" : state.progress.activeSession?.attemptId || state.attemptId || createAttemptId();

  state.progress.totalXp += state.xp;
  state.progress.readiness = Math.max(state.progress.readiness || 0, readinessGain);
  state.readiness = state.progress.readiness;

  state.answers.forEach((answer) => {
    if (answer.isCorrect) {
      const skill = answer.skill || "vocabulary";
      if (!state.progress.skillXp[skill]) state.progress.skillXp[skill] = 0;
      state.progress.skillXp[skill] += xpPerCorrect;
    }
  });

  if (state.reviewMode) {
    const guessedAnswerIds = guessedAnswers.map((answer) => answer.questionId);
    state.progress.wrongQuestionIds = uniqueIds([
      ...state.progress.wrongQuestionIds.filter((questionId) => !correctAnswerIds.includes(questionId)),
      ...wrongAnswers.map((answer) => answer.questionId)
    ]);

    state.progress.guessedQuestionIds = uniqueIds([
      ...state.progress.guessedQuestionIds.filter((questionId) => !correctAnswerIds.includes(questionId) || guessedAnswerIds.includes(questionId)),
      ...guessedAnswerIds
    ]);
  } else {
    state.progress.wrongQuestionIds = uniqueIds([
      ...state.progress.wrongQuestionIds,
      ...wrongAnswers.map((answer) => answer.questionId)
    ]);

    state.progress.guessedQuestionIds = uniqueIds([
      ...state.progress.guessedQuestionIds,
      ...guessedAnswers.map((answer) => answer.questionId)
    ]);
  }

  if (!state.reviewMode && !state.progress.completedMissions.includes(missionId)) {
    state.progress.completedMissions.push(missionId);
  }

  const attemptSummary = {
    mission: state.reviewMode ? `${missionConfig.title} Review` : missionConfig.title,
    score,
    total: activeQuestions.length,
    xp: state.xp,
    wrongCount: wrongAnswers.length,
    guessedCount: guessedAnswers.length,
    totalTimeMs,
    averageTimeMs,
    skillPerformance,
    attemptId,
    completedAt: new Date().toISOString()
  };

  if (state.reviewMode) {
    state.progress.lastReviewAttempt = attemptSummary;
  } else {
    trackMissionCompletedOnce({
      score,
      totalQuestions: activeQuestions.length,
      durationSeconds: Math.round(totalTimeMs / 1000)
    });
    state.progress.lastMissionAttempt = attemptSummary;
    state.progress.lastAttempt = attemptSummary;
    clearActiveSession();
  }

  saveProgress();
  state.screen = "complete";
  render();
}

function renderComplete() {
  const activeQuestions = getActiveQuestions();
  const score = getScore();
  const wrongCount = getWrongAnswers().length;
  const guessedCount = getGuessedAnswers().length;
  const totalTimeMs = getTotalAnswerTimeMs();
  const averageTimeMs = activeQuestions.length ? totalTimeMs / activeQuestions.length : 0;
  const skillTiles = getSkillPerformanceTiles(calculateSkillPerformance(state.answers), completeSkillPerformanceLabels);
  const reviewCount = getReviewQuestions().length;
  const nextMissionId = missionConfig.nextMissionId;
  const canStartNextMission = Boolean(nextMissionId && missionConfigs[nextMissionId] && isMissionPlayable(nextMissionId));
  const nextStepText = reviewCount === 0
    ? `太好了！這次任務的待加強題目都已經複習完成。下一個任務：${missionConfig.nextMissionLabel}`
    : "下一步：複習答錯與不確定的題目，強化你的 TEF 情境理解。";
  const showCompletionCtas = !isReviewEnvironment;

  app.innerHTML = `
    <section class="panel complete-card">
      <p class="eyebrow">${state.reviewMode ? "複習完成" : "任務完成"}</p>
      <h2>${state.reviewMode ? "複習完成" : "任務完成"}</h2>
      <p>你剛完成了一次加拿大${missionConfig.scenarioZh}情境的 TEF-style 法文練習。</p>

      <div class="score-row">
        <div class="stat-card">
          <span class="stat-label">本次得分</span>
          <strong>${score} / ${activeQuestions.length}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">獲得 XP</span>
          <strong>${state.xp}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">答錯題目</span>
          <strong>${wrongCount}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">不確定題目</span>
          <strong>${guessedCount}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">總作答時間</span>
          <strong>${formatDuration(totalTimeMs)}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">平均每題時間</span>
          <strong>${formatDuration(averageTimeMs)}</strong>
        </div>
      </div>

      <div class="report-grid">
        ${skillTiles.map((tile) => `
          <div class="report-tile">
            <span>${tile.label}</span>
            <strong>${tile.value}</strong>
          </div>
        `).join("")}
      </div>

      <p class="next-step">${nextStepText}</p>

      ${showCompletionCtas ? `
        <div class="panel info-panel early-access-card">
          <p class="eyebrow">搶先體驗</p>
          <h2>想解鎖更多生活情境任務嗎？</h2>
          <p>Grocery Store 已經上線。加入搶先體驗名單，在 Banking 與其他 TEF-style 任務推出時第一時間收到通知。</p>
          <p>你的 Email 只會用於 French Quest 的產品更新與新任務通知。</p>
          <div class="actions">
            <button class="primary-btn" data-action="waitlist" data-attempt-scope="last-mission">加入搶先體驗名單</button>
            <button class="secondary-btn" data-action="feedback" data-attempt-scope="last-mission">提供回饋</button>
          </div>
        </div>
      ` : ""}

      <div class="actions">
        ${reviewCount ? `<button class="primary-btn" id="completeReviewMission">複習 ${reviewCount} 題待加強</button>` : ""}
        ${canStartNextMission ? `<button class="primary-btn" id="completeNextMission">開始 ${missionConfigs[nextMissionId].title} 任務</button>` : ""}
        <button class="secondary-btn" id="backToJourney">回到加拿大任務地圖</button>
      </div>
    </section>
  `;

  attachLaunchButtons();

  const completeReviewButton = document.getElementById("completeReviewMission");
  if (completeReviewButton) completeReviewButton.addEventListener("click", startReviewMode);

  const completeNextMissionButton = document.getElementById("completeNextMission");
  if (completeNextMissionButton) completeNextMissionButton.addEventListener("click", () => startOrOpenMission(nextMissionId, { randomizeQuestions: false, randomizeOptions: false, reviewMode: false }));

  document.getElementById("backToJourney").addEventListener("click", () => {
    state.screen = "home";
    state.activeQuestions = [];
    state.reviewMode = false;
    state.questionStartTime = null;
    state.missionStartTime = null;
    render();
  });
}

render();
loadMissionData();


