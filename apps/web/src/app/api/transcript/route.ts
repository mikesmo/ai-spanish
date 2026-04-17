import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // Read the JSON file from the public directory
    const jsonPath = path.join(process.cwd(), 'public', 'transcript.json');
    const fileContent = fs.readFileSync(jsonPath, 'utf8');
    
    // Parse the JSON content
    const phrases = JSON.parse(fileContent);
    
    // Return the JSON response
    return NextResponse.json(phrases);
  } catch (error) {
    console.error('Error reading transcript data:', error);
    return NextResponse.json(
      { error: 'Failed to load phrases' },
      { status: 500 }
    );
  }
}