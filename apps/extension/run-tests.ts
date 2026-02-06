#!/usr/bin/env ts-node
/**
 * Standalone test runner for Prune Intelligence Engine
 * Run with: npx ts-node run-tests.ts
 */

import {
  SymbolExtractor,
  RelevanceDAG,
  IntentClassifier,
  DAGWalker,
  ContextUtilityTracker,
  KnownKnowledgeDetector,
  AdaptiveBudgetCalculator,
  ResponseAnalyzer,
  ContextManifestGenerator,
  PruneIntelligenceEngine,
  type CodeSymbol,
  type IntentType,
} from "./src/prune-intelligence";

import { testSamples, TestRunner } from "./src/prune-intelligence.test";

// Run tests
async function main() {
  console.log("Starting Prune Intelligence Engine Test Suite...\n");

  const runner = new TestRunner();
  await runner.runAllTests();
}

main().catch(console.error);
