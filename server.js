import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 8080;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// raw audio upload
app.use(express.raw({ type: "*/*", limit: "5mb" }));

app.post("/voice", async (req, res) => {
  try {
    console.log("🎤 Audio received:", req.body.length, "bytes");

    /* ======================
       1️⃣ Whisper (STT)
       ====================== */
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", new Blob([req.body]), "audio.pcm");

    const stt = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`
      },
      body: form
    });

    const sttJson = await stt.json();
    const userText = sttJson.text || "";

    console.log("🧠 USER:", userText);

    if (!userText) {
      return res.status(400).send("No speech detected");
    }

    /* ======================
       2️⃣ GPT-4o-mini
       ====================== */
    const chat = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: userText
      })
    });

    const chatJson = await chat.json();
    const answer =
      chatJson.output_text ||
      chatJson.output?.[0]?.content?.[0]?.text ||
      "Sorry, I didn’t understand.";

    console.log("🤖 GPT:", answer);

    /* ======================
       3️⃣ TTS
       ====================== */
    const tts = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: answer,
        response_format: "wav"
      })
    });

    res.setHeader("Content-Type", "audio/wav");
    tts.body.pipe(res);

  } catch (err) {
    console.error("❌ SERVER ERROR:", err);
    res.status(500).send("Server error");
  }
});

app.listen(PORT, () => {
  console.log("✅ Cloud voice server running on port", PORT);
});
