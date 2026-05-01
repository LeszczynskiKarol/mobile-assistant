import Anthropic from "@anthropic-ai/sdk";
import { uploadToS3, getSignedDownloadUrl } from "./s3.js";

const client = new Anthropic();
const SCRAPER_URL = process.env.SCRAPER_URL;

// ── Format detection ──

const SCRAPER_FORMATS = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/msword", // doc
  "text/html",
]);

const IMAGE_FORMATS = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const TEXT_FORMATS = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "text/xml",
  "application/xml",
]);

/**
 * Przetwarza jeden plik:
 * 1. Upload do S3
 * 2. Detekcja formatu
 * 3. Ekstrakcja treści (scraper / vision / direct read)
 * @returns {{ s3Key, filename, mimeType, size, extractedText, visionDescription }}
 */
export async function processFile(buffer, filename, mimeType) {
  console.log(`📎 [FILE] Przetwarzam: ${filename} (${mimeType}, ${(buffer.length / 1024).toFixed(1)} KB)`);

  // 1. Upload do S3
  const { key } = await uploadToS3(buffer, filename, mimeType);

  const result = {
    s3Key: key,
    filename,
    mimeType,
    size: buffer.length,
    extractedText: null,
    visionDescription: null,
    processingMethod: null,
  };

  // 2. Route po formacie
  if (SCRAPER_FORMATS.has(mimeType)) {
    result.extractedText = await extractWithScraper(key);
    result.processingMethod = "scraper";
  } else if (IMAGE_FORMATS.has(mimeType)) {
    result.visionDescription = await extractWithVision(buffer, mimeType);
    result.processingMethod = "vision";
  } else if (TEXT_FORMATS.has(mimeType)) {
    result.extractedText = buffer.toString("utf-8").slice(0, 50000);
    result.processingMethod = "direct";
  } else {
    console.log(`⚠️ [FILE] Nieobsługiwany format: ${mimeType}`);
    result.processingMethod = "unsupported";
  }

  console.log(`✅ [FILE] ${filename} → ${result.processingMethod} (${(result.extractedText?.length || result.visionDescription?.length || 0)} znaków)`);
  return result;
}

// ── Scraper extraction (PDF, DOCX, DOC, HTML) ──

async function extractWithScraper(s3Key) {
  try {
    // Generuj signed URL żeby scraper mógł pobrać plik
    const signedUrl = await getSignedDownloadUrl(s3Key);

    console.log(`📄 [FILE→SCRAPER] Sending to scraper: ${s3Key}`);
    const res = await fetch(`${SCRAPER_URL}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: signedUrl }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      console.error(`❌ [FILE→SCRAPER] HTTP ${res.status}`);
      return `[Błąd scrapera: HTTP ${res.status}]`;
    }

    const data = await res.json();
    const text = (data.text || "").slice(0, 30000);
    console.log(`✅ [FILE→SCRAPER] Extracted ${text.length} chars`);
    return text;
  } catch (err) {
    console.error(`❌ [FILE→SCRAPER] ${err.message}`);
    return `[Błąd ekstrakcji: ${err.message}]`;
  }
}

// ── Claude Vision (images) ──

async function extractWithVision(buffer, mimeType) {
  try {
    console.log(`🖼️ [FILE→VISION] Analyzing image (${(buffer.length / 1024).toFixed(1)} KB)`);

    const base64 = buffer.toString("base64");
    const mediaType = mimeType; // image/png, image/jpeg, etc.

    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64,
            },
          },
          {
            type: "text",
            text: "Opisz szczegółowo co widzisz na tym obrazku. Jeśli to screenshot tekstu, zrzut ekranu, wykres, diagram lub dokument — wyodrębnij CAŁĄ widoczną treść. Jeśli to zdjęcie — opisz co przedstawia. Odpowiedź po polsku.",
          },
        ],
      }],
    });

    const description = response.content[0]?.text || "";
    console.log(`✅ [FILE→VISION] Got ${description.length} chars description`);
    return description;
  } catch (err) {
    console.error(`❌ [FILE→VISION] ${err.message}`);
    return `[Błąd analizy obrazu: ${err.message}]`;
  }
}

/**
 * Formatuje przetworzone pliki jako kontekst do prompta Claude
 */
export function formatFilesForPrompt(processedFiles) {
  if (!processedFiles?.length) return "";

  const parts = processedFiles.map((f, i) => {
    const header = `\n📎 Załącznik ${i + 1}: ${f.filename} (${f.mimeType})`;
    if (f.extractedText) return `${header}\n${f.extractedText}`;
    if (f.visionDescription) return `${header}\n[Opis obrazu]: ${f.visionDescription}`;
    return `${header}\n[Nieobsługiwany format]`;
  });

  return `\n\n---\nZAŁĄCZONE PLIKI:\n${parts.join("\n\n")}`;
}
