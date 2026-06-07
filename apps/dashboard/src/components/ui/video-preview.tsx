"use client";

import { useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

export interface VideoPreviewProps {
  videoSrc: string;
  posterSrc?: string;
  aspectRatio?: "video" | "square" | "wide";
  onExpand?: () => void;
  className?: string;
  showExpandButton?: boolean;
  autoPlayOnHover?: boolean;
}

export function VideoPreview({
  videoSrc,
  posterSrc,
  aspectRatio = "video",
  onExpand,
  className,
  showExpandButton = true,
  autoPlayOnHover = true,
}: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    if (autoPlayOnHover && videoRef.current) {
      videoRef.current.play().catch(() => {
        // Autoplay may be blocked
      });
    }
  }, [autoPlayOnHover]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  const aspectClasses = {
    video: "aspect-video",
    square: "aspect-square",
    wide: "aspect-[21/9]",
  };

  if (hasError) {
    return (
      <div
        className={cn(
          "relative bg-card-hover rounded-lg overflow-hidden",
          "flex items-center justify-center",
          aspectClasses[aspectRatio],
          className
        )}
      >
        <div className="text-center p-4">
          <svg className="w-8 h-8 mx-auto text-secondary mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className="text-xs text-secondary">Demo unavailable</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative bg-black rounded-lg overflow-hidden cursor-pointer group",
        aspectClasses[aspectRatio],
        className
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onExpand?.();
        }
      }}
      aria-label="Watch demo video"
    >
      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-card-hover">
          <div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {/* Video */}
      <video
        ref={videoRef}
        src={videoSrc}
        poster={posterSrc}
        className="w-full h-full object-cover"
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedData={() => setIsLoading(false)}
        onError={() => setHasError(true)}
      />

      {/* Hover overlay */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent",
          "transition-opacity duration-200",
          isHovering ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Play indicator (shows when not hovering) */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "transition-opacity duration-200",
          isHovering ? "opacity-0" : "opacity-100"
        )}
      >
        <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20">
          <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>

      {/* "Playing" indicator (shows when hovering) */}
      <div
        className={cn(
          "absolute bottom-3 left-3 flex items-center gap-1.5",
          "transition-opacity duration-200",
          isHovering ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="flex items-center gap-0.5">
          <div className="w-0.5 h-3 bg-accent rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
          <div className="w-0.5 h-4 bg-accent rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
          <div className="w-0.5 h-2 bg-accent rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-xs text-white font-medium">Playing</span>
      </div>

      {/* Expand button */}
      {showExpandButton && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExpand?.();
          }}
          className={cn(
            "absolute bottom-3 right-3",
            "p-2 rounded-lg bg-black/50 backdrop-blur-sm",
            "text-white hover:bg-black/70",
            "transition-all duration-200",
            isHovering ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          )}
          aria-label="Expand video"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      )}
    </div>
  );
}
