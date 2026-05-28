import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import { Server } from 'socket.io';
import { Assignment } from './models/Assignment';
import { assignmentQueue, initializeAssignmentWorker, redis } from './worker/queue';

dotenv.config();

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
export const io = new Server(server, {
  cors: { origin: allowedOrigin, methods: ['GET', 'POST'] },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'text/plain'];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.txt')) cb(null, true);
    else cb(new Error('Only PDF and text files are supported'));
  },
});

app.use(cors({ origin: allowedOrigin }));
app.use(express.json());
app.use('/downloads', express.static(path.join(process.cwd(), 'pdfs')));

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

function parseAssignment(body: Record<string, unknown>): AssignmentRequest | null {
  if (!body.assignment || typeof body.assignment !== 'string') return null;

  try {
    const parsed = JSON.parse(body.assignment) as AssignmentRequest;
    if (!parsed.title || !parsed.subject || !parsed.classLevel || !parsed.dueDate) return null;
    if (!Number.isFinite(Number(parsed.totalMarks)) || Number(parsed.totalMarks) <= 0) return null;
    if (!Number.isFinite(Number(parsed.durationMinutes)) || Number(parsed.durationMinutes) <= 0) return null;
    if (!Array.isArray(parsed.questionTypes) || parsed.questionTypes.length === 0) return null;

    const hasInvalidType = parsed.questionTypes.some(
      (item) => !item.label || Number(item.count) <= 0 || Number(item.marks) <= 0,
    );
    if (hasInvalidType) return null;

    return {
      ...parsed,
      totalMarks: Number(parsed.totalMarks),
      durationMinutes: Number(parsed.durationMinutes),
      questionTypes: parsed.questionTypes.map((item) => ({
        id: item.id,
        label: item.label,
        count: Number(item.count),
        marks: Number(item.marks),
      })),
    };
  } catch {
    return null;
  }
}

function extractText(file?: Express.Multer.File) {
  if (!file) return '';
  if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) {
    return file.buffer.toString('utf-8').slice(0, 12000);
  }

  return `PDF uploaded: ${file.originalname}. Add a PDF parser such as pdf-parse if full PDF text extraction is required in production.`;
}

app.get('/health', async (_req, res) => {
  const redisStatus = redis.status;
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({ ok: true, redis: redisStatus, mongo: mongoStatus });
});

app.get('/api/assignments/:jobId', async (req, res) => {
  const assignment = await Assignment.findOne({ jobId: req.params.jobId }).lean();
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  return res.json(assignment);
});

app.post('/api/generate', upload.single('contextFile'), async (req, res) => {
  const request = parseAssignment(req.body);
  if (!request) {
    return res.status(400).json({ error: 'Invalid assignment details. Check required fields and positive values.' });
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const extractedText = extractText(req.file);

  await redis.set(
    `assignment:${jobId}:state`,
    JSON.stringify({ status: 'pending', message: 'Queued for generation' }),
    'EX',
    60 * 60,
  );

  await Assignment.create({
    jobId,
    status: 'pending',
    request,
    source: {
      fileName: req.file?.originalname,
      mimeType: req.file?.mimetype,
      extractedText,
    },
  });

  await assignmentQueue.add(
    'generate-assignment',
    { jobId, request, extractedText },
    { attempts: 2, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 50, removeOnFail: 100 },
  );

  return res.status(202).json({ jobId, status: 'queued' });
});

io.on('connection', (socket) => {
  socket.on('join-job-room', (jobId: string) => {
    socket.join(jobId);
  });
});

async function start() {
  const port = Number(process.env.PORT || 8080);
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vedaai';

  await mongoose.connect(mongoUri);
  initializeAssignmentWorker(io);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error('Unable to start server', error);
  process.exit(1);
});
