import OpenAI from "openai";

export const client = new OpenAI();

const response = await client.responses.create({
    model: "gpt-4.1-mini",
    input: "Hello"
});
//@ts-ignore
//console.log(response.output[0].content[0].text);
console.log(response.output_text);
//Query
//Embedding
//Search in memory
//Top K search
//Injected in prompt
//History
//send to llm
//response
//response to create new memory + response to user.