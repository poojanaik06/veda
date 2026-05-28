import mongoose from 'mongoose';

const questionTypeSchema = new mongoose.Schema(
  {
    id: String,
    label: String,
    count: Number,
    marks: Number,
  },
  { _id: false },
);

const assignmentSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    request: {
      title: String,
      subject: String,
      classLevel: String,
      dueDate: String,
      totalMarks: Number,
      durationMinutes: Number,
      questionTypes: [questionTypeSchema],
      instructions: String,
    },
    source: {
      fileName: String,
      mimeType: String,
      extractedText: String,
    },
    resultData: mongoose.Schema.Types.Mixed,
    pdfUrl: String,
    error: String,
  },
  { timestamps: true },
);

export const Assignment = mongoose.model('Assignment', assignmentSchema);
