# Components

What runs, what each piece owns, and who talks to whom. The one-page view is [architecture.md](./architecture.md).

## Overview

```mermaid
flowchart LR
  subgraph client["Browser"]
    web["Web app (TanStack Start)"]
  end

  subgraph vm["GCP VM · docker compose"]
    api["API (FastAPI)"]
    worker["Ingest worker"]
    pg[("Postgres\napp tables + pgvector")]
    subgraph cognee["Cognee (in-process library)"]
      cg["add / cognify / search"]
      graph[("Ladybug graph\n(embedded)")]
    end
    queue[("Job queue\n(Postgres table)")]
  end

  oauth["Google OAuth"]
  llm["LLM API"]
  emb["Embeddings API"]
  gcs[("GCS bucket\nraw uploads")]
  analytics["GA4, page views by route id"]
  telegram["Telegram Bot API"]

  web -- "JWT + JSON" --> api
  web -. "page views (route id, no ids)" .-> analytics
  web -- OAuth --> oauth
  api -- "search(datasets=[global, mine])" --> cg
  api -- "enqueue ingest job" --> queue
  queue --> worker
  worker -- "add → cognify" --> cg
  worker -- "materials.status" --> pg
  api -- "app tables, course_summaries" --> pg
  cg --> pg
  cg --> graph
  cg --> llm
  cg --> emb
  api -- "compose answer" --> llm
  worker -- "fetch file" --> gcs
  api -- "signed upload" --> gcs
  api -- "watchdog alerts" --> telegram
```

The API is the only component that knows about users. Cognee sits behind the API as a storage-and-retrieval engine; it never receives a browser request and never sees a user token. The Worker is the same codebase as the API running a different entrypoint, so it shares models, config, and the Cognee client.

The API also embeds on its own account, outside Cognify: one profile per ready Material through the same embedding model Cognee uses, mean-pooled into the `course_summaries` vector that `/ask` picks Related courses from ([ADR 0008](../adr/0008-related-courses-from-summary-neighbours.md)). That refresh runs on a timer inside the API process, beside Note ingest, until there is a Worker to move it to ([flows.md](./flows.md)).

Measurement lives in the API too. Telemetry (latency, errors, queue age, Spend totals; a course label at most, never a Principal) is served at `GET /metrics` behind `METRICS_TOKEN`; Product events and the Spend ledger are rows in the app Postgres, written in the same transaction as the action they record; a third timer loop, the watchdog, checks queue age, loop heartbeats and the Ceiling and sends Telegram alerts. Nothing scrapes `/metrics` until a compose file exists ([operations.md](./operations.md#telemetry-and-alerts)). The web app's only third party is GA4, which receives page views keyed by route id and nothing else ([security.md](./security.md#egress)).

## Ownership table

| Component | Runs as | Owns | Talks to | Does not |
|---|---|---|---|---|
| **Web app** (TanStack Start, in [`app/`](../../app/)) | `web` container | UI, session cookie, streaming render, GA4 page views by route id, landing page | API, OAuth provider, GA4 | Call Cognee or the LLM directly; send ids, user identity or custom events to GA4; declare API types by hand (they are generated from `contracts/openapi.json`) |
| **API** (FastAPI, in [`server/`](../../server/)) | `api` container | Auth verification, RBAC, course/enrolment/material/session records, the `/ask` pipeline with its Related-course lane, answer validation, rate limits, response cache, the Course-summary refresh timer (until a Worker exists), Telemetry at `/metrics`, the Spend ledger and Ceiling, Product events, the watchdog loop and its Telegram alerts | Postgres, Cognee (in-process), embedding API (for Course summaries), LLM API, GCS, job queue, Telegram Bot API | Run cognify inline (always via Worker); put a Principal in a Telemetry label |
| **Worker** | `worker` container, same image as API (`server/`) | Executes ingest jobs: fetch file, optional pre-convert, `cognee.add`, `cognee.cognify`; updates material status; its Cognify Spend lands in the `spend` ledger against the course | GCS, Cognee, Postgres | Serve HTTP |
| **Cognee** | Python library imported by API and Worker, pinned version | Chunking, entity/relation extraction, embeddings, vector and graph storage, dataset-scoped permissions, `search()` | Postgres (relational + pgvector), Ladybug, LLM API, embeddings API | Know about app users beyond its own principal ids |
| **Postgres** | `postgres` container with `pgvector` | App tables ([data-model.md](./data-model.md)) including `course_summaries` (the one `vector` column the app owns), `spend` and `product_events`, Cognee relational tables, Cognee vector collections, job queue | — | Store the graph (Ladybug does; Postgres-as-graph in Cognee is a paid feature) |
| **Ladybug** | Embedded file DB on a named volume | The knowledge graph per dataset | Cognee only | — |
| **GCS bucket** | External | Raw uploaded files, nightly `pg_dump` | API (signed URLs), Worker | — |
| **LLM API** | External | Extraction during cognify; answer composition; small-model helpers (query rewrite, "why related") | Cognee, API | — |
| **Caddy** | `caddy` container | TLS termination, reverse proxy to `web` and `api` | — | — |
| **GA4** | External | Page-view counts per route id | Browser only | Receive uuids, user ids or custom events ([security.md](./security.md#egress)) |
| **Telegram Bot API** | External | Delivering watchdog alerts to the operator's chat | API (watchdog) | Receive content; unset token means alerts are only logged |

## Fallbacks that change this table

- Neo4j replaces Ladybug via a compose profile if the pinned Ladybug breaks. Whether to switch preemptively is an open decision, see [backlog.md](./backlog.md).
- Docling or markitdown pre-conversion is inserted in the Worker if Cognee's native PDF/PPTX extraction is poor on real slides.
