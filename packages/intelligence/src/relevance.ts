/**
 * TF-IDF based relevance scoring for code blocks
 */

import { tokenize, extractCodeTerms } from "./tokenizer.js";

export interface RelevanceScore {
  score: number; // 0-1, where 1 is most relevant
  matchedTerms: string[];
  category: "relevant" | "peripheral" | "noise";
}

/**
 * Calculate TF (Term Frequency) for a document
 */
function calculateTF(terms: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  const totalTerms = terms.length;

  if (totalTerms === 0) return tf;

  for (const term of terms) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }

  // Normalize by total terms
  for (const [term, count] of tf) {
    tf.set(term, count / totalTerms);
  }

  return tf;
}

/**
 * Calculate IDF (Inverse Document Frequency) across documents
 */
function calculateIDF(
  documents: string[][],
  vocabulary: Set<string>
): Map<string, number> {
  const idf = new Map<string, number>();
  const numDocs = documents.length;

  for (const term of vocabulary) {
    let docCount = 0;
    for (const doc of documents) {
      if (doc.includes(term)) {
        docCount++;
      }
    }
    // Add 1 to avoid division by zero
    idf.set(term, Math.log((numDocs + 1) / (docCount + 1)) + 1);
  }

  return idf;
}

/**
 * Calculate TF-IDF vector for a document
 */
function calculateTFIDF(
  terms: string[],
  idf: Map<string, number>
): Map<string, number> {
  const tf = calculateTF(terms);
  const tfidf = new Map<string, number>();

  for (const [term, tfScore] of tf) {
    const idfScore = idf.get(term) || 1;
    tfidf.set(term, tfScore * idfScore);
  }

  return tfidf;
}

/**
 * Calculate cosine similarity between two TF-IDF vectors
 */
function cosineSimilarity(
  vec1: Map<string, number>,
  vec2: Map<string, number>
): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  // Calculate dot product
  for (const [term, score] of vec1) {
    if (vec2.has(term)) {
      dotProduct += score * (vec2.get(term) || 0);
    }
    norm1 += score * score;
  }

  for (const [, score] of vec2) {
    norm2 += score * score;
  }

  const normProduct = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (normProduct === 0) return 0;

  return dotProduct / normProduct;
}

/**
 * Score relevance of a code block to a prompt using TF-IDF
 */
export function scoreRelevance(
  prompt: string,
  codeBlock: string,
  isCode: boolean
): RelevanceScore {
  // Extract terms from prompt (natural language + potential code terms)
  const promptTerms = [
    ...tokenize(prompt),
    ...extractCodeTerms(prompt),
  ];

  // Extract terms from code block
  const blockTerms = isCode
    ? extractCodeTerms(codeBlock)
    : tokenize(codeBlock);

  if (promptTerms.length === 0 || blockTerms.length === 0) {
    return { score: 0.5, matchedTerms: [], category: "peripheral" };
  }

  // Build vocabulary
  const vocabulary = new Set([...promptTerms, ...blockTerms]);

  // Calculate IDF using both documents
  const idf = calculateIDF([promptTerms, blockTerms], vocabulary);

  // Calculate TF-IDF vectors
  const promptTFIDF = calculateTFIDF(promptTerms, idf);
  const blockTFIDF = calculateTFIDF(blockTerms, idf);

  // Calculate cosine similarity
  const similarity = cosineSimilarity(promptTFIDF, blockTFIDF);

  // Find matched terms (terms that appear in both)
  const matchedTerms: string[] = [];
  for (const term of promptTerms) {
    if (blockTerms.includes(term) && !matchedTerms.includes(term)) {
      matchedTerms.push(term);
    }
  }

  // Apply keyword boost for exact matches
  const keywordBoost = Math.min(0.3, matchedTerms.length * 0.05);
  const finalScore = Math.min(1, similarity + keywordBoost);

  // Categorize based on score
  let category: "relevant" | "peripheral" | "noise";
  if (finalScore >= 0.7) {
    category = "relevant";
  } else if (finalScore >= 0.4) {
    category = "peripheral";
  } else {
    category = "noise";
  }

  return { score: finalScore, matchedTerms, category };
}

/**
 * Batch score multiple code blocks against a prompt
 */
export function scoreCodeBlocks(
  prompt: string,
  blocks: Array<{ content: string; isCode: boolean; file?: string; startLine?: number; endLine?: number }>
): Array<{
  content: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  relevance: RelevanceScore;
}> {
  return blocks.map((block) => ({
    ...block,
    relevance: scoreRelevance(prompt, block.content, block.isCode),
  }));
}
