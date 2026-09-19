/**
 * @file `moku-release` — the workflow template surface: what to write, where, and how to
 * tell a migrated workflow from a hand-written legacy one.
 *
 * `setup` writes what {@link workflowTemplates} lists; `doctor` reads the same list back
 * and asks {@link isThinWorkflow} whether the file on disk still calls the pinned central
 * workflow. One list, both directions — a template can never drift from its check.
 *
 * The bodies are read from this package's own `examples/package/*.yml` and
 * `rulesets/main.json`: this CLI distributes the central definitions, it does not copy them.
 */
import { CI_WORKFLOW, CI_WORKFLOW_PATH, CI_WORKFLOW_REF } from "../templates/ci";
import {
  PUBLISH_WORKFLOW,
  PUBLISH_WORKFLOW_PATH,
  PUBLISH_WORKFLOW_REF
} from "../templates/publish";
import { MAIN_RULESET_JSON } from "../templates/ruleset";

/**
 * One generated workflow: where it lives, what it should contain, and the reusable-workflow
 * ref that proves it is the thin caller rather than a legacy file.
 *
 * @example
 * const [ci] = workflowTemplates;
 * await files.write(ci.path, ci.content);
 */
export type WorkflowTemplate = {
  /** Repo-relative path the workflow is written to. */
  readonly path: string;
  /** The rendered YAML body. */
  readonly content: string;
  /** The `moku-labs/ci/...@v1` ref the file must call. */
  readonly ref: string;
};

/** Both generated workflows, in the order `setup` writes and `doctor` reports them. */
export const workflowTemplates: readonly WorkflowTemplate[] = [
  { path: CI_WORKFLOW_PATH, content: CI_WORKFLOW, ref: CI_WORKFLOW_REF },
  { path: PUBLISH_WORKFLOW_PATH, content: PUBLISH_WORKFLOW, ref: PUBLISH_WORKFLOW_REF }
];

/**
 * Whether a workflow file on disk is the thin caller — i.e. it delegates to the pinned
 * central reusable workflow. A file that does not is a legacy hand-written pipeline.
 * Matching on the `@v1` ref rather than on the whole body is deliberate: the
 * `publish.local-publish.yml` fallback variant calls the same ref and must also pass.
 *
 * @param content - The file contents read from disk.
 * @param template - The template the file is expected to match.
 * @returns `true` when the file calls the pinned reusable workflow.
 * @example
 * isThinWorkflow(onDisk, workflowTemplates[0]);
 */
export function isThinWorkflow(content: string, template: WorkflowTemplate): boolean {
  return content.includes(template.ref);
}

/**
 * The branch-ruleset payload `gh api … --input -` reads — the central definition verbatim.
 *
 * @returns The ruleset JSON.
 * @example
 * const body = renderMainRuleset();
 */
export function renderMainRuleset(): string {
  return MAIN_RULESET_JSON;
}
