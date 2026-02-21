import express from "express";
import fetch from "node-fetch";
import FormData from "form-data";

const app = express();
const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

    if (!sttJson.text || sttJson.text.trim() === "") {
      console.error("❌ STT Failed or empty:", JSON.stringify(sttJson));
      return res.status(500).send("STT failed - audio may be silent");
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
            content: "You are a helpful voice assistant. Keep answers short — 1 to 2 sentences.",
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

    // ── STEP 3: TTS — buffer fully before sending ───────────
    // IMPORTANT: We buffer the entire TTS response so we can send
    // Content-Length. This prevents chunked transfer encoding which
    // confuses the ESP32 WAV parser.
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
        response_format: "wav",
      }),
    });

    if (!ttsResp.ok) {
      const errText = await ttsResp.text();
      console.error("❌ TTS Failed:", errText);
      return res.status(500).send("TTS failed");
    }

    // Buffer the entire WAV into memory
    const ttsArrayBuffer = await ttsResp.arrayBuffer();
    const ttsBuffer = Buffer.from(ttsArrayBuffer);

    console.log(`🔊 Sending ${ttsBuffer.length} bytes of audio (no chunking)...`);

    // Send with explicit Content-Length so ESP32 gets clean WAV bytes
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", ttsBuffer.length);
    res.setHeader("Connection", "close");
    res.end(ttsBuffer);

    console.log("✅ Audio sent.");

  } catch (err) {
    console.error("❌ Unhandled Error:", err.message);
    if (!res.headersSent) {
      res.status(500).send("Server Error");
    }
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
