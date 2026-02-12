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
  {
    id: "smart-copy",
    feature: "Smart Copy",
    prompt: "Copy auth service for AI context",
    command: "prune.smartCopy → auth/service.ts",
    status: "Extracting signatures...",
    result: "3,200 tokens → 340 tokens (89% saved)",
    highlight: "89%",
  },
  {
    id: "preflight",
    feature: "Pre-flight",
    prompt: "Fix the header alignment bug",
    command: "prune.preflight → analyzing context...",
    status: "Calculating optimal context...",
    result: "47,000 → 8,200 tokens ($0.14 → $0.02)",
    highlight: "82%",
  },
  {
    id: "session-memory",
    feature: "Session Memory",
    prompt: "Read auth.ts again for context",
    command: "prune.sessionCheck → auth.ts",
    status: "Checking session memory...",
    result: "Already in context (turn 1). Skipping.",
    highlight: "2.4K saved",
  },
  {
    id: "context-analysis",
    feature: "Context Analysis",
    prompt: "Add rate limiting to API",
    command: "prune.analyzeContext → workspace",
    status: "Scoring file relevance...",
    result: "3 files recommended (skip 31 irrelevant)",
    highlight: "91%",
  },
  {
    id: "compaction",
    feature: "Compaction Recovery",
    prompt: "Check decisions before context compacts",
    command: "prune.compactionCheck → session",
    status: "Scanning architectural decisions...",
    result: "3 decisions at risk. Reminder copied.",
    highlight: "Protected",
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
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-status-green/10 border border-status-green/20">
            <svg className="w-4 h-4 text-status-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-semibold text-status-green">{simulation.highlight} saved</span>
          </div>
        </div>
      )}
    </div>
  );
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

  const handleDotClick = useCallback((index: number) => {
    setPhase("typing");
    setCurrentIndex(index);
  }, []);

  return (
    <div
      className={cn("relative", className)}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Terminal */}
      <TerminalWindow simulation={currentSimulation} phase={phase} />

      {/* Navigation Dots */}
      <div className="flex justify-center gap-2 mt-6">
        {SIMULATIONS.map((sim, index) => (
          <button
            key={sim.id}
            onClick={() => handleDotClick(index)}
            className={cn(
              "w-2 h-2 rounded-full transition-all duration-300",
              index === currentIndex
                ? "bg-status-green w-6"
                : "bg-border hover:bg-secondary"
            )}
            aria-label={`View ${sim.feature} demo`}
          />
        ))}
      </div>

      {/* Feature Labels */}
      <div className="flex justify-center gap-3 mt-4 flex-wrap">
        {SIMULATIONS.map((sim, index) => (
          <button
            key={sim.id}
            onClick={() => handleDotClick(index)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
              index === currentIndex
                ? "bg-foreground text-background"
                : "bg-transparent text-secondary hover:text-foreground border border-border hover:border-secondary"
            )}
          >
            {sim.feature}
          </button>
        ))}
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
