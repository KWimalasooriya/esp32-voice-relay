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
          // Strict: one short sentence only — less text = less audio = faster
          { role: "system", content: "You are a voice assistant. Reply like a known friend." },
          { role: "user", content: sttJson.text },
        ],
      }),
    });
    const llmJson = await llmResp.json();
    if (!llmJson.choices?.[0]) return res.status(500).send("GPT failed");
    const answer = llmJson.choices[0].message.content.trim();
    console.log("🤖 GPT:", answer);

    // ── TTS → raw PCM (no WAV header) ───────────────────────
    // pcm format = raw 24kHz 16-bit mono samples, no header at all.
    // ESP32 can pipe bytes directly to I2S with zero parsing.
    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: answer,
        response_format: "pcm",  // ← raw PCM, no header, smallest possible
      }),
    });

    if (!ttsResp.ok) {
      const err = await ttsResp.text();
      console.error("❌ TTS Failed:", err);
      return res.status(500).send("TTS failed");
    }

    // Buffer PCM and send with Content-Length
    const pcmBuffer = Buffer.from(await ttsResp.arrayBuffer());
    console.log(`🔊 Sending ${pcmBuffer.length} bytes raw PCM...`);

    res.setHeader("Content-Type", "audio/pcm");
    res.setHeader("Content-Length", pcmBuffer.length);
    res.setHeader("X-Sample-Rate", "24000");  // info header for debugging
    res.setHeader("Connection", "close");
    res.end(pcmBuffer);
    console.log("✅ Done.");

  } catch (err) {
    console.error("❌ Error:", err.message);
    if (!res.headersSent) res.status(500).send("Server Error");
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
