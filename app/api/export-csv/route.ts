import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const EXPORTS_DIR = path.join(process.cwd(), 'app', 'exports');

async function ensureExportsDir() {
  try {
    await fs.access(EXPORTS_DIR);
  } catch {
    await fs.mkdir(EXPORTS_DIR, { recursive: true });
  }
}

export async function POST(request: Request) {
  try {
    const { csvContent, fileName } = await request.json();
    await ensureExportsDir();
    
    const filePath = path.join(EXPORTS_DIR, fileName || `inventory_export_${Date.now()}.csv`);
    await fs.writeFile(filePath, csvContent);
    
    return NextResponse.json({ success: true, path: filePath });
  } catch (error) {
    console.error('Failed to save CSV:', error);
    return NextResponse.json({ success: false, error: 'Failed to save CSV' }, { status: 500 });
  }
}
