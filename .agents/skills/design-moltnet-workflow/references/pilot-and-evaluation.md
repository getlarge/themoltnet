# Test the design and the skill

## Pilot the workflow

Choose cases that exercise the proposed slice: ordinary work, an ambiguity or
missing input, and a consequential exception where relevant. Include the next
real consumer and a baseline using the current process or a simpler design.

Define success with the owner before interpreting results. Useful measures:

- Result quality: omissions, unsupported claims, wrong decisions, usable handoffs.
- Human effort: review, corrections, decisions, exception handling.
- Time: end-to-end delay, queue time, execution time, and human waits separately.
- Operation: known usage/cost, missing telemetry, failures, and recovery effort.
- Business effect: the intended bottleneck or outcome, where observable.

Use real thresholds when supplied; otherwise propose thresholds for review and
label them as such. Do not invent measured baselines. Report cold/new-input and
reused-input runs separately. Missing usage is unknown, not zero.

Evaluate the checker as well as the producer. Test whether it finds known errors,
avoids false findings, provides actionable repairs, and stops when evidence is
insufficient. Repeated model agreement is not an independent correctness check.

Keep development examples separate from held-out evaluation. A later document
revision is not automatically the correct answer to an earlier brief. Freeze
candidate inputs/results before exposing evaluation-only evidence.

## Build decision cases from discovery

ACTA incidents and common errors can become case fixtures. Present only the
information available at each decision point; ask what information is missing,
what action follows, and which evidence supports it. Compare with reviewed
domain criteria, allowing multiple legitimate choices where appropriate.

[ShadowBox](https://github.com/curiositech/some_claude_skills/blob/main/corpus/for_erik/Thinking_Inside_the_Box_The_ShadowBox_Me.pdf)
motivates this structure through human training. Its use for evaluating our
agent workflows is an adaptation that needs its own evidence. Expert reference
answers and scoring guidance must remain outside candidate execution context.

## Increase autonomy based on observed behavior

Autonomy can differ by stage: draft, recommend, act after review, or act within
defined bounds with escalation. Select it from consequences, reversibility,
check quality, and available evidence. Full autonomy is not the default endpoint.

Expand a stage's authority only when representative cases support its acceptance
and exception behavior and the owner authorizes the expansion. Record what
changes or failures require review, rollback, or narrower authority.

## Questions the draft skill still needs to answer empirically

| Uncertainty | Useful test |
|---|---|
| Can the interview recover enough tacit knowledge without becoming burdensome? | Observe an implementer/owner pair reconstructing recent work; track time, unanswered decisions and owner corrections |
| Does the method choose useful task boundaries? | Compare its first decomposition with a simpler baseline on the same cases |
| Does it reject weak automation opportunities? | Give it a low-volume process with cheap manual execution and costly review; inspect its reasoning and recommendation |
| Can it preserve a usable existing platform? | Supply an existing n8n/Node-RED workflow and constraints; check that changes follow requirements |
| Can it produce runnable, truthful MoltNet handoffs? | Run the synthetic slice with real supported interfaces and verify accepted output, domain checks and actual human resumption |
| Does it distinguish expertise from confidence? | Include conflicting accounts and weak feedback histories; inspect uncertainty handling |

These are evaluation proposals, not completed tests or hardcoded expected answers.
An independent evaluation should receive the request, skill, and raw evidence;
keep private grading criteria separate. Structural skill validation checks files
and metadata only and must not be reported as behavioral validation.
