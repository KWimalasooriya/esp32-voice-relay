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

    // ── STT ─────────────────────────────────────────────────
    const sttForm = new FormData();
    sttForm.append("file", audioBuffer, { filename: "audio.wav", contentType: "audio/wav" });
    sttForm.append("model", "whisper-1");
    const sttResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, ...sttForm.getHeaders() },
      body: sttForm,
    });
    const sttJson = await sttResp.json();
    if (!sttJson.text || sttJson.text.trim() === "") {
      console.error("❌ STT Failed:", JSON.stringify(sttJson));
      return res.status(500).send("STT failed");
    }
    console.log("🗣  User:", sttJson.text);

    // ── GPT ──────────────────────────────────────────────────
    const llmResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a voice assistant. Reply as a known friend — casual, warm, and natural." },
          { role: "user", content: sttJson.text },
        ],
      }),
    });
    const llmJson = await llmResp.json();
    if (!llmJson.choices?.[0]) return res.status(500).send("GPT failed");
    const answer = llmJson.choices[0].message.content.trim();
    console.log("🤖 GPT:", answer);

    // ── TTS — WAV format (confirmed working with ESP32) ──────
    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: answer,
        response_format: "wav",  // WAV — confirmed working, ESP32 skips 44-byte header
      }),
    });
    if (!ttsResp.ok) {
      const err = await ttsResp.text();
      console.error("❌ TTS Failed:", err);
      return res.status(500).send("TTS failed");
    }

    const wavBuffer = Buffer.from(await ttsResp.arrayBuffer());
    console.log(`🔊 Sending ${wavBuffer.length} bytes WAV...`);

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", wavBuffer.length);
    res.setHeader("Connection", "close");
    res.end(wavBuffer);
    console.log("✅ Done.");

  } catch (err) {
    console.error("❌ Error:", err.message);
    if (!res.headersSent) res.status(500).send("Server Error");
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
