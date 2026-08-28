use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub async fn stream_docs(
    model: String,
    prompt: String,
    app: AppHandle,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let resp = client
        .post("http://localhost:11434/api/generate")
        .json(&serde_json::json!({
            "model": model,
            "prompt": prompt,
            "stream": true
        }))
        .send()
        .await
        .map_err(|e| format!("Cannot reach Ollama at localhost:11434 — is it running? ({})", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error {status}: {body}"));
    }

    let mut stream = resp.bytes_stream();

    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| format!("Stream error: {e}"))?;
        let text = String::from_utf8_lossy(&bytes);

        for line in text.lines().filter(|l| !l.is_empty()) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(token) = v["response"].as_str() {
                    if !token.is_empty() {
                        let _ = app.emit("ollama-token", token.to_string());
                    }
                }
                if v["done"].as_bool().unwrap_or(false) {
                    let _ = app.emit("ollama-done", "ok");
                    return Ok(());
                }
            }
        }
    }

    let _ = app.emit("ollama-done", "ok");
    Ok(())
}
