# Course-summary similarities on the dev courses

24 Sep 2026, branch `feat/crossmod` ([PR #81](https://github.com/xplus2g4/Lattice/pull/81)). `BAAI/bge-small-en-v1.5` through fastembed; one profile per ready Material (title, week, kind, Topic labels, the first Page's text via pypdf, at most 1,500 characters), mean-pooled to unit length per course; cosine similarity read back from pgvector as `1 - (a <=> b)`. Point-in-time: the local dev stack's five courses after the first refresh, four of them with ready Materials. Supersede with a dated file rather than editing.

## The set

| Course | Ready Materials | Profile text (chars) |
|---|---|---|
| cs4234 | 13 | 2,707 |
| cs5234 | 1 | 44 |
| csfoo | 10 | 909 |
| cssmth | 10 | 909 |
| cs3230 | 0 | no summary, by design |

## Pairwise cosine similarity

| Pair | Similarity |
|---|---|
| csfoo, cssmth | 1.000 |
| cs4234, cs5234 | 0.848 |
| cs5234, csfoo | 0.800 |
| cs5234, cssmth | 0.800 |
| cs4234, csfoo | 0.794 |
| cs4234, cssmth | 0.794 |

## What it says, and does not

- Every pair clears the floor `MIN_SIMILARITY = 0.75`, so on this set each course gets its three nearest as Related courses. No pair here is unrelated by any reading, so the floor has met nothing it was meant to exclude: this neither supports nor refutes 0.75.
- csfoo and cssmth are identical summaries: the same ten Materials uploaded under two codes. Duplicate courses will always be each other's nearest, whatever the floor.
- cs5234 has one Material and 44 characters of profile, yet sits at 0.80 to 0.85 from the others. With this model, mean-pooled vectors of any computer-science teaching text land close together; that compressed range is why the floor was set high, and why it cannot be judged without a course from another field.
- The next measurement needs at least one course from another discipline and a labelled list of related and unrelated pairs. Use the [benchmark template](../benchmarks/0000-template.md) with a null arm of profiles shuffled across courses, so that "similar because it is all lecture text" is separated from "similar because it is the same subject".

The open question lives in [backlog.md](../wiki/backlog.md) under "Related-course similarity floor".
