import { processFile } from "../services/fileProcessor.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 5;

const ALLOWED_TYPES = new Set([
  // Documents
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** @param {import('fastify').FastifyInstance} app */
export async function uploadRoutes(app) {
  // POST /api/upload — upload plików, przetworzenie, zwrócenie wyników
  // Multipart form: files[] (max 5 plików, max 20MB each)
  app.post("/upload", async (req, reply) => {
    const parts = req.parts();
    const results = [];
    let fileCount = 0;

    for await (const part of parts) {
      if (part.type !== "file" || !part.filename) continue;

      fileCount++;
      if (fileCount > MAX_FILES) {
        return reply.code(400).send({ error: `Maksymalnie ${MAX_FILES} plików` });
      }

      const mimeType = part.mimetype || "application/octet-stream";
      if (!ALLOWED_TYPES.has(mimeType)) {
        console.log(`⚠️ [UPLOAD] Odrzucono: ${part.filename} (${mimeType})`);
        results.push({
          filename: part.filename,
          error: `Nieobsługiwany format: ${mimeType}`,
          processingMethod: "rejected",
        });
        continue;
      }

      // Zbierz buffer
      const chunks = [];
      let totalSize = 0;
      for await (const chunk of part.file) {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE) {
          return reply.code(400).send({ error: `Plik ${part.filename} przekracza ${MAX_FILE_SIZE / 1024 / 1024}MB` });
        }
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      console.log(`📎 [UPLOAD] ${part.filename} (${mimeType}, ${(buffer.length / 1024).toFixed(1)} KB)`);

      // Przetwórz plik (S3 + ekstrakcja)
      const processed = await processFile(buffer, part.filename, mimeType);
      results.push(processed);
    }

    if (results.length === 0) {
      return reply.code(400).send({ error: "Brak plików" });
    }

    return { files: results, count: results.length };
  });
}
