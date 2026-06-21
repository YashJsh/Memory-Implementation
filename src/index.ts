import OpenAI from "openai";
import { addInMemory, getSimilarResultFromMemory, makeEmbeddings, refineQuery } from "./query";

export const client = new OpenAI();

let messages = [];

const main = async (query : string)=>{
    const refined = await refineQuery(query);
    const embeddings = await makeEmbeddings(refined);
    const similarResult = await getSimilarResultFromMemory(embeddings);
    const prompt = `
    You are a agent which answers users query. You have a memory where the details about the user is stored. Whenever you are asked something. You are give the data of the needed detail along with the prompt. So you can answer according to the memory you remember of the user. 
    Here is the memory which i found about the user for this query:
    ${similarResult}
`
    messages.push({
        role : "system",
        content : prompt
    }, {
        role : "user",
        content : query
    });

    const ai_response = await ai(messages);
    console.log(ai_response);
    await addInMemory(ai_response);
}

const ai = async (messages : any)=>{
    const response = await client.responses.create({
        model : "gpt-4.1-mini",
        input : messages
    });
    return response.output_text;
}

main("hello");

//@ts-ignore
//console.log(response.output[0].content[0].text);

//Query
//Embedding
//Search in memory
//Top K search
//Injected in prompt
//History
//send to llm
//response
//response to create new memory + response to user.