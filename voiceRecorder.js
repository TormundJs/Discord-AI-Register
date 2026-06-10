const { EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const fs = require('fs');

// Generates wave header for raw 16-bit stereo PCM
function getWavHeader(bufferLength, sampleRate = 48000, numChannels = 2, bitsPerSample = 16) {
    const buffer = Buffer.alloc(44);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + bufferLength, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.write('fmt ', 12); // fmt chunk header
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
    buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(bufferLength, 40);
    return buffer;
}

// Calls Gemini API to analyze speech and detect name/age/gender
async function analyzeVoiceRegistration(wavBuffer) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not defined in .env');
    }

    const base64Audio = wavBuffer.toString('base64');
    const systemPrompt = `You are an AI Registry Officer for a Turkish Discord server.
Analyze the audio content, transcribe it in Turkish, and extract the user's name, age, and gender based on vocal pitch/tone and name patterns.

Return a JSON object in this exact format:
{
  "transcription": "The spoken text in Turkish",
  "name": "Capitalized First Name (e.g. Ahmet, Elif)",
  "age": 18, // number
  "gender": "male" or "female",
  "success": true or false
}

Strict Rules:
- If the name is unclear or not a Turkish first name, set success to false.
- If the age is not mentioned or unclear, set success to false.
- Return ONLY the JSON object, start with '{' and end with '}'.`;

    // Fetch available models
    let availableModels = [];
    try {
        const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (modelsRes.ok) {
            const modelsData = await modelsRes.json();
            availableModels = modelsData.models ? modelsData.models.map(m => m.name.replace('models/', '')) : [];
        }
    } catch (e) {}

    const preferredModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-3.5-flash'];
    const modelsToTry = preferredModels.filter(m => availableModels.includes(m));
    if (modelsToTry.length === 0) {
        modelsToTry.push('gemini-2.0-flash');
    }

    let lastError = null;
    for (const model of modelsToTry) {
        console.log(`[VOICE-REG-ANALYSIS] Requesting Gemini using model: ${model}...`);
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { inlineData: { mimeType: 'audio/wav', data: base64Audio } },
                            { text: systemPrompt }
                        ]
                    }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (!response.ok) {
                const errData = await response.json();
                const errMsg = errData.error?.message || 'Unknown error';
                console.warn(`[VOICE-REG-ANALYSIS] Model ${model} failed: ${errMsg}`);
                lastError = new Error(errMsg);
                continue;
            }

            const data = await response.json();
            let textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!textResult) {
                throw new Error('AI produced no content.');
            }

            return JSON.parse(textResult.trim());
        } catch (err) {
            console.warn(`[VOICE-REG-ANALYSIS] Error with model ${model}: ${err.message}`);
            lastError = err;
        }
    }

    throw lastError || new Error('All Gemini models failed to process speech analysis.');
}

// Compares target voice sample against reference voice samples using Gemini
async function compareVoiceSamples(newWavBuffer, userSamplesList) {
    if (!userSamplesList || userSamplesList.length === 0) {
        return { matches: [], highestSimilarityScore: 0, highestMatchUserId: null, highestMatchUsername: null, reasoning: "No samples to compare." };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not defined in .env');
    }

    const parts = [];

    // Target audio (Audio 0)
    parts.push({
        inlineData: {
            mimeType: 'audio/wav',
            data: newWavBuffer.toString('base64')
        }
    });

    const referenceDescriptions = [];
    let referenceIndex = 1;
    const validSamples = [];

    for (let i = 0; i < userSamplesList.length; i++) {
        const sample = userSamplesList[i];
        if (sample.voiceSamplePath && fs.existsSync(sample.voiceSamplePath)) {
            try {
                const audioBuffer = fs.readFileSync(sample.voiceSamplePath);
                parts.push({
                    inlineData: {
                        mimeType: 'audio/wav',
                        data: audioBuffer.toString('base64')
                    }
                });
                referenceDescriptions.push(`- Audio ${referenceIndex}: Registered User ${sample.username} (ID: ${sample.userID})`);
                validSamples.push(sample);
                referenceIndex++;
            } catch (err) {
                console.error(`[VOICE-COMPARE] Error reading voice file for ${sample.userID}:`, err.message);
            }
        }
    }

    if (parts.length <= 1) {
        return { matches: [], highestSimilarityScore: 0, highestMatchUserId: null, highestMatchUsername: null, reasoning: "No valid reference samples found." };
    }

    const systemPrompt = `You are a forensic voice comparison expert.
We have received a new registration request with an audio sample (designated as Audio 0).
We need to compare Audio 0 with the following reference audio samples:
${referenceDescriptions.join('\n')}

Analyze the acoustic characteristics, including fundamental pitch, timbre, speaking rate, cadence, accents, and pronunciation.
Determine if the speaker in Audio 0 is the same person as any of the reference speakers.

Return a JSON object in this exact format:
{
  "matches": [
    {
      "audioIndex": 1, // 1 to N
      "userID": "Matched User ID",
      "username": "Matched Username",
      "similarityScore": 92, // 0 to 100
      "isSamePerson": true // true if similarityScore >= 85
    }
  ],
  "highestSimilarityScore": 92,
  "highestMatchUserId": "ID or null",
  "highestMatchUsername": "Username or null",
  "reasoning": "Acoustic reasoning explanation in Turkish"
}

Rule: If no similarity score is >= 80, return empty matches, highestMatchUserId and highestMatchUsername as null. Return ONLY the JSON object.`;

    parts.push({ text: systemPrompt });

    let availableModels = [];
    try {
        const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (modelsRes.ok) {
            const modelsData = await modelsRes.json();
            availableModels = modelsData.models ? modelsData.models.map(m => m.name.replace('models/', '')) : [];
        }
    } catch (e) {}

    const preferredModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-3.5-flash'];
    const modelsToTry = preferredModels.filter(m => availableModels.includes(m));
    if (modelsToTry.length === 0) {
        modelsToTry.push('gemini-2.0-flash');
    }

    let lastError = null;
    for (const model of modelsToTry) {
        console.log(`[VOICE-COMPARE] Requesting Gemini using model: ${model}...`);
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (!response.ok) {
                const errData = await response.json();
                const errMsg = errData.error?.message || 'Unknown error';
                console.warn(`[VOICE-COMPARE] Model ${model} comparison failed: ${errMsg}`);
                lastError = new Error(errMsg);
                continue;
            }

            const data = await response.json();
            let textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!textResult) {
                throw new Error('AI comparison produced no content.');
            }

            const parsedResult = JSON.parse(textResult.trim());
            
            // Map the relative indexes back to valid user IDs
            if (parsedResult.matches && parsedResult.matches.length > 0) {
                parsedResult.matches = parsedResult.matches.map(m => {
                    const idx = m.audioIndex - 1;
                    if (validSamples[idx]) {
                        return {
                            ...m,
                            userID: validSamples[idx].userID,
                            username: validSamples[idx].username
                        };
                    }
                    return m;
                });
            }
            if (parsedResult.highestMatchUserId) {
                const matchingMatch = parsedResult.matches.find(m => m.audioIndex === parsedResult.matches[0]?.audioIndex);
                if (matchingMatch) {
                    parsedResult.highestMatchUserId = matchingMatch.userID;
                    parsedResult.highestMatchUsername = matchingMatch.username;
                }
            }

            return parsedResult;
        } catch (err) {
            console.warn(`[VOICE-COMPARE] Error comparing with model ${model}: ${err.message}`);
            lastError = err;
        }
    }

    throw lastError || new Error('All Gemini models failed to compare audio.');
}

// Subscribes to Discord voice stream and records speaking audio
function recordUserVoice(voiceConnection, userId) {
    return new Promise((resolve, reject) => {
        const receiver = voiceConnection.receiver;
        
        console.log(`[VOICE-RECORDER] Recording user: ${userId}...`);

        const opusStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 1500
            }
        });

        const opusDecoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
        const pcmChunks = [];

        opusStream.pipe(opusDecoder);

        opusDecoder.on('data', (chunk) => {
            pcmChunks.push(chunk);
        });

        opusDecoder.on('error', (err) => {
            cleanup();
            reject(err);
        });

        let finished = false;
        const cleanup = () => {
            if (finished) return;
            finished = true;
            clearTimeout(hardTimeout);
        };

        // Hard timeout to stop recording after 6 seconds
        const hardTimeout = setTimeout(() => {
            console.log(`[VOICE-RECORDER] Hard 6s limit reached.`);
            opusStream.destroy();
            opusDecoder.end();
        }, 6000);

        opusDecoder.on('end', async () => {
            cleanup();
            try {
                const pcmBuffer = Buffer.concat(pcmChunks);
                if (pcmBuffer.length < 5000) {
                    return reject(new Error('Audio clip is too short or silent.'));
                }

                const wavHeader = getWavHeader(pcmBuffer.length, 48000, 2, 16);
                const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
                
                console.log(`[VOICE-RECORDER] WAV compiled. Sending to Gemini...`);
                const result = await analyzeVoiceRegistration(wavBuffer);
                if (result && typeof result === 'object') {
                    result.wavBuffer = wavBuffer;
                }
                resolve(result);
            } catch (err) {
                reject(err);
            }
        });
    });
}

module.exports = { recordUserVoice, compareVoiceSamples };
