import express from "express";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import FormData from "form-data";

const app = express();
const upload = multer({ dest: "tmp/" });

const OPENAI_KEY = process.env.OPENAI_API_KEY;

app.post("/voice", upload.single("audio"), async (req, res) => {
  try {
    /* ======================
       1. WHISPER STT
       ====================== */
    const sttForm = new FormData();
    sttForm.append("file", fs.createReadStream(req.file.path));
    sttForm.append("model", "whisper-1");

    const sttRes = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: sttForm,
      }
    );

    const stt = await sttRes.json();
    const userText = stt.text || "";

    /* ======================
       2. GPT-4o-mini
       ====================== */
    const gptRes = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          input: userText,
          instructions: "Answer briefly and clearly.",
        }),
      }
    );

    const gpt = await gptRes.json();
    const reply =
      gpt.output_text ||
      gpt.output?.[0]?.content?.[0]?.text ||
      "I did not understand.";

    /* ======================
       3. TTS
       ====================== */
    const ttsRes = await fetch(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "alloy",
          input: reply,
          response_format: "wav",
        }),
      }
    );

    const audio = Buffer.from(await ttsRes.arrayBuffer());

    fs.unlinkSync(req.file.path);

    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error");
  }
});

app.listen(8080, () => {
  console.log("✅ Voice cloud running on 8080");
});
