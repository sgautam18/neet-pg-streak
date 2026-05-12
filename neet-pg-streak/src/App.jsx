import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  Flame,
  Layers3,
  Loader2,
  RotateCcw,
  Shuffle,
  Target,
  Trophy,
  XCircle,
} from 'lucide-react';
import './App.css';

const STORAGE_KEY = 'neet-pg-streak-stats';
const BASE_URL = import.meta.env.BASE_URL;

const defaultStats = {
  streak: 0,
  maxStreak: 0,
  totalSolved: 0,
  correctSolved: 0,
};

function App() {
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [stats, setStats] = useState(() => loadSavedStats());
  const [selectedOption, setSelectedOption] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState('All');
  const [selectedSource, setSelectedSource] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${BASE_URL}questions.json`)
      .then((res) => {
        if (!res.ok) throw new Error('questions.json could not be loaded');
        return res.json();
      })
      .then((data) => {
        const validQuestions = data.map(normalizeQuestion).filter(
          (question) =>
            question?.question &&
            question?.options &&
            Object.keys(question.options).length > 0 &&
            getCorrectOptionKey(question),
        );

        setQuestions(validQuestions);
        setCurrentQuestion(selectRandomQuestion(validQuestions));
      })
      .catch(() => {
        setError('Questions could not be loaded. Make sure public/questions.json exists.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  }, [stats]);

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

  const accuracy =
    stats.totalSolved > 0
      ? Math.round((stats.correctSolved / stats.totalSolved) * 100)
      : 0;

  const pickQuestion = (pool = filteredQuestions) => {
    if (!pool.length) return;

    let nextQuestion = selectRandomQuestion(pool);

    if (pool.length > 1 && currentQuestion) {
      while (nextQuestion === currentQuestion) {
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

  const handleAnswer = (optionKey) => {
    if (showResult) return;

    const isCorrect = optionKey === correctOptionKey;

    setSelectedOption(optionKey);
    setShowResult(true);
    setStats((previousStats) => {
      const nextStreak = isCorrect ? previousStats.streak + 1 : 0;

      return {
        streak: nextStreak,
        maxStreak: Math.max(previousStats.maxStreak, nextStreak),
        totalSolved: previousStats.totalSolved + 1,
        correctSolved: previousStats.correctSolved + (isCorrect ? 1 : 0),
      };
    });
  };

  const resetStats = () => {
    setStats(defaultStats);
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
          <p>{error || 'No usable questions were found in the JSON file.'}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="practice-sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <BookOpenCheck aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">NEET PG</p>
            <h1>Streak Practice</h1>
          </div>
        </div>

        <div className="stats-grid" aria-label="Practice stats">
          <StatTile icon={Flame} label="Current" value={stats.streak} tone="heat" />
          <StatTile icon={Trophy} label="Best" value={stats.maxStreak} tone="gold" />
          <StatTile icon={Target} label="Accuracy" value={`${accuracy}%`} tone="aqua" />
        </div>

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
          <button className="ghost-button" type="button" onClick={resetStats}>
            <RotateCcw aria-hidden="true" />
            Reset
          </button>
        </div>
      </aside>

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
                  disabled={showResult}
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
                      ? `Wrong. Correct option is ${correctOptionKey.replace('O', '')}.`
                      : 'Answer key unavailable for this question.'}
                </div>
                <button className="primary-button" type="button" onClick={() => pickQuestion()}>
                  Next Question
                  <ArrowRight aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <span className="helper-text">Pick one option to lock your answer.</span>
                <span className="solved-count">{stats.totalSolved} solved</span>
              </>
            )}
          </footer>
        </article>
      </section>
    </main>
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

function loadSavedStats() {
  try {
    return {
      ...defaultStats,
      ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'),
    };
  } catch {
    return defaultStats;
  }
}

function selectRandomQuestion(pool) {
  if (!pool.length) return null;

  return pool[Math.floor(Math.random() * pool.length)];
}

function normalizeQuestion(question) {
  const options = {};
  let extractedAnswer = '';

  Object.entries(question.options || {}).forEach(([key, value]) => {
    const baseIndex = Number(key.replace('O', ''));
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

    if (!pieces.length) return;

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

export default App;
