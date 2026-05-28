'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft,
  Bell,
  BookOpen,
  ChevronRight,
  Download,
  FileText,
  Home,
  Loader2,
  LogOut,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  Sparkles,
  UploadCloud,
  UserRound,
} from 'lucide-react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { io, Socket } from 'socket.io-client';
import * as z from 'zod';
import {
  AssignmentFormValues,
  AssignmentResult,
  Difficulty,
  useAssignmentStore,
} from '../store/useAssignmentStore';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const formSchema = z.object({
  title: z.string().min(3, 'Enter an assignment title'),
  subject: z.string().min(2, 'Subject is required'),
  classLevel: z.string().min(1, 'Class or grade is required'),
  dueDate: z.string().min(1, 'Due date is required'),
  totalMarks: z.coerce.number().int().min(1, 'Marks must be positive').max(500),
  durationMinutes: z.coerce.number().int().min(10, 'Minimum duration is 10 minutes').max(360),
  questionTypes: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().min(1, 'Select a type'),
        count: z.coerce.number().int().min(1, 'Use at least 1'),
        marks: z.coerce.number().int().min(1, 'Marks must be positive'),
      }),
    )
    .min(1),
  instructions: z.string().optional(),
});

const defaultValues: AssignmentFormValues = {
  title: 'Quick Electricity',
  subject: 'Science',
  classLevel: 'Class 10',
  dueDate: '',
  totalMarks: 50,
  durationMinutes: 45,
  questionTypes: [
    { id: 'short', label: 'Short Answer', count: 8, marks: 2 },
    { id: 'long', label: 'Long Answer', count: 4, marks: 5 },
  ],
  instructions: 'Create a balanced paper with numerical and reasoning questions. Attempt all questions.',
};

const questionTypeOptions = ['Short Answer', 'Long Answer', 'Multiple Choice', 'Case Study', 'Very Short'];

const stepLabels = {
  dashboard: 'Dashboard',
  create: 'Assignment Details',
  generating: 'Generating Paper',
  output: 'Assignment Output',
};

let socket: Socket | null = null;

export default function AssignmentGenerator() {
  const {
    activeStep,
    isGenerating,
    statusMessage,
    assignmentData,
    pdfUrl,
    lastRequest,
    setStep,
    startGeneration,
    setStatusMessage,
    setAssignmentData,
  } = useAssignmentStore();
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState('');

  const form = useForm<AssignmentFormValues>({
    resolver: zodResolver(formSchema) as any,
    defaultValues,
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'questionTypes',
  });

  const watchedTypes = form.watch('questionTypes');
  const calculatedQuestions = useMemo(
    () => watchedTypes.reduce((sum, item) => sum + Number(item.count || 0), 0),
    [watchedTypes],
  );
  const calculatedMarks = useMemo(
    () => watchedTypes.reduce((sum, item) => sum + Number(item.count || 0) * Number(item.marks || 0), 0),
    [watchedTypes],
  );

  useEffect(() => {
    socket = io(API_URL, { transports: ['websocket', 'polling'] });
    socket.on('job-status', (payload: { message: string }) => setStatusMessage(payload.message));
    socket.on('job-complete', (payload: { data: AssignmentResult; pdfUrl: string | null }) => {
      setAssignmentData(payload.data, payload.pdfUrl);
    });
    socket.on('job-failed', (payload: { message: string }) => {
      setStatusMessage(payload.message || 'Generation failed');
    });

    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [setAssignmentData, setStatusMessage]);

  const submitAssignment = async (values: AssignmentFormValues) => {
    setFormError('');
    const payload = new FormData();
    payload.append('assignment', JSON.stringify(values));
    if (file) payload.append('contextFile', file);

    const response = await fetch(`${API_URL}/api/generate`, {
      method: 'POST',
      body: payload,
    });

    const data = await response.json();
    if (!response.ok) {
      setFormError(data.error || 'Unable to create assignment');
      return;
    }

    socket?.emit('join-job-room', data.jobId);
    startGeneration(data.jobId, values);
  };

  const handleRegenerate = async () => {
    if (!lastRequest) return;
    await submitAssignment(lastRequest);
  };

  return (
    <main className="app-shell">
      <Sidebar activeStep={activeStep} onCreate={() => setStep('create')} />
      <section className="workspace">
        <Topbar activeStep={activeStep} />
        <div className="content-frame">
          {activeStep === 'dashboard' && (
            <DashboardEmpty onCreate={() => setStep('create')} assignmentData={assignmentData} />
          )}
          {activeStep === 'create' && (
            <AssignmentForm
              form={form}
              fields={fields}
              file={file}
              formError={formError}
              calculatedMarks={calculatedMarks}
              calculatedQuestions={calculatedQuestions}
              onBack={() => setStep('dashboard')}
              onFile={(event) => setFile(event.target.files?.[0] || null)}
              onAddType={() =>
                append({
                  id: `type-${Date.now()}`,
                  label: 'Short Answer',
                  count: 1,
                  marks: 1,
                })
              }
              onRemoveType={remove}
              onSubmit={submitAssignment}
            />
          )}
          {activeStep === 'generating' && <GeneratingPanel status={statusMessage} />}
          {activeStep === 'output' && assignmentData && (
            <OutputPage
              assignment={assignmentData}
              pdfUrl={pdfUrl}
              isGenerating={isGenerating}
              onBack={() => setStep('create')}
              onRegenerate={handleRegenerate}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function Sidebar({ activeStep, onCreate }: { activeStep: string; onCreate: () => void }) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'create', label: 'Assignments', icon: BookOpen },
    { id: 'output', label: 'AI Results', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">V</span>
        <span>VedaAI</span>
      </div>
      <button className="primary-pill" onClick={onCreate}>
        <Plus size={14} />
        Create Assignment
      </button>
      <nav className="nav-list">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button className={activeStep === item.id ? 'nav-item active' : 'nav-item'} key={item.id}>
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="avatar">JD</div>
        <div>
          <strong>John Public School</strong>
          <span>Exam coordinator</span>
        </div>
        <LogOut size={15} />
      </div>
    </aside>
  );
}

function Topbar({ activeStep }: { activeStep: keyof typeof stepLabels }) {
  return (
    <header className="topbar">
      <div>
        <p>Assignment Creation Flow - Responsive</p>
        <h1>{stepLabels[activeStep]}</h1>
      </div>
      <div className="topbar-actions">
        <label className="search-box">
          <Search size={15} />
          <input placeholder="Search assignments" />
        </label>
        <button className="icon-button" aria-label="Notifications">
          <Bell size={17} />
        </button>
        <div className="profile-chip">
          <UserRound size={16} />
          John Doe
        </div>
      </div>
    </header>
  );
}

function DashboardEmpty({
  onCreate,
  assignmentData,
}: {
  onCreate: () => void;
  assignmentData: AssignmentResult | null;
}) {
  return (
    <div className="dashboard-grid">
      <section className="empty-state">
        <div className="empty-graphic">
          <FileText size={36} />
          <span />
        </div>
        <h2>{assignmentData ? 'Latest assignment is ready' : 'No assignments yet'}</h2>
        <p>
          {assignmentData
            ? 'Open the generated paper or create a fresh assignment from the left navigation.'
            : 'Create your first AI-generated assessment with sections, marks, difficulty tags, and a downloadable PDF.'}
        </p>
        <button className="dark-button" onClick={onCreate}>
          <Plus size={15} />
          Create New Assignment
        </button>
      </section>
      <section className="dashboard-cards">
        {['Queued', 'Generated', 'PDF Ready'].map((label, index) => (
          <div className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{assignmentData && index > 0 ? 1 : 0}</strong>
          </div>
        ))}
      </section>
    </div>
  );
}

function AssignmentForm({
  form,
  fields,
  file,
  formError,
  calculatedMarks,
  calculatedQuestions,
  onBack,
  onFile,
  onAddType,
  onRemoveType,
  onSubmit,
}: any) {
  const errors = form.formState.errors;

  return (
    <section className="form-screen">
      <div className="form-header">
        <button className="ghost-button" onClick={onBack}>
          <ArrowLeft size={15} />
          Previous
        </button>
        <div>
          <p>Assignment Details</p>
          <h2>Create Assignment</h2>
        </div>
        <button className="dark-button" form="assignment-form" type="submit">
          Next
          <ChevronRight size={15} />
        </button>
      </div>

      <form id="assignment-form" className="assignment-form" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="upload-panel">
          <UploadCloud size={30} />
          <strong>{file ? file.name : 'Choose or drag upload file here'}</strong>
          <span>Upload optional PDF or text material for context</span>
          <label className="upload-button">
            Upload File
            <input type="file" accept=".pdf,.txt,text/plain,application/pdf" onChange={onFile} />
          </label>
        </div>

        <div className="field-grid">
          <Field label="Assignment title" error={errors.title?.message}>
            <input {...form.register('title')} />
          </Field>
          <Field label="Subject" error={errors.subject?.message}>
            <input {...form.register('subject')} />
          </Field>
          <Field label="Class / Grade" error={errors.classLevel?.message}>
            <input {...form.register('classLevel')} />
          </Field>
          <Field label="Due date" error={errors.dueDate?.message}>
            <input type="date" {...form.register('dueDate')} />
          </Field>
          <Field label="Duration" error={errors.durationMinutes?.message}>
            <input type="number" {...form.register('durationMinutes')} />
          </Field>
          <Field label="Total marks" error={errors.totalMarks?.message}>
            <input type="number" {...form.register('totalMarks')} />
          </Field>
        </div>

        <div className="question-type-card">
          <div className="section-heading">
            <div>
              <p>Question Types</p>
              <h3>Number of questions + marks</h3>
            </div>
            <button type="button" className="ghost-button compact" onClick={onAddType}>
              <Plus size={14} />
              Add
            </button>
          </div>
          <div className="question-rows">
            {fields.map((field: any, index: number) => (
              <div className="question-row" key={field.id}>
                <Controller
                  name={`questionTypes.${index}.label`}
                  control={form.control}
                  render={({ field: selectField }) => (
                    <select {...selectField}>
                      {questionTypeOptions.map((option) => (
                        <option value={option} key={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  )}
                />
                <input type="number" min={1} {...form.register(`questionTypes.${index}.count`)} />
                <input type="number" min={1} {...form.register(`questionTypes.${index}.marks`)} />
                <button
                  type="button"
                  className="remove-button"
                  disabled={fields.length === 1}
                  onClick={() => onRemoveType(index)}
                >
                  x
                </button>
              </div>
            ))}
          </div>
          <div className="totals-strip">
            <span>{calculatedQuestions} questions</span>
            <span>{calculatedMarks} configured marks</span>
          </div>
        </div>

        <Field label="Additional instructions" error={errors.instructions?.message}>
          <textarea rows={4} {...form.register('instructions')} />
        </Field>

        {formError && <p className="form-error">{formError}</p>}
      </form>
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <em>{error}</em>}
    </label>
  );
}

function GeneratingPanel({ status }: { status: string }) {
  return (
    <section className="generating-screen">
      <div className="pulse-stack">
        <Loader2 className="spin" size={36} />
        <Sparkles size={22} />
      </div>
      <h2>Generating your question paper</h2>
      <p>{status || 'Preparing structured prompt and background job state...'}</p>
      <div className="progress-rail">
        <span />
      </div>
    </section>
  );
}

function OutputPage({
  assignment,
  pdfUrl,
  isGenerating,
  onBack,
  onRegenerate,
}: {
  assignment: AssignmentResult;
  pdfUrl: string | null;
  isGenerating: boolean;
  onBack: () => void;
  onRegenerate: () => void;
}) {
  return (
    <section className="output-screen">
      <div className="paper-actionbar">
        <button className="ghost-button" onClick={onBack}>
          <ArrowLeft size={15} />
          Edit
        </button>
        <div>
          <strong>{assignment.title}</strong>
          <span>{assignment.sections.length} sections ready</span>
        </div>
        <div className="action-cluster">
          <button className="ghost-button" onClick={onRegenerate} disabled={isGenerating}>
            <RefreshCcw size={15} />
            Regenerate
          </button>
          {pdfUrl && (
            <a className="dark-button" href={pdfUrl} target="_blank" rel="noreferrer">
              <Download size={15} />
              PDF
            </a>
          )}
        </div>
      </div>

      <article className="exam-paper">
        <header className="paper-header">
          <h2>{assignment.institution}</h2>
          <p>{assignment.title}</p>
          <div className="paper-meta">
            <span>{assignment.subject}</span>
            <span>{assignment.classLevel}</span>
            <span>Time: {assignment.durationMinutes} min</span>
            <span>Maximum Marks: {assignment.totalMarks}</span>
          </div>
        </header>

        <section className="student-info">
          <span>Name: ______________________________</span>
          <span>Roll Number: __________________</span>
          <span>Section: __________</span>
        </section>

        {assignment.sections.map((section, sectionIndex) => (
          <section className="question-section" key={`${section.title}-${sectionIndex}`}>
            <div className="section-title-row">
              <div>
                <p>Section {String.fromCharCode(65 + sectionIndex)}</p>
                <h3>{section.title}</h3>
              </div>
              <span>{section.instruction}</span>
            </div>
            <ol>
              {section.questions.map((question, index) => (
                <li key={question.id}>
                  <div>
                    <p>{question.text}</p>
                    <DifficultyBadge difficulty={question.difficulty} />
                  </div>
                  <strong>{question.marks} Marks</strong>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </article>
    </section>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return <span className={`difficulty ${difficulty.toLowerCase()}`}>{difficulty}</span>;
}
