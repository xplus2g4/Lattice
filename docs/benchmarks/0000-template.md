# BENCH-NNNN: <what is being measured>

- **Date:** YYYY-MM-DD
- **Status:** Draft | Final | Superseded by BENCH-NNNN
- **Claim under test:** <the performance claim this exists to confirm or refute>
- **Decision it feeds:** ADR-NNNN, or "none yet"

> A measurement without a stated methodology is an anecdote. Every section below is mandatory.
> If one cannot be filled in, the benchmark is not finished and its numbers must not be quoted.

## The claim

The specific, falsifiable claim. "X is too slow" is not a claim — "X exceeds 16 ms per frame on
a mid-range laptop" is. If the claim as originally stated is unfalsifiable, restate it here and
note that it was restated.

## Isolated variable

**The one thing that differs between arms.** Everything else must be held constant.

State explicitly what the control arm is — including, where relevant, a null arm: the same
measurement with the work removed, establishing the floor. A number without a floor to compare
against cannot distinguish "this operation is slow" from "the harness is slow".

## Environment

| | |
|---|---|
| Machine | <CPU, RAM, OS and version> |
| Runtime | <browser and version, Python and Go versions, compiler and flags> |
| Build | <debug or release, optimisation level, what the build actually produced> |
| Conditions | <thermal state, other load, network, warm or cold> |

Browser results: state whether devtools were open. They were not, ideally — devtools change the
numbers, and an open console with logging can dominate the measurement entirely.

## Method

Commands run, in order. Number of iterations. Warmup iterations discarded, and how many. How
timing was captured, and the resolution of the timer.

## Results

Raw numbers, not just a summary. Report **median and p95**, never the mean alone — a mean hides
the tail, and the tail is what users feel. Include n.

| Arm | n | Median | p95 | Min | Max |
|---|---|---|---|---|---|
| | | | | | |

## Interpretation

What the numbers mean for the claim: confirmed, refuted, or inconclusive. "Inconclusive" is a
real and common result and must be reported as such rather than rounded toward the hypothesis.

## Threats to validity

What could make these numbers wrong or non-transferable. Measured on one machine? Synthetic
workload unlike real use? Confounded by something not isolated? Say so here, plainly. This
section protects the reader from over-trusting the table above.
