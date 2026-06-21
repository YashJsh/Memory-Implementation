import type { Embedding } from "openai/resources";
import { client } from ".";
import { QdrantClient } from "@qdrant/js-client-rest";

const COLLECTION_NAME = "testing_user";
const quadrantClient = new QdrantClient({ host: "localhost", port: 6333, checkCompatibility: false });

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
    try {
        const result = await quadrantClient.search(COLLECTION_NAME, {
            vector: embedding[0]?.embedding!,
            limit: 5
        });
        return result.map(item => item.payload?.text).filter(Boolean).join("\n");
    } catch (error: any) {
        if (error.status === 404 || error.statusText === "Not Found" || String(error).includes("Not Found")) {
            return "No previous memory found.";
        }
        throw error;
    }
}

export const addInMemory = async (data: string) => {
    console.log(`[Memory] Checking for memories to extract from: "${data}"`);
    const localMessages: any[] = [
        {
            role: "system",
            content: "You are an expert AI agent, whose job is to find relevant information from the query given by user. If you think the data is necessary for user, then only use the tool-call for saving the data. You have only one tool: add_to_memory. For example : query -> 'I live in banglore', so this data is important for the user. So you can save this information using the toolCall. For example : Query : 'Hello, how are you', these types of data don't need to be stored in memory. Any specific event, useful data, which can be useful in future use needs to be preserved. Otherwise just do nothing."
        },
        {
            role: "user",
            content: data
        }
    ];

    while (true) {
        const response = await client.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: localMessages,
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
                            required: ["data"],
                        },
                    },
                }
            ]
        });

        const choice = response.choices[0];
        if (!choice) break;

        const message = choice.message;
        if (message) {
            localMessages.push(message);
        }

        if (choice.finish_reason === "tool_calls") {
            const toolCall = message.tool_calls?.[0];
            if (toolCall && toolCall.function.name === "add_to_memory") {
                const parsedArgs = JSON.parse(toolCall.function.arguments || "{}");
                console.log(`[Memory] Tool add_to_memory triggered with: "${parsedArgs.data}"`);
                const toolResponse = await addToMemory(parsedArgs.data);
                localMessages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: toolResponse
                });
            }
        } else {
            console.log(`[Memory] No tool calls triggered. Finish reason: "${choice.finish_reason}"`);
            break;
        }
    }
}

const addToMemory = async (data: string) => {
    if (!data) return "No data provided";
    console.log(`[Memory] Saving to database: "${data}"`);
    const createEmbeddings = await makeEmbeddings(data);
    try {
        await quadrantClient.getCollection(COLLECTION_NAME);
    } catch (error) {
        console.log(`[Memory] Creating collection: "${COLLECTION_NAME}"`);
        await quadrantClient.createCollection(COLLECTION_NAME, {
            vectors: {
                size: 1536,
                distance: "Cosine"
            }
        });
    }
    await quadrantClient.upsert(COLLECTION_NAME, {
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
    console.log(`[Memory] Successfully saved to Qdrant: "${data}"`);
    return "Added in Memory";
}