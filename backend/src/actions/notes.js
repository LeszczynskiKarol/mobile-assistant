import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const NOTES_DIR = join(process.cwd(), 'data', 'notes');

async function ensureDir() {
  if (!existsSync(NOTES_DIR)) {
    await mkdir(NOTES_DIR, { recursive: true });
  }
}

/**
 * Zapisz notatkę jako JSON
 */
export async function createNote({ text, tags, date }) {
  await ensureDir();

  const note = {
    id: Date.now().toString(36),
    text,
    tags: tags || [],
    date: date || null,
    createdAt: new Date().toISOString()
  };

  const filename = `${note.id}.json`;
  await writeFile(join(NOTES_DIR, filename), JSON.stringify(note, null, 2));

  // Dodaj do indeksu
  const indexPath = join(NOTES_DIR, 'index.json');
  let index = [];
  try {
    const raw = await readFile(indexPath, 'utf-8');
    index = JSON.parse(raw);
  } catch {}

  index.push({ id: note.id, text: text.slice(0, 100), tags: note.tags, createdAt: note.createdAt });
  await writeFile(indexPath, JSON.stringify(index, null, 2));

  return { id: note.id, saved: true };
}
