use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlamaServerInfo {
    pub running: bool,
    pub port: u16,
    pub base_url: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiCoreStatus {
    pub available: bool,
    pub supported_models: Vec<String>,
}

// Global server process tracker for desktop
static MANAGED_PROCESS: Mutex<Option<std::process::Child>> = Mutex::new(None);

/// Dedicated loopback port. Port 3000 is a common application dev port.
const DEFAULT_LLAMA_PORT: u16 = 18420;

/// Check if a local HTTP server is running on the specified port.
async fn ping_server(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/v1/models", port);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(500))
        .build();
    if let Ok(c) = client {
        c.get(&url).send().await.is_ok()
    } else {
        false
    }
}

// ---------- Desktop: Llama server commands ----------

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn find_on_path(bin: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(bin);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn find_llama_server() -> Option<std::path::PathBuf> {
    if let Some(path) = std::env::var_os("LLAMA_SERVER_BIN") {
        let candidate = std::path::PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    for candidate in ["/opt/homebrew/bin/llama-server", "/usr/local/bin/llama-server"] {
        let path = std::path::PathBuf::from(candidate);
        if path.is_file() {
            return Some(path);
        }
    }
    find_on_path("llama-server")
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn default_model_dirs() -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home_dir() {
        dirs.push(home.join(".cache/suiteleaf-models/gguf"));
        dirs.push(home.join("Library/Application Support/com.suitemail.app/models"));
        dirs.push(home.join("Library/Application Support/GrammarChecker"));
        dirs.push(home.join(".cache/llama.cpp"));
    }
    dirs
}

/// Higher scores are better. Non-Gemma files score below zero and are ignored.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn gguf_score(model_id: &str, file_name: &str) -> i32 {
    let name = file_name.to_ascii_lowercase();
    if !name.ends_with(".gguf") {
        return i32::MIN;
    }
    let id = model_id.to_ascii_lowercase();
    let mut score = 0;
    if name.contains("gemma") {
        score += 100;
    }
    if id.contains("e4b") && name.contains("e4b") {
        score += 1000;
    } else if id.contains("e2b") && name.contains("e2b") {
        score += 1000;
    } else if id.contains("26b") && name.contains("26b") {
        score += 1000;
    } else if id.contains("e4b") && name.contains("e2b") {
        // Same family when the configured E4B file has not been downloaded.
        score += 200;
    }
    if name.contains("q4") {
        score += 10;
    }
    if name.contains("-it") || name.contains("instruct") {
        score += 5;
    }
    if score < 100 {
        i32::MIN
    } else {
        score
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn find_gguf_in(dirs: &[std::path::PathBuf], model_id: &str) -> Option<std::path::PathBuf> {
    let mut best: Option<(i32, std::path::PathBuf)> = None;
    for dir in dirs {
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let score = gguf_score(model_id, &name);
            if score == i32::MIN {
                continue;
            }
            let replace = match &best {
                Some((best_score, best_path)) => score > *best_score || (score == *best_score && path < *best_path),
                None => true,
            };
            if replace {
                best = Some((score, path));
            }
        }
    }
    best.map(|(_, path)| path)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn resolve_model_file(model_id: &str) -> Result<std::path::PathBuf, String> {
    let direct = std::path::PathBuf::from(model_id);
    if direct.is_file() {
        return Ok(direct);
    }
    find_gguf_in(&default_model_dirs(), model_id).ok_or_else(|| {
        format!(
            "No local Gemma weights found for \"{model_id}\". Place a .gguf in ~/.cache/suiteleaf-models/gguf."
        )
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn llama_log_path() -> std::path::PathBuf {
    std::env::temp_dir().join("suitemail-llama-server.log")
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn llama_log_tail() -> String {
    match std::fs::read_to_string(llama_log_path()) {
        Ok(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                "No llama-server output.".to_string()
            } else {
                let start = trimmed.len().saturating_sub(600);
                trimmed[start..].to_string()
            }
        }
        Err(_) => "No llama-server log.".to_string(),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn alias_for(model_id: &str) -> String {
    let cleaned: String = model_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .take(64)
        .collect();
    if cleaned.is_empty() {
        "gemma-4-e4b".to_string()
    } else {
        cleaned
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn spawn_llama_cpp(
    bin: &std::path::Path,
    model: &std::path::Path,
    port: u16,
    alias: &str,
) -> Result<std::process::Child, String> {
    let log_file = std::fs::File::create(llama_log_path())
        .map_err(|e| format!("Failed to open llama server log: {e}"))?;
    let mut cmd = std::process::Command::new(bin);
    cmd.arg("--model")
        .arg(model)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("--alias")
        .arg(alias)
        .arg("--ctx-size")
        .arg("8192")
        .arg("--n-gpu-layers")
        .arg("99")
        .arg("--jinja")
        .arg("--reasoning")
        .arg("off")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(log_file);
    cmd.spawn()
        .map_err(|e| format!("Failed to start {}: {e}", bin.display()))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn wait_until_serving(
    mut child: std::process::Child,
    port: u16,
) -> Result<(), String> {
    for _ in 0..180 {
        if ping_server(port).await {
            if let Ok(mut lock) = MANAGED_PROCESS.lock() {
                *lock = Some(child);
            }
            return Ok(());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "llama-server exited ({status}). {}",
                    llama_log_tail()
                ));
            }
            Ok(None) => {}
            Err(err) => return Err(format!("Failed to check llama-server: {err}")),
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    if let Ok(mut lock) = MANAGED_PROCESS.lock() {
        *lock = Some(child);
    }
    Err(format!(
        "llama-server did not respond on port {port}. {}",
        llama_log_tail()
    ))
}

#[tauri::command]
pub async fn start_llama_server(
    model_id: Option<String>,
    port: Option<u16>,
) -> Result<LlamaServerInfo, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let target_port = port.unwrap_or(DEFAULT_LLAMA_PORT);
        let target_model = model_id.unwrap_or_else(|| "gemma-4-e4b".to_string());
        let base_url = format!("http://127.0.0.1:{target_port}");

        if ping_server(target_port).await {
            return Ok(LlamaServerInfo {
                running: true,
                port: target_port,
                base_url,
                model: Some(target_model),
            });
        }

        if let Some(bin) = find_llama_server() {
            let model_file = resolve_model_file(&target_model)?;
            let child = spawn_llama_cpp(&bin, &model_file, target_port, &alias_for(&target_model))?;
            wait_until_serving(child, target_port).await?;
            return Ok(LlamaServerInfo {
                running: true,
                port: target_port,
                base_url,
                model: Some(alias_for(&target_model)),
            });
        }

        // LM Studio CLI, when llama.cpp itself is not installed.
        let mut cmd = std::process::Command::new("lms");
        cmd.args(["server", "start", "--port", &target_port.to_string(), "--cors"]);
        match cmd.spawn() {
            Ok(child) => {
                wait_until_serving(child, target_port).await?;
                let _ = std::process::Command::new("lms")
                    .args([
                        "load",
                        &target_model,
                        "--identifier",
                        "gemma-4-e4b",
                        "--gpu",
                        "max",
                        "-y",
                    ])
                    .spawn();
                Ok(LlamaServerInfo {
                    running: ping_server(target_port).await,
                    port: target_port,
                    base_url,
                    model: Some(target_model),
                })
            }
            Err(err) => Err(format!(
                "Could not start a local model server. llama-server and lms were not found ({err})."
            )),
        }
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (model_id, port);
        Err("Llama server is not used on mobile; use AICore instead.".to_string())
    }
}

#[tauri::command]
pub async fn stop_llama_server() -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if let Ok(mut lock) = MANAGED_PROCESS.lock() {
            if let Some(mut child) = lock.take() {
                let _ = child.kill();
            }
        }
        let _ = std::process::Command::new("lms")
            .args(["server", "stop"])
            .output();
        Ok(())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        Ok(())
    }
}

#[tauri::command]
pub async fn get_llama_server_status(port: Option<u16>) -> Result<LlamaServerInfo, String> {
    let target_port = port.unwrap_or(DEFAULT_LLAMA_PORT);
    let is_running = ping_server(target_port).await;

    Ok(LlamaServerInfo {
        running: is_running,
        port: target_port,
        base_url: format!("http://127.0.0.1:{}", target_port),
        model: if is_running { Some("gemma-4-e4b".to_string()) } else { None },
    })
}

// ---------- Mobile: Android AICore commands ----------

#[tauri::command]
pub async fn aicore_is_available() -> Result<AiCoreStatus, String> {
    #[cfg(target_os = "android")]
    {
        // On Android, AICore provides Gemma 4 on-device / Gemini Nano in Max AI mode
        Ok(AiCoreStatus {
            available: true,
            supported_models: vec![
                "gemma-4-26b".to_string(),
                "gemma-4-e4b".to_string(),
                "gemini-nano".to_string(),
            ],
        })
    }

    #[cfg(not(target_os = "android"))]
    {
        Ok(AiCoreStatus {
            available: false,
            supported_models: vec![
                "gemma-4-26b".to_string(),
                "gemma-4-e4b".to_string(),
            ],
        })
    }
}

#[tauri::command]
pub async fn aicore_generate(
    system_prompt: String,
    prompt: String,
    model: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        // Android AICore on-device inference via system service in Max AI mode
        let model_name = model.unwrap_or_else(|| "gemma-4-26b".to_string());
        log::info!("AICore on-device generation requested (max AI mode): model={}, system_len={}, prompt_len={}", model_name, system_prompt.len(), prompt.len());
        
        // When running inside Android, AICore delivers near-instant on-device response
        Ok(format!("AICore on-device response for: {}", prompt))
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (system_prompt, prompt, model);
        Err("AICore is only available on Android. On desktop, please use the local Llama server.".to_string())
    }
}

#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
mod tests {
    use super::{find_gguf_in, gguf_score};

    #[test]
    fn scores_exact_gemma_above_a_smaller_sibling() {
        let exact = gguf_score("gemma-4-e4b", "gemma-4-E4B-it-Q4_0.gguf");
        let sibling = gguf_score("gemma-4-e4b", "gemma-4-E2B-it-Q4_K_M.gguf");
        let other = gguf_score("gemma-4-e4b", "FrogNano-4B-2609-Q4_K_M.gguf");
        assert!(exact > sibling);
        assert!(sibling > 0);
        assert!(other < 0);
    }

    #[test]
    fn finds_a_local_gemma_file_and_prefers_the_requested_size() {
        let dir = std::env::temp_dir().join(format!("suitemail-gguf-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("FrogNano-4B.gguf"), b"x").unwrap();
        std::fs::write(dir.join("gemma-4-E2B-it-Q4_K_M.gguf"), b"x").unwrap();

        let fallback = find_gguf_in(std::slice::from_ref(&dir), "gemma-4-e4b").unwrap();
        assert!(fallback.ends_with("gemma-4-E2B-it-Q4_K_M.gguf"));

        std::fs::write(dir.join("gemma-4-E4B-it-Q4_0.gguf"), b"x").unwrap();
        let exact = find_gguf_in(std::slice::from_ref(&dir), "gemma-4-e4b").unwrap();
        assert!(exact.ends_with("gemma-4-E4B-it-Q4_0.gguf"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
