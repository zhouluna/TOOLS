export type ProbeCandidate = {
  id: string;
  displayName: string;
  status: string;
  endpoint: { url: string | null; nvidiaModelId: string | null; adapter?: string } | null;
};

const SLOW_WORD = /(?:^|[^a-z])(?:ultra|large|vision|guard|safety|translate|preview|super)(?:[^a-z]|$)/;
const SLOW_PRO = /(?:^|[^a-z])pro(?:[^a-z]|$)/;

function parameterBillions(label: string): number | null {
  const stripped = label.toLowerCase().replace(/-a\d+(?:\.\d+)?b\b/g, "");
  const sizes = [...stripped.matchAll(/(\d+(?:\.\d+)?)b\b/g)].map((match) => Number(match[1]));
  if (!sizes.length) return null;
  return Math.min(...sizes);
}

export function probeRank(model: ProbeCandidate): number {
  const label = `${model.id} ${model.displayName} ${model.endpoint?.nvidiaModelId ?? ""}`.toLowerCase();
  const size = parameterBillions(label);
  let rank = size ?? 1_000;
  if (SLOW_WORD.test(label) || SLOW_PRO.test(label) || label.includes("reason")) rank += 500;
  if (label.includes("flash")) rank += 40;
  return rank;
}

export function isKeyTestModel(model: ProbeCandidate | null): model is ProbeCandidate & {
  endpoint: { url: string; nvidiaModelId: string };
} {
  return Boolean(
    model &&
      model.status === "chat_ready" &&
      model.endpoint?.adapter === "openai_chat" &&
      model.endpoint.url &&
      model.endpoint.nvidiaModelId,
  );
}

/** Smallest general chat model. Specialized, reasoning, and unnamed models sort later. */
export function pickProbeModel<T extends ProbeCandidate>(models: readonly T[]): T | null {
  const ready = models.filter(isKeyTestModel);
  if (!ready.length) return null;
  return ready.sort(
    (left, right) =>
      probeRank(left) - probeRank(right) ||
      left.displayName.localeCompare(right.displayName) ||
      left.id.localeCompare(right.id),
  )[0];
}

export function resolveKeyTestModel<T extends ProbeCandidate>(requested: T | null, catalog: readonly T[]): T | null {
  if (requested) return isKeyTestModel(requested) ? requested : null;
  return pickProbeModel(catalog);
}
