/** A compact personal arrival; task controls remain in their usual positions. */
export function HomeArrival({ now }: { now: number }) {
  return (
    <section
      aria-label="Your Home overview"
      className="home-arrival mb-1 flex flex-wrap items-center justify-between gap-3 px-1 py-3 md:py-4"
    >
      <div>
        <h1 className="home-arrival-title">Your space, at your pace.</h1>
        <p className="mt-1 text-xs text-[#625e55]">
          {now
            ? "Start with what matters now. The rest can wait."
            : "A little room for whatever comes next."}
        </p>
      </div>
    </section>
  );
}
