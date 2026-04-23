import OpenAI from "openai";

const client = new OpenAI({
    apiKey: "ant",
    baseURL: "http://localhost:4000/v1",
});

const response = await client.chat.completions.create({
    model: "dolphin:code-advanced",
    messages: [
        { role: "user", content: "Hello!" }
    ],
    stream: true
});

for await (const chunk of response) {
    process.stdout.write(chunk.choices[0]?.delta?.content || "");
}