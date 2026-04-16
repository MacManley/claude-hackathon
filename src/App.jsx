import { useCallback, useEffect, useRef, useState } from 'react';
import FlowBuilder from './FlowBuilder';

const MODEL = 'claude-sonnet-4-20250514';
const TOTAL_QUESTIONS = 5;
const SILENCE_TIMEOUT_MS = 5000;
const AUTO_ADVANCE_DELAY_MS = 900;

const REASSURANCE_FALLBACKS = [
  'Thanks, got it.',
  'Appreciate the detail.',
  "Got it. Let's keep moving.",
  'Thanks for that - understood.',
];

const FALLBACK_POINTERS = [
  {
    title: 'Lead with context',
    detail: 'Open with the situation and your role so the listener can follow.',
  },
  {
    title: 'Show your impact',
    detail: 'Call out results with numbers, scope, or clear outcomes.',
  },
  {
    title: 'Tighten the close',
    detail: 'End with a takeaway that ties back to the question.',
  },
];

const INITIAL_JOB_FORM = {
  roleTitle: '',
  level: '',
  location: '',
  employmentType: '',
  remotePolicy: '',
  salaryRange: '',
  team: '',
  responsibilities: '',
  requirements: '',
  niceToHave: '',
  techStack: '',
  interviewFocus: '',
};

const DEMO_JOB = {
  roleTitle: 'Senior Software Engineer',
  level: 'Senior, 5+ years',
  location: 'Dublin, Ireland',
  employmentType: 'Full-time',
  remotePolicy: 'Hybrid – 2 days in office',
  salaryRange: '€85,000 – €110,000',
  team: 'Core Platform team, building developer tooling and internal APIs',
  responsibilities:
    'Design and ship scalable backend services; lead code reviews and mentor junior engineers; collaborate with product and design on architecture decisions; improve CI/CD pipelines and observability',
  requirements:
    '5+ years building production software; strong TypeScript or Python skills; experience with REST and GraphQL APIs; solid understanding of distributed systems and databases',
  niceToHave:
    'Experience with Kubernetes or AWS; open-source contributions; previous startup experience',
  techStack: 'TypeScript; Node.js; PostgreSQL; Redis; Docker; AWS; GitHub Actions',
  interviewFocus:
    'System design, code quality, collaborative problem-solving, past technical challenges',
};

const QUESTION_SYSTEM = (jobDescription, n, stagePrompt) => {
  if (stagePrompt) {
    return `You are a senior interviewer at the company hiring for this role:
${jobDescription}. This is question ${n} of the interview. The interviewer's directive for this stage is: "${stagePrompt}". Generate ONE interview question that follows this directive. Return ONLY the question text, no preamble, no numbering, no quotation marks. Keep it realistic and concise.`;
  }
  return `You are a senior interviewer at the company hiring for this role:
${jobDescription}. Generate ONE interview question appropriate for question number ${n} of 5. Mix across: background/motivation (Q1), behavioural STAR (Q2), role-specific technical (Q3), situational (Q4), challenging curveball (Q5). Return ONLY the question text, no preamble, no numbering, no quotation marks. Keep it realistic and concise.`;
};

const FEEDBACK_SYSTEM = (jobDescription, question, answer) =>
  `You are a direct, experienced interview coach. The job: ${jobDescription}. The question asked: ${question}. The candidate's answer: ${answer}. Respond in strict JSON with this exact shape:
{"reaffirmation": string, "pointers": [{"title": string, "detail": string}, {"title": string, "detail": string}, {"title": string, "detail": string}], "score": number}

Rules:
- reaffirmation: one short, warm sentence that acknowledges the answer without flattery.
- pointers: exactly three items; title is 3-6 words, detail is 1-2 sentences specific to the answer.
- score: integer 0-10.
Return ONLY the JSON object. Do not wrap in markdown code fences. Do not add any preamble or explanation.`;

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

const EXTRACTION_SYSTEM = `You extract structured job details from a job posting. Return strict JSON with EXACT keys:
{"roleTitle": string, "level": string, "location": string, "employmentType": string, "remotePolicy": string, "salaryRange": string, "team": string, "responsibilities": string, "requirements": string, "niceToHave": string, "techStack": string, "interviewFocus": string}

Rules:
- Use empty string if unknown.
- Keep each value concise; use short sentences or phrases.
- For responsibilities/requirements/niceToHave/techStack, use semicolon-separated phrases.
- Do NOT include extra keys or commentary.`;

function buildJobDescription(form, postingText) {
  const lines = [];
  if (form.roleTitle) lines.push(`Role: ${form.roleTitle}`);
  if (form.level) lines.push(`Level: ${form.level}`);
  if (form.location) lines.push(`Location: ${form.location}`);
  if (form.employmentType) lines.push(`Employment type: ${form.employmentType}`);
  if (form.remotePolicy) lines.push(`Remote policy: ${form.remotePolicy}`);
  if (form.salaryRange) lines.push(`Salary: ${form.salaryRange}`);
  if (form.team) lines.push(`Team: ${form.team}`);
  if (form.responsibilities)
    lines.push(`Responsibilities: ${form.responsibilities}`);
  if (form.requirements) lines.push(`Requirements: ${form.requirements}`);
  if (form.niceToHave) lines.push(`Nice to have: ${form.niceToHave}`);
  if (form.techStack) lines.push(`Tech stack: ${form.techStack}`);
  if (form.interviewFocus)
    lines.push(`Interview focus: ${form.interviewFocus}`);
  if (!lines.length && postingText) {
    lines.push(`Job posting: ${postingText}`);
  }
  return lines.join('\n');
}

function stripFences(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function pickReaffirmation() {
  const index = Math.floor(Math.random() * REASSURANCE_FALLBACKS.length);
  return REASSURANCE_FALLBACKS[index] || 'Thanks, got it.';
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
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [customFlowStages, setCustomFlowStages] = useState(null);
  const [jobForm, setJobForm] = useState(INITIAL_JOB_FORM);
  const [jobPostingText, setJobPostingText] = useState('');
  const [jobPostingUrl, setJobPostingUrl] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionNote, setExtractionNote] = useState('');

  const toggleDemoMode = useCallback((enabled) => {
    setIsDemoMode(enabled);
    if (enabled) {
      setJobForm(DEMO_JOB);
      setJobPostingUrl('https://cadence.wd1.myworkdayjobs.com/External_Careers/job/CORK-01/Intern_R52784?source=LinkedIn');
    } else {
      setJobForm(INITIAL_JOB_FORM);
      setJobPostingUrl('');
    }
  }, []);

  const [questionIndex, setQuestionIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [feedbacks, setFeedbacks] = useState([]);

  const [currentAnswer, setCurrentAnswer] = useState('');
  const [currentFeedback, setCurrentFeedback] = useState(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [speechTick, setSpeechTick] = useState(0);
  const [inputMode, setInputMode] = useState('voice');
  const [emptyWarning, setEmptyWarning] = useState(false);

  const [chatLog, setChatLog] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  const [autoAdvanceReady, setAutoAdvanceReady] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [activePointer, setActivePointer] = useState(null);

  const [loadingState, setLoadingState] = useState('idle');
  const [errorState, setErrorState] = useState(null);

  const [summary, setSummary] = useState(null);

  const [countdown, setCountdown] = useState(3);
  const [countdownActive, setCountdownActive] = useState(false);

  const [voices, setVoices] = useState([]);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef('');
  const isRecordingRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const autoAdvanceRef = useRef(null);
  const hasSpeechRef = useRef(false);
  const isPausedRef = useRef(false);
  const inputModeRef = useRef('voice');
  const chatEndRef = useRef(null);
  const onNextQuestionRef = useRef(null);

  const jobDescription = buildJobDescription(jobForm, jobPostingText);
  const totalQuestions = customFlowStages ? customFlowStages.length : TOTAL_QUESTIONS;

  const hasMinimumInfo =
    !!jobDescription.trim() &&
    (jobForm.roleTitle.trim() || jobPostingText.trim());

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    inputModeRef.current = inputMode;
  }, [inputMode]);

  useEffect(() => {
    if (screen !== 'interview') return;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatLog, currentAnswer, currentFeedback, currentQuestion, loadingState, screen]);

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
        const nextFinal = (finalTranscriptRef.current + ' ' + appended)
          .replace(/\s+/g, ' ')
          .trim();
        finalTranscriptRef.current = nextFinal;
      }
      const combined = `${finalTranscriptRef.current} ${interim}`
        .replace(/\s+/g, ' ')
        .trim();
      if (combined) {
        setCurrentAnswer(combined);
        if (!isPausedRef.current && inputModeRef.current === 'voice') {
          setSpeechTick(Date.now());
          hasSpeechRef.current = true;
        }
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
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
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
    (text, onEnd) => {
      if (typeof window === 'undefined' || !window.speechSynthesis || !text) {
        if (onEnd) onEnd();
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95;
        u.pitch = 1.0;
        const v = pickVoice(voices);
        if (v) u.voice = v;
        if (onEnd) {
          u.onend = () => onEnd();
          u.onerror = () => onEnd();
        }
        window.speechSynthesis.speak(u);
      } catch {
        if (onEnd) onEnd();
      }
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
    if (!rec || isPausedRef.current) return;
    cancelSpeech();
    try {
      finalTranscriptRef.current = currentAnswer || '';
      setInterimTranscript('');
      hasSpeechRef.current = false;
      setSpeechTick(0);
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
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const resetTranscripts = useCallback(() => {
    finalTranscriptRef.current = '';
    setInterimTranscript('');
    setCurrentAnswer('');
    setSpeechTick(0);
    hasSpeechRef.current = false;
    setEmptyWarning(false);
  }, []);

  const startListening = useCallback(() => {
    if (!speechSupported || inputModeRef.current !== 'voice') return;
    if (isPausedRef.current) return;
    if (isRecordingRef.current) return;
    startRecording();
  }, [speechSupported, startRecording]);

  const fetchQuestion = useCallback(
    async (n) => {
      setLoadingState('question');
      setErrorState(null);
      if (autoAdvanceRef.current) {
        clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }
      setAutoAdvanceReady(false);
      try {
        const stagePrompt = customFlowStages?.[n] || null;
        const text = await callClaude({
          system: QUESTION_SYSTEM(jobDescription, n + 1, stagePrompt),
          user: `Please provide question ${n + 1} of ${totalQuestions} now.`,
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
        setActivePointer(null);
        resetTranscripts();
        setLoadingState('idle');
        setChatLog((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${n}`,
            role: 'interviewer',
            text: cleaned,
            questionIndex: n,
          },
        ]);
        setTimeout(() => speak(cleaned, startListening), 200);
      } catch (err) {
        setLoadingState('idle');
        setErrorState({
          message:
            'Something went wrong on our end. Try that answer again?',
          retry: () => fetchQuestion(n),
        });
      }
    },
    [jobDescription, resetTranscripts, speak, startListening, customFlowStages, totalQuestions]
  );

  const scheduleAutoAdvance = useCallback(() => {
    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
    if (isPausedRef.current) {
      setAutoAdvanceReady(true);
      return;
    }
    setAutoAdvanceReady(false);
    autoAdvanceRef.current = setTimeout(() => {
      onNextQuestionRef.current?.();
    }, AUTO_ADVANCE_DELAY_MS);
  }, []);

  const submitAnswer = useCallback(
    async (answerOverride, options = {}) => {
      const answer = (answerOverride ?? (currentAnswer || '')).trim();
      const { skipAppend } = options;
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
      if (!skipAppend) {
        setChatLog((prev) => [
          ...prev,
          {
            id: `${Date.now()}-a-${questionIndex}`,
            role: 'candidate',
            text: answer,
            questionIndex,
          },
        ]);
        resetTranscripts();
      }
      try {
        const text = await callClaude({
          system: FEEDBACK_SYSTEM(jobDescription, currentQuestion, answer),
          user: 'Return the JSON feedback now.',
          maxTokens: 1024,
        });
        const parsed = tryParseJSON(text);
        const reaffirmation =
          parsed && typeof parsed.reaffirmation === 'string'
            ? parsed.reaffirmation.trim()
            : pickReaffirmation();
        const pointers = Array.isArray(parsed?.pointers)
          ? parsed.pointers
              .filter((p) => p && p.title && p.detail)
              .map((p) => ({
                title: String(p.title).trim(),
                detail: String(p.detail).trim(),
              }))
          : [];
        const score =
          parsed && typeof parsed.score === 'number' ? parsed.score : 5;
        const feedbackEntry = {
          reaffirmation: reaffirmation || pickReaffirmation(),
          pointers: pointers.length ? pointers.slice(0, 3) : FALLBACK_POINTERS,
          score,
        };
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
        setReviewIndex(questionIndex);
        setActivePointer(null);
        setChatLog((prev) => [
          ...prev,
          {
            id: `${Date.now()}-c-${questionIndex}`,
            role: 'coach',
            text: feedbackEntry.reaffirmation,
            questionIndex,
          },
        ]);
        setLoadingState('idle');
        scheduleAutoAdvance();
      } catch (err) {
        setLoadingState('idle');
        setErrorState({
          message:
            'Something went wrong on our end. Try that answer again?',
          retry: () => submitAnswer(answer, { skipAppend: true }),
        });
      }
    },
    [
      cancelSpeech,
      currentAnswer,
      currentQuestion,
      jobDescription,
      questionIndex,
      resetTranscripts,
      scheduleAutoAdvance,
    ]
  );

  const finalizeAnswer = useCallback(() => {
    if (loadingState !== 'idle' || currentFeedback) return;
    const answer = (currentAnswer || '').trim();
    if (!answer) return;
    stopRecording();
    submitAnswer(answer);
  }, [currentAnswer, currentFeedback, loadingState, stopRecording, submitAnswer]);

  useEffect(() => {
    if (!isRecording || !speechTick || isPaused) return;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      if (isPausedRef.current) return;
      if (!hasSpeechRef.current) return;
      finalizeAnswer();
    }, SILENCE_TIMEOUT_MS);
    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
  }, [finalizeAnswer, isPaused, isRecording, speechTick]);

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
    setChatLog([]);
    setCurrentQuestion('');
    setCurrentFeedback(null);
    setIsPaused(false);
    setAutoAdvanceReady(false);
    setReviewIndex(0);
    setActivePointer(null);
    setCountdown(3);
    setCountdownActive(true);
    setScreen('countdown');
  }, [jobDescription]);

  useEffect(() => {
    if (screen !== 'countdown' || !countdownActive) return;
    if (countdown <= 0) {
      setCountdownActive(false);
      setScreen('interview');
      fetchQuestion(0);
      return;
    }
    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, countdownActive, fetchQuestion, screen]);

  const applyExtraction = useCallback(
    (extracted) => {
      if (!extracted || typeof extracted !== 'object') return;
      setJobForm((prev) => {
        const next = { ...prev };
        Object.keys(INITIAL_JOB_FORM).forEach((key) => {
          const incoming = (extracted[key] || '').trim();
          if (!next[key] && incoming) next[key] = incoming;
        });
        return next;
      });
    },
    [setJobForm]
  );

  const extractFromPosting = useCallback(
    async (text) => {
      const cleaned = (text || '').trim();
      if (!cleaned) return;
      setIsExtracting(true);
      setExtractionNote('Extracting details...');
      try {
        const result = await callClaude({
          system: EXTRACTION_SYSTEM,
          user: cleaned.slice(0, 12000),
          maxTokens: 1024,
        });
        const parsed = tryParseJSON(result);
        if (parsed) {
          applyExtraction(parsed);
          setExtractionNote('Filled what we could from the posting.');
        } else {
          setExtractionNote('Could not parse the posting. Try pasting text.');
        }
      } catch {
        setExtractionNote('Extraction failed. You can fill fields manually.');
      } finally {
        setIsExtracting(false);
      }
    },
    [applyExtraction]
  );

  const scrapeFromUrl = useCallback(
    async (url) => {
      const cleaned = (url || '').trim();
      if (!cleaned) return;
      setIsExtracting(true);
      setExtractionNote('Fetching the posting...');
      try {
        const normalized = cleaned.startsWith('http')
          ? cleaned
          : `https://${cleaned}`;
        const proxyUrl = `https://r.jina.ai/http://${normalized.replace(
          /^https?:\/\//i,
          ''
        )}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) {
          throw new Error('Fetch failed');
        }
        const text = await res.text();
        const trimmed = text.trim();
        if (!trimmed) {
          setExtractionNote('No readable text found at that URL.');
          return;
        }
        setJobPostingText(trimmed.slice(0, 12000));
        await extractFromPosting(trimmed);
      } catch {
        setExtractionNote('Could not fetch that URL. Try another link.');
      } finally {
        setIsExtracting(false);
      }
    },
    [extractFromPosting]
  );

  const onNextQuestion = useCallback(async () => {
    setAutoAdvanceReady(false);
    const nextIndex = questionIndex + 1;
    if (nextIndex >= totalQuestions) {
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
  }, [answers, fetchQuestion, fetchSummary, feedbacks, questionIndex, questions, totalQuestions]);

  useEffect(() => {
    onNextQuestionRef.current = onNextQuestion;
  }, [onNextQuestion]);

  const pauseSession = useCallback(() => {
    cancelSpeech();
    stopRecording();
    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
      setAutoAdvanceReady(true);
    }
    setIsPaused(true);
  }, [cancelSpeech, stopRecording]);

  const resumeSession = useCallback(() => {
    setIsPaused(false);
  }, []);

  const togglePause = useCallback(() => {
    if (isPaused) resumeSession();
    else pauseSession();
  }, [isPaused, pauseSession, resumeSession]);

  useEffect(() => {
    if (screen !== 'interview' || isPaused) return;
    if (autoAdvanceReady) {
      setAutoAdvanceReady(false);
      onNextQuestion();
      return;
    }
    if (
      speechSupported &&
      inputMode === 'voice' &&
      currentQuestion &&
      !currentFeedback &&
      loadingState === 'idle' &&
      !isRecording
    ) {
      startListening();
    }
  }, [
    autoAdvanceReady,
    currentFeedback,
    currentQuestion,
    inputMode,
    isPaused,
    isRecording,
    loadingState,
    onNextQuestion,
    screen,
    speechSupported,
    startListening,
  ]);

  const endSession = useCallback(async () => {
    // Pause immediately so the auto-listen useEffect doesn't restart recording
    isPausedRef.current = true;
    setIsPaused(true);
    cancelSpeech();
    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
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
    setIsDemoMode(false);
    setCustomFlowStages(null);
    setJobForm(INITIAL_JOB_FORM);
    setJobPostingText('');
    setJobPostingUrl('');
    setExtractionNote('');
    setCountdown(3);
    setCountdownActive(false);
    setQuestions([]);
    setAnswers([]);
    setFeedbacks([]);
    setCurrentQuestion('');
    setCurrentFeedback(null);
    setChatLog([]);
    setIsPaused(false);
    setAutoAdvanceReady(false);
    setReviewIndex(0);
    setActivePointer(null);
    setSummary(null);
    setQuestionIndex(0);
    resetTranscripts();
  }, [cancelSpeech, resetTranscripts]);

  if (screen === 'flowBuilder') {
    return (
      <FlowBuilder
        onSave={(stages) => {
          setCustomFlowStages(stages);
          setScreen('landing');
        }}
        onCancel={() => setScreen('landing')}
      />
    );
  }

  if (screen === 'landing') {
    return (
      <div className="min-h-screen flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-3xl">
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
            {/* Demo mode toggle */}
            <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-800/60">
              <div>
                <p className="text-sm font-medium text-slate-200">Try a demo job</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Auto-fills a Senior Software Engineer role so you can start instantly.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={isDemoMode}
                onClick={() => toggleDemoMode(!isDemoMode)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                  isDemoMode ? 'bg-teal-400' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
                    isDemoMode ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Job role
                </label>
                <input
                  value={jobForm.roleTitle}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      roleTitle: e.target.value,
                    }))
                  }
                  placeholder="Senior Product Designer"
                  className="w-full rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none px-3 py-2 text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Level / years
                </label>
                <input
                  value={jobForm.level}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      level: e.target.value,
                    }))
                  }
                  placeholder="Staff, 6+ years"
                  className="w-full rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none px-3 py-2 text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Location
                </label>
                <input
                  value={jobForm.location}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }))
                  }
                  placeholder="Austin, TX"
                  className="w-full rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none px-3 py-2 text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Employment type
                </label>
                <input
                  value={jobForm.employmentType}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      employmentType: e.target.value,
                    }))
                  }
                  placeholder="Full-time, contract"
                  className="w-full rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none px-3 py-2 text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Remote policy
                </label>
                <input
                  value={jobForm.remotePolicy}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      remotePolicy: e.target.value,
                    }))
                  }
                  placeholder="Hybrid 3 days in office"
                  className="w-full rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none px-3 py-2 text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Salary range
                </label>
                <input
                  value={jobForm.salaryRange}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      salaryRange: e.target.value,
                    }))
                  }
                  placeholder="$140k-$175k"
                  className="w-full rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none px-3 py-2 text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="mt-4 grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Team / domain
                </label>
                <textarea
                  value={jobForm.team}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      team: e.target.value,
                    }))
                  }
                  placeholder="Payments platform, growth squad"
                  className="w-full min-h-[90px] rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none p-3 text-slate-100 leading-relaxed placeholder:text-slate-500 resize-y"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Interview focus
                </label>
                <textarea
                  value={jobForm.interviewFocus}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      interviewFocus: e.target.value,
                    }))
                  }
                  placeholder="Customer empathy, roadmap ownership, cross-functional influence"
                  className="w-full min-h-[90px] rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none p-3 text-slate-100 leading-relaxed placeholder:text-slate-500 resize-y"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Responsibilities
                </label>
                <textarea
                  value={jobForm.responsibilities}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      responsibilities: e.target.value,
                    }))
                  }
                  placeholder="Own design systems; Lead research; Partner with PM"
                  className="w-full min-h-[110px] rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none p-3 text-slate-100 leading-relaxed placeholder:text-slate-500 resize-y"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Requirements
                </label>
                <textarea
                  value={jobForm.requirements}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      requirements: e.target.value,
                    }))
                  }
                  placeholder="7+ years UX; shipped B2B SaaS; strong facilitation"
                  className="w-full min-h-[110px] rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none p-3 text-slate-100 leading-relaxed placeholder:text-slate-500 resize-y"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Nice to have
                </label>
                <textarea
                  value={jobForm.niceToHave}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      niceToHave: e.target.value,
                    }))
                  }
                  placeholder="Fintech experience; design ops"
                  className="w-full min-h-[90px] rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none p-3 text-slate-100 leading-relaxed placeholder:text-slate-500 resize-y"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Tech stack
                </label>
                <textarea
                  value={jobForm.techStack}
                  onChange={(e) =>
                    setJobForm((prev) => ({
                      ...prev,
                      techStack: e.target.value,
                    }))
                  }
                  placeholder="Figma; React; design tokens"
                  className="w-full min-h-[90px] rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none p-3 text-slate-100 leading-relaxed placeholder:text-slate-500 resize-y"
                />
              </div>
            </div>

            <div className="mt-6 border-t border-slate-800/60 pt-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    Add a job posting
                  </p>
                  <p className="text-xs text-slate-500">
                    Paste a link, upload a file, or paste the full posting.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 rounded-xl border border-slate-800/80 px-3 py-2 text-sm text-slate-300 hover:text-slate-100 hover:border-slate-700 cursor-pointer">
                  <input
                    type="file"
                    accept=".txt,.md,.rtf"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (!/\.(txt|md|rtf)$/i.test(file.name)) {
                        setExtractionNote('Please upload a .txt, .md, or .rtf file.');
                        return;
                      }
                      const text = await file.text();
                      setJobPostingText(text.trim());
                      extractFromPosting(text);
                    }}
                  />
                  <span>Choose file</span>
                </label>
              </div>
              <div className="mt-4">
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Paste a job link
                </label>
                <div className="flex flex-col md:flex-row gap-3">
                  <input
                    value={jobPostingUrl}
                    onChange={(e) => setJobPostingUrl(e.target.value)}
                    placeholder="https://company.com/careers/role"
                    className="flex-1 rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none px-3 py-2 text-slate-100 placeholder:text-slate-500"
                  />
                  <button
                    onClick={() => scrapeFromUrl(jobPostingUrl)}
                    disabled={!jobPostingUrl.trim() || isExtracting}
                    className="rounded-xl bg-slate-100/10 hover:bg-slate-100/20 disabled:bg-slate-800/60 disabled:text-slate-500 text-slate-100 font-medium px-4 py-2"
                  >
                    {isExtracting ? 'Fetching...' : 'Fetch from link'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Note: some sites block scraping; try a different link or paste the text.
                </p>
              </div>
              <div className="mt-3">
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  Or paste a full job posting
                </label>
                <textarea
                  value={jobPostingText}
                  onChange={(e) => setJobPostingText(e.target.value)}
                  placeholder="Paste the full posting and click Extract."
                  className="w-full min-h-[120px] rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none p-3 text-slate-100 leading-relaxed placeholder:text-slate-500 resize-y"
                />
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={() => extractFromPosting(jobPostingText)}
                    disabled={!jobPostingText.trim() || isExtracting}
                    className="rounded-xl bg-slate-100/10 hover:bg-slate-100/20 disabled:bg-slate-800/60 disabled:text-slate-500 text-slate-100 font-medium px-4 py-2"
                  >
                    {isExtracting ? 'Extracting...' : 'Extract details'}
                  </button>
                  {extractionNote && (
                    <span className="text-xs text-slate-500">
                      {extractionNote}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {customFlowStages && (
              <div className="mt-5 flex items-center gap-2 text-xs text-teal-300">
                <span className="inline-block w-2 h-2 rounded-full bg-teal-400" />
                Custom flow active — {customFlowStages.length} stage{customFlowStages.length !== 1 ? 's' : ''}
                <button
                  onClick={() => setCustomFlowStages(null)}
                  className="ml-1 text-slate-500 hover:text-slate-300 underline"
                >
                  clear
                </button>
              </div>
            )}
            <div className="mt-4 flex gap-3">
              <button
                onClick={startInterview}
                disabled={!hasMinimumInfo || loadingState === 'question'}
                className="flex-1 rounded-xl bg-teal-300 hover:bg-teal-200 disabled:bg-slate-700 disabled:text-slate-400 text-slate-900 font-medium py-3 transition-colors"
              >
                {loadingState === 'question' ? 'Preparing...' : 'Start interview'}
              </button>
              <button
                onClick={() => setScreen('flowBuilder')}
                className="rounded-xl border border-slate-700 hover:border-teal-400/60 text-slate-300 hover:text-teal-300 font-medium px-4 py-3 transition-colors text-sm"
              >
                Design custom flow
              </button>
            </div>
            <p className="mt-4 text-xs text-slate-500 text-center leading-relaxed">
              {totalQuestions} question{totalQuestions !== 1 ? 's' : ''}. Auto-advances after each answer. Pause anytime to review pointers.
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

  if (screen === 'countdown') {
    return (
      <div className="min-h-screen flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-xl text-center">
          <p className="text-slate-400 text-sm uppercase tracking-widest">
            Starting interview
          </p>
          <div className="mt-4 text-7xl font-semibold text-teal-300 tabular-nums">
            {countdown}
          </div>
          <p className="mt-4 text-slate-500">
            Take a breath. The first question is loading.
          </p>
        </div>
      </div>
    );
  }

  // INTERVIEW SCREEN
  const isWaitingForQuestion = loadingState === 'question';
  const isSubmitting = loadingState === 'feedback';
  const isListening = isRecording && inputMode === 'voice';
  const reviewOptions = answers
    .map((answer, index) => (answer ? index : null))
    .filter((value) => value !== null);
  const activeReviewIndex = reviewOptions.includes(reviewIndex)
    ? reviewIndex
    : reviewOptions[reviewOptions.length - 1] ?? 0;
  const pointersForReview =
    feedbacks[activeReviewIndex]?.pointers || FALLBACK_POINTERS;
  const activePointerData =
    activePointer && activePointer.questionIndex === activeReviewIndex
      ? pointersForReview[activePointer.pointerIndex]
      : null;

  return (
    <div className="min-h-screen px-5 py-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <BreathingDot />
            <div className="text-sm text-slate-300">
              Question{' '}
              <span className="text-slate-100 font-medium">
                {questionIndex + 1}
              </span>{' '}
              of {totalQuestions}
              {isPaused && (
                <span className="ml-2 text-amber-300 text-xs uppercase tracking-widest">
                  Paused
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {currentQuestion && (
              <button
                onClick={() => speak(currentQuestion)}
                className="text-sm text-slate-500 hover:text-slate-300"
                title="Hear the question again"
              >
                Replay question
              </button>
            )}
            <button
              onClick={togglePause}
              className="text-sm text-slate-300 hover:text-slate-100 border border-slate-800/60 hover:border-slate-700 rounded-lg px-3 py-1.5 transition-colors"
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={endSession}
              className="text-sm text-slate-400 hover:text-slate-200 border border-slate-800/60 hover:border-slate-700 rounded-lg px-3 py-1.5 transition-colors"
            >
              End session
            </button>
          </div>
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

        <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-5">
          <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-6 min-h-[520px] flex flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto pr-2">
              {chatLog.map((msg) => {
                const isCandidate = msg.role === 'candidate';
                const isCoach = msg.role === 'coach';
                const bubbleClass = isCandidate
                  ? 'bg-teal-300 text-slate-900'
                  : isCoach
                  ? 'bg-amber-200 text-slate-900'
                  : 'bg-slate-800/80 text-slate-100';
                const labelClass = isCandidate
                  ? 'text-slate-700'
                  : isCoach
                  ? 'text-slate-700'
                  : 'text-slate-400';
                const label = isCandidate
                  ? 'You'
                  : isCoach
                  ? 'Coach'
                  : 'Interviewer';
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isCandidate ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-3 ${bubbleClass}`}
                    >
                      <p className={`text-[10px] uppercase tracking-widest mb-1 ${labelClass}`}>
                        {label}
                      </p>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {msg.text}
                      </p>
                    </div>
                  </div>
                );
              })}

              {isWaitingForQuestion && !currentQuestion && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-4 py-3 bg-slate-800/70 text-slate-400 text-sm">
                    Preparing your next question...
                  </div>
                </div>
              )}

              {isListening && !isPaused && (
                <div className="flex justify-end">
                  <div className="max-w-[78%] rounded-2xl px-4 py-3 border border-teal-300/40 bg-teal-300/10 text-teal-100">
                    <p className="text-[10px] uppercase tracking-widest mb-1 text-teal-200/80">
                      Listening
                    </p>
                    <p className="text-sm leading-relaxed">
                      {currentAnswer || interimTranscript || '...'}
                    </p>
                  </div>
                </div>
              )}

              {isSubmitting && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-4 py-3 bg-slate-800/70 text-slate-500 text-sm animate-pulse">
                    Coach is typing...
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            <div className="mt-4 border-t border-slate-800/60 pt-3">
              {speechSupported && inputMode === 'voice' ? (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isPaused
                          ? 'bg-amber-300'
                          : isListening
                          ? 'bg-rose-400 animate-pulse'
                          : 'bg-slate-600'
                      }`}
                    />
                    {isPaused
                      ? 'Paused - resume when ready.'
                      : isListening
                      ? 'Listening for your answer...'
                      : 'Ready for your answer.'}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={finalizeAnswer}
                      disabled={
                        loadingState !== 'idle' || !currentAnswer.trim()
                      }
                      className="text-sm text-slate-300 hover:text-slate-100 border border-slate-800/60 hover:border-slate-700 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                    >
                      Send now
                    </button>
                    <button
                      onClick={() => {
                        stopRecording();
                        setInputMode('text');
                      }}
                      className="text-sm text-slate-500 hover:text-slate-300"
                    >
                      Type instead
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    value={currentAnswer}
                    onChange={(e) => {
                      setCurrentAnswer(e.target.value);
                      if (e.target.value.trim()) setEmptyWarning(false);
                    }}
                    placeholder="Type your answer here."
                    className="w-full min-h-[110px] rounded-xl bg-slate-950/60 border border-slate-800/80 focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 outline-none p-3 text-slate-100 leading-relaxed placeholder:text-slate-600 resize-y"
                  />
                  {emptyWarning && (
                    <p className="text-sm text-amber-300">
                      Add a few words first.
                    </p>
                  )}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={finalizeAnswer}
                      disabled={loadingState !== 'idle'}
                      className="rounded-xl bg-teal-300 hover:bg-teal-200 disabled:bg-slate-700 disabled:text-slate-400 text-slate-900 font-medium px-4 py-2"
                    >
                      {isSubmitting ? 'Thinking...' : 'Send answer'}
                    </button>
                    {speechSupported && (
                      <button
                        onClick={() => setInputMode('voice')}
                        className="text-sm text-slate-500 hover:text-slate-300"
                      >
                        Use voice
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-6 min-h-[520px] flex flex-col">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-500">
                  Pointers
                </div>
                <p className="text-xs text-slate-500">
                  Click a bullet to expand.
                </p>
              </div>
              {reviewOptions.length > 0 && (
                <select
                  value={activeReviewIndex}
                  onChange={(e) => {
                    setReviewIndex(Number(e.target.value));
                    setActivePointer(null);
                  }}
                  className="rounded-lg bg-slate-950/60 border border-slate-800/80 px-2 py-1 text-xs text-slate-200"
                >
                  {reviewOptions.map((index) => (
                    <option key={index} value={index}>
                      Response {index + 1}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {reviewOptions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center">
                <p className="text-slate-500 text-sm max-w-xs">
                  Pointers appear after your first answer.
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <ul className="space-y-3">
                  {pointersForReview.map((pointer, idx) => (
                    <li key={`${activeReviewIndex}-${idx}`}>
                      <button
                        onClick={() =>
                          setActivePointer({
                            questionIndex: activeReviewIndex,
                            pointerIndex: idx,
                          })
                        }
                        className="w-full text-left rounded-lg px-3 py-2 border border-slate-800/80 hover:border-teal-400/60 bg-slate-950/40 text-slate-200 text-sm flex items-start gap-2"
                      >
                        <span className="text-teal-300 mt-[2px]">•</span>
                        <span>{pointer.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>

                {activePointerData && (
                  <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-950/50 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium text-slate-100">
                        {activePointerData.title}
                      </h4>
                      <button
                        onClick={() => setActivePointer(null)}
                        className="text-xs text-slate-500 hover:text-slate-300"
                      >
                        Close
                      </button>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {activePointerData.detail}
                    </p>
                  </div>
                )}

                {!isPaused && (
                  <p className="mt-4 text-xs text-slate-600">
                    Pause the session anytime to review pointers in detail.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
