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
]
function convertMessagesToPrompt(messages) {
    return messages
        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n");
}
app.post("/v1/chat/completions", async (req, res) => {
    try {
        const { model, messages, stream } = req.body;
        const cleanModel = model.includes("/") ? model.split("/")[1] : model;
        const prompt = convertMessagesToPrompt(messages);
        const geminiModel = genAI.getGenerativeModel({
            model: cleanModel || "gemini-1.5-flash",
        });
        if (!availableModels.includes(cleanModel)) {
            res.status(400).json({ error: "Model not found" });
            return;
        }
        if (stream) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            const result = await geminiModel.generateContentStream(prompt);
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
                        model: model,
                        choices: [
                            {
                                index: 0,
                                delta,
                                finish_reason: null,
                            },
                        ],
                    };
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                    await new Promise(r => setTimeout(r, 5));
                }
            }
            res.write(`data: ${JSON.stringify({
                id: "chatcmpl-" + Date.now(),
                object: "chat.completion.chunk",
                choices: [
                    {
                        index: 0,
                        delta: {},
                        finish_reason: "stop",
                    },
                ],
            })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
        }
        const result = await geminiModel.generateContent(prompt);
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
        res.status(500).json({ error: err.message });
    }
});
app.listen(4000, () => {
    console.log("🚀 OpenAI-compatible Gemini wrapper running on port 4000");
});