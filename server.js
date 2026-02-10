import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";

const app = express();
const upload = multer({ dest: "/tmp" });

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get("/", (req, res) => {
  res.send("ESP32 Voice Server OK");
});

/**
 * ESP32 uploads WAV here
 */
app.post("/voice", upload.single("audio"), async (req, res) => {
  try {
    console.log("🎤 Audio received:", req.file.size, "bytes");

    /* ---------- STT (Whisper) ---------- */
    const sttForm = new FormData();
    sttForm.append("file", fs.createReadStream(req.file.path));
    sttForm.append("model", "whisper-1");

    const sttResp = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: sttForm
      }
    );

    const sttJson = await sttResp.json();
    const userText = sttJson.text || "";
    console.log("🗣 STT:", userText);

    /* ---------- LLM ---------- */
    const llmResp = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          instructions: "You are a helpful robot assistant. Keep responses short.",
          input: userText
        })
      }
    );

    const llmJson = await llmResp.json();
    const answer =
      llmJson.output_text ||
      llmJson.output?.[0]?.content?.[0]?.text ||
      "Sorry, I didn't understand.";

    console.log("🤖 GPT:", answer);

    /* ---------- TTS ---------- */
    const ttsResp = await fetch(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
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
    ttsResp.body.pipe(res);

  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).send("Server error");
  }
});

app.listen(PORT, () => {
  console.log("✅ Cloud voice server running on port", PORT);
});
