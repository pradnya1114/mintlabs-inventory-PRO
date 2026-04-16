import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const EXPORTS_DIR = path.join(process.cwd(), 'app', 'exports');

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fileName = searchParams.get('file');
  
  if (!fileName) {
    return NextResponse.json({ error: 'File name required' }, { status: 400 });
  }
  
  try {
    const filePath = path.join(EXPORTS_DIR, fileName);
    const content = await fs.readFile(filePath);
    
    return new Response(content, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error('Failed to read export file:', error);
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
