# Scheduled refreshes

A corpus goes stale: upstream sources (Wikidata, PetScan, dumps) change after you
build it. `pinakes_engine run --since <duration>` is the scheduled-refresh mode —
point a cron job or systemd timer at it and the corpus stays current without
manual runs.

## How `--since` decides what to refresh

`run --since <duration> jobs/<name>.yml` grades every category in the job against
the corpus catalog (`<output_root>/catalog.json`, written after each run):

- a category whose recorded `last_run` is **older than `now - duration`** (or
  that has never been catalogued) is **stale** and is re-acquired;
- a category refreshed **more recently than the window** is **up to date** and is
  skipped.

The stale categories are re-fetched (the freshness window, not the per-stage
input fingerprint, is what forces a re-fetch — an unchanged category spec would
otherwise never re-acquire). The fresh categories fall through to the ordinary
incremental skip (US-003): they do no work and open no network connection, but
their existing data is still stitched into the rebuilt corpus, so a partial
refresh never drops categories from the graph.

Every scheduled run appends one JSON line to `<output_root>/refresh-log.jsonl`
recording the window, the cutoff, and which categories were refreshed vs skipped
(with a per-category reason), so the schedule leaves an audit trail.

### Duration syntax

`--since` accepts compact durations built from `<number><unit>` terms, where the
unit is `s` (seconds), `m` (minutes), `h` (hours), `d` (days), or `w` (weeks).
Terms may be concatenated:

```
--since 30m      # 30 minutes
--since 24h      # 1 day
--since 7d       # 1 week
--since 1w12h    # 8.5 days
```

## Example: nightly refresh with cron

Refresh any seed-corpus category not rebuilt in the last day, every night at
03:15. The job's `output_root` holds the catalog and the run log, so no extra
state is needed.

```cron
# m h dom mon dow  command
15 3 * * *  cd /srv/pinakes-engine && /srv/pinakes-engine/.venv/bin/pinakes_engine run --since 24h jobs/seed-corpus.yml >> /var/log/pinakes_engine/refresh.log 2>&1
```

## Example: weekly refresh with a systemd timer

`/etc/systemd/system/pinakes_engine-refresh.service`:

```ini
[Unit]
Description=Refresh the pinakes-engine seed corpus
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/srv/pinakes-engine
ExecStart=/srv/pinakes-engine/.venv/bin/pinakes_engine run --since 7d jobs/seed-corpus.yml
```

`/etc/systemd/system/pinakes_engine-refresh.timer`:

```ini
[Unit]
Description=Weekly pinakes-engine corpus refresh

[Timer]
OnCalendar=Mon *-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and start the timer:

```sh
systemctl enable --now pinakes_engine-refresh.timer
systemctl list-timers pinakes_engine-refresh.timer   # confirm the next run
```

`Persistent=true` runs a missed refresh as soon as the machine is back, so a
powered-down host catches up rather than skipping a cycle.
