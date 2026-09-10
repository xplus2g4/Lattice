# Postgres table as the job queue

Ingest jobs (cognify and friends) are queued in a Postgres table claimed with `SELECT … FOR UPDATE SKIP LOCKED`, not in Redis or Celery. One worker process is enough at this scale, and a table means the queue lives inside the same nightly backup and transaction boundary as the rest of the app state. The cost is writing our own claim/retry/heartbeat logic instead of getting it from a broker; at one worker that logic is small.
