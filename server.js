import express from "express";
import fetch from "node-fetch";
import FormData from "form-data";

const app = express();
// Receive raw binary audio data
app.use(express.raw({ type: 'audio/wav', limit: '10mb' }));

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post("/voice", async (req, res) => {
  try {
    const audioBuffer = req.body;
    if (!audioBuffer || audioBuffer.length < 100) {
      return res.status(400).send("No audio received");
    }
    console.log(`🎤 Received ${audioBuffer.length} bytes`);

    // 1. Whisper STT
    const sttForm = new FormData();
    sttForm.append("file", audioBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
    sttForm.append("model", "whisper-1");

    const sttResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, ...sttForm.getHeaders() },
      body: sttForm
    });
    const sttJson = await sttResp.json();
    console.log("🗣 User:", sttJson.text);

    // 2. ChatGPT Response
    const llmResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful assistant. Keep responses very short (1 sentence)." },
          { role: "user", content: sttJson.text }
        ]
      })
    });
    const llmJson = await llmResp.json();
    const answer = llmJson.choices[0].message.content;
    console.log("🤖 GPT:", answer);

    // 3. Text-to-Speech
    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tts-1",
        voice: "alloy",
        input: answer,
        response_format: "wav"
      })
    });

    console.log("🔊 Streaming audio back...");
    res.setHeader("Content-Type", "audio/wav");
    // Pipe the audio stream directly to the ESP32
    ttsResp.body.pipe(res);

  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).send("Internal Server Error");
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
