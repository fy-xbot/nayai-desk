use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri::path::BaseDirectory;
#[cfg(desktop)]
use std::fs;
#[cfg(desktop)]
use std::path::PathBuf;

mod whisper;

#[cfg(desktop)]
use tauri::menu::{
    AboutMetadataBuilder, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder,
};

#[derive(Clone, serde::Serialize)]
struct DownloadStartedPayload {
    filename: String,
    path: String,
}

#[derive(Clone, serde::Serialize)]
struct DownloadFinishedPayload {
    filename: String,
    path: String,
    success: bool,
}

#[cfg(desktop)]
fn downloads_dir() -> PathBuf {
    std::env::var("HOME")
        .map(|h| PathBuf::from(h).join("Downloads"))
        .unwrap_or_else(|_| std::env::temp_dir())
}

#[cfg(desktop)]
fn unique_download_path(dir: &PathBuf, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let stem = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    for i in 1..=999 {
        let name = if ext.is_empty() {
            format!("{} ({})", stem, i)
        } else {
            format!("{} ({}).{}", stem, i, ext)
        };
        let c = dir.join(&name);
        if !c.exists() {
            return c;
        }
    }
    candidate
}

#[cfg(desktop)]
fn filename_from_url(url: &str) -> String {
    let path_part = url.split('?').next().unwrap_or(url);
    let raw = path_part.split('/').last().unwrap_or("download");
    let decoded = urlencoding_decode(raw);
    if decoded.is_empty() || decoded == "." {
        "download".to_string()
    } else {
        decoded
    }
}

#[cfg(desktop)]
fn urlencoding_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    result.push(byte as char);
                    i += 3;
                    continue;
                }
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

#[cfg(desktop)]
#[tauri::command]
async fn create_provider_webview(
    app: tauri::AppHandle,
    label: String,
    url: String,
    provider_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    init_script: Option<String>,
) -> Result<(), String> {
    if app.get_webview(&label).is_some() {
        return Ok(());
    }

    let main_window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let parsed_url = url
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;

    let data_dir = app
        .path()
        .resolve(format!("webview_data/{}", provider_id), BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;

    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let app_for_download = app.clone();
    let dl_dir = downloads_dir();

    let mut builder =
        tauri::webview::WebviewBuilder::new(&label, tauri::WebviewUrl::External(parsed_url))
            .data_directory(data_dir)
            .on_download(move |_webview, event| {
                match event {
                    tauri::webview::DownloadEvent::Requested { url, destination } => {
                        let filename = filename_from_url(url.as_str());
                        let final_path = unique_download_path(&dl_dir, &filename);
                        *destination = final_path.clone();
                        println!(
                            "[download] Requested url={} -> {}",
                            url.as_str(),
                            final_path.display()
                        );
                        let _ = app_for_download.emit("download-started", DownloadStartedPayload {
                            filename,
                            path: final_path.to_string_lossy().to_string(),
                        });
                        true
                    }
                    tauri::webview::DownloadEvent::Finished { path, success, .. } => {
                        println!(
                            "[download] Finished path={:?} success={}",
                            path.as_ref().map(|p| p.display().to_string()),
                            success
                        );
                        let (filename, path_str) = path
                            .as_ref()
                            .map(|p| (
                                p.file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("")
                                    .to_string(),
                                p.to_string_lossy().to_string(),
                            ))
                            .unwrap_or_default();
                        let _ = app_for_download.emit("download-finished", DownloadFinishedPayload {
                            filename,
                            path: path_str,
                            success,
                        });
                        true
                    }
                    other => {
                        println!("[download] other event variant: {:?}", std::mem::discriminant(&other));
                        true
                    }
                }
            });

    if let Some(script) = init_script {
        builder = builder.initialization_script(&script);
    }

    let webview = main_window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    let _ = webview.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
    let _ = webview.set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)));

    println!("[webview] created: {} provider={} at ({},{}) {}x{}", label, provider_id, x, y, width, height);

    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn create_provider_webview(
    _app: tauri::AppHandle,
    _label: String,
    _url: String,
    _provider_id: String,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
    _init_script: Option<String>,
) -> Result<(), String> {
    println!("[mobile] child webviews are not supported on iOS yet");
    Ok(())
}

#[tauri::command]
async fn inject_script(
    app: tauri::AppHandle,
    label: String,
    script: String,
) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;
    webview
        .eval(&script)
        .map_err(|e: tauri::Error| e.to_string())
}

#[tauri::command]
async fn navigate_webview(app: tauri::AppHandle, label: String, url: String) -> Result<(), String> {
    let webview = app.get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;
    let parsed = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    webview.navigate(parsed).map_err(|e| e.to_string())
}

/// 查询本地文件大小；不存在返回 None。用于下载完成探测的兜底逻辑。
#[tauri::command]
fn get_file_size(path: String) -> Option<u64> {
    std::fs::metadata(&path).ok().map(|m| m.len())
}

/// 直接读取某个 webview 的当前 URL
#[cfg(desktop)]
#[tauri::command]
async fn get_webview_url(app: tauri::AppHandle, label: String) -> Result<String, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;
    webview
        .url()
        .map(|u| u.to_string())
        .map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn get_webview_url(_app: tauri::AppHandle, _label: String) -> Result<String, String> {
    Ok(String::new())
}

#[cfg(desktop)]
#[tauri::command]
async fn close_provider_webview(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn close_provider_webview(_app: tauri::AppHandle, _label: String) -> Result<(), String> {
    Ok(())
}

/// 将多个 webview 移出视口并缩成 1x1，彻底不占屏、不盖住设置等浮层
#[cfg(desktop)]
#[tauri::command]
async fn hide_provider_webviews(app: tauri::AppHandle, labels: Vec<String>) -> Result<(), String> {
    const OFF: f64 = -9999.0;
    let tiny = tauri::LogicalSize::new(1.0, 1.0);
    let pos = tauri::Position::Logical(tauri::LogicalPosition::new(OFF, OFF));
    for label in labels {
        if let Some(wv) = app.get_webview(&label) {
            let _ = wv.set_size(tauri::Size::Logical(tiny));
            let _ = wv.set_position(pos);
        }
    }
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn hide_provider_webviews(_app: tauri::AppHandle, _labels: Vec<String>) -> Result<(), String> {
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let dir = std::path::Path::new(&path)
            .parent()
            .unwrap_or(std::path::Path::new("/"))
            .to_string_lossy()
            .to_string();
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
fn reveal_in_finder(_path: String) -> Result<(), String> {
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn start_dragging(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    window.start_dragging().map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
fn start_dragging(_app: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(desktop)]
fn setup_app_menu(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();

    let app_menu = SubmenuBuilder::new(handle, "NayAI Desk")
        .about(Some(AboutMetadataBuilder::new().name(Some("NayAI Desk")).build()))
        .separator()
        .item(&PredefinedMenuItem::services(handle, Some("服务"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(handle, Some("隐藏 NayAI Desk"))?)
        .item(&PredefinedMenuItem::hide_others(handle, Some("隐藏其他"))?)
        .item(&PredefinedMenuItem::show_all(handle, Some("全部显示"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(handle, Some("退出 NayAI Desk"))?)
        .build()?;

    let file_menu = SubmenuBuilder::new(handle, "文件")
        .item(&PredefinedMenuItem::close_window(handle, Some("关闭窗口"))?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(handle, "编辑")
        .item(&MenuItem::with_id(handle, "undo", "撤销", true, Some("CmdOrCtrl+Z"))?)
        .item(&MenuItem::with_id(handle, "redo", "重做", true, Some("CmdOrCtrl+Shift+Z"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(handle, Some("剪切"))?)
        .item(&PredefinedMenuItem::copy(handle, Some("拷贝"))?)
        .item(&PredefinedMenuItem::paste(handle, Some("粘贴"))?)
        .item(&PredefinedMenuItem::select_all(handle, Some("全选"))?)
        .build()?;

    let view_menu = SubmenuBuilder::new(handle, "视图")
        .item(&PredefinedMenuItem::fullscreen(handle, Some("进入全屏幕"))?)
        .build()?;

    let window_menu = SubmenuBuilder::new(handle, "窗口")
        .item(&PredefinedMenuItem::minimize(handle, Some("最小化"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(handle, Some("关闭窗口"))?)
        .build()?;

    let menu = MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()?;

    app.set_menu(menu)?;

    Ok(())
}

#[cfg(mobile)]
fn setup_app_menu(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_provider_webview,
            inject_script,
            navigate_webview,
            get_webview_url,
            get_file_size,
            close_provider_webview,
            hide_provider_webviews,
            reveal_in_finder,
            start_dragging,
            whisper::whisper_model_status,
            whisper::whisper_download_model,
            whisper::whisper_transcribe,
        ])
        .setup(setup_app_menu)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
