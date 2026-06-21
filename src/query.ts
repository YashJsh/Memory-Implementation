import type { Embedding } from "openai/resources";
import { client } from ".";

export const refineQuery = async (query: string) => {
    const response = await client.responses.create({
        model: "gpt-4.1-mini",
        input: [
            {
                role : "system",
                content : "Your only and only task is to remove the filler words from the query. Don't change anything. Just structure the prompt only."
            },
            {
                role : "user",
                content : query
            }
        ]
    });
    return response.output_text;
}

export const makeEmbeddings = async (query : string)=>{
    const embeddings = await client.embeddings.create({
        input : query,
        model : 'text-embedding-3-small'
    });
    return embeddings.data;
}
