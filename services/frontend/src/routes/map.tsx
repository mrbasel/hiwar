import { Input } from "@base-ui/react/input";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Toggle } from "@base-ui/react/toggle";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useEpisodeMap } from "#api/map";
import { ThemeToggle } from "#components/ThemeToggle";
import { arabic, fold } from "#lib/format";
import {
  type ColourBy,
  clusterColour,
  colourOf,
  episodeUrl,
  MapEngine,
  type MapModel,
  type Point,
  prepare,
} from "#map/engine";

export const Route = createFileRoute("/map")({
  head: () => ({ meta: [{ title: "خريطة الحلقات" }] }),
  component: MapPage,
});

function MapPage() {
  const { data, error } = useEpisodeMap();
  const model = useMemo(() => (data ? prepare(data) : null), [data]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<MapEngine | null>(null);

  const [filter, setFilter] = useState("");
  const [colourBy, setColourBy] = useState<ColourBy>("cluster");
  const [selected, setSelected] = useState<Point | null>(null);
  const [activeCluster, setActiveCluster] = useState<number | null>(null);

  useEffect(() => {
    if (!model || !canvasRef.current || !tipRef.current) return;
    const created = new MapEngine(canvasRef.current, tipRef.current, model, setSelected);
    setEngine(created);
    return () => created.destroy();
  }, [model]);

  // Filtering thousands of titles on every keystroke would lag the input.
  const deferredFilter = useDeferredValue(filter);
  const matches = useMemo(() => {
    const terms = fold(deferredFilter).split(/\s+/).filter(Boolean);
    if (!model || !terms.length) return null;
    return new Set(model.points.filter((p) => terms.every((t) => p.norm.includes(t))));
  }, [model, deferredFilter]);

  useEffect(() => engine?.setMatches(matches), [engine, matches]);
  useEffect(() => engine?.setColourBy(colourBy), [engine, colourBy]);
  useEffect(() => engine?.setActiveCluster(activeCluster), [engine, activeCluster]);

  const select = (p: Point | null) => {
    setSelected(p);
    engine?.setSelected(p, { fly: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelected(null);
      engine?.setSelected(null);
      setActiveCluster(null);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [engine]);

  const shown = !matches
    ? null
    : activeCluster === null
      ? matches.size
      : [...matches].filter((p) => p.cluster === activeCluster).length;

  return (
    <div className="flex h-screen flex-col-reverse overflow-hidden bg-stage md:flex-row">
      <aside className="h-[40vh] shrink-0 overflow-y-auto bg-paper px-[1.1rem] pt-4 pb-8 md:h-auto md:w-88 md:border-e md:border-rule">
        <header className="flex items-baseline">
          <h1 className="text-[1.35rem] font-semibold">خريطة الحلقات</h1>
          <ThemeToggle className="ms-auto me-3 self-center" />
          <Link to="/" className="text-sm text-signal underline">
            البحث ←
          </Link>
        </header>
        <p className="my-1.5 text-[0.85rem] text-muted">
          كل نقطة حلقة، والحلقات المتشابهة في المعنى تتجاور. اسحب للتحريك، ومرّر للتكبير.
        </p>

        <Input
          type="search"
          value={filter}
          onValueChange={setFilter}
          placeholder="ظلّل الحلقات حسب العنوان…"
          autoComplete="off"
          aria-label="Filter by title"
          className="mt-2 w-full rounded-md border border-rule bg-surface px-3 py-2 font-medium text-ink"
        />
        {shown !== null && <p className="my-1.5 text-[0.85rem] text-muted">{arabic(shown)} حلقة مطابقة</p>}

        <RadioGroup
          value={colourBy}
          onValueChange={(v) => setColourBy(v as ColourBy)}
          aria-label="Colour by"
          className="mt-2 mb-4 flex gap-4 text-sm"
        >
          <ColourOption value="cluster">لوّن حسب المجموعة</ColourOption>
          <ColourOption value="channel">حسب القناة</ColourOption>
        </RadioGroup>

        {selected && model && (
          <Selected point={selected} model={model} colourBy={colourBy} onSelect={select} />
        )}

        <h3 className="mt-4 mb-1.5 text-[0.8rem] font-semibold text-muted">المجموعات</h3>
        {model && (
          <ClusterList
            model={model}
            active={activeCluster}
            onToggle={(id) => setActiveCluster((current) => (current === id ? null : id))}
          />
        )}
      </aside>

      <div className="relative min-w-0 flex-1">
        <canvas
          ref={canvasRef}
          className="block size-full cursor-grab data-dragging:cursor-grabbing data-over-point:cursor-pointer"
        />
        <div
          ref={tipRef}
          hidden
          className="pointer-events-none absolute max-w-88 rounded-md bg-surface px-2.5 py-2 text-[0.85rem] leading-snug text-ink shadow-[0_4px_16px_rgba(0,0,0,0.35)] [&_span]:text-muted [&_strong]:block [&_strong]:font-semibold"
        />
        <p className="absolute start-4 top-3 m-0 text-[0.85rem] text-[#9aa6b4]">
          {error
            ? error.message
            : model
              ? `${arabic(model.points.length)} حلقة، ${arabic(model.clusters.size)} مجموعة (${model.model})`
              : "جارٍ تحميل الخريطة…"}
        </p>
      </div>
    </div>
  );
}

function ColourOption({ value, children }: { value: ColourBy; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Radio.Root renders the control
    <label className="flex cursor-pointer items-center gap-1.5">
      <Radio.Root
        value={value}
        className="flex size-4 items-center justify-center rounded-full border border-muted data-checked:border-signal"
      >
        <Radio.Indicator className="size-2 rounded-full bg-signal data-unchecked:hidden" />
      </Radio.Root>
      {children}
    </label>
  );
}

const listButton =
  "flex w-full cursor-pointer items-baseline gap-2 rounded px-1.5 py-1 text-start text-[0.85rem] leading-snug text-ink hover:bg-hover";

function Swatch({ colour }: { colour: string }) {
  return <span className="size-2.5 shrink-0 self-center rounded-full" style={{ background: colour }} />;
}

function Selected({
  point,
  model,
  colourBy,
  onSelect,
}: {
  point: Point;
  model: MapModel;
  colourBy: ColourBy;
  onSelect: (p: Point) => void;
}) {
  const cluster = model.clusters.get(point.cluster);
  const near = useMemo(
    () =>
      model.points
        .filter((q) => q !== point)
        .map((q) => [q, (q.x - point.x) ** 2 + (q.y - point.y) ** 2] as const)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 10)
        .map(([q]) => q),
    [model, point],
  );

  return (
    <section className="rounded-lg border border-rule bg-surface px-3.5 py-3">
      <h2 className="text-base leading-snug font-semibold">
        <a href={episodeUrl(point)} target="_blank" rel="noopener" dir="auto" className="hover:text-signal">
          {point.title}
        </a>
      </h2>
      <p className="my-1.5 text-[0.85rem] text-muted">
        {model.channels[point.channel]} · {point.date}
      </p>
      <p className="my-1.5 text-[0.85rem] text-muted">
        {cluster ? `المجموعة: ${cluster.label}` : "بلا مجموعة"}
      </p>
      <h3 className="mt-4 mb-1.5 text-[0.8rem] font-semibold text-muted">الأقرب على الخريطة</h3>
      <ol>
        {near.map((q) => (
          <li key={q.id}>
            <button type="button" className={listButton} onClick={() => onSelect(q)}>
              <Swatch colour={colourOf(q, colourBy)} />
              <span dir="auto">{q.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ClusterList({
  model,
  active,
  onToggle,
}: {
  model: MapModel;
  active: number | null;
  onToggle: (id: number) => void;
}) {
  const order = useMemo(() => [...model.clusters.values()].sort((a, b) => b.size - a.size), [model]);
  return (
    <ol>
      {order.map((c) => (
        <li key={c.id}>
          <Toggle
            pressed={active === c.id}
            onPressedChange={() => onToggle(c.id)}
            className={`${listButton} data-pressed:bg-pressed`}
          >
            <Swatch colour={clusterColour(c.id)} />
            <span dir="auto" className="flex-1">
              {c.label}
            </span>
            <span className="text-muted tabular-nums">{arabic(c.size)}</span>
          </Toggle>
        </li>
      ))}
    </ol>
  );
}
