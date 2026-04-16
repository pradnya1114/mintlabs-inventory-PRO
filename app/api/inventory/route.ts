import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { InventoryData } from '@/lib/inventory';

const DATA_FILE = path.join(process.cwd(), 'app', 'data', 'inventory.json');

async function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function readData(): Promise<InventoryData> {
  try {
    await ensureDataDir();
    const content = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { items: [], requests: [], lastAction: 'System Initialized' };
  }
}

async function writeData(data: InventoryData) {
  await ensureDataDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

export async function GET() {
  const data = await readData();
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const data = await request.json();
  await writeData(data);
  return NextResponse.json({ success: true });
}
