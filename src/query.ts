import type { Embedding } from "openai/resources";
import { client } from ".";
import { QdrantClient } from "@qdrant/js-client-rest";

const quadrantClient = new QdrantClient({ host: "localhost", port: 6333 });

export const refineQuery = async (query: string) => {
    const response = await client.responses.create({
        model: "gpt-4.1-mini",
        input: [
            {
                role: "system",
                content: "Your only and only task is to remove the filler words from the query. Don't change anything. Just structure the prompt only."
            },
            {
                role: "user",
                content: query
            }
        ]
    });
    return response.output_text;
}

export const makeEmbeddings = async (query: string) => {
    const embeddings = await client.embeddings.create({
        input: query,
        model: 'text-embedding-3-small'
    });
    return embeddings.data;
}

export const getSimilarResultFromMemory = async (embedding: Embedding[]) => {
    const result = await quadrantClient.search("testing_user", {
        vector: embedding[0]?.embedding!,
        limit: 5
    })
    return result;
}

let messages: any = [];

export const addInMemory = async (data: string) => {
    messages.push({
        role : "system",
        content : "You are an expert AI agent, whose job is toh find relevant information from the query given by user. If you think the data is necessary for user. Then only use the tool-call for saving the data. You have only one tool. Which is add_to_memory. For example : query -> I live in banglore, So this data is important for the user. So you can save this information using the toolCall. For example : Query : Hello, how are you , These type of data don't need to be stored in memory. Any specific event, useful data, which can be usefull in future use needs to be preserved. Otherwise just do nothing and return simple string which says : `Not added`"
    },{
        role: "assistant",
        content: data
    });
    while (true) {
        const response = await client.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: messages,
            tools: [
                {
                    type: "function",
                    function: {
                        name: "add_to_memory",
                        description: "This tool adds important information of user in the memory",
                        parameters: {
                            type: "object",
                            properties: {
                                data: {
                                    type: "string",
                                    description: "The data we want to store in the memory",
                                },
                            },
                            required: ["sign"],
                        },
                    },
                }
            ]
        });

        if (response.choices[0]?.finish_reason == "stop") {
            messages = [];
            return;
        }

        if (response.choices[0]?.finish_reason == "tool_calls") {
            //@ts-ignore
            const args = response.choices[0]?.message.tool_calls?.[0]?.function.arguments;
            //@ts-ignore
            const tool_name = response.choices[0]?.message.tool_calls?.[0]?.function.name;
            if (tool_name == "add_to_memory") {
                const response = addToMemory(args.data);
                messages.push({
                    role: "toolCall",
                    content: response
                });
            };
        }
    }
}

const addToMemory = async (data: string) => {
    const createEmbeddings = await makeEmbeddings(data);
    try {
        await quadrantClient.getCollection("testing_user");
    } catch (error) {
        await quadrantClient.createCollection("testing_user", {
            vectors: {
                size: 1536,
                distance: "Cosine"
            }
        });
    }
    await quadrantClient.upsert("testing-user", {
        wait: true,
        points: [
            {
                id: crypto.randomUUID(),
                vector: createEmbeddings[0]?.embedding!,
                payload: {
                    text: data,
                    createdAt: new Date().toISOString(),
                },
            },
        ],
    });
    return "Added in Memory"
}