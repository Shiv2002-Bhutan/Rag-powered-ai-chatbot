import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs/promises';

import {
    setupRAG,
    getVectorStore,
    getLlm,
    setVectorStore,
    ingestData,
} from './rag_core.js';

const app = express();
const port = 5000;

app.use(bodyParser.json());
app.use(cors());

const upload = multer({ dest: 'uploads/' });

let llm, vectorStore;

async function initialize() {
    console.log("Initializing RAG system...");
    await setupRAG();
    llm = getLlm();
    vectorStore = getVectorStore();
    console.log("RAG system ready.");
}
initialize();

app.post('/upload', upload.single('pdf'), async (req, res) => {
    const url = req.body.url?.trim();
    const file = req.file;

    if (!url && !file) {
        return res.status(400).json({ error: 'Please provide at least a URL or a PDF file.' });
    }

    try {
        // Pass file path string instead of Buffer
        const pdfInput = file ? file.path : null;

        const result = await ingestData({ url, pdf: pdfInput });
        
        if (file) await fs.unlink(file.path);

        setVectorStore(result.vectorStore);
        vectorStore = getVectorStore();

        res.status(200).json({
            message: 'Data uploaded and processed successfully.',
            details: `Chunks processed: ${result.chunksCount}, documents ingested: ${result.documentsCount}`,
        });
    } catch (err) {
        console.error('Error processing upload:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

app.post('/chat', async (req, res) => {
    const userQuery = req.body.query?.trim();
    const conversationHistory = req.body.history || [];

    if (!vectorStore || !llm) {
        return res.status(503).send('RAG system is not yet initialized. Please upload data first.');
    }

    if (!userQuery || typeof userQuery !== 'string' || userQuery.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid query. Please provide a non-empty string.' });
    }

    try {
        let relevantDocs;
        try {
            relevantDocs = await vectorStore.similaritySearch(userQuery, 4, { where: {} });
        } catch (searchError) {
            console.error("Warning: similaritySearch with where clause failed. Falling back to simple search.");
            relevantDocs = await vectorStore.similaritySearch(userQuery, 4);
        }

        const knowledge = relevantDocs.map(doc => doc.pageContent).join('\n\n');
        const historyString = conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n');

        const ragPrompt = `
You are a friendly, professional AI assistant named aBitBot, designed for seamless user interaction. Your primary function is to provide accurate and relevant information using ONLY the knowledge provided below.

Core Instructions:
- your are an AI-powered chatbot that engages customers and visitors, answering questions about our products and services with personalized, HR- or agent-level support.
- Persona: Maintain a professional and helpful tone and can be creative but keep your response simple.
- Knowledge: Your answers must be based strictly on the provided knowledge. Do NOT use any external information, personal opinions, or speculation.
- "I Don't Know" Policy: If the provided knowledge does not contain the answer, politely state that you cannot find the information. You may then suggest related topics if relevant, but do not make up an answer.But should give your best to find the answer and anything that user might find useful according to their query based on the data you have.You can we creative in your response but response should not be out of context.
- Formatting: Use markdown formatting like bold text, bullet points, or numbered lists to improve clarity when appropriate.
-Don't make your response lengthy keep it precise and relevant. 

Specific User Scenarios:
- Greeting: If the user's query is a simple greeting (e.g., "hello", "hi"), respond with a warm and inviting welcome, such as "Hello! How can I assist you today?" or similar greeting message.But you don't have to greet in every response.
- Contact Details: When providing contact information or website links, ensure the links are clickable and properly formatted.
- Further Assistance: Always end your response by politely offering further assistance, for example, "Is there anything else I can help you with?"

Conversation Context:
Question: ${userQuery}
Knowledge: ${knowledge}
Conversation history: ${historyString}

`;

        const response = await llm.invoke(ragPrompt);
        res.status(200).json({ response: response.content });
    } catch (error) {
        console.error('Error processing chat request:', error);
        res.status(500).json({ error: "An internal server error occurred." });
    }
});
// Health check endpoint
app.get('/status', (req, res) => {
  if (!vectorStore || !llm) {
    return res.status(503).json({ message: 'RAG system is not yet initialized.' });
  }
  res.status(200).json({ message: '✅ Backend is running and RAG system ready.' });
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
