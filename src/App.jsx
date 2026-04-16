import { useCallback, useEffect, useRef, useState } from 'react';

const MODEL = 'claude-sonnet-4-20250514';
const TOTAL_QUESTIONS = 5;

const QUESTION_SYSTEM = (jobDescription, n) =>
  `You are a senior interviewer at the company hiring for this role:
${jobDescription}. Generate ONE interview question appropriate for question number ${n} of 5. Mix across: background/motivation (Q1), behavioural STAR (Q2), role-specific technical (Q3), situational (Q4), challenging curveball (Q5). Return ONLY the question text, no preamble, no numbering, no quotation marks. Keep it realistic and concise.`;

const FEEDBACK_SYSTEM = (jobDescription, question, answer) =>
  `You are a direct, experienced interview coach. The job: ${jobDescription}. The question asked: ${question}. The candidate's answer: ${answer}. Respond in strict JSON with this exact shape:
{"worked": string, "didnt": string, "sharper": string, "score": number}
Be honest — don't flatter weak answers. 'worked' = 1-2 specific strengths or 'nothing notable'. 'didnt' = honest problems (filler words, no STAR structure, vague, didn't answer the question, no quantified impact). 'sharper' = 1-2 sentences showing how a strong candidate would have opened. 'score' = integer 0-10. Return ONLY the JSON object. Do not wrap in markdown code fences. Do not add any preamble or explanation.`;

const SUMMARY_SYSTEM = (jobDescription, pairs) => {
  const transcript = pairs
    .map(
      (p, i) =>
        `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}\nScore: ${
          p.feedback && typeof p.feedback.score === 'number'
            ? p.feedback.score
            : 'n/a'
        }`
    )
    .join('\n\n');
  return `You are a supportive but honest interview coach writing a short debrief for a candidate who just finished a 5-question mock interview for this role: ${jobDescription}.

Here are the five questions, the candidate's answers, and per-question scores:

${transcript}

Respond in strict JSON with this exact shape:
{"overallScore": number, "strengths": [string, string, string], "toWorkOn": [string, string, string], "encouragement": string}

Rules:
- overallScore: integer 0-10, reflecting the whole session honestly.
- strengths: exactly three concise items the candidate genuinely did well.
- toWorkOn: exactly three concise, specific improvements.
- encouragement: 2-3 warm sentences framed around how deliberate preparation reduces interview anxiety. Do not be saccharine.
Return ONLY the JSON. Do not wrap in markdown code fences. Do not add preamble.`;
};

function stripFences(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function tryParseJSON(text) {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function callClaude({ system, user, maxTokens }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const parts = Array.isArray(data?.content) ? data.content : [];
  return parts
    .filter((p) => p && p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim();
}

function pickVoice(voices) {
  if (!voices || voices.length === 0) return null;
  const femaleRe = /female|samantha|karen|serena|fiona|moira|tessa|amelia|sonia/i;
  const byTag = (tag, female) =>
    voices.find(
      (v) =>
        v.lang &&
        v.lang.toLowerCase().startsWith(tag) &&
        (female ? femaleRe.test(v.name) : true)
    );
  return (
    byTag('en-gb', true) ||
    byTag('en-us', true) ||
    byTag('en', true) ||
    byTag('en-gb', false) ||
    byTag('en-us', false) ||
    byTag('en', false) ||
    voices.find((v) => v.default) ||
    voices[0] ||
    null
  );
}

const MicIcon = ({ on }) => (
  <svg
    viewBox="0 0 24 24"
    className="w-7 h-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="22" />
    {on && <circle cx="19" cy="5" r="2" fill="currentColor" stroke="none" />}
  </svg>
);

function BreathingDot() {
  return (
    <span
      aria-hidden
      className="inline-block w-2.5 h-2.5 rounded-full bg-teal-300 animate-breathe"
      title="Breathe"
    />
  );
}

function ErrorPanel({ message, onRetry, onDismiss }) {
  return (
    <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
      <p className="mb-2">{message}</p>
      <div className="flex gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded-md bg-rose-200/10 hover:bg-rose-200/20 border border-rose-900/60 px-3 py-1 text-rose-100"
          >
            Try again
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="rounded-md px-3 py-1 text-rose-200/70 hover:text-rose-100"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState('landing');
  const [jobDescription, setJobDescription] = useState('');

  const [questionIndex, setQuestionIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [feedbacks, setFeedbacks] = useState([]);

  const [currentAnswer, setCurrentAnswer] = useState('');
  const [currentFeedback, setCurrentFeedback] = useState(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [inputMode, setInputMode] = useState('voice');
  const [emptyWarning, setEmptyWarning] = useState(false);

  const [loadingState, setLoadingState] = useState('idle');
  const [errorState, setErrorState] = useState(null);

  const [summary, setSummary] = useState(null);

  const [voices, setVoices] = useState([]);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef('');
  const isRecordingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices() || [];
      if (list.length) setVoices(list);
    };
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', load);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSpeechSupported(false);
      setInputMode('text');
      return;
    }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      let interim = '';
      let appended = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const chunk = r[0]?.transcript || '';
        if (r.isFinal) appended += chunk;
        else interim += chunk;
      }
      if (appended) {
        const next = (finalTranscriptRef.current + ' ' + appended)
          .replace(/\s+/g, ' ')
          .trim();
        finalTranscriptRef.current = next;
        setCurrentAnswer(next);
      }
      setInterimTranscript(interim.trim());
    };
    recognition.onerror = () => {};
    recognition.onend = () => {
      setInterimTranscript('');
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        setIsRecording(false);
      }
    };
    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.onresult = null;
        recognition.onend = null;
        recognition.onerror = null;
        recognition.stop();
      } catch {}
    };
  }, []);

  const speak = useCallback(
    (text) => {
      if (typeof window === 'undefined' || !window.speechSynthesis || !text)
        return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95;
        u.pitch = 1.0;
        const v = pickVoice(voices);
        if (v) u.voice = v;
        window.speechSynthesis.speak(u);
      } catch {}
    },
    [voices]
  );

  const cancelSpeech = useCallback(() => {
    try {
      window.speechSynthesis?.cancel();
    } catch {}
  }, []);

  const startRecording = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    cancelSpeech();
    try {
      finalTranscriptRef.current = currentAnswer || '';
      setInterimTranscript('');
      rec.start();
      isRecordingRef.current = true;
      setIsRecording(true);
    } catch {}
  }, [cancelSpeech, currentAnswer]);

  const stopRecording = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {}
    isRecordingRef.current = false;
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else startRecording();
  }, [isRecording, startRecording, stopRecording]);

  const resetTranscripts = useCallback(() => {
    finalTranscriptRef.current = '';
    setInterimTranscript('');
    setCurrentAnswer('');
    setEmptyWarning(false);
  }, []);

  const fetchQuestion = useCallback(
    async (n) => {
      setLoadingState('question');
      setErrorState(null);
      try {
        const text = await callClaude({
          system: QUESTION_SYSTEM(jobDescription, n + 1),
          user: `Please provide question ${n + 1} of 5 now.`,
          maxTokens: 1024,
        });
        const cleaned = (text || '').trim().replace(/^["'“]|["'”]$/g, '');
        setCurrentQuestion(cleaned);
        setQuestions((prev) => {
          const copy = prev.slice();
          copy[n] = cleaned;
          return copy;
        });
        setQuestionIndex(n);
        setCurrentFeedback(null);
        resetTranscripts();
        setLoadingState('idle');
        setTimeout(() => speak(cleaned), 200);
      } catch (err) {
        setLoadingState('idle');
        setErrorState({
          message:
            'Something went wrong on our end. Try that answer again?',
          retry: () => fetchQuestion(n),
        });
      }
    },
    [jobDescription, resetTranscripts, speak]
  );

  const submitAnswer = useCallback(async () => {
    const answer = (currentAnswer || '').trim();
    if (!answer) {
      setEmptyWarning(true);
      return;
    }
    setEmptyWarning(false);
    if (isRecordingRef.current) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      isRecordingRef.current = false;
      setIsRecording(false);
    }
    cancelSpeech();
    setLoadingState('feedback');
    setErrorState(null);
    try {
      const text = await callClaude({
        system: FEEDBACK_SYSTEM(jobDescription, currentQuestion, answer),
        user: 'Return the JSON feedback now.',
        maxTokens: 1024,
      });
      const parsed = tryParseJSON(text);
      const feedbackEntry =
        parsed &&
        typeof parsed === 'object' &&
        'worked' in parsed &&
        'didnt' in parsed &&
        'sharper' in parsed &&
        'score' in parsed
          ? parsed
          : { raw: text };
      setCurrentFeedback(feedbackEntry);
      setAnswers((prev) => {
        const copy = prev.slice();
        copy[questionIndex] = answer;
        return copy;
      });
      setFeedbacks((prev) => {
        const copy = prev.slice();
        copy[questionIndex] = feedbackEntry;
        return copy;
      });
      setLoadingState('idle');
    } catch (err) {
      setLoadingState('idle');
      setErrorState({
        message:
          'Something went wrong on our end. Try that answer again?',
        retry: () => submitAnswer(),
      });
    }
  }, [cancelSpeech, currentAnswer, currentQuestion, jobDescription, questionIndex]);

  const fetchSummary = useCallback(
    async (pairs) => {
      setLoadingState('summary');
      setErrorState(null);
      try {
        const text = await callClaude({
          system: SUMMARY_SYSTEM(jobDescription, pairs),
          user: 'Return the JSON summary now.',
          maxTokens: 2048,
        });
        const parsed = tryParseJSON(text);
        if (
          parsed &&
          typeof parsed === 'object' &&
          typeof parsed.overallScore === 'number' &&
          Array.isArray(parsed.strengths) &&
          Array.isArray(parsed.toWorkOn) &&
          typeof parsed.encouragement === 'string'
        ) {
          setSummary(parsed);
        } else {
          setSummary({ fallback: true });
        }
        setScreen('summary');
        setLoadingState('idle');
      } catch (err) {
        setLoadingState('idle');
        setSummary({ fallback: true });
        setScreen('summary');
      }
    },
    [jobDescription]
  );

  const startInterview = useCallback(async () => {
    if (!jobDescription.trim()) return;
    setQuestions([]);
    setAnswers([]);
    setFeedbacks([]);
    setSummary(null);
    setScreen('interview');
    await fetchQuestion(0);
  }, [jobDescription, fetchQuestion]);

  const onRetryQuestion = useCallback(() => {
    setCurrentFeedback(null);
    setFeedbacks((prev) => {
      const copy = prev.slice();
      copy[questionIndex] = undefined;
      return copy;
    });
    setAnswers((prev) => {
      const copy = prev.slice();
      copy[questionIndex] = undefined;
      return copy;
    });
    resetTranscripts();
    cancelSpeech();
    setTimeout(() => speak(currentQuestion), 150);
  }, [cancelSpeech, currentQuestion, questionIndex, resetTranscripts, speak]);

  const onNextQuestion = useCallback(async () => {
    const nextIndex = questionIndex + 1;
    if (nextIndex >= TOTAL_QUESTIONS) {
      const pairs = questions
        .map((q, i) => ({
          question: q,
          answer: answers[i],
          feedback: feedbacks[i],
        }))
        .filter((p) => p.question && p.answer);
      await fetchSummary(pairs);
    } else {
      await fetchQuestion(nextIndex);
    }
  }, [answers, fetchQuestion, fetchSummary, feedbacks, questionIndex, questions]);

  const endSession = useCallback(async () => {
    cancelSpeech();
    if (isRecordingRef.current) {
      try {
        recognitionRef.current?.stop();
      } catch {}
    }
    const completed = answers.filter(Boolean).length;
    if (completed === 0) {
      setScreen('landing');
      setQuestions([]);
      setAnswers([]);
      setFeedbacks([]);
      setCurrentQuestion('');
      setCurrentFeedback(null);
      resetTranscripts();
      return;
    }
    const pairs = questions
      .map((q, i) => ({
        question: q,
        answer: answers[i],
        feedback: feedbacks[i],
      }))
      .filter((p) => p.question && p.answer);
    await fetchSummary(pairs);
  }, [answers, cancelSpeech, fetchSummary, feedbacks, questions, resetTranscripts]);

  const restart = useCallback(() => {
    cancelSpeech();
    setScreen('landing');
    setJobDescription('');
    setQuestions([]);
    setAnswers([]);
    setFeedbacks([]);
    setCurrentQuestion('');
    setCurrentFeedback(null);
    setSummary(null);
    setQuestionIndex(0);
    resetTranscripts();
  }, [cancelSpeech, resetTranscripts]);

  if (screen === 'landing') {
    return (
      <div className="min-h-screen flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-xl">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-semibold tracking-tight">
              <span className="text-teal-300">Interview</span>{' '}
              <span className="text-slate-100">Coach</span>
            </h1>
            <p className="mt-2 text-slate-400 leading-relaxed">
              Practise under pressure, without the pressure.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-6 shadow-xl shadow-black/20">
            <label
              htmlFor="jd"
              className="block text-sm font-medium text-slate-300 mb-2"
            >
              Paste the job description
            </label>
            <textarea
              id="jd"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the full JD here — role, responsibilities, the things they care about."
              className="w-full min-h-[160px] rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none p-4 text-slate-100 leading-relaxed placeholder:text-slate-500 resize-y"
            />

            <button
              onClick={startInterview}
              disabled={!jobDescription.trim() || loadingState === 'question'}
              className="mt-5 w-full rounded-xl bg-teal-300 hover:bg-teal-200 disabled:bg-slate-700 disabled:text-slate-400 text-slate-900 font-medium py-3 transition-colors"
            >
              {loadingState === 'question' ? 'Preparing…' : 'Start interview'}
            </button>
            <p className="mt-4 text-xs text-slate-500 text-center leading-relaxed">
              5 questions. Honest feedback after each. You can redo any answer.
            </p>
            {!speechSupported && (
              <p className="mt-2 text-xs text-slate-500 text-center">
                Voice mode works best in Chrome.
              </p>
            )}
            {errorState && (
              <div className="mt-4">
                <ErrorPanel
                  message={errorState.message}
                  onRetry={errorState.retry}
                  onDismiss={() => setErrorState(null)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'summary') {
    return (
      <div className="min-h-screen flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <p className="text-slate-400 text-sm uppercase tracking-widest">
              Session summary
            </p>
            <h2 className="mt-1 text-3xl font-semibold text-slate-100">
              Nice work finishing all five.
            </h2>
          </div>
          {summary && !summary.fallback ? (
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-6 animate-fadeIn">
              <div className="flex items-baseline justify-center gap-3 mb-6">
                <span className="text-slate-400 text-sm">Overall</span>
                <span className="text-5xl font-semibold text-amber-400 tabular-nums">
                  {summary.overallScore}
                </span>
                <span className="text-slate-500">/ 10</span>
              </div>
              <div className="grid md:grid-cols-2 gap-5 mb-6">
                <div>
                  <h3 className="text-sm font-medium text-teal-300 mb-2">
                    Strengths
                  </h3>
                  <ul className="space-y-2 text-slate-200 text-sm leading-relaxed">
                    {(summary.strengths || []).slice(0, 3).map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-teal-300 mt-[2px]">•</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-amber-300 mb-2">
                    To work on
                  </h3>
                  <ul className="space-y-2 text-slate-200 text-sm leading-relaxed">
                    {(summary.toWorkOn || []).slice(0, 3).map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-amber-300 mt-[2px]">•</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="text-slate-300 leading-relaxed bg-slate-950/40 border border-slate-800/60 rounded-xl p-4 text-sm">
                {summary.encouragement}
              </p>
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-6 text-center animate-fadeIn">
              <p className="text-slate-200 leading-relaxed">
                You finished all 5 questions — great work.
              </p>
              <p className="text-slate-500 text-sm mt-2">
                Every rep reduces the noise. Come back tomorrow and do it
                again.
              </p>
            </div>
          )}
          <div className="mt-6 flex justify-center">
            <button
              onClick={restart}
              className="rounded-xl bg-teal-300 hover:bg-teal-200 text-slate-900 font-medium px-6 py-3"
            >
              Start new interview
            </button>
          </div>
        </div>
      </div>
    );
  }

  // INTERVIEW SCREEN
  const isWaitingForQuestion = loadingState === 'question';
  const isSubmitting = loadingState === 'feedback';
  const hasFeedback = !!currentFeedback;

  return (
    <div className="min-h-screen px-5 py-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <BreathingDot />
            <div className="text-sm text-slate-300">
              Question{' '}
              <span className="text-slate-100 font-medium">
                {questionIndex + 1}
              </span>{' '}
              of {TOTAL_QUESTIONS}
            </div>
          </div>
          <button
            onClick={endSession}
            className="text-sm text-slate-400 hover:text-slate-200 border border-slate-800/60 hover:border-slate-700 rounded-lg px-3 py-1.5 transition-colors"
          >
            End session
          </button>
        </header>

        {errorState && (
          <div className="mb-5">
            <ErrorPanel
              message={errorState.message}
              onRetry={errorState.retry}
              onDismiss={() => setErrorState(null)}
            />
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-5">
          {/* LEFT: Interviewer */}
          <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-6 min-h-[420px] flex flex-col">
            <div className="text-xs uppercase tracking-widest text-slate-500 mb-3">
              Interviewer
            </div>
            <div className="text-xl md:text-2xl text-slate-100 leading-relaxed min-h-[4rem]">
              {isWaitingForQuestion && !currentQuestion ? (
                <span className="text-slate-500">Preparing your question…</span>
              ) : (
                currentQuestion
              )}
            </div>

            <div className="mt-6 flex-1 flex flex-col">
              {inputMode === 'voice' && speechSupported ? (
                <>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={toggleRecording}
                      disabled={isSubmitting || isWaitingForQuestion}
                      aria-pressed={isRecording}
                      className={`w-16 h-16 rounded-full flex items-center justify-center border transition-colors ${
                        isRecording
                          ? 'bg-rose-500/20 border-rose-400/60 text-rose-200'
                          : 'bg-teal-300/10 border-teal-300/40 text-teal-200 hover:bg-teal-300/20'
                      } disabled:opacity-50`}
                      title={isRecording ? 'Stop recording' : 'Start recording'}
                    >
                      <MicIcon on={isRecording} />
                    </button>
                    <div className="text-sm text-slate-400 leading-relaxed">
                      {isRecording ? (
                        <span className="text-rose-200">
                          Listening — tap again to stop.
                        </span>
                      ) : (
                        <span>Tap to start speaking. Take your time.</span>
                      )}
                    </div>
                  </div>

                  {(isRecording || interimTranscript) && (
                    <div className="mt-4 text-sm text-slate-400 italic min-h-[1.25rem]">
                      {interimTranscript ? (
                        <>
                          <span className="text-slate-500">…</span>{' '}
                          {interimTranscript}
                        </>
                      ) : (
                        <span className="text-slate-600">
                          Waiting for your words…
                        </span>
                      )}
                    </div>
                  )}

                  <label className="mt-5 text-xs text-slate-500">
                    Your answer (editable)
                  </label>
                  <textarea
                    value={currentAnswer}
                    onChange={(e) => {
                      setCurrentAnswer(e.target.value);
                      finalTranscriptRef.current = e.target.value;
                      if (e.target.value.trim()) setEmptyWarning(false);
                    }}
                    placeholder="Your transcript will appear here. Edit freely before submitting."
                    className="mt-1 flex-1 min-h-[120px] rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none p-3 text-slate-100 leading-relaxed placeholder:text-slate-600 resize-y"
                  />
                </>
              ) : (
                <>
                  <label className="text-xs text-slate-500">Your answer</label>
                  <textarea
                    value={currentAnswer}
                    onChange={(e) => {
                      setCurrentAnswer(e.target.value);
                      if (e.target.value.trim()) setEmptyWarning(false);
                    }}
                    placeholder="Type your answer here."
                    className="mt-1 flex-1 min-h-[220px] rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none p-3 text-slate-100 leading-relaxed placeholder:text-slate-600 resize-y"
                  />
                </>
              )}

              {emptyWarning && (
                <p className="mt-2 text-sm text-amber-300">
                  Add a few words first.
                </p>
              )}

              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <button
                  onClick={submitAnswer}
                  disabled={isSubmitting || isWaitingForQuestion || hasFeedback}
                  className="rounded-xl bg-teal-300 hover:bg-teal-200 disabled:bg-slate-700 disabled:text-slate-400 text-slate-900 font-medium px-5 py-2.5 transition-colors"
                >
                  {isSubmitting ? 'Thinking…' : 'Submit answer'}
                </button>
                {speechSupported && (
                  <button
                    onClick={() => {
                      if (isRecording) stopRecording();
                      setInputMode((m) => (m === 'voice' ? 'text' : 'voice'));
                    }}
                    className="text-sm text-slate-400 hover:text-slate-200 underline underline-offset-4 decoration-slate-700"
                  >
                    {inputMode === 'voice' ? 'Type instead' : 'Voice instead'}
                  </button>
                )}
                {currentQuestion && (
                  <button
                    onClick={() => speak(currentQuestion)}
                    className="text-sm text-slate-500 hover:text-slate-300"
                    title="Hear the question again"
                  >
                    Replay question
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: Coach */}
          <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-6 min-h-[420px] flex flex-col">
            <div className="text-xs uppercase tracking-widest text-slate-500 mb-3">
              Coach
            </div>
            {!hasFeedback && !isSubmitting && (
              <div className="flex-1 flex items-center justify-center text-center">
                <p className="text-slate-500 leading-relaxed max-w-xs">
                  Feedback appears here after you submit. Honest, not harsh.
                </p>
              </div>
            )}
            {isSubmitting && !hasFeedback && (
              <div className="flex-1 flex items-center justify-center text-slate-500">
                <span className="animate-pulse">Reading your answer…</span>
              </div>
            )}
            {hasFeedback && (
              <div className="animate-fadeIn flex-1 flex flex-col">
                {currentFeedback.raw ? (
                  <>
                    <p className="text-xs text-slate-500 mb-2">
                      Feedback (unformatted)
                    </p>
                    <pre className="flex-1 whitespace-pre-wrap text-slate-200 text-sm leading-relaxed bg-slate-950/40 border border-slate-800/60 rounded-xl p-4 overflow-auto">
                      {currentFeedback.raw}
                    </pre>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-slate-100 font-medium">
                        Coaching note
                      </h3>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-semibold text-amber-400 tabular-nums">
                          {currentFeedback.score}
                        </span>
                        <span className="text-slate-500 text-sm">/ 10</span>
                      </div>
                    </div>
                    <div className="space-y-4 flex-1">
                      <div>
                        <div className="text-xs uppercase tracking-widest text-teal-300 mb-1">
                          What worked
                        </div>
                        <p className="text-slate-200 text-sm leading-relaxed">
                          {currentFeedback.worked}
                        </p>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-widest text-amber-300 mb-1">
                          What didn't
                        </div>
                        <p className="text-slate-200 text-sm leading-relaxed">
                          {currentFeedback.didnt}
                        </p>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-widest text-slate-400 mb-1">
                          A sharper version
                        </div>
                        <p className="text-slate-200 text-sm leading-relaxed italic">
                          {currentFeedback.sharper}
                        </p>
                      </div>
                    </div>
                  </>
                )}
                <div className="mt-5 flex items-center gap-3 flex-wrap">
                  <button
                    onClick={onNextQuestion}
                    disabled={loadingState !== 'idle'}
                    className="rounded-xl bg-teal-300 hover:bg-teal-200 disabled:bg-slate-700 disabled:text-slate-400 text-slate-900 font-medium px-5 py-2.5"
                  >
                    {questionIndex + 1 >= TOTAL_QUESTIONS
                      ? loadingState === 'summary'
                        ? 'Wrapping up…'
                        : 'See summary'
                      : loadingState === 'question'
                      ? 'Preparing…'
                      : 'Next question'}
                  </button>
                  <button
                    onClick={onRetryQuestion}
                    disabled={loadingState !== 'idle'}
                    className="text-sm text-slate-300 hover:text-slate-100 border border-slate-800/60 hover:border-slate-700 rounded-lg px-3 py-2"
                  >
                    Retry this question
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
