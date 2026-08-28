use crate::state::AppState;
use serde::Serialize;
use sqlx::Row;
use tauri::State;

#[derive(Serialize, Debug)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub is_primary_key: bool,
}

#[derive(Serialize, Debug)]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    pub columns: Vec<ColumnInfo>,
    pub row_count_estimate: Option<i64>,
}

#[derive(Serialize, Debug)]
pub struct ViewInfo {
    pub schema: String,
    pub name: String,
}

#[derive(Serialize, Debug)]
pub struct FunctionInfo {
    pub schema: String,
    pub name: String,
    pub return_type: String,
    pub language: String,
    pub kind: String, // "function" | "procedure"
}

#[tauri::command]
pub async fn get_schema(state: State<'_, AppState>) -> Result<Vec<TableInfo>, String> {
    let pool = {
        let guard = state.pg_pool.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Not connected")?.clone()
    };

    let rows = sqlx::query(
        r#"
        SELECT
            t.table_schema,
            t.table_name,
            c.column_name,
            c.data_type,
            (c.is_nullable = 'YES') AS is_nullable,
            c.column_default,
            EXISTS (
                SELECT 1
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON kcu.constraint_name = tc.constraint_name
                    AND kcu.table_schema = tc.table_schema
                    AND kcu.table_name = tc.table_name
                WHERE tc.constraint_type = 'PRIMARY KEY'
                AND kcu.column_name = c.column_name
                AND kcu.table_name = t.table_name
                AND kcu.table_schema = t.table_schema
            ) AS is_primary_key,
            (
                SELECT reltuples::bigint
                FROM pg_class
                JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
                WHERE pg_class.relname = t.table_name
                AND pg_namespace.nspname = t.table_schema
            ) AS row_estimate
        FROM information_schema.tables t
        JOIN information_schema.columns c
            ON c.table_name = t.table_name
            AND c.table_schema = t.table_schema
        WHERE t.table_type = 'BASE TABLE'
        AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY t.table_schema, t.table_name, c.ordinal_position
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut tables: std::collections::BTreeMap<String, TableInfo> = Default::default();
    for row in &rows {
        let table_schema: String = row.try_get("table_schema").map_err(|e| e.to_string())?;
        let table_name: String = row.try_get("table_name").map_err(|e| e.to_string())?;
        let column_name: String = row.try_get("column_name").map_err(|e| e.to_string())?;
        let data_type: String = row.try_get("data_type").map_err(|e| e.to_string())?;
        let is_nullable: bool = row.try_get("is_nullable").map_err(|e| e.to_string())?;
        let column_default: Option<String> = row.try_get("column_default").map_err(|e| e.to_string())?;
        let is_primary_key: bool = row.try_get("is_primary_key").map_err(|e| e.to_string())?;
        let row_estimate: Option<i64> = row.try_get("row_estimate").map_err(|e| e.to_string())?;

        let key = format!("{}.{}", table_schema, table_name);
        let entry = tables.entry(key).or_insert_with(|| TableInfo {
            schema: table_schema.clone(),
            name: table_name.clone(),
            columns: vec![],
            row_count_estimate: row_estimate,
        });
        entry.columns.push(ColumnInfo {
            name: column_name,
            data_type,
            is_nullable,
            column_default,
            is_primary_key,
        });
    }

    Ok(tables.into_values().collect())
}

#[tauri::command]
pub async fn get_views(state: State<'_, AppState>) -> Result<Vec<ViewInfo>, String> {
    let pool = {
        let guard = state.pg_pool.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Not connected")?.clone()
    };

    let rows = sqlx::query(
        r#"
        SELECT table_schema, table_name
        FROM information_schema.views
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    rows.iter()
        .map(|r| {
            Ok(ViewInfo {
                schema: r.try_get("table_schema").map_err(|e: sqlx::Error| e.to_string())?,
                name: r.try_get("table_name").map_err(|e: sqlx::Error| e.to_string())?,
            })
        })
        .collect()
}

#[derive(Serialize, Debug)]
pub struct MatViewInfo {
    pub schema: String,
    pub name: String,
    pub is_populated: bool,
}

#[tauri::command]
pub async fn get_functions(state: State<'_, AppState>) -> Result<Vec<FunctionInfo>, String> {
    let pool = {
        let guard = state.pg_pool.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Not connected")?.clone()
    };

    // Use pg_proc instead of information_schema.routines to exclude extension-owned functions
    let rows = sqlx::query(
        r#"
        SELECT
            n.nspname AS routine_schema,
            p.proname AS routine_name,
            pg_get_function_result(p.oid) AS return_type,
            l.lanname AS language,
            CASE p.prokind
                WHEN 'f' THEN 'function'
                WHEN 'p' THEN 'procedure'
                WHEN 'a' THEN 'aggregate'
                WHEN 'w' THEN 'window'
                ELSE 'function'
            END AS kind
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              JOIN pg_extension e ON e.oid = d.refobjid
              WHERE d.objid = p.oid AND d.deptype = 'e'
          )
        ORDER BY n.nspname, p.proname
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    rows.iter()
        .map(|r| {
            Ok(FunctionInfo {
                schema: r.try_get("routine_schema").map_err(|e: sqlx::Error| e.to_string())?,
                name: r.try_get("routine_name").map_err(|e: sqlx::Error| e.to_string())?,
                return_type: r.try_get("return_type").map_err(|e: sqlx::Error| e.to_string())?,
                language: r.try_get("language").map_err(|e: sqlx::Error| e.to_string())?,
                kind: r.try_get("kind").map_err(|e: sqlx::Error| e.to_string())?,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn get_materialized_views(state: State<'_, AppState>) -> Result<Vec<MatViewInfo>, String> {
    let pool = {
        let guard = state.pg_pool.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Not connected")?.clone()
    };

    let rows = sqlx::query(
        r#"
        SELECT schemaname, matviewname, ispopulated
        FROM pg_matviews
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY schemaname, matviewname
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    rows.iter()
        .map(|r| {
            Ok(MatViewInfo {
                schema: r.try_get("schemaname").map_err(|e: sqlx::Error| e.to_string())?,
                name: r.try_get("matviewname").map_err(|e: sqlx::Error| e.to_string())?,
                is_populated: r.try_get("ispopulated").map_err(|e: sqlx::Error| e.to_string())?,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn get_table_ddl(
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let pool = {
        let guard = state.pg_pool.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Not connected")?.clone()
    };

    let rows = sqlx::query(
        r#"
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
        "#,
    )
    .bind(&schema)
    .bind(&table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut ddl = format!("CREATE TABLE {}.{} (\n", schema, table);
    let col_defs: Vec<String> = rows
        .iter()
        .map(|r| {
            let col: String = r.try_get("column_name").unwrap_or_default();
            let typ: String = r.try_get("data_type").unwrap_or_default();
            let nullable: String = r.try_get("is_nullable").unwrap_or_default();
            let default: Option<String> = r.try_get("column_default").unwrap_or(None);
            let null_str = if nullable == "YES" { "" } else { " NOT NULL" };
            let default_str = default.map(|d| format!(" DEFAULT {}", d)).unwrap_or_default();
            format!("  {} {}{}{}", col, typ, null_str, default_str)
        })
        .collect();
    ddl.push_str(&col_defs.join(",\n"));
    ddl.push_str("\n);");

    Ok(ddl)
}

// ── Sequences ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Debug)]
pub struct SequenceInfo {
    pub schema: String,
    pub name: String,
    pub data_type: String,
    pub start_value: String,
    pub increment: String,
    pub min_value: String,
    pub max_value: String,
    pub cycle: bool,
}

#[tauri::command]
pub async fn get_sequences(state: State<'_, AppState>) -> Result<Vec<SequenceInfo>, String> {
    let pool = {
        let guard = state.pg_pool.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Not connected")?.clone()
    };

    let rows = sqlx::query(
        r#"
        SELECT
            sequence_schema,
            sequence_name,
            data_type,
            start_value::text,
            increment::text,
            minimum_value::text,
            maximum_value::text,
            cycle_option
        FROM information_schema.sequences
        WHERE sequence_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY sequence_schema, sequence_name
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    rows.iter()
        .map(|r| {
            let cycle: String = r.try_get("cycle_option").map_err(|e: sqlx::Error| e.to_string())?;
            Ok(SequenceInfo {
                schema: r.try_get("sequence_schema").map_err(|e: sqlx::Error| e.to_string())?,
                name: r.try_get("sequence_name").map_err(|e: sqlx::Error| e.to_string())?,
                data_type: r.try_get("data_type").map_err(|e: sqlx::Error| e.to_string())?,
                start_value: r.try_get("start_value").map_err(|e: sqlx::Error| e.to_string())?,
                increment: r.try_get("increment").map_err(|e: sqlx::Error| e.to_string())?,
                min_value: r.try_get("minimum_value").map_err(|e: sqlx::Error| e.to_string())?,
                max_value: r.try_get("maximum_value").map_err(|e: sqlx::Error| e.to_string())?,
                cycle: cycle.to_uppercase() == "YES",
            })
        })
        .collect()
}

// ── Object definition ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_object_definition(
    schema: String,
    name: String,
    kind: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let pool = {
        let guard = state.pg_pool.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Not connected")?.clone()
    };

    let sql = match kind.as_str() {
        "function" | "procedure" | "aggregate" | "window" => {
            // pg_get_functiondef returns the full CREATE OR REPLACE FUNCTION statement
            let rows = sqlx::query(
                r#"
                SELECT pg_get_functiondef(p.oid) AS def
                FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = $1 AND p.proname = $2
                ORDER BY p.oid
                LIMIT 1
                "#,
            )
            .bind(&schema)
            .bind(&name)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.first()
                .map(|r| r.try_get::<String, _>("def").unwrap_or_default())
                .ok_or_else(|| format!("Function {}.{} not found", schema, name))?
        }

        "view" => {
            let rows = sqlx::query(
                r#"
                SELECT 'CREATE OR REPLACE VIEW ' || table_schema || '.' || table_name
                    || ' AS' || chr(10) || view_definition AS def
                FROM information_schema.views
                WHERE table_schema = $1 AND table_name = $2
                "#,
            )
            .bind(&schema)
            .bind(&name)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.first()
                .map(|r| r.try_get::<String, _>("def").unwrap_or_default())
                .ok_or_else(|| format!("View {}.{} not found", schema, name))?
        }

        "matview" => {
            let rows = sqlx::query(
                r#"
                SELECT 'CREATE MATERIALIZED VIEW ' || schemaname || '.' || matviewname
                    || ' AS' || chr(10) || definition AS def
                FROM pg_matviews
                WHERE schemaname = $1 AND matviewname = $2
                "#,
            )
            .bind(&schema)
            .bind(&name)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

            rows.first()
                .map(|r| r.try_get::<String, _>("def").unwrap_or_default())
                .ok_or_else(|| format!("Materialized view {}.{} not found", schema, name))?
        }

        "sequence" => {
            // Escape single quotes in schema/name for the nextval string argument
            let s_esc = schema.replace('\'', "''");
            let n_esc = name.replace('\'', "''");
            format!(
                r#"-- Sequence: {0}.{1}
SELECT * FROM "{0}"."{1}";

-- Next value:
SELECT nextval('"{2}"."{3}"');"#,
                schema, name, s_esc, n_esc
            )
        }

        _ => return Err(format!("Unknown object kind: {}", kind)),
    };

    Ok(sql)
}
