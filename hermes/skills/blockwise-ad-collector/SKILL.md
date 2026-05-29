# blockwise-ad-collector

## Purpose

Run bounded ad collection against resolved Meta advertiser pages. The primary
hosted provider is selected by `AD_COLLECTOR_PROVIDER`; the self-hosted
collector is the verifier/debug path and writes through the normal research
ingestion path when selected.

## Hermes Access On The VPS

The collector is a sibling Docker service on the private `blockwise` network:

```bash
META_AD_LIBRARY_COLLECTOR_URL=http://meta-ad-library-collector:9100
SELF_HOSTED_META_COLLECTOR_URL=http://meta-ad-library-collector:9100
```

Hermes may call:

- `GET /health`
- `GET /session/status`
- `POST /status-check`
- `POST /full-capture`

For a bounded end-to-end ingest of exactly one resolved advertiser page, run
the orchestrator with:

```bash
ORCHESTRATOR_MODE=once ORCHESTRATOR_MAX_PAGES_PER_TICK=1 ORCHESTRATOR_TARGET_PAGE_ID=<advertiser_pages.id-or-meta-page-id>
```

Use `scripts/collector_client.py` for repeatable checks. The collector source
is mounted inside Hermes at:

```text
/opt/blockwise/meta-ad-library-collector
```

Hermes can refine the collector, but edits must stay inside that directory or
this skill folder. After changing collector code, run:

```bash
python -m py_compile /opt/blockwise/meta-ad-library-collector/server.py
curl -s "$META_AD_LIBRARY_COLLECTOR_URL/health"
python /opt/data/skills/blockwise-ad-collector/scripts/collector_client.py session-status
```

Login walls, checkpoints, timeouts, and blocked pages are failed runs, never
"zero ads." Do not add forged tokens or account-evasion logic.
