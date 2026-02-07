import WebSocket, { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const wss = new WebSocketServer({ port: PORT });
console.log("☁️ Cloud relay listening on port", PORT);

/* ===================== UTILITIES ===================== */

// Linear resample PCM16 mono from 16kHz → 24kHz
function resample16kTo24k(int16) {
  const inRate = 16000;
  const outRate = 24000;
  const ratio = outRate / inRate;

  const outLength = Math.floor(int16.length * ratio);
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcIndex = i / ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, int16.length - 1);
    const frac = srcIndex - i0;

    out[i] = (int16[i0] * (1 - frac)) + (int16[i1] * frac);
  }

  return out;
}

function pcm16ToBase64(int16) {
  return Buffer.from(int16.buffer).toString("base64");
}

/* ===================== OPENAI CONNECTION ===================== */

function connectToOpenAI(onEvent) {
  const ws = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    }
  );

  ws.on("open", () => {
    console.log("✅ OpenAI socket OPEN");

    // Send session update AFTER connection stabilizes
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          instructions: "You are a helpful robot assistant.",
          modalities: ["audio", "text"],
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          voice: "alloy",
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            silence_duration_ms: 200,
            prefix_padding_ms: 300
          }
        }
      }));
      console.log("➡ session.update sent");
    }, 100);
  });

  ws.on("message", (msg) => {
    try {
      const event = JSON.parse(msg.toString());
      console.log("⬅ OpenAI EVENT:", event.type);
      onEvent?.(event);
    } catch (e) {
      console.error("❌ OpenAI JSON parse error:", e);
    }
  });

  ws.on("error", err => {
    console.error("❌ OpenAI socket error:", err);
  });

  ws.on("close", (code, reason) => {
    console.error("❌ OpenAI socket CLOSED:", code, reason.toString());
  });

  return ws;
}

/* ===================== ESP32 HANDLING ===================== */

wss.on("connection", (esp) => {
  console.log("✅ ESP32 connected");

  const ai = connectToOpenAI((event) => {
    // Stream AI audio back to ESP32
    if (event.type === "response.audio.delta") {
      const audio = Buffer.from(event.delta, "base64");
      esp.send(audio);
    }
  });

  esp.on("message", (data, isBinary) => {

    // ---------- TEXT CONTROL EVENTS ----------
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());

        // Forward control messages directly
        if (
          msg.type === "input_audio_buffer.clear" ||
          msg.type === "input_audio_buffer.commit" ||
          msg.type === "response.create"
        ) {
          ai.readyState === WebSocket.OPEN &&
            ai.send(JSON.stringify(msg));
        }

        return;
      } catch {
        return;
      }
    }

    // ---------- BINARY AUDIO ----------
    if (ai.readyState !== WebSocket.OPEN) return;

    // Incoming PCM16 @ 16kHz
    const pcm16_16k = new Int16Array(
      data.buffer,
      data.byteOffset,
      data.byteLength / 2
    );

    // Resample → 24kHz
    const pcm16_24k = resample16kTo24k(pcm16_16k);

    // Encode base64
    const base64 = pcm16ToBase64(pcm16_24k);

    // Send proper OpenAI audio event
    ai.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: base64
    }));
  });

  esp.on("close", () => {
    console.log("🔌 ESP32 disconnected");
    ai.close();
  });
});
