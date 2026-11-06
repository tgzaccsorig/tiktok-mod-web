"use client";

import type { Slide } from "@/lib/types";

export function playerSrc(id: string, o: { autoplay: boolean; muted: boolean; loop: boolean }) {
  const q = new URLSearchParams({
    autoplay: o.autoplay ? "1" : "0",
    muted: o.muted ? "1" : "0",
    loop: o.loop ? "1" : "0",
    controls: "0",
    music_info: "0",
    description: "0",
    rel: "0",
    native_context_menu: "0",
    closed_caption: "0",
  });
  return `https://www.tiktok.com/player/v1/${id}?${q.toString()}`;
}

type Props = {
  slide: Slide;
  position: number;
  mountPlayer: boolean;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  reloadNonce: number;
  showPoster: boolean;
  register: (key: string, el: HTMLIFrameElement | null) => void;
};

/** Один экран ленты. Настоящий плеер TikTok монтируется только у текущего ролика. */
export default function VideoSlide(p: Props) {
  const { slide, position } = p;
  const thumb = slide.item.thumbnail;

  return (
    <div
      data-testid="slide"
      data-key={slide.key}
      data-video-id={slide.item.id}
      className="absolute inset-0 overflow-hidden bg-black"
      style={{ transform: `translate3d(0, ${position * 100}%, 0)` }}
    >
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          aria-hidden
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
        />
      )}
      <div className="relative mx-auto h-full w-full" style={{ maxWidth: "calc(100dvh * 9 / 16)" }}>
        {p.mountPlayer && (
          <iframe
            key={`${slide.key}:${p.reloadNonce}`}
            ref={(el) => p.register(slide.key, el)}
            data-testid="player"
            title={`TikTok ${slide.item.author}`}
            src={playerSrc(slide.item.id, { autoplay: p.autoplay, muted: p.muted, loop: p.loop })}
            allow="autoplay; fullscreen; encrypted-media"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 h-full w-full border-0 bg-black"
          />
        )}
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            referrerPolicy="no-referrer"
            className={`pointer-events-none absolute inset-0 h-full w-full bg-black object-cover transition-opacity duration-300 ${
              p.showPoster ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
      </div>
    </div>
  );
}
