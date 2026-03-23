import express from "express";
import fetch from "node-fetch";
import FormData from "form-data";

const app = express();
const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use(express.raw({ type: "audio/wav", limit: "10mb" }));

// ── Detect emotion from GPT response text ────────────────────
// Returns: "HAPPY", "ANGRY", "TIRED", "DEFAULT"
function detectEmotion(text) {
  const t = text.toLowerCase();

  // Emojis
  if (text.match(/😊|😄|😃|😁|🎉|✨|😍|🥰|😂|🤣/)) return "HAPPY";
  if (text.match(/😢|😭|😔|😞|💔|😩|😫/)) return "TIRED";
  if (text.match(/😠|😡|🤬|💢/)) return "ANGRY";

  // English keywords
  if (t.match(/happy|great|awesome|wonderful|love|yay|haha|fantastic|excited|fun|cool|amazing|glad|joy/))
    return "HAPPY";
  if (t.match(/sorry|tired|exhaust|boring|ugh|meh|sleepy|sad|unfortunately/))
    return "TIRED";
  if (t.match(/angry|mad|furious|annoyed|frustrated|terrible/))
    return "ANGRY";

  // Sinhala keywords (🔥 added)
  if (text.match(/සතුටු|හරි සතුටුයි|නියමයි|ලස්සනයි|හරි හොඳයි/))
    return "HAPPY";

  if (text.match(/දුකයි|කණගාටුයි|අමාරුයි|බෝරයි|නරකයි/))
    return "TIRED";

  if (text.match(/තරහයි|කෝපයි|හිත අමාරුයි|වැරදි/))
    return "ANGRY";

  return "DEFAULT";
}

// ── Downsample 24kHz PCM → 8kHz ─────────────────────────────
function downsample24to8(pcm24k) {
  const inSamples  = pcm24k.length / 2;
  const outSamples = Math.floor(inSamples / 3);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const s0 = pcm24k.readInt16LE((i * 3)     * 2);
    const s1 = pcm24k.readInt16LE((i * 3 + 1) * 2);
    const s2 = pcm24k.readInt16LE((i * 3 + 2) * 2);
    out.writeInt16LE(Math.round((s0 + s1 + s2) / 3), i * 2);
  }
  return out;
}

// ── Wrap PCM in WAV header ───────────────────────────────────
function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);      header.writeUInt16LE(1,  20);
  header.writeUInt16LE(1,  22);      header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2,  32);      header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii"); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ── Pitch shift (balanced for Sinhala clarity) ───────────────
function pitchUp(pcm, factor = 1.15) {
  const inSamples = pcm.length / 2;
  const outSamples = Math.floor(inSamples / factor);
  const out = Buffer.alloc(outSamples * 2);

  for (let i = 0; i < outSamples; i++) {
    const srcIndex = Math.floor(i * factor);
    const sample = pcm.readInt16LE(srcIndex * 2);
    out.writeInt16LE(sample, i * 2);
  }
  return out;
}

app.post("/voice", async (req, res) => {
  try {
    const audioBuffer = req.body;
    if (!audioBuffer || audioBuffer.length < 100)
      return res.status(400).send("No audio");

    console.log(`🎤 Received ${audioBuffer.length} bytes`);

    // ── STT ──────────────────────────────────────────────────
    const sttForm = new FormData();
    sttForm.append("file", audioBuffer, { filename: "audio.wav", contentType: "audio/wav" });
    sttForm.append("model", "whisper-1");

    const sttResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, ...sttForm.getHeaders() },
      body: sttForm,
    });

    const sttJson = await sttResp.json();

    if (!sttJson.text?.trim()) {
      console.error("❌ STT Failed:", JSON.stringify(sttJson));
      return res.status(500).send("STT failed");
    }

    console.log("🗣 User:", sttJson.text);

    // ── GPT ──────────────────────────────────────────────────
    const llmResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a tiny cute robot named Mandy. Always reply ONLY in Sinhala (සිංහල). Use simple spoken Sinhala (like friends talking), not formal language. Be playful, cheerful, and expressive."
          },
          {
            role: "user",
            content: sttJson.text
          }
        ],
      }),
    });

    const llmJson = await llmResp.json();

    if (!llmJson.choices?.[0])
      return res.status(500).send("GPT failed");

    const answer = llmJson.choices[0].message.content.trim();

    console.log("🤖 GPT:", answer);

    // ── Emotion detection ─────────────────────────────────────
    const emotion = detectEmotion(answer);
    console.log(`😊 Emotion: ${emotion}`);

    // ── TTS ──────────────────────────────────────────────────
    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "nova",
        input: `Say this clearly in Sinhala in a cute, soft, playful tiny robot voice: ${answer}`,
        response_format: "pcm",
        speed: 0.9
      }),
    });

    if (!ttsResp.ok) {
      console.error("❌ TTS Failed:", await ttsResp.text());
      return res.status(500).send("TTS failed");
    }

    const pcm24k = Buffer.from(await ttsResp.arrayBuffer());
    const pitched = pitchUp(pcm24k, 1.15);
    const pcm8k  = downsample24to8(pitched);
    const wav8k  = pcmToWav(pcm8k, 8000);

    console.log(`🔊 Audio ready | Emotion: ${emotion}`);

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", wav8k.length);
    res.setHeader("X-Emotion", emotion);
    res.setHeader("Connection", "close");

    res.end(wav8k);

    console.log("✅ Done.");

  } catch (err) {
    console.error("❌ Error:", err.message);
    if (!res.headersSent)
      res.status(500).send("Server Error");
  }
});

app.listen(PORT, () =>
  console.log(`✅ Robot server running on port ${PORT}`)
);
