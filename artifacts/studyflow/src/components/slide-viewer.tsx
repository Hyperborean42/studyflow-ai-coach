import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, ChevronRight, X, Maximize, Minimize, Monitor,
} from "lucide-react";

interface Slide {
  number: string;
  content: string;
}

interface SlideViewerProps {
  /** Raw content with [Slide N] markers */
  content: string;
  title: string;
  subject?: string;
  open: boolean;
  onClose: () => void;
}

/** Parse "[Slide N]\n..." blocks into structured slides */
function parseSlides(content: string): Slide[] {
  const parts = content.split(/\[Slide (\d+)\]\n?/);
  const slides: Slide[] = [];
  // parts: ["", "1", "slide1 content", "2", "slide2 content", ...]
  for (let i = 1; i < parts.length; i += 2) {
    const num = parts[i];
    const text = (parts[i + 1] || "").trim();
    if (text) {
      slides.push({ number: num, content: text });
    }
  }
  // If no slides found, treat entire content as one slide
  if (slides.length === 0 && content.trim()) {
    slides.push({ number: "1", content: content.trim() });
  }
  return slides;
}

export function SlideViewer({ content, title, subject, open, onClose }: SlideViewerProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const slides = parseSlides(content);

  const goNext = useCallback(() => {
    setCurrentSlide((i) => Math.min(i + 1, slides.length - 1));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setCurrentSlide((i) => Math.max(i - 1, 0));
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      if (e.key === "Escape") {
        if (document.fullscreenElement) {
          document.exitFullscreen();
          setIsFullscreen(false);
        } else {
          onClose();
        }
      }
      if (e.key === "f" || e.key === "F") { toggleFullscreen(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, goNext, goPrev, onClose, toggleFullscreen]);

  // Listen for fullscreen changes (e.g. user presses Esc in fullscreen)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Touch swipe
  const touchStartX = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      if (dx < 0) goNext();
      else goPrev();
    }
  };

  if (!open || slides.length === 0) return null;

  const slide = slides[currentSlide];
  const progress = ((currentSlide + 1) / slides.length) * 100;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-background flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{title}</h2>
            {subject && <p className="text-xs text-muted-foreground">{subject}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground font-mono">
            {currentSlide + 1} / {slides.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
            {isFullscreen ? "Venster" : "Volledig scherm"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={toggleFullscreen}
            title="Presenteren — gebruik AirPlay/Chromecast via schermdeling"
          >
            <Monitor className="h-3.5 w-3.5" />
            Presenteren
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted shrink-0">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Slide content */}
      <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
        <div className="max-w-4xl w-full">
          <div className="bg-card border rounded-2xl shadow-lg p-8 md:p-12 min-h-[50vh] flex flex-col justify-center">
            {/* Parse slide text into visual structure */}
            {slide.content.split("\n").map((line, i) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={i} className="h-4" />;

              // Section header (LEEFOMGEVING > Wateroverlast > ...)
              if (trimmed.includes(" > ")) {
                return (
                  <p key={i} className="text-xs uppercase tracking-wider text-muted-foreground mb-4">
                    {trimmed}
                  </p>
                );
              }

              // Short lines that look like headings (no period, under 80 chars)
              if (trimmed.length < 80 && !trimmed.endsWith(".") && !trimmed.endsWith("?") && !trimmed.startsWith("-")) {
                return (
                  <h3 key={i} className="text-2xl font-bold text-primary mb-3 mt-2">
                    {trimmed}
                  </h3>
                );
              }

              // Questions (end with ?)
              if (trimmed.endsWith("?")) {
                return (
                  <p key={i} className="text-lg font-medium text-foreground mb-2 italic">
                    {trimmed}
                  </p>
                );
              }

              // Regular text
              return (
                <p key={i} className="text-base leading-relaxed text-foreground/90 mb-2">
                  {trimmed}
                </p>
              );
            })}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30 shrink-0">
        <Button
          variant="outline"
          onClick={goPrev}
          disabled={currentSlide === 0}
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Vorige
        </Button>
        <div className="flex gap-1">
          {slides.map((_, i) => (
            <button
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === currentSlide
                  ? "w-6 bg-primary"
                  : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              }`}
              onClick={() => setCurrentSlide(i)}
            />
          ))}
        </div>
        <Button
          variant="outline"
          onClick={goNext}
          disabled={currentSlide === slides.length - 1}
          className="gap-1"
        >
          Volgende <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
