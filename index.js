import express from "express";
import bodyParser from "body-parser";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const availableModels = [
  "gemma-4-31b-it",
  "gemma-4-26b-a4b-it",
  "gemini-2.5-flash",
  "gemini-3.0-flash",
  "gemini-3.1-flash-lite-preview",
];

// 🔧 Normalize OpenAI → Gemini format
function convertToGeminiContents(messages) {
  return messages.map((m) => {
    let text = "";

    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content.map((p) => p.text || "").join("");
    } else if (typeof m.content === "object" && m.content !== null) {
      text = m.content.text || "";
    }

    return {
      role:
        m.role === "assistant"
          ? "model"
          : m.role === "system"
          ? "user"
          : "user",
      parts: [{ text }],
    };
  });
}

// 🔐 Simple API key check
function validateApiKey(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

app.post("/v1/chat/completions", async (req, res) => {
  try {
    if (!validateApiKey(req, res)) return;

    const { model, messages, stream } = req.body;

    const cleanModel = model?.includes("/")
      ? model.split("/")[1]
      : model;

    if (!availableModels.includes(cleanModel)) {
      return res.status(400).json({ error: "Model not found" });
    }

    const geminiModel = genAI.getGenerativeModel({
      model: cleanModel,
    });

    const contents = convertToGeminiContents(messages);

    // 🚀 STREAMING RESPONSE
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const result = await geminiModel.generateContentStream({
        contents,
      });

      let isFirstChunk = true;

      for await (const chunk of result.stream) {
        const text = chunk.text();

        for (const char of text) {
          const delta = isFirstChunk
            ? { role: "assistant", content: char }
            : { content: char };

          isFirstChunk = false;

          const data = {
            id: "chatcmpl-" + Date.now(),
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta,
                finish_reason: null,
              },
            ],
          };

          res.write(`data: ${JSON.stringify(data)}\n\n`);
          await new Promise((r) => setTimeout(r, 5));
        }
      }

      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-" + Date.now(),
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
        })}\n\n`
      );

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // 🚀 NORMAL RESPONSE
    const result = await geminiModel.generateContent({
      contents,
    });

    const text = result.response.text();

    res.json({
      id: "chatcmpl-" + Date.now(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: text,
          },
          finish_reason: "stop",
        },
      ],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message || "Internal server error",
    });
  }
});

app.listen(4000, () => {
  console.log("🚀 OpenAI-compatible Gemini wrapper running on port 4000");
});
