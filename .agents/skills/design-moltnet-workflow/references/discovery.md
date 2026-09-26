# Discover work and decide whether assistance is worthwhile

## Reconstruct actual work

Begin with a recent occurrence and its artifacts. Ask what arrived, what happened,
what was produced, who received it, and what indicated it was good enough.
Trace waiting, re-entry, informal fixes, and rejected results as well as the
normal path. When useful, compare a difficult case with an ordinary one.

Separate observed behavior, recollection, written policy, and proposed changes.
Record role, source/date/revision, conditions of applicability, and unresolved
conflicts. Evidence from historical practice may identify a hypothesis without
establishing current volume, costs, or adoption.

Before optimizing a step, establish what improvement matters: time recovered,
shorter queues, fewer errors, capacity, or a better downstream decision. Faster
production may not imply earlier release or permission to act.

## Assess value and readiness separately

| Dimension | Evidence to seek |
|---|---|
| Potential value | Frequency, work and waiting time, rework, consequence of mistakes, downstream bottleneck |
| Available inputs | Real examples, source access, freshness, missing information, allowed processing destinations |
| Checkability | What the recipient accepts/rejects, observable checks, examples of costly mistakes |
| Operational readiness | Integrations, owner, maintenance capacity, recovery requirements |
| Remaining human work | Review, corrections, decisions, exceptions, and their expected frequency |

Use ranges and unknowns where measurements are missing. Compare expected savings
and quality benefits with setup, operation, review, and maintenance costs. Avoid
a universal numeric suitability score. A prototype can measure feasibility while
commercial value remains unvalidated.

Possible recommendation: retain manual work, simplify first, automate with fixed
tools, assist selected stages, or test broader autonomy. Explain what observation
would change the recommendation.

## Use ACTA where judgment is hidden

Adapt the original ACTA sequence:

1. Sketch a small task diagram with the owner. Locate difficult judgments.
2. Use relevant knowledge-audit probes on those judgments.
3. Walk through a challenging real or established training scenario.
4. Summarize cognitive demands and check the interpretation with the owner.

| Response | Useful follow-up |
|---|---|
| A list of steps | What tells you it is time to move on? |
| "It depends" | Show two cases where you acted differently. What changed? |
| "You get a feel for it" | What did you notice in the last case that someone new might miss? |
| An apparently obvious decision | What would have made that decision wrong? |
| A workaround | What fails in the normal procedure, and when? |
| Confidence without evidence | What feedback showed that earlier decisions were correct? |
| Conflicting expert accounts | Under which conditions does each approach apply? |

Probe perception, situation awareness, prediction, practical heuristics,
improvisation, self-monitoring, anomalies, and equipment limitations only where
they help. Ask what information was available at the time to avoid hindsight
being mistaken for a usable decision rule.

Capture difficult element, why difficult, cues/strategies, common errors,
applicability, and source. Add example cases and implications for inputs/checks.
Expert descriptions can be incomplete or mistaken: triangulate with records,
observed work, recipients, or other practitioners when that uncertainty matters.
Retain plausible disagreements. More interviews may strengthen evidence, but a
fixed expert count or forced consensus is not a completion rule.

If a cue is sensory, private, or inaccessible, identify how the implementation
would obtain it. A language description of expertise does not supply the sensor,
integration, or demonstrated model ability.

## Classify gaps before asking for everything

- **Blocks an activity:** name the dependent activity and required evidence.
- **Creates alternatives:** explore distinct interpretations if useful and affordable.
- **Permits an assumption:** state bounds and when confirmation becomes necessary.
- **Needed later:** preserve it without interrupting unrelated work.

Each consequential question needs a stable ID, intended answerer, requested
evidence, affected activities, and eventual answer provenance. Persist it with
the design or case. A missing adapter is an implementation gap, not a question
the process owner should be asked to resolve as a business fact.

## Sources and adaptation boundaries

- [ACTA technical report, 1997](https://github.com/curiositech/some_claude_skills/blob/main/corpus/for_erik/Applied_Cognitive_Task_Analysis_ACTA_Met.pdf): task diagram, knowledge audit, simulation interview, demands table.
- [ACTA journal paper, 1998](https://doi.org/10.1080/001401398186108).
- [Critical Decision Method](https://doi.org/10.1109/21.31053): deeper incident-based elicitation when needed.
- [Kahneman and Klein, intuitive expertise](https://doi.org/10.1037/a0016755): predictable conditions and opportunities to learn; subjective confidence is insufficient.
- [Automation selection study](https://doi.org/10.1177/02683962231165066): useful selection dimensions; its RPA assumptions do not establish agent suitability.
- [Reviewed ACTA skill](https://github.com/curiositech/windags-skills/blob/291fd696c6a3219f8c33b4738b9ac656ad7c2fda/skills/applied-cognitive-task-analysis-acta-met/SKILL.md): useful interview-pivot inspiration. This reference is an independent synthesis; it does not adopt its fixed coverage or consensus rules.

The suitability and stopping guidance above is our proposed application of these
methods, to be tested with implementer/owner pairs.
