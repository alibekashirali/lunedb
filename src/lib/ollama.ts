import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Generic streaming generator — reused by both Wiki and Chat
export async function* streamOllama(
  prompt: string,
  model: string
): AsyncGenerator<string> {
  const tokens: string[] = [];
  let done = false;
  let streamError: string | null = null;
  let notify: (() => void) | null = null;

  const signal = () => { if (notify) { notify(); notify = null; } };
  const wait = () => new Promise<void>((res) => { notify = res; });

  const unlisten1 = await listen<string>("ollama-token", (e) => {
    tokens.push(e.payload);
    signal();
  });
  const unlisten2 = await listen<string>("ollama-done", () => {
    done = true;
    signal();
  });

  invoke<void>("stream_docs", { model, prompt }).catch((err) => {
    streamError = String(err);
    done = true;
    signal();
  });

  try {
    while (true) {
      if (tokens.length > 0) {
        yield tokens.shift()!;
      } else if (done) {
        while (tokens.length > 0) yield tokens.shift()!;
        break;
      } else {
        await wait();
      }
    }
  } finally {
    unlisten1();
    unlisten2();
  }

  if (streamError) throw new Error(streamError);
}

// ── Wiki docs ─────────────────────────────────────────────────────────────────

const DOCS_PROMPT = (tableName: string, ddl: string) =>
  `You are a database documentation expert. Write clear, concise documentation in Markdown format for the following PostgreSQL table.

Rules:
- Write raw Markdown directly. Do NOT wrap your response in a code fence or \`\`\`markdown block.
- Start immediately with the first heading.

Include:
1. **Overview** — what this table stores and its business purpose
2. **Key Columns** — description of the most important columns
3. **Business Rules** — any constraints or logic implied by the schema
4. **Relationships** — foreign keys or implied relationships to other tables

Table: \`${tableName}\`

\`\`\`sql
${ddl}
\`\`\`

Documentation:`;

export async function* streamDocumentation(
  tableName: string,
  ddl: string,
  model: string
): AsyncGenerator<string> {
  yield* streamOllama(DOCS_PROMPT(tableName, ddl), model);
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export interface SchemaColumn {
  name: string;
  type: string;
  isPk?: boolean;
}

export interface SchemaContext {
  name: string;       // "schema.table"
  columns: SchemaColumn[];
}

// Cap the number of tables included in the prompt to avoid huge context windows.
const SCHEMA_PROMPT_TABLE_LIMIT = 40;

export function buildChatPrompt(
  question: string,
  schema: SchemaContext[]
): string {
  const capped = schema.slice(0, SCHEMA_PROMPT_TABLE_LIMIT);
  const truncated = schema.length > SCHEMA_PROMPT_TABLE_LIMIT;

  const tables = capped
    .map((t) => {
      const cols = t.columns.map((c) => `${c.name} ${c.type}${c.isPk ? " PK" : ""}`).join(", ");
      return `- ${t.name} (${cols})`;
    })
    .join("\n");

  const schemaNote = truncated
    ? `\n(${schema.length - SCHEMA_PROMPT_TABLE_LIMIT} additional tables not shown)`
    : "";

  return `You are a PostgreSQL expert assistant. The user has the following database schema:

${tables}${schemaNote}

Answer the user's question concisely. If the question requires data retrieval, write a clean PostgreSQL query in a \`\`\`sql code block. Keep explanations short.

User: ${question}
Assistant:`;
}
