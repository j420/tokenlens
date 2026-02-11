"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type IDEType = "cursor" | "vscode" | "codex";

interface IDE {
  id: IDEType;
  name: string;
  icon: string;
  description: string;
  uriScheme: string;
}

const IDES: IDE[] = [
  {
    id: "cursor",
    name: "Cursor",
    icon: "cursor-icon",
    description: "AI-first code editor",
    uriScheme: "cursor",
  },
  {
    id: "vscode",
    name: "Claude Code",
    icon: "claude-icon",
    description: "VS Code with Claude",
    uriScheme: "vscode",
  },
  {
    id: "codex",
    name: "Codex",
    icon: "codex-icon",
    description: "OpenAI Codex CLI",
    uriScheme: "vscode",
  },
];

const STORAGE_KEY = "prune_preferred_ide";

function CursorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" opacity="0.2" />
      <path d="M7 7l10 5-10 5V7z" fill="currentColor" />
    </svg>
  );
}

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l2.5 2.5" strokeLinecap="round" />
    </svg>
  );
}

function CodexIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" opacity="0.2" />
      <path d="M8 12h8M8 8h8M8 16h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IDEIcon({ ide, className }: { ide: IDEType; className?: string }) {
  switch (ide) {
    case "cursor":
      return <CursorIcon className={className} />;
    case "vscode":
      return <ClaudeIcon className={className} />;
    case "codex":
      return <CodexIcon className={className} />;
  }
}

export function usePreferredIDE(): [IDEType, (ide: IDEType) => void] {
  const [preferredIDE, setPreferredIDEState] = useState<IDEType>("cursor");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as IDEType | null;
    if (stored && IDES.find((ide) => ide.id === stored)) {
      setPreferredIDEState(stored);
    }
  }, []);

  const setPreferredIDE = (ide: IDEType) => {
    localStorage.setItem(STORAGE_KEY, ide);
    setPreferredIDEState(ide);
  };

  return [preferredIDE, setPreferredIDE];
}

export function getIDEUri(ide: IDEType, featureId: string): string {
  const ideConfig = IDES.find((i) => i.id === ide);
  const scheme = ideConfig?.uriScheme ?? "vscode";
  return `${scheme}://delimit.prune/run/${featureId}`;
}

export function IDESelector({
  value,
  onChange,
  compact = false,
}: {
  value: IDEType;
  onChange: (ide: IDEType) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedIDE = IDES.find((ide) => ide.id === value)!;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white font-medium text-gray-700 transition hover:bg-gray-50",
          compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"
        )}
      >
        <IDEIcon ide={value} className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        <span>{selectedIDE.name}</span>
        <svg
          className={cn("transition-transform", compact ? "h-3 w-3" : "h-4 w-4", open && "rotate-180")}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {IDES.map((ide) => (
            <button
              key={ide.id}
              type="button"
              onClick={() => {
                onChange(ide.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-gray-50",
                ide.id === value && "bg-prune-green/5"
              )}
            >
              <IDEIcon ide={ide.id} className="h-5 w-5 text-gray-600" />
              <div>
                <div className={cn("font-medium", ide.id === value ? "text-prune-green" : "text-gray-900")}>
                  {ide.name}
                </div>
                <div className="text-xs text-gray-500">{ide.description}</div>
              </div>
              {ide.id === value && (
                <svg className="ml-auto h-4 w-4 text-prune-green" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function OpenInIDEButton({
  featureId,
  ide,
  className,
  children,
}: {
  featureId: string;
  ide: IDEType;
  className?: string;
  children?: React.ReactNode;
}) {
  const uri = getIDEUri(ide, featureId);
  const ideConfig = IDES.find((i) => i.id === ide)!;

  return (
    <a
      href={uri}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-200",
        className
      )}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
      {children ?? `Open in ${ideConfig.name}`}
    </a>
  );
}

export { IDES };
