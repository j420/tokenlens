"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { VideoPreview } from "./ui/video-preview";
import { VideoModal } from "./ui/video-modal";
import { Card } from "./ui/card";

// ============================================================================
// Feature Demo Data
// ============================================================================

export interface FeatureDemo {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  benefit: string;
  videoSrc: string;
  posterSrc: string;
  duration: string;
  category: "token-saver" | "analysis" | "utility";
  impact: "high" | "medium" | "low";
  keybinding?: { windows: string; mac: string };
  savings?: string;
}

export const FEATURE_DEMOS: FeatureDemo[] = [
  {
    id: "smart-copy",
    title: "Smart Copy",
    shortTitle: "Smart Copy",
    description: "Copy files optimized for AI - signatures only, not full implementations",
    benefit: "Reduce token usage by 70-90% when sharing code context",
    videoSrc: "/demos/smart-copy.mp4",
    posterSrc: "/demos/posters/smart-copy.svg",
    duration: "0:08",
    category: "token-saver",
    impact: "high",
    keybinding: { windows: "Ctrl+Alt+C", mac: "Cmd+Alt+C" },
    savings: "89%",
  },
  {
    id: "preflight",
    title: "Pre-flight Optimizer",
    shortTitle: "Pre-flight",
    description: "Analyze your context before sending to AI - see what you're about to spend",
    benefit: "Know your token cost upfront and optimize before spending",
    videoSrc: "/demos/preflight.mp4",
    posterSrc: "/demos/posters/preflight.svg",
    duration: "0:12",
    category: "token-saver",
    impact: "high",
    keybinding: { windows: "Ctrl+Alt+P", mac: "Cmd+Alt+P" },
    savings: "82%",
  },
  {
    id: "session-memory",
    title: "Session Memory",
    shortTitle: "Session Memory",
    description: "Tracks files already in context - prevents duplicate reads",
    benefit: "AI won't re-read files it already knows about",
    videoSrc: "/demos/session-memory.mp4",
    posterSrc: "/demos/posters/session-memory.svg",
    duration: "0:10",
    category: "token-saver",
    impact: "high",
    savings: "15K+ tokens/session",
  },
  {
    id: "compaction",
    title: "Compaction Recovery",
    shortTitle: "Compaction",
    description: "Track decisions at risk of being forgotten when context compacts",
    benefit: "Never lose important architectural decisions mid-conversation",
    videoSrc: "/demos/compaction.mp4",
    posterSrc: "/demos/posters/compaction.svg",
    duration: "0:15",
    category: "token-saver",
    impact: "high",
  },
  {
    id: "analyze-context",
    title: "Smart Context Analysis",
    shortTitle: "Context Analysis",
    description: "Given a task, scores all files for relevance and shows optimal context",
    benefit: "Include only what matters - skip irrelevant files automatically",
    videoSrc: "/demos/analyze-context.mp4",
    posterSrc: "/demos/posters/analyze-context.svg",
    duration: "0:14",
    category: "analysis",
    impact: "medium",
    keybinding: { windows: "Ctrl+Alt+A", mac: "Cmd+Alt+A" },
  },
  {
    id: "squeeze",
    title: "Code Squeezer",
    shortTitle: "Squeezer",
    description: "Compress code using AST analysis - remove comments, bodies, or go telegraphic",
    benefit: "3 compression tiers: Lossless (15%), Structural (40%), Telegraphic (70%)",
    videoSrc: "/demos/squeeze.mp4",
    posterSrc: "/demos/posters/squeeze.svg",
    duration: "0:11",
    category: "analysis",
    impact: "medium",
  },
  {
    id: "token-counter",
    title: "Real-Time Token Counter",
    shortTitle: "Token Counter",
    description: "Live token count in status bar - updates on every keystroke",
    benefit: "Always know exactly how many tokens you're working with",
    videoSrc: "/demos/token-counter.mp4",
    posterSrc: "/demos/posters/token-counter.svg",
    duration: "0:06",
    category: "utility",
    impact: "medium",
  },
];

// ============================================================================
// Category Filter
// ============================================================================

const CATEGORIES = [
  { id: "all", label: "All Features", count: FEATURE_DEMOS.length },
  { id: "token-saver", label: "Token Savers", count: FEATURE_DEMOS.filter(f => f.category === "token-saver").length },
  { id: "analysis", label: "Analysis", count: FEATURE_DEMOS.filter(f => f.category === "analysis").length },
  { id: "utility", label: "Utility", count: FEATURE_DEMOS.filter(f => f.category === "utility").length },
];

// ============================================================================
// Impact Badge
// ============================================================================

function ImpactBadge({ impact }: { impact: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-accent-dim text-accent-text border-accent-line",
    medium: "bg-status-amber/10 text-status-amber border-status-amber/20",
    low: "bg-secondary/10 text-secondary border-secondary/20",
  };

  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
      styles[impact]
    )}>
      {impact === "high" && "High Impact"}
      {impact === "medium" && "Medium Impact"}
      {impact === "low" && "Low Impact"}
    </span>
  );
}

// ============================================================================
// Feature Demo Card
// ============================================================================

interface FeatureDemoCardProps {
  demo: FeatureDemo;
  onWatchDemo: (demo: FeatureDemo) => void;
  isCompact?: boolean;
}

function FeatureDemoCard({ demo, onWatchDemo, isCompact = false }: FeatureDemoCardProps) {
  return (
    <Card
      variant="interactive"
      padding="none"
      className="overflow-hidden group"
    >
      {/* Video Preview */}
      <div className="relative">
        <VideoPreview
          videoSrc={demo.videoSrc}
          posterSrc={demo.posterSrc}
          aspectRatio="video"
          onExpand={() => onWatchDemo(demo)}
          autoPlayOnHover
        />

        {/* Duration badge */}
        <div className="absolute top-3 right-3 px-2 py-1 rounded bg-black/70 backdrop-blur-sm">
          <span className="text-xs text-white font-medium tabular-nums">{demo.duration}</span>
        </div>

        {/* Savings badge (if available) */}
        {demo.savings && (
          <div className="absolute top-3 left-3 px-2 py-1 rounded bg-accent backdrop-blur-sm">
            <span className="text-xs text-white font-semibold">{demo.savings} saved</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-foreground group-hover:text-accent-text transition-colors">
            {demo.title}
          </h3>
          <ImpactBadge impact={demo.impact} />
        </div>

        <p className="text-sm text-secondary mb-3 line-clamp-2">
          {demo.description}
        </p>

        {!isCompact && (
          <p className="text-sm text-accent-text mb-3">
            {demo.benefit}
          </p>
        )}

        <div className="flex items-center justify-between">
          {demo.keybinding && (
            <div className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 text-xs bg-card-hover border border-border rounded font-mono">
                {demo.keybinding.mac}
              </kbd>
            </div>
          )}

          <button
            onClick={() => onWatchDemo(demo)}
            className={cn(
              "flex items-center gap-1.5 text-sm font-medium",
              "text-secondary hover:text-foreground transition-colors",
              !demo.keybinding && "ml-auto"
            )}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Watch Demo
          </button>
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// Main Showcase Component
// ============================================================================

interface FeatureShowcaseProps {
  title?: string;
  subtitle?: string;
  showFilters?: boolean;
  maxFeatures?: number;
  compact?: boolean;
  className?: string;
}

export function FeatureShowcase({
  title = "See TokenLens in Action",
  subtitle = "Watch short simulations of each feature to understand how they save you tokens",
  showFilters = true,
  maxFeatures,
  compact = false,
  className,
}: FeatureShowcaseProps) {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [activeDemo, setActiveDemo] = useState<FeatureDemo | null>(null);

  const filteredDemos = FEATURE_DEMOS.filter(
    demo => activeCategory === "all" || demo.category === activeCategory
  ).slice(0, maxFeatures);

  const handleWatchDemo = useCallback((demo: FeatureDemo) => {
    setActiveDemo(demo);
  }, []);

  const handleCloseModal = useCallback(() => {
    setActiveDemo(null);
  }, []);

  return (
    <section className={cn("py-12", className)}>
      {/* Header */}
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
          {title}
        </h2>
        <p className="text-secondary max-w-2xl mx-auto">
          {subtitle}
        </p>
      </div>

      {/* Category Filters */}
      {showFilters && (
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {CATEGORIES.map(category => (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium transition-all",
                "border",
                activeCategory === category.id
                  ? "bg-foreground text-background border-foreground"
                  : "bg-transparent text-secondary border-border hover:border-secondary hover:text-foreground"
              )}
            >
              {category.label}
              <span className="ml-1.5 text-xs opacity-70">({category.count})</span>
            </button>
          ))}
        </div>
      )}

      {/* Feature Grid */}
      <div className={cn(
        "grid gap-6",
        compact
          ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
          : "grid-cols-1 md:grid-cols-2"
      )}>
        {filteredDemos.map(demo => (
          <FeatureDemoCard
            key={demo.id}
            demo={demo}
            onWatchDemo={handleWatchDemo}
            isCompact={compact}
          />
        ))}
      </div>

      {/* "See All" link if maxFeatures is set */}
      {maxFeatures && maxFeatures < FEATURE_DEMOS.length && (
        <div className="text-center mt-8">
          <a
            href="/dashboard/features"
            className={cn(
              "inline-flex items-center gap-2 px-6 py-3 rounded-lg",
              "text-sm font-medium",
              "bg-card border border-border",
              "hover:border-secondary hover:shadow-sm transition-all"
            )}
          >
            See all {FEATURE_DEMOS.length} features
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      )}

      {/* Video Modal */}
      {activeDemo && (
        <VideoModal
          isOpen={true}
          onClose={handleCloseModal}
          videoSrc={activeDemo.videoSrc}
          posterSrc={activeDemo.posterSrc}
          title={activeDemo.title}
          description={activeDemo.benefit}
          autoPlay
        />
      )}
    </section>
  );
}

// ============================================================================
// Featured Demo (Hero variant)
// ============================================================================

interface FeaturedDemoProps {
  demo?: FeatureDemo;
  className?: string;
}

export function FeaturedDemo({ demo = FEATURE_DEMOS[0], className }: FeaturedDemoProps) {
  const [showModal, setShowModal] = useState(false);

  return (
    <div className={cn("relative", className)}>
      <div className="grid md:grid-cols-2 gap-8 items-center">
        {/* Video */}
        <div className="order-2 md:order-1">
          <div className="relative rounded-xl overflow-hidden shadow-2xl border border-border">
            <VideoPreview
              videoSrc={demo.videoSrc}
              posterSrc={demo.posterSrc}
              aspectRatio="video"
              onExpand={() => setShowModal(true)}
              autoPlayOnHover
            />

            {/* Duration */}
            <div className="absolute top-4 right-4 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-sm">
              <span className="text-sm text-white font-medium tabular-nums">{demo.duration}</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="order-1 md:order-2">
          <ImpactBadge impact={demo.impact} />

          <h3 className="text-2xl md:text-3xl font-bold text-foreground mt-4 mb-3">
            {demo.title}
          </h3>

          <p className="text-lg text-secondary mb-4">
            {demo.description}
          </p>

          <p className="text-accent-text font-medium mb-6">
            {demo.benefit}
          </p>

          {demo.savings && (
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-dim border border-accent-line mb-6">
              <svg className="w-5 h-5 text-accent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              <span className="text-sm font-semibold text-accent-text">
                Average savings: {demo.savings}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={() => setShowModal(true)}
              className={cn(
                "flex items-center gap-2 px-6 py-3 rounded-lg",
                "bg-foreground text-background",
                "font-medium text-sm",
                "hover:opacity-90 transition-opacity"
              )}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Watch Full Demo
            </button>

            {demo.keybinding && (
              <div className="flex items-center gap-2 text-sm text-secondary">
                <span>Shortcut:</span>
                <kbd className="px-2 py-1 bg-card border border-border rounded font-mono text-foreground">
                  {demo.keybinding.mac}
                </kbd>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal */}
      <VideoModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        videoSrc={demo.videoSrc}
        posterSrc={demo.posterSrc}
        title={demo.title}
        description={demo.benefit}
        autoPlay
      />
    </div>
  );
}

// ============================================================================
// Mini Demo Carousel (for compact spaces)
// ============================================================================

interface MiniDemoCarouselProps {
  demos?: FeatureDemo[];
  className?: string;
}

export function MiniDemoCarousel({ demos = FEATURE_DEMOS.slice(0, 4), className }: MiniDemoCarouselProps) {
  const [activeDemo, setActiveDemo] = useState<FeatureDemo | null>(null);

  return (
    <div className={className}>
      <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-thin">
        {demos.map(demo => (
          <button
            key={demo.id}
            onClick={() => setActiveDemo(demo)}
            className={cn(
              "flex-shrink-0 w-64 rounded-xl overflow-hidden",
              "border border-border bg-card",
              "hover:border-secondary hover:shadow-md transition-all",
              "text-left group"
            )}
          >
            <div className="relative aspect-video bg-black">
              <VideoPreview
                videoSrc={demo.videoSrc}
                posterSrc={demo.posterSrc}
                aspectRatio="video"
                showExpandButton={false}
                autoPlayOnHover
              />
              <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-xs text-white">
                {demo.duration}
              </div>
            </div>
            <div className="p-3">
              <h4 className="font-medium text-foreground text-sm group-hover:text-accent-text transition-colors">
                {demo.shortTitle}
              </h4>
              <p className="text-xs text-secondary mt-1 line-clamp-1">
                {demo.description}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Modal */}
      {activeDemo && (
        <VideoModal
          isOpen={true}
          onClose={() => setActiveDemo(null)}
          videoSrc={activeDemo.videoSrc}
          posterSrc={activeDemo.posterSrc}
          title={activeDemo.title}
          description={activeDemo.benefit}
          autoPlay
        />
      )}
    </div>
  );
}
