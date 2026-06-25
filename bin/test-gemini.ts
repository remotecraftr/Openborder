import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Simple environment loader to parse .env.local without external dependencies
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          const value = trimmed.slice(idx + 1).trim();
          process.env[key] = value;
        }
      }
    }
  }
}

async function testGemini() {
  loadEnv();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ Error: GEMINI_API_KEY is not defined in your environment or .env.local');
    console.error('Please create or update your .env.local file with:');
    console.error('GEMINI_API_KEY=your_api_key_here');
    process.exit(1);
  }

  // Mask the API key for security
  const maskedKey = apiKey.length > 8 
    ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
    : '***';

  console.log(`🔌 Initializing GoogleGenerativeAI client...`);
  console.log(`🔑 Using API Key: ${maskedKey}`);

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = 'gemini-2.5-flash';

  console.log(`🤖 Using model: ${modelName}`);
  console.log(`✉️ Sending test request: "Reply with exactly 'API Connection Successful!'"`);

  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent("Reply with exactly 'API Connection Successful!'");
    const responseText = result.response.text().trim();
    
    console.log('\n--- API Response ---');
    console.log(responseText);
    console.log('--------------------\n');

    if (responseText.includes('API Connection Successful!')) {
      console.log('✅ Gemini API Key test PASSED! Your API key works perfectly with gemini-2.5-flash.');
    } else {
      console.log('⚠️ Gemini API Key test completed, but response was unexpected.');
    }
  } catch (error: any) {
    console.error('❌ Gemini API Key test FAILED!');
    console.error('Error Details:', error.message || error);
    process.exit(1);
  }
}

testGemini();
