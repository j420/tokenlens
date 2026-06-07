"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

// ============================================================================
// Simulation Data
// ============================================================================

interface SimulationStep {
  id: string;
  feature: string;
  prompt: string;
  command: string;
  status: string;
  result?: string;
  highlight?: string;
}

const SIMULATIONS: SimulationStep[] = [
  // Smart Copy variants
  {
    id: "smart-copy-1",
    feature: "Smart Copy",
    prompt: "Copy auth service for AI context",
    command: "prune.smartCopy → auth/service.ts",
    status: "Extracting signatures...",
    result: "3,200 tokens → 340 tokens (89% saved)",
    highlight: "89%",
  },
  {
    id: "smart-copy-2",
    feature: "Smart Copy",
    prompt: "Copy entire API folder for refactoring",
    command: "prune.smartCopy → src/api/* (12 files)",
    status: "Extracting signatures...",
    result: "28,400 tokens → 2,100 tokens (93% saved)",
    highlight: "93%",
  },
  {
    id: "smart-copy-3",
    feature: "Smart Copy",
    prompt: "Share database models with AI",
    command: "prune.smartCopy → models/*.ts",
    status: "Extracting type definitions...",
    result: "8,900 tokens → 890 tokens (90% saved)",
    highlight: "90%",
  },

  // Pre-flight variants
  {
    id: "preflight-1",
    feature: "Pre-flight",
    prompt: "Fix the header alignment bug",
    command: "prune.preflight → analyzing context...",
    status: "Calculating optimal context...",
    result: "47,000 → 8,200 tokens ($0.14 → $0.02)",
    highlight: "82%",
  },
  {
    id: "preflight-2",
    feature: "Pre-flight",
    prompt: "Add dark mode to the dashboard",
    command: "prune.preflight → scanning 89 files...",
    status: "Finding relevant components...",
    result: "124,000 → 15,600 tokens ($0.37 → $0.05)",
    highlight: "87%",
  },
  {
    id: "preflight-3",
    feature: "Pre-flight",
    prompt: "Write unit tests for UserService",
    command: "prune.preflight → analyzing dependencies...",
    status: "Mapping test coverage...",
    result: "31,000 → 6,200 tokens ($0.09 → $0.02)",
    highlight: "80%",
  },

  // Session Memory variants
  {
    id: "session-memory-1",
    feature: "Session Memory",
    prompt: "Read auth.ts again for context",
    command: "prune.sessionCheck → auth.ts",
    status: "Checking session memory...",
    result: "Already in context (turn 1). Skipping.",
    highlight: "2.4K saved",
  },
  {
    id: "session-memory-2",
    feature: "Session Memory",
    prompt: "Need to check the config file again",
    command: "prune.sessionCheck → config/index.ts",
    status: "Checking session memory...",
    result: "Already in context (turn 3). Skipping.",
    highlight: "1.8K saved",
  },
  {
    id: "session-memory-3",
    feature: "Session Memory",
    prompt: "View session deduplication stats",
    command: "prune.sessionStats → current session",
    status: "Calculating savings...",
    result: "6 files tracked, 14,200 tokens deduplicated",
    highlight: "14.2K saved",
  },

  // Context Analysis variants
  {
    id: "context-analysis-1",
    feature: "Context Analysis",
    prompt: "Add rate limiting to API",
    command: "prune.analyzeContext → workspace",
    status: "Scoring file relevance...",
    result: "3 files recommended (skip 31 irrelevant)",
    highlight: "91%",
  },
  {
    id: "context-analysis-2",
    feature: "Context Analysis",
    prompt: "Debug the checkout flow bug",
    command: "prune.analyzeContext → src/checkout/*",
    status: "Tracing error path...",
    result: "5 files critical, 2 medium (skip 18)",
    highlight: "72%",
  },
  {
    id: "context-analysis-3",
    feature: "Context Analysis",
    prompt: "Refactor payment processing",
    command: "prune.analyzeContext → analyzing imports...",
    status: "Building dependency graph...",
    result: "7 files in scope, clear refactor boundary",
    highlight: "85%",
  },

  // Compaction Recovery variants
  {
    id: "compaction-1",
    feature: "Compaction Recovery",
    prompt: "Check decisions before context compacts",
    command: "prune.compactionCheck → session",
    status: "Scanning architectural decisions...",
    result: "3 decisions at risk. Reminder copied.",
    highlight: "Protected",
  },
  {
    id: "compaction-2",
    feature: "Compaction Recovery",
    prompt: "Track: Use Redis for session storage",
    command: "prune.trackDecision → recording...",
    status: "Saving architectural decision...",
    result: "Decision saved. Will persist across compaction.",
    highlight: "Tracked",
  },
  {
    id: "compaction-3",
    feature: "Compaction Recovery",
    prompt: "Generate compaction recovery prompt",
    command: "prune.compactionCheck → 8 decisions found",
    status: "Building recovery context...",
    result: "Recovery prompt ready. 340 tokens.",
    highlight: "8 decisions",
  },
];

// ============================================================================
// Typing Animation Hook
// ============================================================================

function useTypingAnimation(text: string, speed: number = 50, startDelay: number = 0) {
  const [displayText, setDisplayText] = useState("");
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    setDisplayText("");
    setIsComplete(false);

    const delayTimeout = setTimeout(() => {
      let currentIndex = 0;
      const interval = setInterval(() => {
        if (currentIndex < text.length) {
          setDisplayText(text.slice(0, currentIndex + 1));
          currentIndex++;
        } else {
          setIsComplete(true);
          clearInterval(interval);
        }
      }, speed);

      return () => clearInterval(interval);
    }, startDelay);

    return () => clearTimeout(delayTimeout);
  }, [text, speed, startDelay]);

  return { displayText, isComplete };
}

// ============================================================================
// Terminal Window Component
// ============================================================================

interface TerminalWindowProps {
  simulation: SimulationStep;
  phase: "typing" | "processing" | "result";
}

function TerminalWindow({ simulation, phase }: TerminalWindowProps) {
  const { displayText: promptText, isComplete: promptComplete } = useTypingAnimation(
    simulation.prompt,
    40,
    300
  );

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Window Chrome */}
      <div className="rounded-xl overflow-hidden shadow-2xl border border-border/50">
        {/* Title Bar */}
        <div className="bg-[#1a1b26] px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
            <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
          </div>
          <div className="flex-1 text-center">
            <span className="text-xs text-[#565869] font-medium">TokenLens</span>
          </div>
        </div>

        {/* Terminal Content */}
        <div className="bg-[#1a1b26] px-5 py-5 min-h-[180px]">
          {/* Feature Badge */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[#565869] text-sm">prompt</span>
            <span className="text-[#565869]">→</span>
            <span className="px-2.5 py-1 rounded-md bg-[#3b82f6] text-white text-xs font-medium">
              {simulation.feature}
            </span>
          </div>

          {/* Command Line */}
          <div className="font-mono">
            <div className="flex items-start gap-2">
              <span className="text-[#3b82f6] select-none">$</span>
              <span className="text-[#7dcfff]">
                {promptText}
                {!promptComplete && (
                  <span className="inline-block w-2 h-4 bg-[#7dcfff] ml-0.5 animate-pulse" />
                )}
              </span>
            </div>
          </div>

          {/* Status Line */}
          {(phase === "processing" || phase === "result") && promptComplete && (
            <div className="mt-4 flex items-center gap-2">
              <span
                className={cn(
                  "w-2 h-2 rounded-full",
                  phase === "processing" ? "bg-[#e0af68] animate-pulse" : "bg-[#9ece6a]"
                )}
              />
              <span className="text-sm text-[#a9b1d6]">
                {phase === "processing" ? simulation.status : simulation.command}
              </span>
            </div>
          )}

          {/* Result */}
          {phase === "result" && simulation.result && (
            <div className="mt-3 pl-4 border-l-2 border-[#9ece6a]/30">
              <p className="text-sm text-[#9ece6a]">{simulation.result}</p>
            </div>
          )}
        </div>
      </div>

      {/* Highlight Badge */}
      {phase === "result" && simulation.highlight && (
        <div className="flex justify-center mt-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent-dim border border-accent-line">
            <svg className="w-4 h-4 text-accent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-semibold text-accent-text">{simulation.highlight} saved</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Feature Categories
// ============================================================================

const FEATURES = [
  "Smart Copy",
  "Pre-flight",
  "Session Memory",
  "Context Analysis",
  "Compaction Recovery",
] as const;

type FeatureName = (typeof FEATURES)[number];

function getSimulationsByFeature(feature: FeatureName): SimulationStep[] {
  return SIMULATIONS.filter((sim) => sim.feature === feature);
}

// ============================================================================
// Feature Simulation Component
// ============================================================================

interface FeatureSimulationProps {
  className?: string;
  autoPlay?: boolean;
  intervalMs?: number;
}

export function FeatureSimulation({
  className,
  autoPlay = true,
  intervalMs = 5000,
}: FeatureSimulationProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<"typing" | "processing" | "result">("typing");
  const [isPaused, setIsPaused] = useState(false);

  const currentSimulation = SIMULATIONS[currentIndex];
  const currentFeature = currentSimulation.feature as FeatureName;
  const featureSimulations = getSimulationsByFeature(currentFeature);
  const variantIndex = featureSimulations.findIndex((s) => s.id === currentSimulation.id);

  // Phase progression
  useEffect(() => {
    if (isPaused) return;

    const timers: NodeJS.Timeout[] = [];

    // Phase 1: Typing (1.5s)
    timers.push(setTimeout(() => setPhase("processing"), 1500));

    // Phase 2: Processing (1s more)
    timers.push(setTimeout(() => setPhase("result"), 2500));

    return () => timers.forEach(clearTimeout);
  }, [currentIndex, isPaused]);

  // Auto-advance
  useEffect(() => {
    if (!autoPlay || isPaused) return;

    const timer = setTimeout(() => {
      setPhase("typing");
      setCurrentIndex((prev) => (prev + 1) % SIMULATIONS.length);
    }, intervalMs);

    return () => clearTimeout(timer);
  }, [currentIndex, autoPlay, intervalMs, isPaused]);

  const handleFeatureClick = useCallback((feature: FeatureName) => {
    const firstSimIndex = SIMULATIONS.findIndex((s) => s.feature === feature);
    if (firstSimIndex !== -1) {
      setPhase("typing");
      setCurrentIndex(firstSimIndex);
    }
  }, []);

  const handleVariantClick = useCallback((simId: string) => {
    const index = SIMULATIONS.findIndex((s) => s.id === simId);
    if (index !== -1) {
      setPhase("typing");
      setCurrentIndex(index);
    }
  }, []);

  return (
    <div
      className={cn("relative", className)}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Terminal */}
      <TerminalWindow simulation={currentSimulation} phase={phase} />

      {/* Feature Tabs */}
      <div className="flex justify-center gap-2 mt-6 flex-wrap">
        {FEATURES.map((feature) => (
          <button
            key={feature}
            onClick={() => handleFeatureClick(feature)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
              currentFeature === feature
                ? "bg-foreground text-background"
                : "bg-transparent text-secondary hover:text-foreground border border-border hover:border-secondary"
            )}
          >
            {feature}
          </button>
        ))}
      </div>

      {/* Variant Dots (examples within current feature) */}
      <div className="flex justify-center items-center gap-3 mt-4">
        <span className="text-xs text-muted">Examples:</span>
        <div className="flex gap-1.5">
          {featureSimulations.map((sim, idx) => (
            <button
              key={sim.id}
              onClick={() => handleVariantClick(sim.id)}
              className={cn(
                "w-2 h-2 rounded-full transition-all duration-300",
                variantIndex === idx
                  ? "bg-accent w-5"
                  : "bg-border hover:bg-secondary"
              )}
              aria-label={`Example ${idx + 1}`}
            />
          ))}
        </div>
        <span className="text-xs text-muted">
          {variantIndex + 1} of {featureSimulations.length}
        </span>
      </div>

      {/* Pause indicator */}
      {isPaused && (
        <div className="absolute top-4 right-4 px-2 py-1 rounded bg-black/50 backdrop-blur-sm">
          <span className="text-xs text-white/70">Paused</span>
        </div>
      )}
    </div>
  );
}

export { SIMULATIONS };
