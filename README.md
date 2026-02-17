# Astrum

Astrum is a Fastify API that runs SQL queries against multiple databases and generates report files (`.xlsx` or `.json`) in batches.

## What it does

- Exposes an HTTP API for report generation.
- Supports `mssql`, `pg`, and `sqlite3`.
- Generates one output file per worksheet definition.
- Streams large datasets using chunked pagination.
- Provides OpenAPI docs at `/docs`.

## Requirements

- Bun (used by project scripts)
- Node.js 22+ (recommended)

## Install

```bash
bun install
```

## Run

Development:

```bash
bun run dev
```

Production-like:

```bash
bun run build
bun run start
```

Default server address: `http://0.0.0.0:3000`

## Environment variables

- `PORT`: API port (default: `3000`)
- `OUTPUT_DIR`: directory where reports are written (default: `./output`)
- `DATABASE_PRESETS_JSON_FILE`: path to a JSON file with DB presets
- `DATABASE_PRESETS_JSON`: JSON string with DB presets (used if file variable is not set)

Example `.env`:

```env
DATABASE_PRESETS_JSON_FILE=secrets/database.json
OUTPUT_DIR=output
PORT=3000
```

Preset key rules:

- Keys must use only uppercase letters (`^[A-Z]+$`), e.g. `SALESDB`.

## API

### `GET /health`

Returns service status, runtime, and uptime.

### `POST /reports`

Creates report files from one or more worksheet definitions.

Request body:

```json
{
  "report_name": "monthly_report",
  "format": "xlsx",
  "chunksize": 10000,
  "worksheets": {
    "customers": {
      "query": "SELECT id, name FROM customers",
      "database": "TESTE"
    },
    "orders": {
      "query": "SELECT id, total FROM orders",
      "database": {
        "dialect": "pg",
        "host": "localhost",
        "port": 5432,
        "user": "postgres",
        "password": "postgres",
        "database": "appdb"
      }
    }
  }
}
```

Notes:

- `database` can be a preset key string (`"TESTE"`) or an inline database config object
- Supported `format`: `xlsx`, `json`
- `chunksize` defaults to `10000` when omitted

### `GET /reports/:filename`

Downloads a previously generated file from `OUTPUT_DIR`.

## Quick test

```bash
curl http://localhost:3000/health
```

## PM2 (optional)

An `ecosystem.config.js` is included:

```bash
bun run build
pm2 start ecosystem.config.js
```

## Project structure

```text
src/server.ts    # Fastify API, validation, routes
src/pipeline.ts  # Worker orchestration per worksheet
src/worker.ts    # Worker thread entrypoint
src/excel.ts     # XLSX/JSON file writers
src/db.ts        # DB connections and paginated querying
src/types.ts     # Shared TypeScript types
```
