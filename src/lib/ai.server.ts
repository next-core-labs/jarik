/**
 * The AI model behind rent suggestions, ad text, the assistant, WhatsApp triage and voice-note
 * transcription — any OpenAI-compatible `/chat/completions` endpoint, chosen by three settings:
 *
 *   AI_API_KEY   (required — the features fall back or switch off without it)
 *   AI_BASE_URL  (default: Google Gemini's OpenAI-compatible endpoint)
 *   AI_MODEL     (default: gemini-2.5-flash — the model these prompts were written for)
 *
 * Voice transcription sends audio parts (`input_audio`), so the chosen model must accept audio.
 */
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-2.5-flash";

export function aiKey(): string | null {
  return process.env["AI_API_KEY"] || null;
}

export function aiChatUrl(): string {
  return `${(process.env["AI_BASE_URL"] || DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
}

export function aiModel(): string {
  return process.env["AI_MODEL"] || DEFAULT_MODEL;
}
