import express from "express";
import fetch from "node-fetch";
import FormData from "form-data";

const app = express();
const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use(express.raw({ type: "audio/wav", limit: "10mb" }));

// ───────── downsample 24k → 8k ─────────
function downsample24to8(pcm24k) {
  const inSamples = pcm24k.length / 2;
  const outSamples = Math.floor(inSamples / 3);
  const out = Buffer.alloc(outSamples * 2);

  for (let i = 0; i < outSamples; i++) {
    const s0 = pcm24k.readInt16LE((i * 3) * 2);
    const s1 = pcm24k.readInt16LE((i * 3 + 1) * 2);
    const s2 = pcm24k.readInt16LE((i * 3 + 2) * 2);
    out.writeInt16LE(Math.round((s0 + s1 + s2) / 3), i * 2);
  }
  return out;
}

function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

app.post("/voice", async (req, res) => {
  try {
    const audioBuffer = req.body;
    if (!audioBuffer || audioBuffer.length < 100)
      return res.status(400).send("No audio");

    // ───── STT ─────
    const sttForm = new FormData();
    sttForm.append("file", audioBuffer, {
      filename: "audio.wav",
      contentType: "audio/wav"
    });
    sttForm.append("model", "whisper-1");

    const sttResp = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          ...sttForm.getHeaders()
        },
        body: sttForm
      }
    );

    const sttJson = await sttResp.json();
    const userText = sttJson.text || "";

    // ───── GPT + EMOTION ─────
    const llmResp = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
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
              content: `
You are a friendly robot companion.

Return JSON ONLY:
{
  "reply": "...",
  "emotion": "happy | sad | curious | excited | neutral"
}`
            },
            { role: "user", content: userText }
          ],
          response_format: { type: "json_object" }
        })
      }
    );

    const llmJson = await llmResp.json();
    const parsed = JSON.parse(llmJson.choices[0].message.content);

    const answer = parsed.reply;
    const emotion = parsed.emotion || "neutral";

    // ───── TTS ─────
    const ttsResp = await fetch(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "nova",
          input: answer,
          response_format: "pcm"
        })
      }
    );

    const pcm24k = Buffer.from(await ttsResp.arrayBuffer());
    const pcm8k = downsample24to8(pcm24k);
    const wav8k = pcmToWav(pcm8k, 8000);

    // ⭐ SEND EMOTION HEADER
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", wav8k.length);
    res.setHeader("X-Emotion", emotion);
    res.setHeader("Connection", "close");

    res.end(wav8k);

  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).send("Server Error");
  }
});

app.listen(PORT, () =>
  console.log(`✅ Server running on port ${PORT}`)
);
