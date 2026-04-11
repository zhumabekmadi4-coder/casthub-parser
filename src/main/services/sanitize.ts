/**
 * Text sanitizer — applied to all incoming Telegram messages
 * BEFORE any processing (AI, SQLite, queue).
 *
 * Cleans: whitespace, special chars, SQL injection patterns,
 * prompt injection patterns, invisible Unicode.
 */

export function sanitizeText(text: string): string {
  let cleaned = text;

  // === Unicode / invisible characters ===
  // Remove zero-width chars (ZWS, ZWNJ, ZWJ, BOM, etc.)
  cleaned = cleaned.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, "");
  // Remove other invisible control chars (except newline, tab)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // === Whitespace normalization ===
  // Replace tabs with spaces
  cleaned = cleaned.replace(/\t/g, " ");
  // Collapse multiple spaces into one (preserve newlines)
  cleaned = cleaned.replace(/ {2,}/g, " ");
  // Collapse 3+ consecutive newlines into 2
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  // Trim each line
  cleaned = cleaned
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

  // === Special characters that could be used for injection ===
  // Remove curly braces (JSON injection)
  cleaned = cleaned.replace(/[{}]/g, "");
  // Remove square brackets (JSON/array injection)
  cleaned = cleaned.replace(/[\[\]]/g, "");
  // Remove backticks (code injection, markdown)
  cleaned = cleaned.replace(/`/g, "'");
  // Remove backslashes (escape sequences)
  cleaned = cleaned.replace(/\\/g, "/");

  // === SQL injection patterns ===
  cleaned = cleaned.replace(/;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|EXEC)\b/gi, ";");
  cleaned = cleaned.replace(/'\s*(OR|AND)\s+'?\d*\s*=\s*'?\d*/gi, "");
  cleaned = cleaned.replace(/--\s/g, "— "); // SQL comments → em-dash
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, ""); // C-style comments

  // === Prompt injection patterns ===
  cleaned = cleaned.replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, "");
  cleaned = cleaned.replace(/disregard\s+(all\s+)?(previous|above|prior)/gi, "");
  cleaned = cleaned.replace(/you\s+are\s+now\s+/gi, "");
  cleaned = cleaned.replace(/new\s+instructions?:/gi, "");
  cleaned = cleaned.replace(/system\s*prompt:/gi, "");
  cleaned = cleaned.replace(/\brole\s*:\s*(system|assistant|user)\b/gi, "");
  // XML/HTML injection
  cleaned = cleaned.replace(/<\/?(?:system|instruction|prompt|script|img|iframe|svg|object|embed)[^>]*>/gi, "");

  // === Final cleanup ===
  // Collapse any double-spaces that appeared after removals
  cleaned = cleaned.replace(/ {2,}/g, " ");
  cleaned = cleaned.trim();

  return cleaned;
}
