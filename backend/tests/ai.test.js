import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeProjectBrief, respondToVoiceTurn, transcribeVoiceNote } from '../ai.js';

test('analyzes a project brief through an OpenAI-compatible provider', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer test-google-key');

    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gemini-2.5-flash');
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.messages[1].content.includes('Who are the first customers?'), true);

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            name: 'Helix Shop',
            description: 'A storefront for independent makers.',
            keyFeatures: ['Catalog', 'Checkout'],
            techStack: ['React', 'PostgreSQL'],
          }),
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const analysis = await analyzeProjectBrief(
      {
        name: 'Helix Shop',
        description: 'A storefront for independent makers.',
        conversation: [{ role: 'assistant', content: 'Who are the first customers?' }],
      },
      {
        aiProvider: 'google',
        aiApiKey: 'test-google-key',
        aiModel: 'gemini-2.5-flash',
        aiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      },
    );

    assert.ok(analysis.keyFeatures.includes('Catalog'));
    assert.ok(analysis.keyFeatures.includes('Checkout'));
    assert.ok(analysis.keyFeatures.length >= 4);
    assert.deepEqual(analysis.techStack, ['React', 'PostgreSQL']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('replaces feature sentences copied from the description', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      name: 'Maker Market',
      description: 'A marketplace for local makers where sellers can publish products and buyers can place orders.',
      keyFeatures: ['A marketplace for local makers where sellers can publish products and buyers can place orders.'],
      techStack: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Tailwind CSS'],
    }) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const analysis = await analyzeProjectBrief(
      { name: 'Maker Market', description: 'A marketplace for local makers where sellers can publish products and buyers can place orders.' },
      { aiProvider: 'xai', aiApiKey: 'test-key', aiModel: 'test-model', aiBaseUrl: 'https://api.example.com' },
    );

    assert.equal(analysis.keyFeatures[0], 'Primary user workflow');
    assert.equal(analysis.keyFeatures.some((feature) => feature.includes('marketplace for local makers')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transcribes a voice note through the configured Gemini provider', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=test-google-key');
    assert.equal(options.headers['content-type'], 'application/json');
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts[0].text.includes('Transcribe this voice note'), true);
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'audio/webm');

    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'We need a marketplace for local makers.' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const transcript = await transcribeVoiceNote(
      { audio: Buffer.from('voice-note'), mimeType: 'audio/webm' },
      {
        aiProvider: 'google',
        aiApiKey: 'test-google-key',
        aiModel: 'gemini-2.5-flash',
        googleAiModel: 'gemini-3.6-flash',
      },
    );

    assert.equal(transcript, 'We need a marketplace for local makers.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('responds to a voice turn with conversational context', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.example.com/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.messages.at(-1).content, 'We need a marketplace for local makers.');
    assert.equal(body.messages.at(-1).role, 'user');

    return new Response(JSON.stringify({
      choices: [{ message: { content: 'That sounds useful. Who are the first customers you want to serve?' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const reply = await respondToVoiceTurn(
      {
        name: 'Maker Market',
        messages: [{ role: 'user', content: 'We need a marketplace for local makers.' }],
      },
      {
        aiProvider: 'openai',
        aiApiKey: 'test-key',
        aiModel: 'test-model',
        aiBaseUrl: 'https://api.example.com',
      },
    );

    assert.equal(reply, 'That sounds useful. Who are the first customers you want to serve?');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps voice conversations moving when the provider is rate-limited', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 429 });

  try {
    const reply = await respondToVoiceTurn(
      { name: 'Maker Market', messages: [{ role: 'user', content: 'A marketplace for local makers.' }] },
      { aiProvider: 'openai', aiApiKey: 'test-key', aiModel: 'test-model', aiBaseUrl: 'https://api.example.com' },
    );

    assert.match(reply, /marketplace for local makers/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('creates a usable project summary when analysis is rate-limited', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 429 });

  try {
    const analysis = await analyzeProjectBrief(
      { name: 'Maker Market', description: 'A marketplace for local makers. Sellers need simple listings.' },
      { aiProvider: 'openai', aiApiKey: 'test-key', aiModel: 'test-model', aiBaseUrl: 'https://api.example.com' },
    );

    assert.equal(analysis.name, 'Maker Market');
    assert.ok(analysis.keyFeatures.length > 0);
    assert.ok(analysis.techStack.includes('React'));
    assert.equal(analysis.keyFeatures.includes('A marketplace for local makers'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
