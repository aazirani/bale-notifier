import fs from "node:fs";
import path from "node:path";

export interface LocalStorageEntry {
  key: string;
  value: string;
}

const STORAGE_FILE = "local-storage.json";

export async function saveLocalStorage(
  entries: LocalStorageEntry[],
  dir: string,
): Promise<void> {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, STORAGE_FILE);
  const data = JSON.stringify({ entries }, null, 2);
  fs.writeFileSync(filePath, data, "utf-8");
}

export async function loadLocalStorage(
  dir: string,
): Promise<LocalStorageEntry[]> {
  const filePath = path.join(dir, STORAGE_FILE);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as { entries: LocalStorageEntry[] };
  return parsed.entries ?? [];
}
