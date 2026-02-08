import express from "express";
import fetch from "node-fetch";
import { Readable } from "stream";
import FormData from "form-data";

const app = express();
const PORT = process.env.PORT || 8080;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// IMPORTANT: do NOT auto-abort
app.use(express.raw({
  type: "*/*",
  limit: "5mb",
  inflate: true
}));

function pcmToWav(pcmBuffer, sampleRate = 16000) {
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
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
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

app.post("/voice", async (req, res) => {
  try {
    if (!req.body || req.body.length < 1000) {
      console.log("⚠️ Audio too small");
      return res.status(400).send("Audio too small");
    }

    console.log("🎤 Audio bytes:", req.body.length);

    const wav = pcmToWav(req.body);

    /* ======================
       1️⃣ Whisper
       ====================== */
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", wav, {
      filename: "audio.wav",
      contentType: "audio/wav"
    });

    const stt = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`
        },
        body: form
      }
    );

    const sttJson = await stt.json();
    const userText = sttJson.text || "";

    console.log("🧠 USER:", userText);

    if (!userText) {
      return res.status(200).send("No speech");
    }

    /* ======================
       2️⃣ GPT-4o-mini
       ====================== */
    const chat = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          input: userText
        })
      }
    );

    const chatJson = await chat.json();
    const answer =
      chatJson.output_text ||
      chatJson.output?.[0]?.content?.[0]?.text ||
      "Sorry.";

    console.log("🤖 GPT:", answer);

    /* ======================
       3️⃣ TTS
       ====================== */
    const tts = await fetch(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "alloy",
          input: answer,
          response_format: "wav"
        })
      }
    );

    res.setHeader("Content-Type", "audio/wav");
    Readable.fromWeb(tts.body).pipe(res);

  } catch (err) {
    console.error("❌ SERVER ERROR:", err);
    res.status(500).send("Server error");
  }
});

app.listen(PORT, () => {
  console.log("✅ Cloud voice server running on port", PORT);
});
