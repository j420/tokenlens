import { describe, it, expect } from "vitest";
import { scoreRelevance, scoreCodeBlocks } from "./relevance.js";

describe("scoreRelevance", () => {
  it("returns a score for matching content", () => {
    const prompt = "How do I implement user authentication?";
    const code = `
      function authenticateUser(username, password) {
        // Validate credentials
        return checkUserCredentials(username, password);
      }
    `;
    const score = scoreRelevance(prompt, code, true);
    // TF-IDF scores are relative, so we just check it's a valid score
    expect(score.score).toBeGreaterThan(0);
    expect(score.score).toBeLessThanOrEqual(1);
    expect(score.matchedTerms.length).toBeGreaterThan(0);
  });

  it("returns lower score for unrelated content", () => {
    const prompt = "How do I implement user authentication?";
    const relevantCode = `function authenticateUser(user, pass) { return verify(user, pass); }`;
    const unrelatedCode = `function calculateShippingCost(weight, distance) { return weight * distance * 0.5; }`;

    const relevantScore = scoreRelevance(prompt, relevantCode, true);
    const unrelatedScore = scoreRelevance(prompt, unrelatedCode, true);

    // Related code should score higher than unrelated
    expect(relevantScore.score).toBeGreaterThan(unrelatedScore.score);
  });

  it("categorizes content based on score thresholds", () => {
    const prompt = "How do I handle form validation?";
    const code = `function validateInput(value) { return value.length > 0; }`;
    const score = scoreRelevance(prompt, code, true);
    // Just verify we get a valid category
    expect(["relevant", "peripheral", "noise"]).toContain(score.category);
  });

  it("handles empty strings gracefully", () => {
    const score1 = scoreRelevance("", "some code", true);
    expect(score1.score).toBe(0.5); // Defaults to peripheral score
    expect(score1.category).toBe("peripheral");

    const score2 = scoreRelevance("some prompt", "", true);
    expect(score2.score).toBe(0.5);
    expect(score2.category).toBe("peripheral");
  });

  it("gives higher score for exact keyword matches", () => {
    const prompt = "Fix the getUserById function";
    const codeWithMatch = `function getUserById(id) { return users.find(u => u.id === id); }`;
    const codeWithoutMatch = `function fetchData(id) { return db.query(id); }`;

    const scoreWith = scoreRelevance(prompt, codeWithMatch, true);
    const scoreWithout = scoreRelevance(prompt, codeWithoutMatch, true);

    expect(scoreWith.score).toBeGreaterThan(scoreWithout.score);
  });
});

describe("scoreCodeBlocks", () => {
  it("scores multiple blocks", () => {
    const prompt = "Implement user login";
    const blocks = [
      { content: "function login() { }", isCode: true },
      { content: "function calculateTax() { }", isCode: true },
    ];

    const scores = scoreCodeBlocks(prompt, blocks);
    expect(scores).toHaveLength(2);
    // Both should have relevance objects
    expect(scores[0].relevance).toBeDefined();
    expect(scores[1].relevance).toBeDefined();
  });

  it("returns empty array for empty input", () => {
    const scores = scoreCodeBlocks("test", []);
    expect(scores).toEqual([]);
  });
});
