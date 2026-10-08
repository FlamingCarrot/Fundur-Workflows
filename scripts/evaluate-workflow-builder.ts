import { readFileSync } from "node:fs";
import {
  BUILDER_EVALUATIONS,
  scoreWorkflowReply,
} from "../src/lib/workflow/builder-evaluation";
// This command never contacts a provider. Pass captured candidate JSON replies keyed by case ID.
const [candidatePath, baselinePath] = process.argv.slice(2);
if (!candidatePath) {
  console.error(
    "Usage: npx tsx scripts/evaluate-workflow-builder.ts candidate.json [baseline.json]\nEach file maps the 12 evaluation case IDs to raw JSON replies or parsed reply objects.",
  );
  process.exit(1);
}
function scores(file: string) {
  const values = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    unknown
  >;
  const results = BUILDER_EVALUATIONS.map((sample) =>
    scoreWorkflowReply(
      sample,
      typeof values[sample.id] === "string"
        ? (values[sample.id] as string)
        : JSON.stringify(values[sample.id] ?? null),
    ),
  );
  return {
    average: Math.round(
      results.reduce((sum, r) => sum + r.score, 0) / results.length,
    ),
    results,
  };
}
const candidate = scores(candidatePath),
  baseline = baselinePath ? scores(baselinePath) : null;
console.log(
  JSON.stringify(
    {
      candidate,
      baseline,
      change: baseline ? candidate.average - baseline.average : null,
      limitation:
        "Structural/module coverage score; designer suitability and faithfulness need human review.",
    },
    null,
    2,
  ),
);
