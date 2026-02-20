import Database from "better-sqlite3";
import { QueryTypes, Sequelize, type Options } from "sequelize";
import type { DatabaseConfig, DatabaseDialect } from "../../domain/report/models.js";

type QueryRow = Record<string, unknown>;

const sequelizeByDatabase = new Map<string, Sequelize>();

const POOL_CONFIG = {
  max: 20,
  min: 2,
  idle: 30_000,
};

const TRAILING_SEMICOLON_PATTERN = /;+\s*$/;
const ORDER_BY_PATTERN = /\border\s+by\b/i;

function buildDatabaseKey(config: DatabaseConfig): string {
  return [
    config.dialect,
    config.host ?? "",
    config.port?.toString() ?? "",
    config.user ?? "",
    config.database,
  ].join("|");
}

function mapDialect(dialect: DatabaseDialect): Options["dialect"] {
  if (dialect === "pg") {
    return "postgres";
  }

  if (dialect === "sqlite3") {
    return "sqlite";
  }

  return "mssql";
}

function buildSequelizeInstance(config: DatabaseConfig): Sequelize {
  const dialect = mapDialect(config.dialect);

  if (dialect === "sqlite") {
    type SQLiteOptions = Options & { useNullAsDefault: boolean };

    const sqliteOptions: SQLiteOptions = {
      dialect,
      storage: config.database,
      logging: false,
      dialectModule: Database,
      useNullAsDefault: true,
    };

    return new Sequelize(sqliteOptions as unknown as Options);
  }

  const sequelizeOptions: Options = {
    dialect,
    host: config.host,
    port: config.port,
    username: config.user,
    password: config.password,
    database: config.database,
    logging: false,
    pool: POOL_CONFIG,
  };

  return new Sequelize(sequelizeOptions);
}

function getSequelize(config: DatabaseConfig): Sequelize {
  const key = buildDatabaseKey(config);
  const cached = sequelizeByDatabase.get(key);

  if (cached) {
    return cached;
  }

  const created = buildSequelizeInstance(config);
  sequelizeByDatabase.set(key, created);
  return created;
}

function removeTrailingSemicolon(query: string): string {
  return query.trim().replace(TRAILING_SEMICOLON_PATTERN, "");
}

function paginateQuery(
  query: string,
  dialect: DatabaseDialect,
  offset: number,
  limit: number,
): string {
  const normalized = removeTrailingSemicolon(query);

  if (dialect === "mssql") {
    const orderedQuery = ORDER_BY_PATTERN.test(normalized)
      ? normalized
      : `${normalized} ORDER BY (SELECT NULL)`;

    return `${orderedQuery} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  }

  return `SELECT * FROM (${normalized}) AS paged_query LIMIT ${limit} OFFSET ${offset}`;
}

async function fetchQueryBatch(
  config: DatabaseConfig,
  query: string,
  offset: number,
  limit: number,
): Promise<QueryRow[]> {
  const sequelize = getSequelize(config);
  const paginatedQuery = paginateQuery(query, config.dialect, offset, limit);

  const rows = await sequelize.query<QueryRow>(paginatedQuery, {
    type: QueryTypes.SELECT,
    raw: true,
  });

  return rows;
}

export async function* queryInBatches(
  config: DatabaseConfig,
  query: string,
  chunkSize: number,
): AsyncGenerator<QueryRow[]> {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer.");
  }

  let offset = 0;

  for (;;) {
    const rows = await fetchQueryBatch(config, query, offset, chunkSize);

    if (rows.length === 0) {
      break;
    }

    yield rows;

    if (rows.length < chunkSize) {
      break;
    }

    offset += chunkSize;
  }
}

export async function closeAllConnections(): Promise<void> {
  const closeTasks = Array.from(sequelizeByDatabase.values()).map((sequelize) =>
    sequelize.close(),
  );

  await Promise.all(closeTasks);
  sequelizeByDatabase.clear();
}
