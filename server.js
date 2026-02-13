import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 8080;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

app.post("/voice", async (req, res) => {

  console.log("🎤 Incoming audio...");

  let chunks = [];
  let totalSize = 0;

  req.on("data", chunk => {
    chunks.push(chunk);
    totalSize += chunk.length;
  });

  req.on("end", async () => {

    console.log("✅ Received bytes:", totalSize);

    const audioBuffer = Buffer.concat(chunks);

    try {

      // 1️⃣ STT
      const formData = new FormData();
      formData.append("file", new Blob([audioBuffer]), "audio.wav");
      formData.append("model", "whisper-1");

      const sttRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_KEY}`
        },
        body: formData
      });

      const sttJson = await sttRes.json();
      const userText = sttJson.text || "I did not understand.";
      console.log("🗣 User:", userText);

      // 2️⃣ GPT
      const gptRes = await fetch("https://api.openai.com/v1/responses", {
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

      const gptJson = await gptRes.json();
      const replyText = gptJson.output_text || "Sorry, error.";
      console.log("🤖 GPT:", replyText);

      // 3️⃣ TTS
      const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "alloy",
          input: replyText,
          response_format: "wav"
        })
      });

      const audioReply = Buffer.from(await ttsRes.arrayBuffer());

      res.writeHead(200, {
        "Content-Type": "audio/wav",
        "Content-Length": audioReply.length
      });

      res.end(audioReply);

      console.log("🔊 Response sent");

    } catch (err) {
      console.error("❌ Error:", err);
      res.status(500).send("Error");
    }

  });

  req.on("error", err => {
    console.error("❌ Stream error:", err);
  });

});

app.listen(PORT, () => {
  console.log("✅ Cloud voice server running on port", PORT);
});
