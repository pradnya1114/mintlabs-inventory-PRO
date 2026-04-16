import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const EXPORTS_DIR = path.join(process.cwd(), 'app', 'exports');

export async function GET() {
  try {
    try {
      await fs.access(EXPORTS_DIR);
    } catch {
      return NextResponse.json({ exports: [] });
    }
    
    const files = await fs.readdir(EXPORTS_DIR);
    const csvFiles = files.filter(f => f.endsWith('.csv')).sort().reverse();
    
    return NextResponse.json({ exports: csvFiles });
  } catch (error) {
    console.error('Failed to list exports:', error);
    return NextResponse.json({ exports: [] });
  }
}
