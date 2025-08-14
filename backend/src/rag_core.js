import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";
import { load } from "cheerio";
import dotenv from "dotenv";
import fs from "fs";
import { log } from "console";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let vectorStore, llm, embeddingModel;

/**
 * Crawl and scrape starting from a URL, collecting internal links up to maxPages
 */
async function scrapeWebsite(startUrl, maxPages = 40) {
    const visited = new Set();
    const docs = [];

    function toAbsoluteUrl(base, relative) {
        try {
            return new URL(relative, base).toString();
        } catch {
            return null;
        }
    }

    function isInternalUrl(url) {
        try {
            const startOrigin = new URL(startUrl).origin;
            return url.startsWith(startOrigin);
        } catch {
            return false;
        }
    }

    async function crawl(url) {
        if (visited.size >= maxPages) return;
        if (visited.has(url)) return;
        visited.add(url);

        try {
            const loader = new CheerioWebBaseLoader(url, {
                selector: "p, h1, h2, h3, li,a,span",
            });
            const pageDocs = await loader.load();
            docs.push(...pageDocs);
        } catch (e) {
            console.warn(`Failed to load ${url}:`, e.message);
        }

        try {
            const res = await fetch(url);
            if (!res.ok) return;
            const html = await res.text();
            const $ = load(html);
            const links = $("a[href]")
                .map((_, el) => $(el).attr("href"))
                .get()
                .map(link => toAbsoluteUrl(url, link))
                .filter(link => link && isInternalUrl(link));

            for (const link of links) {
                if (visited.size >= maxPages) break;
                await crawl(link);
            }
        } catch (e) {
            console.warn(`Failed to fetch/parse links from ${url}:`, e.message);
        }
    }

    await crawl(startUrl);
    return docs;
}

/**
 * Load and parse PDF file from a file path (string)
 */
async function loadPdfDocs(pdfPath) {
    const loader = new PDFLoader(pdfPath);
    const docs = await loader.load();
    return docs;
}

/**
 * Split documents into chunks for embeddings
 */
async function prepareAndSplitDocuments(docs) {
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 300,
        chunkOverlap: 100,
    });
    return splitter.splitDocuments(docs);
}

/**
 * Get or create the vector store instance.
 * It re-uses the existing vector store if available,
 * otherwise, it creates a new one.
 */
async function getOrCreateVectorStore(embeddingModelInstance) {
    if (vectorStore) {
        return vectorStore;
    }
    
    console.log("Creating new vector store collection 'data_collection'...");
    const store = new Chroma(embeddingModelInstance, {
        collectionName: "data_collection",
        url: "http://localhost:8000",
    });
    
    // Attempt to get the collection to see if it exists
    // This part is for initial setup, to ensure the connection is valid
    try {
        await store.get();
        console.log("Existing collection 'data_collection' found and connected.");
    } catch (e) {
        // If the collection does not exist, a new one will be created on the first `addDocuments` call.
        console.log("Collection 'data_collection' not found, will be created.");
    }
    
    return store;
}

/**
 * Setup embeddings and LLM instance
 */
async function setupRAG() {
    embeddingModel = new GoogleGenerativeAIEmbeddings({
        apiKey: GEMINI_API_KEY,
    });

    llm = new ChatGoogleGenerativeAI({
        apiKey: GEMINI_API_KEY,
        model: "gemini-1.5-flash",
        temperature: 0.4,
    });

    // Initialize the vector store here to make it ready
    vectorStore = await getOrCreateVectorStore(embeddingModel);
}

/**
 * Process input data (URL and/or PDF)
 */
async function ingestData({ url, pdf }) {
    let allDocs = [];

    if (url) {
        console.log(`Starting to scrape URL: ${url}`);
        const internalLinks = 10;
        const urlDocs = await scrapeWebsite(url, internalLinks);
        allDocs = allDocs.concat(urlDocs);
        console.log("scrapping completed");
    }

    if (pdf) {
        console.log(`Loading PDF documents`);
        const pdfDocs = await loadPdfDocs(pdf);
        allDocs = allDocs.concat(pdfDocs);
    }

    if (allDocs.length === 0) {
        throw new Error("No documents found from URL or PDF.");
    }

    const chunks = await prepareAndSplitDocuments(allDocs);
    
    // Add the new documents to the existing vector store
    const uuids = chunks.map(() => uuidv4());
    await vectorStore.addDocuments(chunks, { ids: uuids });

    return { chunksCount: chunks.length, documentsCount: allDocs.length, vectorStore: vectorStore };
}

/**
 * Query the vector store and return structured result (dynamic numResults)
 */
async function queryRAG(query) {
    if (!vectorStore || !llm) {
        throw new Error("RAG not set up. Call setupRAG() and ingestData() first.");
    }

    const wordCount = query.trim().split(/\s+/).length;
    let numResults;
    if (wordCount <= 5) {
        numResults = 3;
    } else if (wordCount <= 15) {
        numResults = 5;
    } else {
        numResults = 8;
    }

    const retriever = vectorStore.asRetriever({ searchKwargs: { k: numResults } });
    const retrievedDocs = await retriever.getRelevantDocuments(query);

    const context = retrievedDocs.map(doc => doc.pageContent).join("\n\n");
    const response = await llm.invoke(`Answer the following question based only on the context:\n${context}\n\nQuestion: ${query}`);

    const result = {
        query,
        numResults,
        retrievedDocs,
        answer: response.content || response
    };

    return result;
}

/**
 * Getters and setters
 */
function getVectorStore() {
    return vectorStore;
}

function getLlm() {
    return llm;
}

function getEmbeddingModel() {
    return embeddingModel;
}

function setVectorStore(store) {
    vectorStore = store;
}

export {
    setupRAG,
    getVectorStore,
    getLlm,
    getEmbeddingModel,
    setVectorStore,
    scrapeWebsite,
    prepareAndSplitDocuments,
    ingestData,
    queryRAG,
};