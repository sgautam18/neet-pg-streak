import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Flame,
  Gamepad2,
  Layers3,
  Loader2,
  PartyPopper,
  RefreshCcw,
  Search,
  Shuffle,
  Target,
  Trophy,
  UserRound,
  XCircle,
  Crosshair,
} from 'lucide-react';
import './App.css';

const DEVICE_KEY = 'neet-pg-device-id';
const EXAM_KEY = 'neet-pg-selected-exam';
const STATIC_STATE_KEY = 'neet-pg-static-state';
const BASE_URL = import.meta.env.BASE_URL;
const STATIC_EXAMS = [
  { id: 'neet-pg', label: 'NEET PG', file: 'questions.json' },
  { id: 'inicet', label: 'INI-CET', file: 'inicet_questions.json' },
];
const memoryStorage = new Map();
const praiseLines = [
  'Clean hit. Keep going.',
  'Sharp shot. That was yours.',
  'Excellent. Next one.',
  'Beautiful accuracy.',
  'Strong work. Stay locked in.',
];

const defaultStats = {
  streak: 0,
  maxStreak: 0,
  bestScore: 0,
  totalSolved: 0,
  correctSolved: 0,
};

function App() {
  const [screen, setScreen] = useState(() =>
    window.location.hash === '#game' ? 'game' : 'practice',
  );
  const [config, setConfig] = useState({ exams: [] });
  const [selectedExam, setSelectedExam] = useState(
    () => storageGet(EXAM_KEY) || 'neet-pg',
  );
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [profile, setProfile] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [wrongQuestions, setWrongQuestions] = useState([]);
  const [wrongSearch, setWrongSearch] = useState('');
  const [wrongSubject, setWrongSubject] = useState('All');
  const [selectedOption, setSelectedOption] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState('All');
  const [selectedSource, setSelectedSource] = useState('All');
  const [registrationRequired, setRegistrationRequired] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refreshUserData = useCallback(async (deviceId, exam) => {
    const suffix = `exam=${encodeURIComponent(exam)}`;
    const [profilePayload, leaderboardPayload, wrongPayload] = await Promise.all([
      apiGet(`/api/profile?deviceId=${encodeURIComponent(deviceId)}&${suffix}`),
      apiGet(`/api/leaderboard?${suffix}`),
      apiGet(`/api/wrong?deviceId=${encodeURIComponent(deviceId)}&${suffix}`),
    ]);

    setProfile(profilePayload.profile);
    setLeaderboard(leaderboardPayload.leaderboard || []);
    setWrongQuestions(wrongPayload.wrongQuestions || []);
    setRegistrationRequired(false);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadExam = async () => {
      setLoading(true);
      setError('');
      setSelectedSubject('All');
      setSelectedSource('All');
      setSelectedOption('');
      setShowResult(false);
      storageSet(EXAM_KEY, selectedExam);

      try {
        const deviceId = getDeviceId();
        const suffix = `exam=${encodeURIComponent(selectedExam)}`;
        const appConfig = await apiGet(`/api/config?${suffix}`);
        const questionPayload = await apiGet(`/api/questions?${suffix}`);
        const examQuestions = (questionPayload.questions || [])
          .map((question, index) => normalizeQuestion(question, index, selectedExam))
          .filter(
            (question) =>
              question?.question &&
              question?.options &&
              Object.keys(question.options).length > 0 &&
              getCorrectOptionKey(question),
          );

        if (!mounted) return;
        setConfig(appConfig);
        setQuestions(examQuestions);
        setCurrentQuestion(selectRandomQuestion(examQuestions));

        try {
          await refreshUserData(deviceId, selectedExam);
          apiPost('/api/event', {
            deviceId,
            exam: selectedExam,
            event: 'session_open',
          }).catch(() => {});
        } catch (profileError) {
          if (profileError.status === 404) {
            setProfile(null);
            setLeaderboard([]);
            setWrongQuestions([]);
            setRegistrationRequired(true);
          } else {
            throw profileError;
          }
        }
      } catch (loadError) {
        setError(
          loadError.message ||
            'Practice could not start. Make sure the backend is running with python3 main.py.',
        );
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadExam();

    return () => {
      mounted = false;
    };
  }, [selectedExam, refreshUserData]);

  const stats = profile?.stats || defaultStats;
  const accuracy =
    stats.totalSolved > 0
      ? Math.round((stats.correctSolved / stats.totalSolved) * 100)
      : 0;

  const activeExamLabel =
    config.exams?.find((exam) => exam.id === selectedExam)?.label ||
    config.label ||
    'Question Bank';

  const subjects = useMemo(() => {
    const uniqueSubjects = new Set(
      questions.map((question) => question.subject).filter(Boolean),
    );

    return ['All', ...Array.from(uniqueSubjects).sort()];
  }, [questions]);

  const sources = useMemo(() => {
    const uniqueSources = new Set(
      questions.map((question) => sourceLabel(question.source_pdf)).filter(Boolean),
    );

    return ['All', ...Array.from(uniqueSources).sort()];
  }, [questions]);

  const wrongSubjects = useMemo(() => {
    const uniqueSubjects = new Set(
      wrongQuestions.map((item) => item.question.subject).filter(Boolean),
    );

    return ['All', ...Array.from(uniqueSubjects).sort()];
  }, [wrongQuestions]);

  const filteredWrongQuestions = useMemo(() => {
    const search = normalizeForMatch(wrongSearch);

    return wrongQuestions.filter((item) => {
      const question = item.question;
      const subjectMatches =
        wrongSubject === 'All' || question.subject === wrongSubject;
      const searchable = normalizeForMatch(
        `${question.question} ${question.subject} ${question.topic} ${sourceLabel(
          question.source_pdf,
        )} ${question.question_no}`,
      );

      return subjectMatches && (!search || searchable.includes(search));
    });
  }, [wrongQuestions, wrongSearch, wrongSubject]);

  const filteredQuestions = useMemo(
    () =>
      questions.filter((question) => {
        const subjectMatches =
          selectedSubject === 'All' || question.subject === selectedSubject;
        const sourceMatches =
          selectedSource === 'All' || sourceLabel(question.source_pdf) === selectedSource;

        return subjectMatches && sourceMatches;
      }),
    [questions, selectedSubject, selectedSource],
  );

  const options = useMemo(
    () => Object.entries(currentQuestion?.options || {}),
    [currentQuestion],
  );

  const correctOptionKey = useMemo(() => {
    return getCorrectOptionKey(currentQuestion);
  }, [currentQuestion]);

  useEffect(() => {
    const handleHashChange = () => {
      setScreen(window.location.hash === '#game' ? 'game' : 'practice');
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const changeScreen = (nextScreen) => {
    setScreen(nextScreen);
    window.location.hash = nextScreen === 'game' ? 'game' : '';
  };

  const changeExam = (examId) => {
    if (examId === selectedExam) return;
    setSelectedExam(examId);
  };

  const registerDevice = async (event) => {
    event.preventDefault();
    const name = nameInput.trim();
    if (!name) return;

    setSaving(true);
    setError('');
    try {
      const payload = await apiPost('/api/device/register', {
        deviceId: getDeviceId(),
        exam: selectedExam,
        name,
      });
      setProfile(payload.profile);
      setRegistrationRequired(false);
      await refreshUserData(getDeviceId(), selectedExam);
    } catch (registerError) {
      setError(registerError.message || 'Could not register this device.');
    } finally {
      setSaving(false);
    }
  };

  const pickQuestion = (pool = filteredQuestions) => {
    if (!pool.length) return;

    let nextQuestion = selectRandomQuestion(pool);

    if (pool.length > 1 && currentQuestion) {
      while (nextQuestion?.id === currentQuestion.id) {
        nextQuestion = selectRandomQuestion(pool);
      }
    }

    setCurrentQuestion(nextQuestion);
    setSelectedOption('');
    setShowResult(false);
  };

  const changeSubject = (subject) => {
    const nextPool = questions.filter((question) => {
      const subjectMatches = subject === 'All' || question.subject === subject;
      const sourceMatches =
        selectedSource === 'All' || sourceLabel(question.source_pdf) === selectedSource;

      return subjectMatches && sourceMatches;
    });

    setSelectedSubject(subject);
    pickQuestion(nextPool);
  };

  const changeSource = (source) => {
    const nextPool = questions.filter((question) => {
      const subjectMatches =
        selectedSubject === 'All' || question.subject === selectedSubject;
      const sourceMatches = source === 'All' || sourceLabel(question.source_pdf) === source;

      return subjectMatches && sourceMatches;
    });

    setSelectedSource(source);
    pickQuestion(nextPool);
  };

  const recordAttempt = async (question, optionKey) => {
    const isCorrect = optionKey === getCorrectOptionKey(question);

    const payload = await apiPost('/api/attempt', {
      deviceId: getDeviceId(),
      exam: selectedExam,
      questionId: question.id,
      question,
      selectedOption: optionKey,
      correct: isCorrect,
    });

    setProfile(payload.profile);
    setLeaderboard(payload.leaderboard || []);
    const wrongPayload = await apiGet(
      `/api/wrong?deviceId=${encodeURIComponent(getDeviceId())}&exam=${encodeURIComponent(
        selectedExam,
      )}`,
    );
    setWrongQuestions(wrongPayload.wrongQuestions || []);

    return isCorrect;
  };

  const handleAnswer = async (optionKey) => {
    if (showResult || !profile) return;

    setSelectedOption(optionKey);
    setShowResult(true);

    try {
      await recordAttempt(currentQuestion, optionKey);
    } catch (attemptError) {
      setError(attemptError.message || 'Your answer could not be saved.');
    }
  };

  const revisitWrongQuestion = (item) => {
    const question =
      questions.find((candidate) => candidate.id === item.questionId) ||
      normalizeQuestion(item.question, 0, selectedExam);

    setCurrentQuestion(question);
    setSelectedOption('');
    setShowResult(false);
  };

  const removeWrongQuestion = async (questionId) => {
    await apiPost('/api/wrong/remove', {
      deviceId: getDeviceId(),
      exam: selectedExam,
      questionId,
    });
    setWrongQuestions((items) => items.filter((item) => item.questionId !== questionId));
  };

  if (loading) {
    return (
      <main className="app-loading">
        <Loader2 className="loading-icon" aria-hidden="true" />
        <span>Loading your question bank</span>
      </main>
    );
  }

  if (error || !currentQuestion) {
    return (
      <main className="app-error">
        <div className="message-panel">
          <XCircle aria-hidden="true" />
          <h1>Practice cannot start</h1>
          <p>{error || 'No usable questions were found.'}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`app-shell ${screen === 'game' ? 'is-game' : ''}`}>
      <aside className="practice-sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <BookOpenCheck aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">{activeExamLabel}</p>
            <h1>Streak Practice</h1>
          </div>
        </div>

        {config.exams?.length > 0 && (
          <div className="exam-switcher" aria-label="Exam selector">
            {config.exams.map((exam) => (
              <button
                className={exam.id === selectedExam ? 'is-active' : ''}
                type="button"
                key={exam.id}
                onClick={() => changeExam(exam.id)}
              >
                {exam.label}
              </button>
            ))}
          </div>
        )}

        <div className="screen-switcher" aria-label="Mode selector">
          <button
            className={screen === 'practice' ? 'is-active' : ''}
            type="button"
            onClick={() => changeScreen('practice')}
          >
            <BookOpenCheck aria-hidden="true" />
            Practice
          </button>
          <button
            className={screen === 'game' ? 'is-active' : ''}
            type="button"
            onClick={() => changeScreen('game')}
          >
            <Gamepad2 aria-hidden="true" />
            Game
          </button>
        </div>

        {profile && (
          <div className="user-chip">
            <UserRound aria-hidden="true" />
            <span>{profile.name}</span>
          </div>
        )}

        <div className="stats-grid" aria-label="Practice stats">
          <StatTile icon={Flame} label="Current" value={stats.streak} tone="heat" />
          <StatTile icon={Trophy} label="Best" value={stats.bestScore} tone="gold" />
          <StatTile icon={Target} label="Accuracy" value={`${accuracy}%`} tone="aqua" />
        </div>

        <section className="leaderboard-panel" aria-label="Leaderboard">
          <div className="panel-title">
            <BarChart3 aria-hidden="true" />
            <span>Leaderboard</span>
          </div>
          {leaderboard.length ? (
            <ol className="leaderboard-list">
              {leaderboard.slice(0, 5).map((entry) => (
                <li key={`${entry.name}-${entry.bestScore}-${entry.correctSolved}`}>
                  <span>{entry.name}</span>
                  <strong>{entry.bestScore}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-copy">No scores yet.</p>
          )}
        </section>

        <section className="wrong-panel" aria-label="Wrong questions">
          <div className="panel-title">
            <Bookmark aria-hidden="true" />
            <span>Wrong Questions</span>
            <strong>{wrongQuestions.length}</strong>
          </div>

          {wrongQuestions.length ? (
            <>
              <div className="wrong-tools">
                <label className="search-wrap" htmlFor="wrong-search">
                  <Search aria-hidden="true" />
                  <input
                    id="wrong-search"
                    type="search"
                    value={wrongSearch}
                    onChange={(event) => setWrongSearch(event.target.value)}
                    placeholder="Search"
                  />
                </label>
                <div className="select-wrap">
                  <select
                    aria-label="Wrong question subject"
                    value={wrongSubject}
                    onChange={(event) => setWrongSubject(event.target.value)}
                  >
                    {wrongSubjects.map((subject) => (
                      <option key={subject} value={subject}>
                        {subject}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </div>
              </div>

              {filteredWrongQuestions.length ? (
                <div className="wrong-list">
                  {filteredWrongQuestions.map((item, index) => (
                    <div className="wrong-item" key={item.questionId}>
                      <button type="button" onClick={() => revisitWrongQuestion(item)}>
                        <span>Q{item.question.question_no || index + 1}</span>
                        <strong>{item.question.subject || 'Mixed'}</strong>
                        <small>{truncate(item.question.question, 86)}</small>
                        <em>{item.misses} miss{item.misses === 1 ? '' : 'es'}</em>
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label="Remove from wrong questions"
                        onClick={() => removeWrongQuestion(item.questionId)}
                      >
                        <XCircle aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">No match found.</p>
              )}
            </>
          ) : (
            <p className="empty-copy">No misses yet.</p>
          )}
        </section>

        <section className="control-panel" aria-label="Question filters">
          <label className="field-label" htmlFor="subject-filter">
            Subject
          </label>
          <div className="select-wrap">
            <select
              id="subject-filter"
              value={selectedSubject}
              onChange={(event) => changeSubject(event.target.value)}
            >
              {subjects.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </div>

          <label className="field-label" htmlFor="source-filter">
            Paper
          </label>
          <div className="select-wrap">
            <select
              id="source-filter"
              value={selectedSource}
              onChange={(event) => changeSource(event.target.value)}
            >
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </div>
        </section>

        <div className="sidebar-actions">
          <button className="secondary-button" type="button" onClick={() => pickQuestion()}>
            <Shuffle aria-hidden="true" />
            Random
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => refreshUserData(getDeviceId(), selectedExam)}
          >
            <RefreshCcw aria-hidden="true" />
            Refresh
          </button>
        </div>
      </aside>

      {screen === 'game' ? (
        <GameScreen
          questions={filteredQuestions}
          profile={profile}
          registrationRequired={registrationRequired}
          recordAttempt={recordAttempt}
          selectedExam={selectedExam}
        />
      ) : (
        <section className="practice-main">
          <div className="question-toolbar">
            <div className="question-meta">
              <span>{currentQuestion.subject || 'Mixed'}</span>
              <span>{currentQuestion.topic || 'General'}</span>
              <span>{sourceLabel(currentQuestion.source_pdf)}</span>
            </div>
            <div className="question-count">
              <Layers3 aria-hidden="true" />
              {filteredQuestions.length} questions
            </div>
          </div>

          <article className="question-panel">
            <header className="question-header">
              <p className="question-number">Question {currentQuestion.question_no}</p>
              <h2>{currentQuestion.question}</h2>
            </header>

            {currentQuestion.images?.length > 0 && (
              <figure className="question-image-frame">
                <img src={`${BASE_URL}${currentQuestion.images[0]}`} alt="Question reference" />
              </figure>
            )}

            <div className="options-list">
              {options.map(([key, text], index) => {
                const isCorrect = key === correctOptionKey;
                const isSelected = key === selectedOption;
                const optionClass = [
                  'option-button',
                  showResult && isCorrect ? 'is-correct' : '',
                  showResult && isSelected && !isCorrect ? 'is-wrong' : '',
                  showResult && !isSelected && !isCorrect ? 'is-muted' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <button
                    className={optionClass}
                    type="button"
                    key={key}
                    onClick={() => handleAnswer(key)}
                    disabled={showResult || registrationRequired}
                  >
                    <span className="option-index">{String.fromCharCode(65 + index)}</span>
                    <span className="option-copy">{text}</span>
                    {showResult && isCorrect && <CheckCircle2 aria-hidden="true" />}
                    {showResult && isSelected && !isCorrect && <XCircle aria-hidden="true" />}
                  </button>
                );
              })}
            </div>

            <footer className="answer-bar">
              {showResult ? (
                <>
                  <div
                    className={
                      selectedOption === correctOptionKey
                        ? 'result-pill is-correct'
                        : 'result-pill is-wrong'
                    }
                  >
                    {selectedOption === correctOptionKey
                      ? `Correct. Streak ${stats.streak}.`
                      : correctOptionKey
                        ? `Wrong. Correct option is ${correctOptionKey.replace('O', '')}. Added to revisit list.`
                        : 'Answer key unavailable for this question.'}
                  </div>
                  <button className="primary-button" type="button" onClick={() => pickQuestion()}>
                    Next Question
                    <ArrowRight aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <span className="helper-text">
                    {profile ? 'Pick one option to lock your answer.' : 'Register this device to start.'}
                  </span>
                  <span className="solved-count">{stats.totalSolved} solved</span>
                </>
              )}
            </footer>
          </article>
        </section>
      )}

      {registrationRequired && (
        <div className="modal-backdrop" role="presentation">
          <form className="register-panel" onSubmit={registerDevice}>
            <div className="brand-mark">
              <UserRound aria-hidden="true" />
            </div>
            <h2>Register this device</h2>
            <label htmlFor="name-input">Name</label>
            <input
              id="name-input"
              type="text"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              autoFocus
              maxLength={40}
            />
            <button className="primary-button" type="submit" disabled={saving || !nameInput.trim()}>
              {saving ? 'Saving' : 'Start Practice'}
            </button>
          </form>
        </div>
      )}

      <span className="corner-note">for you baby</span>
    </main>
  );
}

function GameScreen({
  questions,
  profile,
  registrationRequired,
  recordAttempt,
  selectedExam,
}) {
  const [gameQuestion, setGameQuestion] = useState(null);
  const [timeLeft, setTimeLeft] = useState(60);
  const [roundState, setRoundState] = useState('active');
  const [message, setMessage] = useState('Shoot the correct boulder before it crosses the line.');
  const [praise, setPraise] = useState('');
  const [gameScore, setGameScore] = useState(0);
  const [hitOption, setHitOption] = useState('');

  const gameOptions = useMemo(
    () => Object.entries(gameQuestion?.options || {}),
    [gameQuestion],
  );

  const startRound = useCallback(() => {
    if (!questions.length) return;
    setGameQuestion(selectRandomQuestion(questions));
    setTimeLeft(60);
    setRoundState('active');
    setMessage('Shoot the correct boulder before it crosses the line.');
    setPraise('');
    setHitOption('');
  }, [questions]);

  useEffect(() => {
    const timer = window.setTimeout(startRound, 0);
    return () => window.clearTimeout(timer);
  }, [startRound, selectedExam]);

  useEffect(() => {
    if (roundState !== 'active' || registrationRequired || !profile) return undefined;

    const interval = window.setInterval(() => {
      setTimeLeft((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          setRoundState('missed');
          setMessage('Boulder crossed the line. New question incoming.');
          window.setTimeout(startRound, 1400);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [profile, registrationRequired, roundState, startRound]);

  const shootBoulder = async (optionKey) => {
    if (roundState !== 'active' || !profile || registrationRequired || !gameQuestion) return;

    setHitOption(optionKey);
    setRoundState('resolved');

    try {
      const correct = await recordAttempt(gameQuestion, optionKey);
      if (correct) {
        setGameScore((score) => score + 1);
        setPraise(praiseLines[(gameScore + gameQuestion.id.length) % praiseLines.length]);
        setMessage('Direct hit. Correct answer.');
      } else {
        setPraise('');
        setMessage(`Wrong boulder. Correct option was ${getCorrectOptionKey(gameQuestion).replace('O', '')}.`);
      }
      window.setTimeout(startRound, correct ? 1900 : 1600);
    } catch {
      setMessage('Could not save this shot. Try the next one.');
      window.setTimeout(startRound, 1400);
    }
  };

  if (!gameQuestion) {
    return (
      <section className="game-main">
        <div className="game-loading">Loading game arena</div>
      </section>
    );
  }

  const elapsedPercent = 100 - (timeLeft / 60) * 100;
  const timePercent = `${(timeLeft / 60) * 100}%`;
  const fallY = `${Math.min(elapsedPercent * 0.68, 69)}%`;

  return (
    <section className="game-main">
      <div className="game-hud">
        <div>
          <p className="eyebrow">Boulder Rush</p>
          <h2>{gameQuestion.question}</h2>
        </div>
        <div className="game-clock">
          <span>{timeLeft}s</span>
          <div>
            <i style={{ width: timePercent }} />
          </div>
        </div>
      </div>

      <div className="game-arena" style={{ '--fall-y': fallY }}>
        {roundState === 'resolved' && hitOption === getCorrectOptionKey(gameQuestion) && (
          <div className="fireworks" aria-hidden="true">
            {Array.from({ length: 18 }).map((_, index) => (
              <span key={index} style={{ '--spark': index }} />
            ))}
          </div>
        )}

        <div className="finish-line">
          <span>Finish Line</span>
        </div>

        <div className="boulder-field">
          {gameOptions.map(([key, text], index) => {
            const correct = key === getCorrectOptionKey(gameQuestion);
            const wasHit = key === hitOption;
            const className = [
              'boulder',
              wasHit && correct ? 'is-correct' : '',
              wasHit && !correct ? 'is-wrong' : '',
              roundState !== 'active' && !wasHit ? 'is-muted' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                className={className}
                type="button"
                key={key}
                style={{
                  '--boulder-left': `${3 + index * 24}%`,
                  '--mobile-left': `${3 + (index % 2) * 48}%`,
                  '--mobile-offset': `${Math.floor(index / 2) * 118}px`,
                  '--boulder-tilt': `${(index - 1.5) * 4}deg`,
                  '--delay': `${index * 0.8}s`,
                }}
                onClick={() => shootBoulder(key)}
                disabled={roundState !== 'active' || registrationRequired || !profile}
              >
                <span>{String.fromCharCode(65 + index)}</span>
                <strong>{truncate(text, 72)}</strong>
              </button>
            );
          })}
        </div>

        <div className="shooter">
          <Crosshair aria-hidden="true" />
          <span />
        </div>
      </div>

      <div className="game-status">
        <div className="game-score">
          <Trophy aria-hidden="true" />
          <span>{gameScore} hits</span>
        </div>
        <p>{profile ? message : 'Register this device to unlock the game.'}</p>
        {praise && (
          <strong>
            <PartyPopper aria-hidden="true" />
            {praise}
          </strong>
        )}
      </div>
    </section>
  );
}

function StatTile({ icon: Icon, label, value, tone }) {
  return (
    <div className={`stat-tile ${tone}`}>
      <div className="stat-label">
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

async function apiGet(path) {
  if (prefersStaticApi(path)) {
    return staticApiGet(path);
  }

  try {
    const response = await fetch(path);
    if (shouldFallbackToStaticApi(path, response)) {
      return staticApiGet(path);
    }
    return readApiResponse(response);
  } catch (error) {
    if (canUseStaticApi(path)) {
      return staticApiGet(path);
    }
    throw error;
  }
}

async function apiPost(path, payload) {
  if (prefersStaticApi(path)) {
    return staticApiPost(path, payload);
  }

  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (shouldFallbackToStaticApi(path, response)) {
      return staticApiPost(path, payload);
    }
    return readApiResponse(response);
  } catch (error) {
    if (canUseStaticApi(path)) {
      return staticApiPost(path, payload);
    }
    throw error;
  }
}

async function readApiResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function prefersStaticApi(path) {
  const hostname = window.location.hostname;
  return canUseStaticApi(path) && hostname.endsWith('github.io');
}

function shouldFallbackToStaticApi(path, response) {
  if (!canUseStaticApi(path)) return false;

  const contentType = response.headers.get('Content-Type') || '';
  return !contentType.includes('application/json');
}

function canUseStaticApi(path) {
  return path.startsWith('/api/');
}

async function staticApiGet(path) {
  const url = new URL(path, window.location.origin);
  const exam = staticExamFromValue(url.searchParams.get('exam'));
  const deviceId = url.searchParams.get('deviceId') || '';

  if (url.pathname === '/api/config') {
    return {
      exam: exam.id,
      label: exam.label,
      exams: STATIC_EXAMS.map(({ id, label }) => ({ id, label })),
    };
  }

  if (url.pathname === '/api/game/config') {
    return {
      exam: exam.id,
      label: exam.label,
      roundSeconds: 60,
      mode: 'boulder-rush',
    };
  }

  if (url.pathname === '/api/questions') {
    const response = await fetch(`${BASE_URL}${exam.file}`);
    if (!response.ok) {
      throw new Error(`Could not load ${exam.label} questions.`);
    }
    return { questions: await response.json() };
  }

  if (url.pathname === '/api/game/questions') {
    const response = await fetch(`${BASE_URL}${exam.file}`);
    if (!response.ok) {
      throw new Error(`Could not load ${exam.label} game questions.`);
    }
    return { questions: await response.json() };
  }

  if (url.pathname === '/api/profile') {
    const state = readStaticState();
    const profile = staticProfileFor(state, deviceId, exam.id);
    if (!profile) {
      const error = new Error('Device is not registered');
      error.status = 404;
      throw error;
    }
    return { registered: true, profile };
  }

  if (url.pathname === '/api/leaderboard') {
    return { leaderboard: staticLeaderboard(exam.id) };
  }

  if (url.pathname === '/api/wrong') {
    return { wrongQuestions: staticWrongQuestions(deviceId, exam.id) };
  }

  throw new Error('Static API route not found');
}

async function staticApiPost(path, payload = {}) {
  const url = new URL(path, window.location.origin);
  const exam = staticExamFromValue(payload.exam);
  const deviceId = payload.deviceId || '';

  if (url.pathname === '/api/device/register') {
    const name = cleanCopy(payload.name);
    if (!deviceId || !name) {
      throw new Error('deviceId and name are required');
    }

    const state = readStaticState();
    const timestamp = nowSeconds();
    state.profiles[deviceId] = {
      name,
      createdAt: state.profiles[deviceId]?.createdAt || timestamp,
      lastSeen: timestamp,
    };
    ensureStaticStats(state, deviceId, exam.id);
    writeStaticState(state);
    return { profile: staticProfileFor(state, deviceId, exam.id) };
  }

  if (url.pathname === '/api/attempt') {
    if (!deviceId || !payload.questionId) {
      throw new Error('deviceId and questionId are required');
    }

    const state = readStaticState();
    const stats = ensureStaticStats(state, deviceId, exam.id);
    const correct = Boolean(payload.correct);
    stats.totalSolved += 1;
    stats.correctSolved += correct ? 1 : 0;
    stats.streak = correct ? stats.streak + 1 : 0;
    stats.bestScore = Math.max(stats.bestScore, stats.streak);
    stats.maxStreak = stats.bestScore;

    if (!correct) {
      const wrongKey = staticScopedKey(deviceId, exam.id);
      const wrongQuestions = state.wrongQuestions[wrongKey] || [];
      const existing = wrongQuestions.find((item) => item.questionId === payload.questionId);
      if (existing) {
        existing.question = payload.question;
        existing.selectedOption = payload.selectedOption;
        existing.misses += 1;
        existing.lastWrongAt = nowSeconds();
      } else {
        wrongQuestions.unshift({
          questionId: payload.questionId,
          question: payload.question,
          selectedOption: payload.selectedOption,
          misses: 1,
          lastWrongAt: nowSeconds(),
        });
      }
      state.wrongQuestions[wrongKey] = wrongQuestions;
    }

    writeStaticState(state);
    return {
      profile: staticProfileFor(state, deviceId, exam.id),
      leaderboard: staticLeaderboard(exam.id, state),
    };
  }

  if (url.pathname === '/api/wrong/remove') {
    const state = readStaticState();
    const wrongKey = staticScopedKey(deviceId, exam.id);
    state.wrongQuestions[wrongKey] = (state.wrongQuestions[wrongKey] || []).filter(
      (item) => item.questionId !== payload.questionId,
    );
    writeStaticState(state);
    return { ok: true };
  }

  if (url.pathname === '/api/event') {
    return { ok: true };
  }

  throw new Error('Static API route not found');
}

function staticExamFromValue(value) {
  return STATIC_EXAMS.find((exam) => exam.id === value) || STATIC_EXAMS[0];
}

function readStaticState() {
  try {
    const parsed = JSON.parse(storageGet(STATIC_STATE_KEY) || '{}');
    return {
      profiles: parsed.profiles || {},
      stats: parsed.stats || {},
      wrongQuestions: parsed.wrongQuestions || {},
    };
  } catch {
    return { profiles: {}, stats: {}, wrongQuestions: {} };
  }
}

function writeStaticState(state) {
  storageSet(STATIC_STATE_KEY, JSON.stringify(state));
}

function staticProfileFor(state, deviceId, examId) {
  const profile = state.profiles[deviceId];
  if (!profile) return null;

  profile.lastSeen = nowSeconds();
  const stats = ensureStaticStats(state, deviceId, examId);
  writeStaticState(state);

  return {
    deviceId,
    name: profile.name,
    stats,
  };
}

function ensureStaticStats(state, deviceId, examId) {
  const statsKey = staticScopedKey(deviceId, examId);
  state.stats[statsKey] ||= { ...defaultStats };
  return state.stats[statsKey];
}

function staticLeaderboard(examId, state = readStaticState()) {
  return Object.entries(state.profiles)
    .map(([deviceId, profile]) => ({
      name: profile.name,
      ...ensureStaticStats(state, deviceId, examId),
    }))
    .sort((a, b) => b.bestScore - a.bestScore || b.correctSolved - a.correctSolved)
    .slice(0, 10);
}

function staticWrongQuestions(deviceId, examId) {
  const state = readStaticState();
  return state.wrongQuestions[staticScopedKey(deviceId, examId)] || [];
}

function staticScopedKey(deviceId, examId) {
  return `${deviceId}:${examId}`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function getDeviceId() {
  let deviceId = storageGet(DEVICE_KEY);
  if (!deviceId) {
    deviceId = createDeviceId();
    storageSet(DEVICE_KEY, deviceId);
  }
  return deviceId;
}

function storageGet(key) {
  try {
    return window.localStorage?.getItem(key) || memoryStorage.get(key) || null;
  } catch {
    return memoryStorage.get(key) || null;
  }
}

function storageSet(key, value) {
  memoryStorage.set(key, value);
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // In-memory storage keeps the app usable when persistent storage is blocked.
  }
}

function createDeviceId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function selectRandomQuestion(pool) {
  if (!pool.length) return null;

  return pool[Math.floor(Math.random() * pool.length)];
}

function normalizeQuestion(question, index = 0, exam = 'neet-pg') {
  const options = {};
  let extractedAnswer = '';

  Object.entries(question.options || {}).forEach(([key, value]) => {
    const baseIndex = Number(String(key).replace(/[^\d]/g, '')) || 1;
    const cleanValue = cleanCopy(value);
    const answerMatch = cleanValue.match(/Correct\s*Answer\s*:\s*(.*?)(?=\s+Topic\s*:|$)/i);

    if (answerMatch?.[1]) {
      extractedAnswer = cleanCopy(answerMatch[1]);
    }

    const withoutAnswer = cleanValue
      .replace(/Correct\s*Answer\s*:.*$/i, '')
      .replace(/\s+Topic\s*:.*$/i, '')
      .trim();

    const pieces = withoutAnswer
      .split(/(?=\s+[1-4][.)]\s+)/)
      .map((piece) => piece.trim())
      .filter(Boolean);

    if (!pieces.length) {
      options[`O${baseIndex}`] = withoutAnswer;
      return;
    }

    pieces.forEach((piece, pieceIndex) => {
      const markerMatch = piece.match(/^([1-4])[.)]\s+(.*)$/);
      const optionNumber = markerMatch ? Number(markerMatch[1]) : baseIndex + pieceIndex;
      const optionText = markerMatch ? markerMatch[2] : piece;

      if (optionNumber >= 1 && optionNumber <= 4) {
        options[`O${optionNumber}`] = cleanCopy(optionText);
      }
    });
  });

  return {
    ...question,
    id: question.id || `${exam}:${question.source_pdf || 'source'}:${question.question_no || index}:${question.page_number || 0}`,
    exam,
    question: cleanCopy(question.question)
      .replace(/^\d+[.)]\s*/, '')
      .trim(),
    options,
    answer: question.answer || answerFromText(options, extractedAnswer),
  };
}

function getCorrectOptionKey(question) {
  if (!question?.answer) return '';

  const answer = String(question.answer).trim();

  if (/^O[1-4]$/i.test(answer)) return answer.toUpperCase();
  if (/^[1-4]$/.test(answer)) return `O${answer}`;

  return answerFromText(question.options || {}, answer);
}

function answerFromText(options, answerText) {
  const normalizedAnswer = normalizeForMatch(answerText);
  if (!normalizedAnswer) return '';

  for (const [key, optionText] of Object.entries(options)) {
    const normalizedOption = normalizeForMatch(optionText);

    if (
      normalizedOption === normalizedAnswer ||
      normalizedOption.includes(normalizedAnswer) ||
      normalizedAnswer.includes(normalizedOption)
    ) {
      return key;
    }
  }

  return '';
}

function cleanCopy(value = '') {
  return String(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\bPrep\s*Ladder\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(value = '') {
  return cleanCopy(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sourceLabel(source = '') {
  if (!source) return 'Unknown paper';

  const year = source.match(/20\d{2}/)?.[0];
  if (year) return year;

  return source.replace(/\.pdf$/i, '').replaceAll('-', ' ');
}

function truncate(value, length) {
  const text = cleanCopy(value);
  if (text.length <= length) return text;
  return `${text.slice(0, length - 3)}...`;
}

export default App;
