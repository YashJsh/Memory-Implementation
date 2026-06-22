import type { Embedding } from "openai/resources";
import { client } from ".";
import { QdrantClient } from "@qdrant/js-client-rest";
import { MEMORY_AGENT_PROMPT } from "./prompt";

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
            content : MEMORY_AGENT_PROMPT
            // content: `You are an expert AI agent, whose job is to find relevant information from the query given by user. If you think the data is necessary for user, then only use the tool-call for saving the data. Before doing anything first, find the similarity using the check_similarity, and from this result create or update in the memory.

            // You have three tools :  
            // 1. add_to_memory. For example : query -> 'I live in banglore', so this data is important for the user. So you can save this information using the toolCall and you need to save only like "User lives in banglore". Example2 : Query -> I am yash and i like dosa. So for this you have to save "user name yash" and "yash likes dosa".  You have to multiple tool call in this case. For first to store user's name and then 'user likes dosa'. You have to store crisp information.  Example3 : Query : 'Hello, how are you', these types of data don't need to be stored in memory.

            // 2. check_similarity : This tools helps you to find the closest similar data stored in the memory. It gives you top similar results with their id's back to you. 

            // 3. update_to_memory : This tool helps you to update the memory. You have to send the data and id of the data which you think is the similar to new data.
            // For this tool, you need the result of check_similarity tool. Otherwise this tool is of no use. 
            // For example : 
            // Old Query -> I live in banglore. -> It means in memory it is stored that user lives in banglore.
            // New Query -> I have shifted to delhi -> It means we have to update this memory. With lives in delhi.
            
            // Update the memory only if you thing they are similar, And the new memory is important than the previous one. If the previous one is important too, then create a new only. 
            // Any specific event, useful data, which can be useful in future use needs to be preserved. Otherwise just do nothing.`
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
                },
                {
                    type: "function",
                    function: {
                        name: "check_similarity",
                        description: "This tool get the similar results to our query from memory.",
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
                },
                {
                    type: "function",
                    function: {
                        name: "update_memory",
                        description: "This tool updated the point in the memory",
                        parameters: {
                            type: "object",
                            properties: {
                                data: {
                                    type: "string",
                                    description: "The data we want to store in the memory",
                                },
                                id: {
                                    type: "string",
                                    description: "This id is the points id, which is needed to update the point in the memory"
                                }
                            },
                            required: ["data", "id"],
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
            for (const toolCall of message.tool_calls ?? []) {
                if (toolCall.function.name === "add_to_memory") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await addToMemory(args.data);
                    localMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                }
                if (toolCall.function.name === "check_similarity") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await checkSimilar(args.data);
                    localMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                }
                if (toolCall.function.name === "update_memory") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await updateToMemory(args.data, args.id);
                    localMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                }
            }
        } else {
            // console.log(`[Memory] No tool calls triggered. Finish reason: "${choice.finish_reason}"`);
            break;
        }
    }
}

const checkSimilar = async (data: string) => {
    console.log("[assistant]: Checking for similar memories")
    const embedding = await makeEmbeddings(data);
    const result = await quadrantClient.search(COLLECTION_NAME, {
        vector: embedding[0]?.embedding!,
        limit: 5
    });

    const returnable = JSON.stringify(
        result.map(d => ({
            id: d.id,
            payload: d.payload?.text
        }))
    );
    console.log("Returnable data : ", returnable);
    return returnable;
}

const updateToMemory = async (data: string, id: string) => {
    console.log("[assistant]: Updating the existing memory")
    const embedding = await makeEmbeddings(data);
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
                id: id,
                vector: embedding[0]?.embedding!,
                payload: {
                    text: data,
                    createdAt: new Date().toISOString(),
                },
            }
        ]
    })
    console.log(`[Memory] Successfully updated to Qdrant: "${data}"`);
    return "Memory updated successsfully";
}

const addToMemory = async (data: string) => {
    if (!data) return "No data provided";
    console.log(`[Memory] Creating / Saving to database: "${data}"`);
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
    return `${data} added in memory`;
}