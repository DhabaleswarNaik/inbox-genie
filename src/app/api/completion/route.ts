import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";

export const runtime = "edge"; // optional, improves performance on Vercel Edge

export async function POST(req: Request) {
  // extract the prompt from the body
  const { prompt } = await req.json();

  const result = await streamText({
    model: openai("gpt-4o-mini"), // same model, new syntax
    messages: [
      {
        role: "system",
        content: `You are a helpful AI embedded in a notion text editor app that is used to autocomplete sentences
        The traits of AI include expert knowledge, helpfulness, cleverness, and articulateness.
        AI is a well-behaved and well-mannered individual.
        AI is always friendly, kind, and inspiring, and he is eager to provide vivid and thoughtful responses to the user.`,
      },
      {
        role: "user",
        content: `
        I am writing a piece of text in a notion text editor app.
        Help me complete my train of thought here: ##${prompt}##
        keep the tone of the text consistent with the rest of the text.
        keep the response short and sweet.
        `,
      },
    ],
  });

  // ✅ Modern replacement for StreamingTextResponse
  return result.toDataStreamResponse();
}
