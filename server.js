import express from "express";
import fetch from "node-fetch";
import FormData from "form-data";

const app = express();

// Increase limit to handle audio files
app.use(express.raw({ type: 'audio/wav', limit: '10mb' }));

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.get("/", (req, res) => res.send("ESP32 Voice Server OK"));

app.post("/voice", async (req, res) => {
  try {
    const audioBuffer = req.body;
    if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).send("No audio data received");
    }
    console.log("🎤 Audio received:", audioBuffer.length, "bytes");

    /* ---------- STT (Whisper) ---------- */
    const sttForm = new FormData();
    // Pass buffer directly to Whisper
    sttForm.append("file", audioBuffer, { filename: 'recording.wav', contentType: 'audio/wav' });
    sttForm.append("model", "whisper-1");

    const sttResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, ...sttForm.getHeaders() },
      body: sttForm
    });

    const sttJson = await sttResp.json();
    const userText = sttJson.text || "";
    console.log("🗣 STT:", userText);

    if (!userText) throw new Error("Could not transcribe audio");

    /* ---------- LLM (Chat) ---------- */
    const llmResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: "You are a helpful robot assistant. Keep responses very short (1 sentence)." },
            { role: "user", content: userText }
        ]
      })
    });

    const llmJson = await llmResp.json();
    const answer = llmJson.choices?.[0]?.message?.content || "I am not sure.";
    console.log("🤖 GPT:", answer);

    /* ---------- TTS (Speech) ---------- */
    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "alloy",
        input: answer,
        response_format: "wav"
      })
    });

    console.log("🔊 Sending TTS back to ESP32");
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Transfer-Encoding", "chunked");
    
    // Pipe the audio stream directly back to the ESP32
    ttsResp.body.pipe(res);

  } catch (err) {
    console.error("❌ Server error:", err.message);
    res.status(500).send("Server error: " + err.message);
  }
});

app.listen(PORT, () => console.log("✅ Cloud server running on port", PORT));
