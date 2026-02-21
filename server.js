import express from "express";
import fetch from "node-fetch";
import FormData from "form-data";

const app = express();
const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Accept raw WAV audio up to 10MB
app.use(express.raw({ type: "audio/wav", limit: "10mb" }));

app.post("/voice", async (req, res) => {
  try {
    const audioBuffer = req.body;

    if (!audioBuffer || audioBuffer.length < 100) {
      return res.status(400).send("No audio received");
    }

    console.log(`🎤 Received ${audioBuffer.length} bytes`);

    // ── STEP 1: Whisper STT ─────────────────────────────────
    const sttForm = new FormData();
    sttForm.append("file", audioBuffer, {
      filename: "audio.wav",
      contentType: "audio/wav",
    });
    sttForm.append("model", "whisper-1");

    const sttResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        ...sttForm.getHeaders(),
      },
      body: sttForm,
    });

    const sttJson = await sttResp.json();

    if (!sttJson.text) {
      console.error("❌ STT Failed:", JSON.stringify(sttJson));
      return res.status(500).send("STT failed");
    }

    console.log("🗣  User:", sttJson.text);

    // ── STEP 2: GPT Chat ────────────────────────────────────
    const llmResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful voice assistant. Keep your answers very short — 1 to 2 sentences maximum.",
          },
          { role: "user", content: sttJson.text },
        ],
      }),
    });

    const llmJson = await llmResp.json();

    if (!llmJson.choices || !llmJson.choices[0]) {
      console.error("❌ GPT Failed:", JSON.stringify(llmJson));
      return res.status(500).send("GPT failed");
    }

    const answer = llmJson.choices[0].message.content.trim();
    console.log("🤖 GPT:", answer);

    // ── STEP 3: TTS ─────────────────────────────────────────
    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: answer,
        response_format: "wav", // WAV = 24000 Hz PCM from OpenAI
      }),
    });

    if (!ttsResp.ok) {
      const errText = await ttsResp.text();
      console.error("❌ TTS Failed:", errText);
      return res.status(500).send("TTS failed");
    }

    console.log("🔊 Streaming audio response to ESP32...");

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Connection", "close");

    // Pipe TTS audio directly to ESP32
    ttsResp.body.pipe(res);

    ttsResp.body.on("end", () => {
      console.log("✅ Audio stream complete.");
    });

    ttsResp.body.on("error", (err) => {
      console.error("❌ Stream error:", err.message);
    });

  } catch (err) {
    console.error("❌ Unhandled Error:", err.message);
    if (!res.headersSent) {
      res.status(500).send("Server Error");
    }
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
