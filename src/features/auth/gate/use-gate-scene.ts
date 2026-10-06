import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { GateScene } from "./gate-scene";

export type GateRefs = {
  root: RefObject<HTMLDivElement | null>;
  video: RefObject<HTMLVideoElement | null>;
  ring: RefObject<SVGSVGElement | null>;
  ringPos: RefObject<SVGGElement | null>;
  ringTime: RefObject<SVGCircleElement | null>;
  lit: RefObject<(SVGCircleElement | null)[]>;
  column: RefObject<HTMLElement | null>;
  welcome: RefObject<HTMLElement | null>;
};

/**
 * Owns the GateScene for the lifetime of the page. Attach `refs.root`,
 * `refs.column` and `refs.welcome` to the page's own elements and render
 * <GateStage refs={refs} /> for the video and ring.
 */
export function useGateScene(reduceMotion: boolean, { unlocked = false } = {}) {
  const refs: GateRefs = {
    root: useRef<HTMLDivElement>(null),
    video: useRef<HTMLVideoElement>(null),
    ring: useRef<SVGSVGElement>(null),
    ringPos: useRef<SVGGElement>(null),
    ringTime: useRef<SVGCircleElement>(null),
    lit: useRef<(SVGCircleElement | null)[]>([]),
    column: useRef<HTMLElement>(null),
    welcome: useRef<HTMLElement>(null),
  };
  const sceneRef = useRef<GateScene | null>(null);
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;
  const unlockedRef = useRef(unlocked);

  useLayoutEffect(() => {
    const { root, video, ring, ringPos, ringTime, lit, column, welcome } = refs;
    if (!root.current || !video.current || !ring.current || !ringPos.current || !ringTime.current) return;
    if (!column.current || !welcome.current) return;
    const scene = new GateScene(
      {
        root: root.current,
        video: video.current,
        ring: ring.current,
        ringPos: ringPos.current,
        ringTime: ringTime.current,
        litSegments: lit.current.filter((el): el is SVGCircleElement => el != null),
        column: column.current,
        welcome: welcome.current,
      },
      reduceRef.current,
    );
    scene.start({ unlocked: unlockedRef.current });
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
    // The scene binds to elements that live for the whole page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setReducedMotion(reduceMotion);
  }, [reduceMotion]);

  return { refs, sceneRef };
}
