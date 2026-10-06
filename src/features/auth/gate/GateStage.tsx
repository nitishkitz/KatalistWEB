import type { CSSProperties } from "react";

import sceneMp4 from "@/assets/auth/gate/scene-4k.mp4";
import scenePoster from "@/assets/auth/gate/scene-poster.jpg";
import type { GateRefs } from "./use-gate-scene";
import { GATE_RING_SEGMENTS } from "./scene-track";

/** The tracked clip and the code ring that sits on Coey's ball dock. */
export function GateStage({ refs, poster }: { refs: GateRefs; poster?: string | null }) {
  const segments = Array.from({ length: GATE_RING_SEGMENTS }, (_, k) => k);
  return (
    <div className="kg-stage" aria-hidden="true">
      <video
        ref={refs.video}
        className="kg-video"
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        poster={poster || scenePoster}
      >
        <source src={sceneMp4} type="video/mp4" />
      </video>
      <svg ref={refs.ring} className="kg-ring">
        <defs>
          <filter id="kg-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g ref={refs.ringPos}>
          <circle
            ref={refs.ringTime}
            className="kg-ring-time"
            r="132"
            pathLength={360}
            transform="rotate(225)"
            strokeDasharray="270 360"
          />
          {/* An open dial, clear of Coey's paw. */}
          <g>
            {segments.map((k) => (
              <circle
                key={k}
                className="kg-ring-base"
                r="86"
                pathLength={360}
                transform={`rotate(${225 + k * 45 + 4.5})`}
                style={{ "--k": k } as CSSProperties}
              />
            ))}
          </g>
          <g filter="url(#kg-glow)">
            {segments.map((k) => (
              <circle
                key={k}
                ref={(el) => {
                  refs.lit.current[k] = el;
                }}
                className="kg-ring-lit"
                style={{ animationDelay: `${k * 180 - 1080}ms` }}
                r="86"
                pathLength={360}
                transform={`rotate(${225 + k * 45 + 4.5})`}
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}
