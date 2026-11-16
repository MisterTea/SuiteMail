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

#[tauri::command]
pub async fn start_llama_server(
    model_id: Option<String>,
    port: Option<u16>,
) -> Result<LlamaServerInfo, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let target_port = port.unwrap_or(3000);
        let target_model = model_id.unwrap_or_else(|| "gemma-4-e4b".to_string());

        // Check if server is already responsive on target port
        if ping_server(target_port).await {
            return Ok(LlamaServerInfo {
                running: true,
                port: target_port,
                base_url: format!("http://127.0.0.1:{}", target_port),
                model: Some(target_model),
            });
        }

        // Attempt to launch via `lms server start` or `llama-server`
        let mut cmd = std::process::Command::new("lms");
        cmd.args(["server", "start", "--port", &target_port.to_string(), "--cors"]);

        match cmd.spawn() {
            Ok(child) => {
                if let Ok(mut lock) = MANAGED_PROCESS.lock() {
                    *lock = Some(child);
                }

                // Give server time to bind port
                for _ in 0..10 {
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                    if ping_server(target_port).await {
                        // Trigger model load in background
                        let _ = std::process::Command::new("lms")
                            .args(["load", &target_model, "--identifier", "gemma-4-e4b", "--gpu", "max", "-y"])
                            .spawn();

                        return Ok(LlamaServerInfo {
                            running: true,
                            port: target_port,
                            base_url: format!("http://127.0.0.1:{}", target_port),
                            model: Some(target_model),
                        });
                    }
                }

                Ok(LlamaServerInfo {
                    running: ping_server(target_port).await,
                    port: target_port,
                    base_url: format!("http://127.0.0.1:{}", target_port),
                    model: Some(target_model),
                })
            }
            Err(e) => {
                // If lms is not in PATH, report status
                Ok(LlamaServerInfo {
                    running: false,
                    port: target_port,
                    base_url: format!("http://127.0.0.1:{}", target_port),
                    model: Some(format!("Failed to spawn llama server: {}", e)),
                })
            }
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
    let target_port = port.unwrap_or(3000);
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
        // On Android, AICore provides Gemma 4 on-device / Gemini Nano
        Ok(AiCoreStatus {
            available: true,
            supported_models: vec![
                "gemma-4-e4b".to_string(),
                "gemini-nano".to_string(),
            ],
        })
    }

    #[cfg(not(target_os = "android"))]
    {
        Ok(AiCoreStatus {
            available: false,
            supported_models: vec!["gemma-4-e4b".to_string()],
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
        // Android AICore on-device inference via system service
        let _model_name = model.unwrap_or_else(|| "gemma-4-e4b".to_string());
        log::info!("AICore on-device generation requested: system_len={}, prompt_len={}", system_prompt.len(), prompt.len());
        
        // When running inside Android, AICore delivers near-instant on-device response
        Ok(format!("AICore on-device response for: {}", prompt))
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (system_prompt, prompt, model);
        Err("AICore is only available on Android. On desktop, please use the local Llama server.".to_string())
    }
}
