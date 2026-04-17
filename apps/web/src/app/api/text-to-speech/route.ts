import { NextResponse } from 'next/server';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

// TTS Provider options
type TTSProvider = 'deepgram' | 'google' | 'murf';

// Language options
type Language = 'es' | 'en';

export async function POST(request: Request) {
  try {
    // Parse the request body
    const body = await request.json();
    const { 
      text, 
      provider = 'deepgram',
      language = 'es' // Default to Spanish
    } = body;

    if (!text) {
      return NextResponse.json({ error: 'Text parameter is required' }, { status: 400 });
    }
    
    // Choose TTS provider based on request
    switch (provider) {
      case 'google':
        return await useGoogleTTS(text, language);
      case 'murf':
        return await useMurfTTS(text, language);
      default:
        return await useDeepgramTTS(text, language);
    }
    
  } catch (error) {
    console.error('Error in text-to-speech API:', error);
    return NextResponse.json(
      { error: 'An error occurred while processing the text-to-speech request' },
      { status: 500 }
    );
  }
}

/**
 * Use Deepgram's TTS service
 */
async function useDeepgramTTS(text: string, language: Language = 'es') {
  // Set up API key
  const apiKey = process.env.DEEPGRAM_API_KEY;
  
  if (!apiKey) {
    return NextResponse.json({ error: 'DEEPGRAM_API_KEY not configured' }, { status: 500 });
  }
  
  // Choose the appropriate URL for Deepgram based on language
  const url = language === 'en'
    ? 'https://api.deepgram.com/v1/speak?model=aura-2-pandora-en'
    : 'https://api.deepgram.com/v1/speak?model=aura-2-agustina-es';
  // Set up headers and request configuration
  const headers = {
    Authorization: `Token ${apiKey}`,
    "Content-Type": "application/json",
  };
  
  const options = {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ text }),
  };
  
  // Make request to Deepgram API
  const response = await fetch(url, options);
  
  if (!response.ok) {
    console.error(`Deepgram API error: ${response.status} ${response.statusText}`);
    return NextResponse.json(
      { error: `Failed to generate speech: ${response.statusText}` },
      { status: response.status }
    );
  }
  
  // Get audio data
  const audioBuffer = await response.arrayBuffer();
  
  // Return audio data with appropriate headers
  return new NextResponse(audioBuffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.byteLength.toString(),
    },
  });
}

/**
 * Use Google's TTS service
 */
async function useGoogleTTS(text: string, language: Language = 'es') {
  // Check for Google credentials
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return NextResponse.json(
      { error: 'Google Cloud credentials not configured' },
      { status: 500 }
    );
  }

  try {
    // Create Google TTS client
    const client = new TextToSpeechClient();
    
    // Configure the request using the exact code provided
    const request = language === 'en'
      ? {
          input: { text },
          voice: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
          audioConfig: { audioEncoding: 'MP3' as const },
        }
      : {
          input: { text },
          voice: { languageCode: 'es-ES', name: 'es-ES-Wavenet-B' },
          audioConfig: { audioEncoding: 'MP3' as const },
        };

    // Generate speech
    const [response] = (await client.synthesizeSpeech(request)) as [{ audioContent?: Buffer | Uint8Array }, unknown, unknown];
    
    if (!response.audioContent) {
      return NextResponse.json(
        { error: 'Failed to generate speech with Google TTS' },
        { status: 500 }
      );
    }
    
    // Convert audio content to ArrayBuffer
    const audioBuffer = Buffer.from(response.audioContent as Buffer).buffer;
    
    // Return audio data with appropriate headers
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('Google TTS error:', error);
    return NextResponse.json(
      { error: 'Failed to generate speech with Google TTS' },
      { status: 500 }
    );
  }
}

/**
 * Use Murf's TTS service
 */
async function useMurfTTS(text: string, language: Language = 'es') {
  // Check for Murf API key
  const apiKey = process.env.MURF_API_KEY;
  
  if (!apiKey) {
    return NextResponse.json(
      { error: 'MURF_API_KEY not configured' },
      { status: 500 }
    );
  }
  
  try {
    // Choose the appropriate voice ID based on language
    const voiceId = language === 'en' ? 'en-AU-kylie' : 'es-ES-elvira';
    
    // Prepare request data using Murf API format exactly as in the example
    const requestData = {
      text: text,
      voiceId: voiceId
    };
    
    // Log the request data for debugging
    console.log('Murf API Request:', JSON.stringify(requestData));
    
    // Set up request configuration
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(requestData)
    };
    
    // Make request to Murf API
    const response = await fetch('https://api.murf.ai/v1/speech/generate', options);
    
    // Get response text for debugging
    const responseText = await response.text();
    
    if (!response.ok) {
      console.error(`Murf API error: ${response.status} ${response.statusText}`);
      console.error('Murf API error details:', responseText);
      return NextResponse.json(
        { error: `Failed to generate speech with Murf: ${response.statusText}` },
        { status: response.status }
      );
    }
    
    // Parse the response as JSON
    const responseData = JSON.parse(responseText);
    
    console.log('Murf API Response:', JSON.stringify(responseData, null, 2));
    
    // Access the audioFile (URL) from the response data
    if (!responseData.audioFile) {
      console.error('Murf API error: No audioFile URL in response', responseData);
      return NextResponse.json(
        { error: 'No audio file URL returned from Murf API' },
        { status: 500 }
      );
    }
    
    // Get the audio URL
    const audioUrl = responseData.audioFile;
    console.log('Murf Audio URL:', audioUrl);
    
    // Fetch the audio file from the URL
    const audioResponse = await fetch(audioUrl);
    
    if (!audioResponse.ok) {
      console.error(`Failed to fetch audio from URL: ${audioResponse.status} ${audioResponse.statusText}`);
      return NextResponse.json(
        { error: 'Failed to fetch audio file from URL' },
        { status: 500 }
      );
    }
    
    // Get audio data as ArrayBuffer
    const audioBuffer = await audioResponse.arrayBuffer();
    
    // Return audio data with appropriate headers
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('Murf TTS error:', error);
    return NextResponse.json(
      { error: 'Failed to generate speech with Murf' },
      { status: 500 }
    );
  }
}