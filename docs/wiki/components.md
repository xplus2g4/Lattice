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
      kuzu[("Kuzu graph\n(embedded)")]
    end
    queue[("Job queue\n(Postgres table)")]
  end

  oauth["Google OAuth"]
  llm["LLM API"]
  emb["Embeddings API"]
  gcs[("GCS bucket\nraw uploads")]
  analytics["GA4 / PostHog"]

  web -- "JWT + JSON" --> api
  web -. events .-> analytics
  web -- OAuth --> oauth
  api -- "search(datasets=[global, mine])" --> cg
  api -- "enqueue ingest job" --> queue
  queue --> worker
  worker -- "add → cognify" --> cg
  worker -- "materials.status" --> pg
  api --> pg
  cg --> pg
  cg --> kuzu
  cg --> llm
  cg --> emb
  api -- "compose answer" --> llm
  worker -- "fetch file" --> gcs
  api -- "signed upload" --> gcs
```

The API is the only component that knows about users. Cognee sits behind the API as a storage-and-retrieval engine; it never receives a browser request and never sees a user token. The Worker is the same codebase as the API running a different entrypoint, so it shares models, config, and the Cognee client.

## Ownership table

| Component | Runs as | Owns | Talks to | Does not |
|---|---|---|---|---|
| **Web app** (TanStack Start, in [`app/`](../../app/)) | `web` container | UI, session cookie, streaming render, analytics events, landing page | API, OAuth provider, analytics | Call Cognee or the LLM directly |
| **API** (FastAPI) | `api` container | Auth verification, RBAC, course/enrolment/material/session records, the `/ask` pipeline, answer validation, rate limits, response cache | Postgres, Cognee (in-process), LLM API, GCS, job queue | Run cognify inline (always via Worker) |
| **Worker** | `worker` container, same image as API | Executes ingest jobs: fetch file, optional pre-convert, `cognee.add`, `cognee.cognify`; updates material status and token cost | GCS, Cognee, Postgres | Serve HTTP |
| **Cognee** | Python library imported by API and Worker, pinned version | Chunking, entity/relation extraction, embeddings, vector and graph storage, dataset-scoped permissions, `search()` | Postgres (relational + pgvector), Kuzu, LLM API, embeddings API | Know about app users beyond its own principal ids |
| **Postgres** | `postgres` container with `pgvector` | App tables ([data-model.md](./data-model.md)), Cognee relational tables, Cognee vector collections, job queue | — | Store the graph (Kuzu does; Postgres-as-graph in Cognee is a paid feature) |
| **Kuzu** | Embedded file DB on a named volume | The knowledge graph per dataset | Cognee only | — |
| **GCS bucket** | External | Raw uploaded files, nightly `pg_dump` | API (signed URLs), Worker | — |
| **LLM API** | External | Extraction during cognify; answer composition; small-model helpers (query rewrite, "why related") | Cognee, API | — |
| **Caddy** | `caddy` container | TLS termination, reverse proxy to `web` and `api` | — | — |

## Fallbacks that change this table

- Neo4j replaces Kuzu via a compose profile if the pinned Kuzu breaks. Whether to switch preemptively is an open decision, see [backlog.md](./backlog.md).
- Docling or markitdown pre-conversion is inserted in the Worker if Cognee's native PDF/PPTX extraction is poor on real slides.
