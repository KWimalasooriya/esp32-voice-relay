import express from "express";
import fetch from "node-fetch";
import multer from "multer";

const app = express();
const upload = multer();
const PORT = process.env.PORT || 8080;
const KEY = process.env.OPENAI_API_KEY;

app.post("/voice", upload.single("file"), async (req, res) => {
  try {
    const audio = req.body;

    const stt = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}` },
      body: audio
    }).then(r => r.json());

    const chat = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: stt.text
      })
    }).then(r => r.json());

    const tts = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: chat.output_text
      })
    });

    res.set("Content-Type", "audio/wav");
    tts.body.pipe(res);

  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log("✅ Cloud running", PORT));
