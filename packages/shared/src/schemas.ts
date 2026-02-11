import { z } from "zod";

// ----------------------------
// Source ingest (MVP)
// ----------------------------

export const SourceTypeSchema = z.enum(["PASTE", "MARKDOWN_UPLOAD", "URL", "GITHUB"]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const CreateSourcePasteSchema = z.object({
  type: z.literal("PASTE"),
  title: z.string().min(1).max(200).optional(),
  text: z.string().min(1).max(200_000)
});

export const CreateSourceMarkdownUploadSchema = z.object({
  type: z.literal("MARKDOWN_UPLOAD"),
  title: z.string().min(1).max(200).optional(),
  md: z.string().min(1).max(200_000)
});

export const CreateSourceUrlSchema = z.object({
  type: z.literal("URL"),
  title: z.string().min(1).max(200).optional(),
  url: z.string().url()
});

// GitHub is planned; keep schema placeholder for now (MVP can skip implementation).
export const CreateSourceGithubSchema = z.object({
  type: z.literal("GITHUB"),
  title: z.string().min(1).max(200).optional(),
  repo: z.string().min(1).max(200), // "owner/repo"
  ref: z.string().min(1).max(200).optional(), // branch | tag | sha
  paths: z.array(z.string().min(1)).min(1).max(200)
});

export const CreateSourceRequestSchema = z.discriminatedUnion("type", [
  CreateSourcePasteSchema,
  CreateSourceMarkdownUploadSchema,
  CreateSourceUrlSchema,
  CreateSourceGithubSchema
]);
export type CreateSourceRequest = z.infer<typeof CreateSourceRequestSchema>;

// ----------------------------
// Paper config
// ----------------------------

export const PaperMixSchema = z.object({
  mcq: z.number().int().min(0).max(100),
  shortAnswer: z.number().int().min(0).max(100)
});

export const PaperConfigSchema = z.object({
  language: z.enum(["zh", "en"]).default("zh"),
  numQuestions: z.number().int().min(5).max(50).default(10),
  difficulty: z.number().int().min(1).max(3).default(2),
  mix: PaperMixSchema.default({ mcq: 60, shortAnswer: 40 })
});
export type PaperConfig = z.infer<typeof PaperConfigSchema>;

export const CreatePaperRequestSchema = z.object({
  sourceId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  config: PaperConfigSchema.optional()
});
export type CreatePaperRequest = z.infer<typeof CreatePaperRequestSchema>;

export const CreateAttemptRequestSchema = z.object({
  paperId: z.string().uuid()
});
export type CreateAttemptRequest = z.infer<typeof CreateAttemptRequestSchema>;

export const SubmitAttemptAnswerSchema = z.object({
  questionId: z.string().uuid(),
  optionId: z.enum(["A", "B", "C", "D"]).optional(),
  text: z.string().max(20_000).optional()
});

export const SubmitAttemptRequestSchema = z.object({
  answers: z.array(SubmitAttemptAnswerSchema).min(1).max(200)
});
export type SubmitAttemptRequest = z.infer<typeof SubmitAttemptRequestSchema>;

// ----------------------------
// LLM outputs: question generation
// ----------------------------

export const CitationSchema = z.object({
  chunkId: z.string().min(1),
  snippet: z.string().min(1).max(400).optional()
});

export const McqOptionSchema = z.object({
  id: z.enum(["A", "B", "C", "D"]),
  text: z.string().min(1).max(800)
});

const McqOptionsSchema = z.preprocess((val) => {
  // Many models return options as an object map instead of an array:
  // { "A": "...", "B": "...", "C": "...", "D": "..." }
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const o = val as any;
    const keys = ["A", "B", "C", "D"] as const;
    if (keys.every((k) => typeof o?.[k] === "string")) {
      return keys.map((k) => ({ id: k, text: String(o[k]) }));
    }
  }
  return val;
}, z.array(McqOptionSchema).length(4));

export const RubricPointSchema = z.preprocess((val) => {
  // Common alternates:
  // - { id, points, description } instead of { id, points, criteria }
  // - { id, points, text }
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const o = val as any;
    if (typeof o.criteria !== "string") {
      const alt =
        typeof o.description === "string"
          ? o.description
          : typeof o.criterion === "string"
            ? o.criterion
            : typeof o.text === "string"
              ? o.text
              : undefined;
      if (typeof alt === "string") {
        return { ...o, criteria: alt };
      }
    }
  }
  return val;
}, z.object({
  id: z.string().min(1).max(50),
  points: z.number().min(0).max(10),
  criteria: z.string().min(1).max(800)
}));

export const LlmMcqQuestionSchema = z.preprocess((val) => {
  // Common alternate field: `question` instead of `prompt`.
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const o = val as any;
    if (typeof o.prompt !== "string" && typeof o.question === "string") {
      return { ...o, prompt: o.question };
    }
  }
  return val;
}, z.object({
  type: z.literal("MCQ"),
  difficulty: z.number().int().min(1).max(3).default(2),
  prompt: z.string().min(1).max(2000),
  options: McqOptionsSchema,
  answerKey: z.enum(["A", "B", "C", "D"]),
  rationale: z.string().min(1).max(2000),
  tags: z.array(z.string().min(1).max(50)).min(1).max(20).default(["general"]),
  citations: z.array(CitationSchema).min(1).max(8)
}));

export const LlmShortAnswerQuestionSchema = z.preprocess((val) => {
  // Common alternate field: `question` instead of `prompt`.
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const o = val as any;
    if (typeof o.prompt !== "string" && typeof o.question === "string") {
      return { ...o, prompt: o.question };
    }
  }
  return val;
}, z.object({
  type: z.literal("SHORT_ANSWER"),
  difficulty: z.number().int().min(1).max(3).default(2),
  prompt: z.string().min(1).max(2000),
  referenceAnswer: z.string().min(1).max(3000),
  rubric: z.array(RubricPointSchema).min(1).max(10),
  tags: z.array(z.string().min(1).max(50)).min(1).max(20).default(["general"]),
  citations: z.array(CitationSchema).min(1).max(8)
}));

// NOTE: We intentionally use `z.union` (instead of `z.discriminatedUnion`)
// because some providers require preprocessing / coercion, which wraps schemas
// in effects and breaks `$ZodTypeDiscriminable` typing.
export const LlmQuestionSchema = z.union([LlmMcqQuestionSchema, LlmShortAnswerQuestionSchema]);

export const LlmPaperSchema = z.object({
  paperTitle: z.string().min(1).max(200),
  questions: z.array(LlmQuestionSchema).min(1).max(50)
});

// ----------------------------
// LLM outputs: grading
// ----------------------------

export const GradeHitPointSchema = z.object({
  rubricPointId: z.string().min(1).max(50),
  comment: z.string().min(1).max(800).optional()
});

export const LlmGradeSchema = z.preprocess((val) => {
  // Some models return a compact rubric breakdown instead of our MVP shape.
  // We normalize it to the fields our worker expects.
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const o = val as any;

    // Common alternate key.
    if (typeof o.maxScore !== "number" && typeof o.max_score === "number") {
      o.maxScore = o.max_score;
    }

    // Common alternate keys.
    if (!Array.isArray(o.actionableSuggestions) && Array.isArray(o.suggestions)) {
      o.actionableSuggestions = o.suggestions;
    }
    if (typeof o.suggestedAnswer !== "string" && typeof o.modelAnswer === "string") {
      o.suggestedAnswer = o.modelAnswer;
    }

    if (typeof o.feedbackMd !== "string") {
      if (typeof o.feedback === "string") {
        o.feedbackMd = o.feedback;
      } else if (Array.isArray(o.rubricBreakdown)) {
        const hitPoints: Array<{ rubricPointId: string; comment?: string }> = [];
        const missingPoints: string[] = [];

        const lines: string[] = [];
        if (typeof o.score === "number" && typeof o.maxScore === "number") {
          lines.push(`Score: ${o.score}/${o.maxScore}`);
          lines.push("");
        }
        lines.push("Rubric breakdown:");

        for (const item of o.rubricBreakdown) {
          const id = typeof item?.id === "string" ? item.id : "";
          const awarded = typeof item?.pointsAwarded === "number" ? item.pointsAwarded : 0;
          const possible = typeof item?.pointsPossible === "number" ? item.pointsPossible : 0;
          const evidence = typeof item?.evidence === "string" ? item.evidence.trim() : "";

          if (id) {
            if (awarded > 0) {
              hitPoints.push({ rubricPointId: id, comment: evidence || undefined });
            }
            if (possible > awarded) {
              missingPoints.push(`${id}: missing ${possible - awarded} point(s)`);
            }
          }

          const evidenceTail = evidence ? ` — ${evidence}` : "";
          const label = id ? `${id}: ` : "";
          lines.push(`- ${label}${awarded}/${possible}${evidenceTail}`.trim());
        }

        o.hitPoints = Array.isArray(o.hitPoints) ? o.hitPoints : hitPoints;
        o.missingPoints = Array.isArray(o.missingPoints) ? o.missingPoints : missingPoints;
        o.misconceptions = Array.isArray(o.misconceptions) ? o.misconceptions : [];
        o.actionableSuggestions = Array.isArray(o.actionableSuggestions) ? o.actionableSuggestions : [];
        o.feedbackMd = lines.join("\n").trim() || "No feedback.";
      }
    }
  }

  return val;
}, z.object({
  score: z.number().min(0),
  maxScore: z.number().min(0),
  hitPoints: z.array(GradeHitPointSchema).default([]),
  missingPoints: z.array(z.string().min(1).max(800)).default([]),
  misconceptions: z.array(z.string().min(1).max(800)).default([]),
  actionableSuggestions: z.array(z.string().min(1).max(800)).default([]),
  suggestedAnswer: z.string().min(1).max(4000).optional(),
  feedbackMd: z.string().min(1).max(4000),
  recommendedReviewChunkIds: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1).optional()
}));
