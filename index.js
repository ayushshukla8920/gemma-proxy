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
  "dolphin:logical",
  "dolphin:code-beginner",
  "dolphin:code-advanced",
];

// ✅ Normalize OpenAI → Gemini
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

    // 🔥 Handle tool responses
    if (m.role === "tool") {
      text = `TOOL RESULT:\n${text}`;
    }

    return {
      role:
        m.role === "assistant"
          ? "model"
          : "user", // Gemini only supports user/model
      parts: [{ text }],
    };
  });
}

// 🔐 API Key validation
function validateApiKey(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: Missing or invalid Authorization header" });
    return false;
  }

  const key = auth.split(" ")[1];
  if (key !== "sk-live-7k8r2n5m9p0qwf47shwkqndevbbs") {
    res.status(401).json({ error: "Unauthorized: Invalid API Key" });
    return false;
  }

  return true;
}

// 🧠 Detect tool calls (structured)
function detectToolCall(text, tools = []) {
  if (!tools || tools.length === 0) return null;

  // VERY IMPORTANT: require JSON output from model
  try {
    const parsed = JSON.parse(text);

    if (parsed.tool && parsed.arguments) {
      return {
        id: "call_" + Date.now(),
        type: "function",
        function: {
          name: parsed.tool,
          arguments: JSON.stringify(parsed.arguments),
        },
      };
    }
  } catch (e) {
    return null;
  }

  return null;
}

app.post("/v1/chat/completions", async (req, res) => {
  try {
    if (!validateApiKey(req, res)) return;

    const { model, messages, stream, tools } = req.body;

    const cleanModel = model?.includes("/")
      ? model.split("/")[1]
      : model;

    if (!availableModels.includes(cleanModel)) {
      return res.status(400).json({ error: "Model not found" });
    }

    // 🐬 DOLPHIN HANDLING
    if (cleanModel.startsWith("dolphin")) {
      const template = cleanModel.includes(":") ? cleanModel.split(":")[1] : "logical";

      const myHeaders = new Headers();
      myHeaders.append("accept", "text/event-stream");
      myHeaders.append("content-type", "application/json");
      myHeaders.append("origin", "https://chat.dphn.ai");
      myHeaders.append("referer", "https://chat.dphn.ai/");
      myHeaders.append("user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36");

      const raw = JSON.stringify({
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        model: "dolphinserver:24B",
        template: template
      });

      const response = await fetch("https://chat.dphn.ai/api/chat", {
        method: "POST",
        headers: myHeaders,
        body: raw,
      });

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
        return;
      } else {
        const text = await response.text();
        const lines = text.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]');
        let fullContent = "";
        let lastId = "chatcmpl-" + Date.now();

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
              fullContent += data.choices[0].delta.content;
            }
            if (data.id) lastId = data.id;
          } catch (e) { }
        }

        return res.json({
          id: lastId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: cleanModel,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: fullContent,
              },
              finish_reason: "stop",
            },
          ],
        });
      }
    }


    const geminiModel = genAI.getGenerativeModel({
      model: cleanModel,
    });

    let contents = convertToGeminiContents(messages);

    // 🧠 Add tool instruction to system
    if (tools && tools.length > 0) {
      contents.unshift({
        role: "user",
        parts: [
          {
            text: `
You can call tools.

Respond ONLY in JSON:
{
  "tool": "function_name",
  "arguments": { ... }
}

Available tools:
${JSON.stringify(tools, null, 2)}
            `,
          },
        ],
      });
    }

    // 🚀 STREAMING
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

          res.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-" + Date.now(),
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta, finish_reason: null }],
            })}\n\n`
          );
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

    // 🔥 TOOL CALL HANDLING
    const toolCall = detectToolCall(text, tools);

    if (toolCall) {
      return res.json({
        id: "chatcmpl-" + Date.now(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [toolCall],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
    }

    // ✅ Normal text response
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
  console.log("🚀 Gemini OpenAI-compatible wrapper running on port 4000");
});
