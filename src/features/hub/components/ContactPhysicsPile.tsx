import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bodies,
  Body,
  Composite,
  Constraint,
  Engine,
  Events,
  Runner,
  Sleeping,
  type Body as MatterBody,
  type Constraint as MatterConstraint,
} from "matter-js";
import type { TeamMember } from "@/features/people/use-team";
import { cn } from "@/lib/utils";

const CARD_CATEGORY = 0x0001;
const BOUNDARY_CATEGORY = 0x0002;

type Dimensions = { width: number; height: number };

type ContactPhysicsPileProps = {
  members: TeamMember[];
  activePersonId: string | null;
  resultPersonIds: string[];
  onlineIds: Set<string>;
  reduceMotion: boolean;
  onSelect: (personId: string) => void;
  activeControls?: ReactNode;
};

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function cardMetrics(width: number) {
  return width < 720 ? { width: 77, height: 99, radius: 12 } : { width: 93, height: 117, radius: 14 };
}

export function ContactPhysicsPile({
  members,
  activePersonId,
  resultPersonIds,
  onlineIds,
  reduceMotion,
  onSelect,
  activeControls,
}: ContactPhysicsPileProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const runnerRef = useRef<Runner | null>(null);
  const bodiesRef = useRef(new Map<string, MatterBody>());
  const cardsRef = useRef(new Map<string, HTMLButtonElement>());
  const selectedConstraintRef = useRef<MatterConstraint | null>(null);
  const resultConstraintsRef = useRef(new Map<string, MatterConstraint>());
  const selectedIdRef = useRef<string | null>(null);
  const activePersonIdRef = useRef(activePersonId);
  const resultPersonIdsRef = useRef(resultPersonIds);
  const membersRef = useRef(members);
  const dimensionsRef = useRef<Dimensions>({ width: 0, height: 0 });
  const rafRef = useRef<number | null>(null);
  const savedBodiesRef = useRef(new Map<string, { x: number; y: number; angle: number; vx: number; vy: number; sleeping: boolean }>());
  const [dimensions, setDimensions] = useState<Dimensions>({ width: 0, height: 0 });

  const memberKey = useMemo(() => members.map((member) => member.id).join("|"), [members]);
  const metrics = cardMetrics(dimensions.width);
  activePersonIdRef.current = activePersonId;
  resultPersonIdsRef.current = resultPersonIds;
  membersRef.current = members;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateDimensions = () => {
      const next = {
        width: Math.round(stage.clientWidth),
        height: Math.round(stage.clientHeight),
      };
      setDimensions((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };

    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const syncActiveBodies = useCallback((nextIds: string[]) => {
    const engine = engineRef.current;
    if (!engine) return;

    const { width } = dimensionsRef.current;
    if (width <= 0) return;

    const previousIds = new Set(resultConstraintsRef.current.keys());
    const nextSet = new Set(nextIds);
    for (const id of previousIds) {
      if (nextSet.has(id)) continue;
      const constraint = resultConstraintsRef.current.get(id);
      if (constraint) Composite.remove(engine.world, constraint);
      resultConstraintsRef.current.delete(id);
      const body = bodiesRef.current.get(id);
      if (body) {
        body.collisionFilter.mask = CARD_CATEGORY | BOUNDARY_CATEGORY;
        Sleeping.set(body, false);
        Body.setVelocity(body, { x: body.velocity.x * 0.35, y: Math.max(body.velocity.y, 0) });
        Body.setAngularVelocity(body, ((hash(id) % 9) - 4) * 0.004);
      }
    }

    const { width: cardWidth, height: cardHeight } = cardMetrics(width);
    const columns = Math.max(1, Math.min(5, Math.floor((width - 24) / (cardWidth + 18))));
    const gridWidth = columns * cardWidth + (columns - 1) * 18;
    const startX = (width - gridWidth) / 2 + cardWidth / 2;
    nextIds.forEach((id, index) => {
      const body = bodiesRef.current.get(id);
      if (!body) return;
      body.collisionFilter.mask = BOUNDARY_CATEGORY;
      Sleeping.set(body, false);
      Body.setAngularVelocity(body, body.angularVelocity * 0.4);
      const row = Math.floor(index / columns);
      const column = index % columns;
      const constraint = resultConstraintsRef.current.get(id);
      const point = { x: startX + column * (cardWidth + 18), y: Math.max(cardHeight / 2 + 12, 86) + row * (cardHeight + 18) };
      if (constraint) {
        constraint.pointA = point;
      } else {
        const spring = Constraint.create({ pointA: point, bodyB: body, length: 0, stiffness: 0.014, damping: 0.22 });
        resultConstraintsRef.current.set(id, spring);
        Composite.add(engine.world, spring);
      }
    });
    selectedIdRef.current = activePersonIdRef.current;
    selectedConstraintRef.current = activePersonIdRef.current ? resultConstraintsRef.current.get(activePersonIdRef.current) ?? null : null;
  }, []);

  useEffect(() => {
    dimensionsRef.current = dimensions;
    const { width, height } = dimensions;
    const currentMembers = membersRef.current;
    if (reduceMotion || width <= 0 || height <= 0 || currentMembers.length === 0) return;

    const { width: cardWidth, height: cardHeight, radius } = cardMetrics(width);
    const engine = Engine.create({
      enableSleeping: true,
      positionIterations: 8,
      velocityIterations: 6,
      constraintIterations: 3,
    });
    engine.gravity.y = 1;
    engine.gravity.scale = 0.001;
    engineRef.current = engine;

    const floor = Bodies.rectangle(width / 2, height + 24, width + 160, 56, {
      isStatic: true,
      collisionFilter: { category: BOUNDARY_CATEGORY, mask: CARD_CATEGORY },
    });
    const leftWall = Bodies.rectangle(-28, height / 2, 56, height * 2, {
      isStatic: true,
      collisionFilter: { category: BOUNDARY_CATEGORY, mask: CARD_CATEGORY },
    });
    const rightWall = Bodies.rectangle(width + 28, height / 2, 56, height * 2, {
      isStatic: true,
      collisionFilter: { category: BOUNDARY_CATEGORY, mask: CARD_CATEGORY },
    });

    const nextBodies = new Map<string, MatterBody>();
    const cardBodies = currentMembers.map((member, index) => {
      const seed = hash(member.id);
      const usableWidth = Math.max(cardWidth, width - cardWidth);
      const columns = Math.max(1, Math.floor(usableWidth / (cardWidth * 0.72)));
      const column = index % columns;
      const columnWidth = usableWidth / columns;
      const x = cardWidth / 2 + columnWidth * (column + 0.5) + ((seed % 17) - 8);
      const y = -cardHeight / 2 - Math.floor(index / columns) * 36 - (seed % 48);
      const body = Bodies.rectangle(x, y, cardWidth, cardHeight, {
        chamfer: { radius },
        restitution: 0.1,
        friction: 0.86,
        frictionStatic: 1,
        frictionAir: 0.018,
        sleepThreshold: 45,
        angle: (((seed % 17) - 8) * Math.PI) / 180,
        collisionFilter: {
          category: CARD_CATEGORY,
          mask: CARD_CATEGORY | BOUNDARY_CATEGORY,
        },
      });
      Body.setVelocity(body, { x: ((seed % 11) - 5) * 0.08, y: 0.6 + (seed % 5) * 0.12 });
      const saved = savedBodiesRef.current.get(member.id);
      if (saved) {
        Body.setPosition(body, {
          x: Math.max(cardWidth / 2, Math.min(width - cardWidth / 2, saved.x * width)),
          y: Math.min(height - cardHeight / 2, saved.y * height),
        });
        Body.setAngle(body, saved.angle);
        Body.setVelocity(body, { x: saved.vx, y: saved.vy });
        Sleeping.set(body, saved.sleeping);
      }
      nextBodies.set(member.id, body);
      return body;
    });
    bodiesRef.current = nextBodies;
    Composite.add(engine.world, [floor, leftWall, rightWall, ...cardBodies]);

    const paintCards = () => {
      rafRef.current = null;
      for (const [id, body] of bodiesRef.current) {
        const card = cardsRef.current.get(id);
        if (!card) continue;
        card.style.transform = `translate3d(${body.position.x - cardWidth / 2}px, ${body.position.y - cardHeight / 2}px, 0) rotate(${body.angle}rad)`;
        card.style.zIndex = id === selectedIdRef.current ? "40" : String(10 + Math.round(body.position.y / 24));
        card.style.opacity = "1";
      }
    };
    const schedulePaint = () => {
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(paintCards);
    };
    const steadySelectedCard = () => {
      const id = selectedIdRef.current;
      if (!id) return;
      const body = bodiesRef.current.get(id);
      if (!body) return;
      Body.setAngularVelocity(body, body.angularVelocity * 0.72 - body.angle * 0.025);
    };

    Events.on(engine, "beforeUpdate", steadySelectedCard);
    const runner = Runner.create({ delta: 1000 / 60, maxFrameTime: 1000 / 30, maxUpdates: 2 });
    runnerRef.current = runner;
    Events.on(runner, "afterTick", schedulePaint);
    Runner.run(runner, engine);
    syncActiveBodies(resultPersonIdsRef.current);
    schedulePaint();

    const onVisibilityChange = () => {
      runner.enabled = !document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      // Preserve poses across boundary changes. Resize must not replay entry.
      savedBodiesRef.current = new Map(Array.from(bodiesRef.current, ([id, body]) => [id, {
        x: body.position.x / width,
        y: body.position.y / height,
        angle: body.angle,
        vx: body.velocity.x,
        vy: body.velocity.y,
        sleeping: body.isSleeping,
      }]));
      document.removeEventListener("visibilitychange", onVisibilityChange);
      Events.off(engine, "beforeUpdate", steadySelectedCard);
      Events.off(runner, "afterTick", schedulePaint);
      Runner.stop(runner);
      Composite.clear(engine.world, false, true);
      Engine.clear(engine);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      selectedConstraintRef.current = null;
      resultConstraintsRef.current.clear();
      selectedIdRef.current = null;
      bodiesRef.current.clear();
      runnerRef.current = null;
      engineRef.current = null;
    };
  }, [dimensions, memberKey, reduceMotion, syncActiveBodies]);

  useEffect(() => {
    if (reduceMotion) return;
    syncActiveBodies(resultPersonIds);
  }, [activePersonId, reduceMotion, resultPersonIds, syncActiveBodies]);

  const getStaticTransform = (member: TeamMember, index: number) => {
    const active = member.id === activePersonId;
    if (active) {
      return `translate3d(calc(50% - ${metrics.width / 2}px), 12px, 0) rotate(0deg)`;
    }
    const count = Math.max(1, members.length);
    const spread = Math.min(76, 70 / Math.max(1, count - 1));
    const offset = (index - (count - 1) / 2) * spread;
    const rotation = ((hash(member.id) % 15) - 7) * 0.8;
    return `translate3d(calc(50% - ${metrics.width / 2}px + ${offset}px), calc(100% - ${metrics.height + 4}px), 0) rotate(${rotation}deg)`;
  };

  return (
    <div ref={stageRef} className="contact-physics-stage relative mx-[-1.25rem] min-h-[260px] flex-1 overflow-hidden md:mx-[-2.5rem]" aria-label="Team members">
      <span className="sr-only" aria-live="polite">
        {activePersonId ? `${members.find((member) => member.id === activePersonId)?.name ?? "Person"} selected` : "All people in the pile"}
      </span>
      {members.map((member, index) => {
        const active = resultPersonIds.includes(member.id);
        const primary = member.id === activePersonId;
        return (
          <button
            key={member.id}
            ref={(node) => {
              if (node) cardsRef.current.set(member.id, node);
              else cardsRef.current.delete(member.id);
            }}
            type="button"
            aria-label={`Select ${member.name}`}
            aria-pressed={primary}
            data-active={active ? "true" : "false"}
            onClick={() => onSelect(member.id)}
            style={{
              width: metrics.width,
              height: metrics.height,
              // Physics owns these properties during motion. React must not
              // reset a moving card to its fallback pose on a query render.
              ...(reduceMotion ? { opacity: 1, transform: getStaticTransform(member, index) } : {}),
            }}
            className={cn(
              "contact-physics-card absolute left-0 top-0 flex origin-center flex-col overflow-hidden rounded-[17px] border border-white bg-white p-1.5 text-left shadow-[0_8px_24px_rgba(28,25,43,0.2)] outline-none transition-[box-shadow,filter] duration-150 hover:brightness-105 focus-visible:ring-2 focus-visible:ring-[#7141cf] focus-visible:ring-offset-2",
              !active && "contact-physics-card--resting",
              active && "ring-2 ring-[#ae82ed] ring-offset-2 shadow-[0_18px_38px_rgba(82,54,125,0.3)]",
            )}
          >
            <span className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] bg-gradient-to-br from-[#e9f2ff] to-[#f7eafb]">
              {member.avatarUrl ? (
                <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[24px] font-semibold text-[#7045a4]">{member.initials}</span>
              )}
              {onlineIds.has(member.id) ? <span className="absolute bottom-1.5 right-1.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" /> : null}
            </span>
            {active ? (
              <>
                <span className="truncate px-1 pt-1 text-center text-[11px] font-semibold text-[#343253]">{member.name}</span>
                <span className="truncate px-1 text-center text-[10px] text-[#8a8ca8]">{member.role || "Teammate"}</span>
              </>
            ) : null}
          </button>
        );
      })}

      {activePersonId && activeControls ? (
        <div
          className="absolute left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[#eee9f7] bg-white/92 px-2.5 py-2 shadow-[0_12px_28px_rgba(54,34,86,0.14)] backdrop-blur-sm"
          style={{ top: Math.max(metrics.height + 30, 176) }}
        >
          {activeControls}
        </div>
      ) : null}
    </div>
  );
}
