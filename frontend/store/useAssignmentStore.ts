import { create } from 'zustand';

export type Difficulty = 'Easy' | 'Moderate' | 'Hard';

export type QuestionType = {
  id: string;
  label: string;
  count: number;
  marks: number;
};

export type AssignmentFormValues = {
  title: string;
  subject: string;
  classLevel: string;
  dueDate: string;
  totalMarks: number;
  durationMinutes: number;
  questionTypes: QuestionType[];
  instructions?: string;
};

export type GeneratedQuestion = {
  id: string;
  text: string;
  difficulty: Difficulty;
  marks: number;
};

export type GeneratedSection = {
  title: string;
  instruction: string;
  questions: GeneratedQuestion[];
};

export type AssignmentResult = {
  title: string;
  institution: string;
  subject: string;
  classLevel: string;
  dueDate: string;
  totalMarks: number;
  durationMinutes: number;
  sections: GeneratedSection[];
};

type Step = 'dashboard' | 'create' | 'generating' | 'output';

interface AssignmentState {
  activeStep: Step;
  isGenerating: boolean;
  statusMessage: string;
  jobId: string | null;
  assignmentData: AssignmentResult | null;
  pdfUrl: string | null;
  lastRequest: AssignmentFormValues | null;
  setStep: (step: Step) => void;
  startGeneration: (jobId: string, request: AssignmentFormValues) => void;
  setStatusMessage: (message: string) => void;
  setAssignmentData: (data: AssignmentResult, pdfUrl: string | null) => void;
  reset: () => void;
}

export const useAssignmentStore = create<AssignmentState>((set) => ({
  activeStep: 'dashboard',
  isGenerating: false,
  statusMessage: '',
  jobId: null,
  assignmentData: null,
  pdfUrl: null,
  lastRequest: null,
  setStep: (activeStep) => set({ activeStep }),
  startGeneration: (jobId, lastRequest) =>
    set({
      activeStep: 'generating',
      isGenerating: true,
      statusMessage: 'Queued for generation',
      jobId,
      lastRequest,
      assignmentData: null,
      pdfUrl: null,
    }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  setAssignmentData: (assignmentData, pdfUrl) =>
    set({
      activeStep: 'output',
      assignmentData,
      pdfUrl,
      isGenerating: false,
      statusMessage: 'Completed',
    }),
  reset: () =>
    set({
      activeStep: 'dashboard',
      isGenerating: false,
      statusMessage: '',
      jobId: null,
      assignmentData: null,
      pdfUrl: null,
    }),
}));
