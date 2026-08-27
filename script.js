let questions = [];

const storageKey = "frenchQuestProgressV03";
const xpPerCorrect = 10;
const waitlistUrl = "https://forms.gle/cgmTvvnV7hXWH4gQ8";
const feedbackUrl = "#";
const skillPerformanceLabels = {
  vocabulary: "Vocabulary",
  situation: "Situation",
  expression: "Expression",
  reading: "Reading"
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
  xp: 0,
  readiness: 0,
  missionLoaded: false,
  errorMessage: "",
  questionStartTime: null,
  missionStartTime: null,
  progress: loadProgress()
};

const app = document.getElementById("app");

function getFreshDefaultProgress() {
  return JSON.parse(JSON.stringify(defaultProgress));
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
      completedMissions: parsed.completedMissions || []
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

function uniqueIds(ids) {
  return [...new Set(ids.filter(Boolean))];
}

function getValidAttempt(attempt) {
  return attempt && Number(attempt.total) > 0 ? attempt : null;
}

async function loadMissionData() {
  try {
    const response = await fetch("./data/coffee_shop.json");
    if (!response.ok) throw new Error("Mission data request failed.");

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Mission data is empty.");
    }

    questions = data;
    state.missionLoaded = true;
    state.readiness = state.progress.readiness || 0;
    state.screen = "home";
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
      <p class="eyebrow">Loading Mission</p>
      <h2>Coffee Shop</h2>
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

function getSkillPerformanceTiles(skillPerformance) {
  if (!skillPerformance) return [];

  return Object.entries(skillPerformanceLabels).map(([skill, label]) => {
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
  return [...items].sort(() => Math.random() - 0.5);
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

function prepareQuestionsForSession(sourceQuestions, { randomizeQuestions = false, randomizeOptions = false } = {}) {
  const prepared = sourceQuestions.map((question) => prepareQuestionForSession(question, randomizeOptions));
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

function handleExternalAction(type) {
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
    button.addEventListener("click", () => handleExternalAction("waitlist"));
  });

  document.querySelectorAll("[data-action='feedback']").forEach((button) => {
    button.addEventListener("click", () => handleExternalAction("feedback"));
  });
}

function renderHome() {
  const lastMissionAttempt = getValidAttempt(state.progress.lastMissionAttempt);
  const lastReviewAttempt = getValidAttempt(state.progress.lastReviewAttempt);
  const skillTiles = getSkillPerformanceTiles(lastMissionAttempt?.skillPerformance);
  const reviewCount = getReviewQuestions().length;
  const hasCompletedCoffeeShop = state.progress.completedMissions.includes("coffee_shop");

  app.innerHTML = `
    <section class="panel launch-hero">
      <p class="eyebrow">Launch Version 1</p>
      <h2>Practice TEF Canada French through real Canadian life missions.</h2>
      <p class="launch-copy">為中文使用者設計的 TEF Canada 法文情境練習工具。</p>
      <p class="launch-copy">French Quest helps TEF Canada learners practice everyday French for real situations: ordering coffee, shopping for groceries, and visiting a bank.</p>
      <div class="launch-points">
        <span>Original TEF-style questions</span>
        <span>Wrong-answer review</span>
        <span>Guessed-question tracking</span>
        <span>Timed practice</span>
      </div>
      <div class="actions launch-actions">
        <button class="primary-btn" id="heroStartMission" ${state.missionLoaded ? "" : "disabled"}>Start your first mission</button>
        <button class="secondary-btn" data-action="waitlist">Join Early Access</button>
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
            <span class="route-state">${hasCompletedCoffeeShop ? "Completed" : "Ready"}</span>
          </div>
          <div class="route-arrow" aria-hidden="true">|</div>
          <div class="route-stop">
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
            <span class="route-state">Coming Soon</span>
          </div>
          <div class="route-arrow" aria-hidden="true">|</div>
          <div class="route-stop">
            <div class="route-icon" aria-hidden="true">$</div>
            <div>
              <p class="route-name">Banking</p>
              <p class="route-preview">Practice simple banking situations, account services, and service counter questions.</p>
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
          <button class="primary-btn" id="startMission" ${state.missionLoaded ? "" : "disabled"}>Start Coffee Shop Mission</button>
          ${hasCompletedCoffeeShop ? `<button class="secondary-btn" id="retakeMission">Retake</button>` : ""}
          ${reviewCount ? `<button class="secondary-btn" id="reviewMission">Review ${reviewCount} Weak Spots</button>` : ""}
        </div>
      </div>

      <div class="panel readiness-card">
        <div class="readiness-top">
          <div>
            <p class="eyebrow">Practice Indicator</p>
            <h2>TEF Practice Progress</h2>
          </div>
          <div class="readiness-number">${state.progress.readiness}%</div>
        </div>
        <div class="meter" aria-label="TEF Practice Progress ${state.progress.readiness}%">
          <div class="meter-fill" style="--value: ${state.progress.readiness}%"></div>
        </div>
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
            <p class="next-step">${formatDateTime(lastMissionAttempt.completedAt)} · Wrong: ${lastMissionAttempt.wrongCount} · Guessed: ${lastMissionAttempt.guessedCount} · Time: ${formatDuration(lastMissionAttempt.totalTimeMs)}</p>
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
      <div class="panel info-panel">
        <p class="eyebrow">About French Quest</p>
        <h2>Built for practical TEF Canada preparation.</h2>
        <p>French Quest is for learners who want more than grammar drills. Each mission uses simple real-life situations to practice vocabulary, reading, responses, and test-style thinking.</p>
      </div>

      <div class="panel info-panel">
        <p class="eyebrow">Early Access</p>
        <h2>Get new missions when they launch.</h2>
        <p>Grocery Store and Banking missions are coming next. Join the early access list to get updates when new TEF practice missions are added.</p>
        <p>Your email will only be used for French Quest updates. You can unsubscribe anytime by contacting us.</p>
        <div class="actions">
          <button class="primary-btn" data-action="waitlist">Join Early Access List</button>
        </div>
      </div>

      <div class="panel info-panel disclaimer-panel">
        <p class="eyebrow">Disclaimer</p>
        <h2>Independent practice tool.</h2>
        <p>French Quest is an independent TEF Canada practice tool. All questions are original and created for learning purposes. French Quest is not affiliated with or endorsed by TEF, Le français des affaires, or any official testing organization. Practice progress indicators are for practice only and do not guarantee official scores.</p>
      </div>
    </section>
  `;

  attachLaunchButtons();

  if (state.missionLoaded) {
    document.getElementById("heroStartMission").addEventListener("click", () => startMission({ randomizeQuestions: false, randomizeOptions: false, reviewMode: false }));
    document.getElementById("startMission").addEventListener("click", () => startMission({ randomizeQuestions: false, randomizeOptions: false, reviewMode: false }));

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
  state.activeQuestions = prepareQuestionsForSession(questions, { randomizeQuestions, randomizeOptions });
  state.missionStartTime = Date.now();
  state.questionStartTime = Date.now();
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
          <p class="eyebrow">${state.reviewMode ? "Review Mode" : "Mission 1"}</p>
          <h2>Coffee Shop</h2>
        </div>
        <span class="pill">XP ${state.xp}</span>
      </div>

      <div class="question-meta">
        <span class="pill">Question ${state.currentQuestion + 1} / ${activeQuestions.length}</span>
        <span class="pill">${state.reviewMode ? "Weak spots" : "Canadian daily life"}</span>
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
        <button class="secondary-btn" id="guessToggle" type="button">${state.guessedCurrent ? "Marked as guessed" : "I guessed this"}</button>
        <button class="primary-btn" id="submitAnswer" ${state.selectedAnswer === null ? "disabled" : ""}>Submit</button>
      </div>
    </section>
  `;

  document.querySelectorAll(".option").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAnswer = Number(button.dataset.option);
      renderQuestion();
    });
  });

  document.getElementById("guessToggle").addEventListener("click", () => {
    state.guessedCurrent = !state.guessedCurrent;
    renderQuestion();
  });

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
          <p class="eyebrow">${state.reviewMode ? "Review Mode" : "Mission 1: Coffee Shop"}</p>
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
          ${question.vocabulary}
        </div>
        <div class="note">
          <span>Pattern</span>
          ${question.pattern}
        </div>
        <div class="note">
          <span>TEF Tip</span>
          ${question.tef_tip || ""}
        </div>
      </div>

      <div class="actions">
        <button class="primary-btn" id="nextQuestion">Next Question</button>
      </div>
    </section>
  `;

  document.getElementById("nextQuestion").addEventListener("click", nextQuestion);
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
    state.progress.wrongQuestionIds = uniqueIds([
      ...state.progress.wrongQuestionIds.filter((questionId) => !correctAnswerIds.includes(questionId)),
      ...wrongAnswers.map((answer) => answer.questionId)
    ]);

    state.progress.guessedQuestionIds = uniqueIds([
      ...state.progress.guessedQuestionIds.filter((questionId) => !correctAnswerIds.includes(questionId)),
      ...guessedAnswers.filter((answer) => !answer.isCorrect).map((answer) => answer.questionId)
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

  if (!state.reviewMode && !state.progress.completedMissions.includes("coffee_shop")) {
    state.progress.completedMissions.push("coffee_shop");
  }

  const attemptSummary = {
    mission: state.reviewMode ? "Coffee Shop Review" : "Coffee Shop",
    score,
    total: activeQuestions.length,
    xp: state.xp,
    wrongCount: wrongAnswers.length,
    guessedCount: guessedAnswers.length,
    totalTimeMs,
    averageTimeMs,
    skillPerformance,
    completedAt: new Date().toISOString()
  };

  if (state.reviewMode) {
    state.progress.lastReviewAttempt = attemptSummary;
  } else {
    state.progress.lastMissionAttempt = attemptSummary;
    state.progress.lastAttempt = attemptSummary;
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
  const skillTiles = getSkillPerformanceTiles(calculateSkillPerformance(state.answers));
  const reviewCount = getReviewQuestions().length;
  const nextStepText = reviewCount === 0
    ? "Great work — you cleared your weak spots for this mission. Next mission: Grocery Store — coming soon."
    : "Next: Review wrong and guessed questions to build a stronger TEF profile.";

  app.innerHTML = `
    <section class="panel complete-card">
      <p class="eyebrow">${state.reviewMode ? "Review Complete" : "Coffee Shop Stamp Earned"}</p>
      <h2>${state.reviewMode ? "Review Complete" : "Mission Complete"}</h2>
      <p>You practiced a real Canadian coffee shop situation with TEF-style practical French.</p>

      <div class="score-row">
        <div class="stat-card">
          <span class="stat-label">Final Score</span>
          <strong>${score} / ${activeQuestions.length}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">XP Earned</span>
          <strong>${state.xp}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">TEF Practice Progress</span>
          <strong>${state.progress.readiness}%</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Wrong Questions</span>
          <strong>${wrongCount}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Guessed Questions</span>
          <strong>${guessedCount}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Total Time</span>
          <strong>${formatDuration(totalTimeMs)}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">Average Time</span>
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

      <div class="panel info-panel early-access-card">
        <p class="eyebrow">Early Access</p>
        <h2>Want new missions next?</h2>
        <p>Join the early access list to get updates when Grocery Store, Banking, and other TEF-style missions launch.</p>
        <p>Your email will only be used for French Quest updates. You can unsubscribe anytime by contacting us.</p>
        <div class="actions">
          <button class="primary-btn" data-action="waitlist">Join Early Access List</button>
          <button class="secondary-btn" data-action="feedback">Give Feedback</button>
        </div>
      </div>

      <div class="actions">
        ${reviewCount ? `<button class="primary-btn" id="completeReviewMission">Review ${reviewCount} Weak Spots</button>` : ""}
        <button class="secondary-btn" id="backToJourney">Back to Canada Journey</button>
      </div>
    </section>
  `;

  attachLaunchButtons();

  const completeReviewButton = document.getElementById("completeReviewMission");
  if (completeReviewButton) completeReviewButton.addEventListener("click", startReviewMode);

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
