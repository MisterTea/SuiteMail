use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtonBridgeStatus {
    pub is_installed: bool,
    pub is_running: bool,
    pub executable_path: Option<String>,
    pub imap_port: u16,
    pub smtp_port: u16,
    pub imap_listening: bool,
    pub smtp_listening: bool,
    pub config_dir_found: bool,
    pub banner: Option<String>,
}

const DEFAULT_IMAP_PORT: u16 = 1143;
const DEFAULT_SMTP_PORT: u16 = 1025;

/// Probe a local TCP port to see if a service is listening.
/// If `read_banner` is true, attempts to read an initial greeting banner (e.g. IMAP greeting).
async fn probe_port(port: u16, read_banner: bool) -> (bool, Option<String>) {
    let addr = format!("127.0.0.1:{}", port);
    let connect_timeout = std::time::Duration::from_millis(600);

    match tokio::time::timeout(connect_timeout, tokio::net::TcpStream::connect(&addr)).await {
        Ok(Ok(mut stream)) => {
            if !read_banner {
                return (true, None);
            }
            let mut buf = [0u8; 256];
            let read_timeout = std::time::Duration::from_millis(400);
            match tokio::time::timeout(
                read_timeout,
                tokio::io::AsyncReadExt::read(&mut stream, &mut buf),
            )
            .await
            {
                Ok(Ok(n)) if n > 0 => {
                    let banner = String::from_utf8_lossy(&buf[..n]).trim().to_string();
                    (true, Some(banner))
                }
                _ => (true, None),
            }
        }
        _ => (false, None),
    }
}

/// Find installed or bundled Proton Mail Bridge executable.
fn find_executable() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    let exe_names = if cfg!(windows) {
        vec!["proton-bridge.exe", "bridge.exe", "bridge-gui.exe"]
    } else {
        vec!["proton-bridge", "bridge"]
    };

    // 1. Check relative to current executable (production app bundle / sidecar)
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            for name in &exe_names {
                candidates.push(exe_dir.join(name));
                candidates.push(exe_dir.join("bin").join(name));
                candidates.push(exe_dir.join("..").join("bin").join(name));
                candidates.push(exe_dir.join("..").join("submodules").join("proton-bridge").join(name));
            }
        }
    }

    // 2. Check relative to current working directory (development / workspace submodule)
    if let Ok(cwd) = std::env::current_dir() {
        for name in &exe_names {
            candidates.push(cwd.join("src-tauri").join("bin").join(name));
            candidates.push(cwd.join("bin").join(name));
            candidates.push(cwd.join("submodules").join("proton-bridge").join(name));
            #[cfg(windows)]
            candidates.push(cwd.join("submodules").join("proton-bridge").join("cmd").join("Desktop-Bridge").join("deploy").join("windows").join(name));
            #[cfg(target_os = "macos")]
            candidates.push(cwd.join("submodules").join("proton-bridge").join("cmd").join("Desktop-Bridge").join("deploy").join("darwin").join(name));
            #[cfg(target_os = "linux")]
            candidates.push(cwd.join("submodules").join("proton-bridge").join("cmd").join("Desktop-Bridge").join("deploy").join("linux").join(name));
        }
    }

    // 3. System installed locations

    #[cfg(windows)]
    {
        if let Ok(pf) = std::env::var("ProgramFiles") {
            candidates.push(Path::new(&pf).join("Proton AG").join("Proton Mail Bridge").join("proton-bridge.exe"));
            candidates.push(Path::new(&pf).join("Proton AG").join("Proton Mail Bridge").join("bridge-gui.exe"));
            candidates.push(Path::new(&pf).join("Proton AG").join("proton-bridge.exe"));
        }
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(Path::new(&pf86).join("Proton AG").join("Proton Mail Bridge").join("proton-bridge.exe"));
            candidates.push(Path::new(&pf86).join("Proton AG").join("Proton Mail Bridge").join("bridge-gui.exe"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(Path::new(&local).join("Programs").join("Proton").join("Bridge").join("proton-bridge.exe"));
            candidates.push(Path::new(&local).join("Proton").join("Proton Mail Bridge").join("proton-bridge.exe"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/Applications/Proton Mail Bridge.app/Contents/MacOS/Proton Mail Bridge"));
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(Path::new(&home).join("Applications").join("Proton Mail Bridge.app").join("Contents").join("MacOS").join("Proton Mail Bridge"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/protonmail-bridge"));
        candidates.push(PathBuf::from("/usr/bin/proton-bridge"));
        candidates.push(PathBuf::from("/usr/local/bin/protonmail-bridge"));
        candidates.push(PathBuf::from("/usr/local/bin/proton-bridge"));
        candidates.push(PathBuf::from("/var/lib/flatpak/exports/bin/ch.protonmail.protonmail-bridge"));
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(Path::new(&home).join(".local").join("share").join("flatpak").join("exports").join("bin").join("ch.protonmail.protonmail-bridge"));
        }
    }

    // Check standard candidate locations
    for p in &candidates {
        if p.is_file() {
            return Some(p.clone());
        }
    }

    // Fallback: search in PATH
    if let Ok(path_var) = std::env::var("PATH") {
        let separator = if cfg!(windows) { ';' } else { ':' };
        let exe_names = if cfg!(windows) {
            vec!["proton-bridge.exe", "protonmail-bridge.exe", "bridge-gui.exe"]
        } else {
            vec!["proton-bridge", "protonmail-bridge"]
        };

        for dir in path_var.split(separator) {
            let dir_path = Path::new(dir);
            for name in &exe_names {
                let p = dir_path.join(name);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }

    None
}

/// Check if Proton Bridge configuration directory exists.
fn config_directory_exists() -> bool {
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let p3 = Path::new(&appdata).join("protonmail").join("bridge-v3");
            let p2 = Path::new(&appdata).join("protonmail").join("bridge");
            if p3.is_dir() || p2.is_dir() {
                return true;
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let p3 = Path::new(&home).join("Library").join("Application Support").join("protonmail").join("bridge-v3");
            let p2 = Path::new(&home).join("Library").join("Application Support").join("protonmail").join("bridge");
            if p3.is_dir() || p2.is_dir() {
                return true;
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let p3 = Path::new(&home).join(".config").join("protonmail").join("bridge-v3");
            let p2 = Path::new(&home).join(".config").join("protonmail").join("bridge");
            if p3.is_dir() || p2.is_dir() {
                return true;
            }
        }
    }

    false
}

/// Check current Proton Mail Bridge status.
pub async fn check_status(
    custom_imap_port: Option<u16>,
    custom_smtp_port: Option<u16>,
) -> Result<ProtonBridgeStatus, String> {
    let imap_port = custom_imap_port.unwrap_or(DEFAULT_IMAP_PORT);
    let smtp_port = custom_smtp_port.unwrap_or(DEFAULT_SMTP_PORT);

    // Probe IMAP and SMTP ports concurrently
    let (imap_probe, smtp_probe) = tokio::join!(
        probe_port(imap_port, true),
        probe_port(smtp_port, false),
    );

    let (imap_listening, banner) = imap_probe;
    let (smtp_listening, _) = smtp_probe;

    let is_running = imap_listening || smtp_listening;
    let exe = find_executable();
    let is_installed = exe.is_some() || is_running;
    let config_dir_found = config_directory_exists();

    Ok(ProtonBridgeStatus {
        is_installed,
        is_running,
        executable_path: exe.map(|p| p.to_string_lossy().to_string()),
        imap_port,
        smtp_port,
        imap_listening,
        smtp_listening,
        config_dir_found,
        banner,
    })
}

/// Launch Proton Mail Bridge if found on the system.
pub async fn launch() -> Result<bool, String> {
    let exe = find_executable().ok_or_else(|| {
        "Proton Mail Bridge executable was not found in standard system locations.".to_string()
    })?;

    log::info!("Launching Proton Mail Bridge from {:?}", exe);

    let mut cmd = std::process::Command::new(exe);

    #[cfg(windows)]
    {
        // Detach process on Windows so it continues running independently
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(DETACHED_PROCESS);
    }

    match cmd.spawn() {
        Ok(_) => {
            // Wait briefly for process to begin initializing
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            Ok(true)
        }
        Err(e) => Err(format!("Failed to start Proton Mail Bridge: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_check_status_returns_default_ports() {
        let status = check_status(Some(19999), Some(19998)).await.unwrap();
        assert_eq!(status.imap_port, 19999);
        assert_eq!(status.smtp_port, 19998);
        assert!(!status.imap_listening);
        assert!(!status.smtp_listening);
    }

    #[test]
    fn test_find_executable_does_not_panic() {
        let _ = find_executable();
    }

    #[test]
    fn test_config_directory_does_not_panic() {
        let _ = config_directory_exists();
    }
}
