function createAiError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createFallbackAnalysis({ name, description }) {
  return {
    name: name.trim(),
    description: description.trim(),
    keyFeatures: [
      'Primary user workflow',
      'Project data and state management',
      'User-facing dashboard',
      'Responsive web experience',
    ],
    techStack: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Tailwind CSS'],
  };
}

function createFallbackVoiceReply({ name, messages }) {
  const lastMessage = messages.at(-1)?.content ?? '';
  const question = messages.length < 3
    ? 'Who is this for, and what problem should it solve first?'
    : 'What is the most important result the first version must deliver?';
  return `I have captured that for ${name}: "${lastMessage}" ${question}`;
}

function getAiKeyName(provider) {
  if (provider === 'google') return 'GOOGLE_AI_API_KEY';
  if (provider === 'xai') return 'XAI_API_KEY';
  return 'AI_API_KEY';
}

function normalizeText(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isCopiedDescription(feature, description) {
  const normalizedFeature = normalizeText(feature);
  if (!normalizedFeature) return true;

  const descriptionSentences = description
    .split(/[.!?]+/)
    .map(normalizeText)
    .filter(Boolean);

  return descriptionSentences.some((sentence) => (
    normalizedFeature === sentence
    || (normalizedFeature.split(' ').length >= 6 && sentence.includes(normalizedFeature))
  ));
}

function createDistinctFeatures(features, description) {
  const validFeatures = features
    .map(String)
    .map((feature) => feature.trim())
    .filter((feature) => feature && !isCopiedDescription(feature, description));
  const fallbackFeatures = [
    'Primary user workflow',
    'Project data and state management',
    'User-facing dashboard',
    'Responsive web experience',
  ];
  const normalized = new Set(validFeatures.map(normalizeText));

  for (const feature of fallbackFeatures) {
    if (validFeatures.length >= 4) break;
    if (!normalized.has(normalizeText(feature))) {
      validFeatures.push(feature);
      normalized.add(normalizeText(feature));
    }
  }

  return validFeatures.slice(0, 12);
}

function parseAnalysis(content, description) {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;

  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw createAiError('AI_INVALID_RESPONSE', 'The AI returned an invalid project summary.');
  }

  if (
    !parsed ||
    typeof parsed.name !== 'string' ||
    typeof parsed.description !== 'string' ||
    !Array.isArray(parsed.keyFeatures) ||
    !Array.isArray(parsed.techStack)
  ) {
    throw createAiError('AI_INVALID_RESPONSE', 'The AI returned an incomplete project summary.');
  }

  return {
    name: parsed.name.trim(),
    description: parsed.description.trim(),
    keyFeatures: createDistinctFeatures(parsed.keyFeatures, description),
    techStack: parsed.techStack.map(String).map((technology) => technology.trim()).filter(Boolean).slice(0, 12),
  };
}

export async function analyzeProjectBrief({ name, description, conversation = [] }, config) {
  const hasPlaceholderKey = /^(your[-_]|replace[-_]|sk[-_]?your)/i.test(config.aiApiKey ?? '');
  if (!config.aiProvider || !config.aiApiKey || hasPlaceholderKey || !config.aiBaseUrl || !config.aiModel) {
    const keyName = getAiKeyName(config.aiProvider);
    throw createAiError('AI_NOT_CONFIGURED', `Project analysis AI is not configured. Add ${keyName} to the backend environment.`);
  }

  const response = await fetch(`${config.aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.aiApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are HELIX Project Manager AI. Turn the user and HELIX brainstorming conversation into a clear, production-ready project brief. Return only valid JSON with exactly these fields: name (string), description (string), keyFeatures (array of 4 to 8 concise strings), techStack (array of 5 to 10 concrete technologies). Treat user statements as requirements, use HELIX questions and answers as context, resolve repetition, and do not invent unrelated features. The description must summarize the product outcome in your own words, not paste the user input. Key features must be distinct product capabilities or user workflows, not copied sentences from the description. Rewrite implied requirements as actionable capabilities, remove duplicates, and never use the same wording for both description and a feature. Each feature should be short enough to edit as a single list item. Choose a tech stack that is appropriate for these capabilities, not a generic default.',
        },
        {
          role: 'user',
          content: JSON.stringify({ name, description, conversation }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const providerPayload = await response.json().catch(() => null);
    const providerCode = providerPayload?.error?.code;

    if (response.status === 401) {
      throw createAiError('AI_AUTH_ERROR', `The ${config.aiProvider} API key was rejected. Check that the key is active and correctly configured.`);
    }
    if (response.status === 403 || (response.status === 429 && providerCode === 'insufficient_quota')) {
      return createFallbackAnalysis({ name, description });
    }

    if (response.status === 429) return createFallbackAnalysis({ name, description });

    throw createAiError('AI_PROVIDER_ERROR', `Project analysis provider returned ${response.status}.`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw createAiError('AI_INVALID_RESPONSE', 'The AI returned an empty project summary.');
  }

  return parseAnalysis(content, description);
}

export async function respondToVoiceTurn({ name, messages }, config) {
  const hasPlaceholderKey = /^(your[-_]|replace[-_]|sk[-_]?your)/i.test(config.aiApiKey ?? '');
  if (!config.aiProvider || !config.aiApiKey || hasPlaceholderKey || !config.aiBaseUrl || !config.aiModel) {
    const keyName = getAiKeyName(config.aiProvider);
    throw createAiError('AI_NOT_CONFIGURED', `Voice AI is not configured. Add ${keyName} to the backend environment.`);
  }

  const response = await fetch(`${config.aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.aiApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiModel,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: `You are HELIX, a helpful AI product partner on a live voice call about a project called "${name}". Respond like a normal, intelligent conversational AI: understand what the user means, answer their questions directly, explain things clearly, and keep the conversation natural. Ask a follow-up question only when it is useful, and do not force every reply into an interview question. Do not produce a final project summary yet; that happens when the user ends the call. Keep replies concise and easy to hear aloud, usually two to four sentences.`,
        },
        ...messages.slice(-12),
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 403 || response.status === 429) return createFallbackVoiceReply({ name, messages });
    throw createAiError('AI_PROVIDER_ERROR', `Voice AI provider returned ${response.status}.`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw createAiError('AI_INVALID_RESPONSE', 'The voice AI returned an empty response.');
  }

  return content.trim();
}

export async function transcribeVoiceNote({ audio, mimeType }, config) {
  const transcriptionKey = config.aiProvider === 'google'
    ? (config.aiApiKey ?? '')
    : (config.googleAiApiKey ?? '');
  const hasPlaceholderKey = /^(your[-_]|replace[-_]|sk[-_]?your)/i.test(transcriptionKey);
  if (!transcriptionKey || hasPlaceholderKey) {
    throw createAiError('AI_NOT_CONFIGURED', 'Gemini AI transcription is not configured. Add GOOGLE_AI_API_KEY to the backend environment.');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.googleAiModel ?? config.aiModel}:generateContent?key=${encodeURIComponent(transcriptionKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Transcribe this voice note exactly. Return only the spoken words, with normal punctuation.' },
            { inlineData: { mimeType, data: audio.toString('base64') } },
          ],
        }],
      }),
    },
  );

  if (!response.ok) {
    if (response.status === 429) {
      const fallbackTranscript = await transcribeWithOpenAi(audio, mimeType, config);
      if (fallbackTranscript) return fallbackTranscript;
      throw createAiError('AI_RATE_LIMITED', 'Voice transcription is temporarily rate limited. Please try again in a moment.');
    }
    throw createAiError('AI_PROVIDER_ERROR', `Voice transcription provider returned ${response.status}.`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!text) throw createAiError('AI_INVALID_RESPONSE', 'The voice transcription was empty.');
  return text;
}

async function transcribeWithOpenAi(audio, mimeType, config) {
  if (!config.openAiApiKey || /^(your[-_]|replace[-_])/i.test(config.openAiApiKey)) return null;

  const formData = new FormData();
  formData.append('file', new Blob([audio], { type: mimeType }), 'voice.webm');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'json');

  const response = await fetch(`${config.openAiBaseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.openAiApiKey}` },
    body: formData,
  });

  if (!response.ok) return null;
  const payload = await response.json();
  return typeof payload?.text === 'string' && payload.text.trim() ? payload.text.trim() : null;
}