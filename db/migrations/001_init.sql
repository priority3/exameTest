-- MVP schema for the AI testing platform.
-- Notes:
-- - Uses pgvector for embeddings (default dim=1536 for OpenAI text-embedding-3-small).
-- - Stores most flexible fields as jsonb to keep iteration speed high.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_type') THEN
    CREATE TYPE source_type AS ENUM ('PASTE', 'MARKDOWN_UPLOAD', 'URL', 'GITHUB');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_status') THEN
    CREATE TYPE source_status AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'paper_status') THEN
    CREATE TYPE paper_status AS ENUM ('DRAFT', 'READY', 'FAILED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'question_type') THEN
    CREATE TYPE question_type AS ENUM ('MCQ', 'SHORT_ANSWER');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attempt_status') THEN
    CREATE TYPE attempt_status AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'GRADED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type source_type NOT NULL,
  title TEXT NOT NULL,
  status source_status NOT NULL DEFAULT 'PENDING',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL, -- e.g. ARTICLE | GITHUB_FILE
  uri TEXT,
  content_hash TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_md TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_source_id ON documents(source_id);
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);

CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  text TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id UUID PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  embedding VECTOR(1536) NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Note: For small datasets you can skip ivfflat; add it later when you have scale.
-- CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_ivfflat
--   ON chunk_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status paper_status NOT NULL DEFAULT 'DRAFT',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_papers_source_id ON papers(source_id);

CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  type question_type NOT NULL,
  difficulty INT NOT NULL,
  prompt TEXT NOT NULL,
  options JSONB, -- MCQ only
  answer_key JSONB NOT NULL DEFAULT '{}'::jsonb,
  rubric JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_questions_paper_id ON questions(paper_id);

CREATE TABLE IF NOT EXISTS question_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  snippet TEXT,
  relevance REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_question_citations_question_id ON question_citations(question_id);

CREATE TABLE IF NOT EXISTS attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status attempt_status NOT NULL DEFAULT 'IN_PROGRESS',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  graded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_attempts_paper_id ON attempts(paper_id);

CREATE TABLE IF NOT EXISTS answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_text TEXT,
  answer_option_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_attempt_id ON answers(attempt_id);

CREATE TABLE IF NOT EXISTS grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  score NUMERIC NOT NULL,
  max_score NUMERIC NOT NULL,
  verdict JSONB NOT NULL DEFAULT '{}'::jsonb,
  feedback_md TEXT NOT NULL DEFAULT '',
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_grades_attempt_id ON grades(attempt_id);

CREATE TABLE IF NOT EXISTS wrong_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  last_wrong_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  wrong_count INT NOT NULL DEFAULT 1,
  weak_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(user_id, question_id)
);

