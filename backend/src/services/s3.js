import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { extname } from "path";

const s3 = new S3Client({
  region: process.env.S3_REGION || "eu-central-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.S3_BUCKET || "smart-omni-uploads";

/**
 * Upload buffer do S3
 * @returns {{ key: string, url: string }}
 */
export async function uploadToS3(buffer, originalFilename, mimeType) {
  const ext = extname(originalFilename) || ".bin";
  const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    Metadata: { "original-name": encodeURIComponent(originalFilename) },
  }));

  console.log(`☁️ [S3] Uploaded: ${key} (${(buffer.length / 1024).toFixed(1)} KB)`);

  return { key, bucket: BUCKET };
}

/**
 * Generuj tymczasowy signed URL do pobrania (ważny 1h)
 */
export async function getSignedDownloadUrl(key) {
  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }), { expiresIn: 3600 });
  return url;
}

/**
 * Pobierz plik z S3 jako buffer
 */
export async function downloadFromS3(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Usuń plik z S3
 */
export async function deleteFromS3(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
