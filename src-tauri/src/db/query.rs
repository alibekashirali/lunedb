use crate::state::AppState;
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use sqlx::{Column, Row, TypeInfo};
use tauri::State;

const ROW_LIMIT: usize = 10_000;
const QUERY_TIMEOUT_SECS: u64 = 30;

#[derive(Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub row_count: usize,
    pub execution_time_ms: u64,
    pub truncated: bool,
    pub error: Option<String>,
}

fn pg_value(row: &sqlx::postgres::PgRow, i: usize) -> Value {
    let type_name = row.column(i).type_info().name();

    match type_name {
        "BOOL" => row
            .try_get::<Option<bool>, _>(i)
            .ok()
            .flatten()
            .map(Value::Bool)
            .unwrap_or(Value::Null),

        "INT2" => row
            .try_get::<Option<i16>, _>(i)
            .ok()
            .flatten()
            .map(|n| Value::Number((n as i64).into()))
            .unwrap_or(Value::Null),
        "INT4" => row
            .try_get::<Option<i32>, _>(i)
            .ok()
            .flatten()
            .map(|n| Value::Number((n as i64).into()))
            .unwrap_or(Value::Null),
        "INT8" | "OID" => row
            .try_get::<Option<i64>, _>(i)
            .ok()
            .flatten()
            .map(|n| Value::Number(n.into()))
            .unwrap_or(Value::Null),

        "FLOAT4" => row
            .try_get::<Option<f32>, _>(i)
            .ok()
            .flatten()
            .and_then(|f| serde_json::Number::from_f64(f as f64))
            .map(Value::Number)
            .unwrap_or(Value::Null),
        "FLOAT8" => row
            .try_get::<Option<f64>, _>(i)
            .ok()
            .flatten()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),

        "NUMERIC" => row
            .try_get::<Option<rust_decimal::Decimal>, _>(i)
            .ok()
            .flatten()
            .map(|d| Value::String(d.to_string()))
            .unwrap_or(Value::Null),

        "JSON" | "JSONB" => row
            .try_get::<Option<serde_json::Value>, _>(i)
            .ok()
            .flatten()
            .unwrap_or(Value::Null),

        "TIMESTAMPTZ" => row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(i)
            .ok()
            .flatten()
            .map(|dt| Value::String(dt.format("%Y-%m-%d %H:%M:%S UTC").to_string()))
            .unwrap_or(Value::Null),

        "TIMESTAMP" => row
            .try_get::<Option<chrono::NaiveDateTime>, _>(i)
            .ok()
            .flatten()
            .map(|dt| Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
            .unwrap_or(Value::Null),

        "DATE" => row
            .try_get::<Option<chrono::NaiveDate>, _>(i)
            .ok()
            .flatten()
            .map(|d| Value::String(d.format("%Y-%m-%d").to_string()))
            .unwrap_or(Value::Null),

        "TIME" => row
            .try_get::<Option<chrono::NaiveTime>, _>(i)
            .ok()
            .flatten()
            .map(|t| Value::String(t.format("%H:%M:%S").to_string()))
            .unwrap_or(Value::Null),

        _ => row
            .try_get::<Option<String>, _>(i)
            .ok()
            .flatten()
            .map(Value::String)
            .unwrap_or(Value::Null),
    }
}

async fn fetch_rows(
    pool: &sqlx::PgPool,
    sql: &str,
) -> Result<(Vec<sqlx::postgres::PgRow>, bool), sqlx::Error> {
    let mut stream = sqlx::query(sql).fetch(pool);
    let mut rows: Vec<sqlx::postgres::PgRow> = Vec::new();
    let mut truncated = false;

    while let Some(result) = stream.next().await {
        rows.push(result?);
        if rows.len() >= ROW_LIMIT {
            truncated = true;
            break;
        }
    }

    Ok((rows, truncated))
}

#[tauri::command]
pub async fn execute_query(sql: String, state: State<'_, AppState>) -> Result<QueryResult, String> {
    let pool = {
        let guard = state.pg_pool.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Not connected to a database")?.clone()
    };

    let start = std::time::Instant::now();

    let fetch_result = tokio::time::timeout(
        std::time::Duration::from_secs(QUERY_TIMEOUT_SECS),
        fetch_rows(&pool, &sql),
    )
    .await;

    match fetch_result {
        Err(_) => Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            execution_time_ms: start.elapsed().as_millis() as u64,
            truncated: false,
            error: Some(format!("Query timed out after {}s", QUERY_TIMEOUT_SECS)),
        }),
        Ok(Err(e)) => Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            execution_time_ms: start.elapsed().as_millis() as u64,
            truncated: false,
            error: Some(e.to_string()),
        }),
        Ok(Ok((pg_rows, truncated))) => {
            let columns: Vec<String> = if pg_rows.is_empty() {
                vec![]
            } else {
                pg_rows[0]
                    .columns()
                    .iter()
                    .map(|c| c.name().to_string())
                    .collect()
            };

            let data_rows: Vec<Vec<Value>> = pg_rows
                .iter()
                .map(|row| (0..columns.len()).map(|i| pg_value(row, i)).collect())
                .collect();

            Ok(QueryResult {
                row_count: data_rows.len(),
                execution_time_ms: start.elapsed().as_millis() as u64,
                columns,
                rows: data_rows,
                truncated,
                error: None,
            })
        }
    }
}
