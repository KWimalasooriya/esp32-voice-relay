import WebSocket, { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const wss = new WebSocketServer({ port: PORT });
console.log("Cloud relay listening on port", PORT);

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
    console.log("✅ OpenAI socket OPEN");

    // Delay session update slightly (IMPORTANT)
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          instructions: "You are a helpful robot assistant.",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          voice: "alloy"
        }
      }));
      console.log("➡ session.update sent");
    }, 100);
  });

  ws.on("message", (msg) => {
    const txt = msg.toString();
    console.log("⬅ OpenAI EVENT:", txt);
    ws.onEvent && ws.onEvent(JSON.parse(txt));
  });

  ws.on("error", err => {
    console.error("❌ OpenAI socket error:", err);
  });

  ws.on("close", (code, reason) => {
    console.error("❌ OpenAI socket CLOSED:", code, reason.toString());
  });

  return ws;
}

wss.on("connection", (esp) => {
  console.log("✅ ESP32 connected");

  const ai = connectToOpenAI();

  esp.on("message", (data) => {
    if (ai.readyState === WebSocket.OPEN) {
      ai.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: Buffer.from(data).toString("base64")
      }));
    }
  });

  ai.onEvent = (event) => {
    if (event.type === "response.audio.delta") {
      esp.send(Buffer.from(event.delta, "base64"));
    }
  };

  esp.on("close", () => {
    console.log("ESP32 disconnected");
    ai.close();
  });
});
