import dotenv from 'dotenv';
import fs from 'fs';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import OpenAI from 'openai';
import path from 'path';
import puppeteer from 'puppeteer';
import type { Server } from 'socket.io';
import { Assignment } from '../models/Assignment';

dotenv.config();

export const redis = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  maxRetriesPerRequest: null,
});

export const assignmentQueue = new Queue('assignment-queue', { connection: redis as any });

type Difficulty = 'Easy' | 'Moderate' | 'Hard';

type AssignmentRequest = {
  title: string;
  subject: string;
  classLevel: string;
  dueDate: string;
  totalMarks: number;
  durationMinutes: number;
  questionTypes: { id: string; label: string; count: number; marks: number }[];
  instructions?: string;
};

type GeneratedQuestion = {
  id: string;
  text: string;
  difficulty: Difficulty;
  marks: number;
};

type GeneratedResult = {
  title: string;
  institution: string;
  subject: string;
  classLevel: string;
  dueDate: string;
  totalMarks: number;
  durationMinutes: number;
  sections: {
    title: string;
    instruction: string;
    questions: GeneratedQuestion[];
  }[];
};

const llmApiKey = process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY;
const llmBaseUrl = process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1';
const llmModel = process.env.LLM_MODEL || 'openrouter/free';

const client =
  llmApiKey &&
  new OpenAI({
    apiKey: llmApiKey,
    baseURL: llmBaseUrl,
    defaultHeaders: {
      'HTTP-Referer': process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
      'X-Title': 'VedaAI Assignment Generator',
    },
  });

function buildStructuredPrompt(request: AssignmentRequest, extractedText: string) {
  const expectedShape = {
    title: 'string',
    institution: 'Delhi Public School, Sector-4, Bokaro',
    subject: 'string',
    classLevel: 'string',
    dueDate: 'YYYY-MM-DD',
    totalMarks: 50,
    durationMinutes: 45,
    sections: [
      {
        title: 'Section A - Short Answer',
        instruction: 'Attempt all questions',
        questions: [{ id: 'A1', text: 'Question text', difficulty: 'Easy | Moderate | Hard', marks: 2 }],
      },
    ],
  };

  return [
    'You are an expert K-12 exam paper setter.',
    'Return only valid JSON. Do not include markdown or commentary.',
    'Create a polished assignment paper with grouped sections A, B, C based on the requested question types.',
    'Each question must have text, difficulty, and marks. Do not exceed the configured counts.',
    `Expected JSON shape: ${JSON.stringify(expectedShape)}`,
    `Assignment request: ${JSON.stringify(request)}`,
    `Source material: ${extractedText || 'No source material uploaded.'}`,
  ].join('\n\n');
}

function parseJsonObject(text: string) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('LLM returned no JSON object');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function generateWithLlm(request: AssignmentRequest, extractedText: string) {
  if (!client) return null;

  const response = await client.chat.completions.create({
    model: llmModel,
    messages: [
      {
        role: 'system',
        content:
          'You transform teacher requirements into structured exam papers. Output only parseable JSON.',
      },
      { role: 'user', content: buildStructuredPrompt(request, extractedText) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.4,
  });

  return parseJsonObject(response.choices[0]?.message?.content || '{}');
}

function normalizeDifficulty(value: unknown, index: number): Difficulty {
  const text = String(value || '').toLowerCase();
  if (text.includes('hard')) return 'Hard';
  if (text.includes('moderate') || text.includes('medium')) return 'Moderate';
  if (text.includes('easy')) return 'Easy';
  return index % 3 === 0 ? 'Easy' : index % 3 === 1 ? 'Moderate' : 'Hard';
}

function fallbackResult(request: AssignmentRequest): GeneratedResult {
  return {
    title: request.title,
    institution: 'Delhi Public School, Sector-4, Bokaro',
    subject: request.subject,
    classLevel: request.classLevel,
    dueDate: request.dueDate,
    totalMarks: request.totalMarks,
    durationMinutes: request.durationMinutes,
    sections: request.questionTypes.map((type, sectionIndex) => ({
      title: `Section ${String.fromCharCode(65 + sectionIndex)} - ${type.label}`,
      instruction: type.label.toLowerCase().includes('multiple')
        ? 'Choose the correct option.'
        : 'Attempt all questions.',
      questions: Array.from({ length: type.count }, (_, questionIndex) => ({
        id: `${String.fromCharCode(65 + sectionIndex)}${questionIndex + 1}`,
        text: `Explain ${request.subject} concept ${questionIndex + 1} from "${request.title}" with a clear example.`,
        difficulty: normalizeDifficulty(null, questionIndex),
        marks: type.marks,
      })),
    })),
  };
}

function normalizeResult(raw: unknown, request: AssignmentRequest): GeneratedResult {
  const fallback = fallbackResult(request);
  const source = raw && typeof raw === 'object' ? (raw as Partial<GeneratedResult>) : {};
  const rawSections = Array.isArray(source.sections) ? source.sections : fallback.sections;

  const sections = rawSections.map((section: any, sectionIndex: number) => {
    const type = request.questionTypes[sectionIndex] || request.questionTypes[0];
    const questions = Array.isArray(section.questions) ? section.questions : [];
    const normalizedQuestions = questions.slice(0, type.count).map((question: any, questionIndex: number) => ({
      id: String(question.id || `${String.fromCharCode(65 + sectionIndex)}${questionIndex + 1}`),
      text: String(question.text || fallback.sections[sectionIndex]?.questions[questionIndex]?.text || '').trim(),
      difficulty: normalizeDifficulty(question.difficulty, questionIndex),
      marks: Math.max(1, Number(question.marks || type.marks)),
    }));

    while (normalizedQuestions.length < type.count) {
      normalizedQuestions.push(fallback.sections[sectionIndex].questions[normalizedQuestions.length]);
    }

    return {
      title: String(section.title || fallback.sections[sectionIndex]?.title || `Section ${sectionIndex + 1}`),
      instruction: String(section.instruction || section.instructions || fallback.sections[sectionIndex]?.instruction),
      questions: normalizedQuestions,
    };
  });

  return {
    title: String(source.title || request.title),
    institution: String(source.institution || 'Delhi Public School, Sector-4, Bokaro'),
    subject: String(source.subject || request.subject),
    classLevel: String(source.classLevel || request.classLevel),
    dueDate: String(source.dueDate || request.dueDate),
    totalMarks: Number(source.totalMarks || request.totalMarks),
    durationMinutes: Number(source.durationMinutes || request.durationMinutes),
    sections,
  };
}

function escapeHtml(value: string | number) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderPdfHtml(result: GeneratedResult) {
  return `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; color: #111; padding: 36px; }
          .header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 14px; }
          .header h1 { font-size: 18px; margin: 0 0 8px; text-transform: uppercase; }
          .meta { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; font-size: 12px; }
          .student { display: flex; justify-content: space-between; gap: 12px; margin: 24px 0; font-weight: bold; font-size: 12px; }
          .section { margin-top: 24px; }
          .section-head { display: flex; justify-content: space-between; border-bottom: 1px solid #ddd; padding-bottom: 7px; }
          .section h2 { font-size: 15px; margin: 0; text-transform: uppercase; }
          .section em { font-size: 12px; color: #555; }
          .question { display: flex; gap: 18px; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
          .question p { margin: 0 0 5px; font-size: 12px; line-height: 1.45; }
          .badge { display: inline-block; border-radius: 999px; padding: 3px 8px; background: #f1f1f1; font-size: 9px; font-weight: bold; text-transform: uppercase; }
          .marks { white-space: nowrap; font-size: 12px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${escapeHtml(result.institution)}</h1>
          <div><strong>${escapeHtml(result.title)}</strong></div>
          <div class="meta">
            <span>${escapeHtml(result.subject)}</span>
            <span>${escapeHtml(result.classLevel)}</span>
            <span>Time: ${escapeHtml(result.durationMinutes)} min</span>
            <span>Maximum Marks: ${escapeHtml(result.totalMarks)}</span>
          </div>
        </div>
        <div class="student">
          <span>Name: __________________________</span>
          <span>Roll Number: __________________</span>
          <span>Section: ________</span>
        </div>
        ${result.sections
          .map(
            (section) => `
              <div class="section">
                <div class="section-head">
                  <h2>${escapeHtml(section.title)}</h2>
                  <em>${escapeHtml(section.instruction)}</em>
                </div>
                ${section.questions
                  .map(
                    (question, index) => `
                      <div class="question">
                        <div>
                          <p><strong>Q${index + 1}.</strong> ${escapeHtml(question.text)}</p>
                          <span class="badge">${escapeHtml(question.difficulty)}</span>
                        </div>
                        <div class="marks">${escapeHtml(question.marks)} Marks</div>
                      </div>
                    `,
                  )
                  .join('')}
              </div>
            `,
          )
          .join('')}
      </body>
    </html>
  `;
}

async function updateStatus(io: Server, jobId: string, message: string) {
  await redis.set(`assignment:${jobId}:state`, JSON.stringify({ status: 'processing', message }), 'EX', 60 * 60);
  io.to(jobId).emit('job-status', { status: 'processing', message });
}

export function initializeAssignmentWorker(io: Server) {
  return new Worker(
    'assignment-queue',
    async (job) => {
      const { jobId, request, extractedText } = job.data as {
        jobId: string;
        request: AssignmentRequest;
        extractedText: string;
      };

      await updateStatus(io, jobId, 'Converting inputs into a structured prompt...');
      await Assignment.updateOne({ jobId }, { status: 'processing' });

      await updateStatus(io, jobId, 'Generating sections, marks, and difficulty tags...');
      const raw = await generateWithLlm(request, extractedText);
      const result = normalizeResult(raw, request);

      await updateStatus(io, jobId, 'Formatting question paper PDF...');
      const pdfFilename = `${jobId}.pdf`;
      const pdfDir = path.join(process.cwd(), 'pdfs');
      const pdfPath = path.join(pdfDir, pdfFilename);
      fs.mkdirSync(pdfDir, { recursive: true });

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setContent(renderPdfHtml(result), { waitUntil: 'load' });
      await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
      await browser.close();

      const baseUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 8080}`;
      const pdfUrl = `${baseUrl}/downloads/${pdfFilename}`;

      await Assignment.updateOne({ jobId }, { status: 'completed', resultData: result, pdfUrl });
      await redis.set(
        `assignment:${jobId}:state`,
        JSON.stringify({ status: 'completed', message: 'Completed', pdfUrl }),
        'EX',
        60 * 60,
      );

      io.to(jobId).emit('job-complete', { status: 'completed', data: result, pdfUrl });
      return result;
    },
    { connection: redis as any },
  ).on('failed', async (job, error) => {
    const jobId = job?.data?.jobId;
    if (!jobId) return;
    await Assignment.updateOne({ jobId }, { status: 'failed', error: error.message });
    await redis.set(
      `assignment:${jobId}:state`,
      JSON.stringify({ status: 'failed', message: error.message }),
      'EX',
      60 * 60,
    );
    io.to(jobId).emit('job-failed', { status: 'failed', message: error.message });
  });
}
