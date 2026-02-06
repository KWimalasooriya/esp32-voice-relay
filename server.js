import WebSocket, { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// 1️⃣ WebSocket server for ESP32
const wss = new WebSocketServer({ port: PORT });

console.log("Cloud relay listening on port", PORT);

// 2️⃣ Connect to OpenAI Realtime API
function connectToOpenAI() {
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
    console.log("Connected to OpenAI Realtime");

    // Configure the session
    ws.send(JSON.stringify({
      type: "session.update",
      session: {
        instructions: "You are a friendly robot assistant. Keep responses short and clear.",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        voice: "alloy"
      }
    }));
  });

  ws.on("message", (msg) => {
    const event = JSON.parse(msg.toString());
    ws.onEvent && ws.onEvent(event);
  });

  ws.on("close", () => console.log("OpenAI connection closed"));
  ws.on("error", err => console.error("OpenAI error:", err));

  return ws;
}

// 3️⃣ Handle ESP32 connections
wss.on("connection", (esp) => {
  console.log("ESP32 connected");

  const ai = connectToOpenAI();

  // Forward audio from ESP32 → OpenAI
  esp.on("message", (data) => {
    if (ai.readyState === WebSocket.OPEN) {
      ai.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: Buffer.from(data).toString("base64")
      }));
    }
  });

  // Forward audio from OpenAI → ESP32
  ai.onEvent = (event) => {
    if (event.type === "response.audio.delta") {
      const audio = Buffer.from(event.delta, "base64");
      esp.send(audio);
    }
  };

  esp.on("close", () => {
    console.log("ESP32 disconnected");
    ai.close();
  });
});
