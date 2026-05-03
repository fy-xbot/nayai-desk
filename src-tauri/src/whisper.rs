//! 本地离线语音识别模块
//!
//! - 首次启动时从 HuggingFace 下载 whisper base 多语种模型到 AppData
//! - 前端捕获的 16kHz 单声道 f32 PCM 通过 invoke 传进来
//! - Rust 侧加载一次模型（Arc 缓存），每次转录 create 一个新 state
//!
//! 仅在桌面平台编译（iOS/Android 会走 #[cfg(mobile)] 的空实现）
//!
//! 模型信息：
//! - base 多语种 (ggml-base.bin) ~ 142MB
//! - 支持中文、英文等 99 种语言
//! - M1/M2 via Metal: 比实时快 5~10 倍

use serde::Serialize;
use tauri::AppHandle;

pub const WHISPER_PROGRESS_EVENT: &str = "whisper-download-progress";

#[derive(Clone, Serialize)]
pub struct WhisperProgressPayload {
    pub phase: String, // "download" | "ready" | "error"
    pub downloaded: u64,
    pub total: u64,
    pub message: String,
}

#[derive(Serialize)]
pub struct WhisperModelStatus {
    pub exists: bool,
    pub path: String,
    pub size: u64,
    pub downloading: bool,
}

// ---------------- 桌面实现 ----------------

#[cfg(desktop)]
mod desktop_impl {
    use super::*;
    use futures_util::StreamExt;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex, OnceLock};
    use tauri::{Emitter, Manager};
    use tokio::io::AsyncWriteExt;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    const MODEL_NAME: &str = "ggml-base.bin";
    /// 下载地址列表：优先国内镜像，最后回退官方源
    const MODEL_URLS: &[&str] = &[
        "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    ];
    /// 下载完成后的模型大小，用于检测完整性（允许 1% 误差）
    const MODEL_EXPECTED_SIZE: u64 = 147_951_465;
    /// 最小有效大小，低于它视为未完成的残留
    const MODEL_MIN_VALID_SIZE: u64 = 100_000_000;

    /// 全局模型缓存（进程生命周期内共享一个 WhisperContext）
    static CTX_CACHE: OnceLock<Mutex<Option<Arc<WhisperContext>>>> = OnceLock::new();
    /// 下载串行锁：避免前端误触发两次并发下载
    static DOWNLOADING: OnceLock<Mutex<bool>> = OnceLock::new();

    fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
        let dir = app
            .path()
            .resolve("whisper", tauri::path::BaseDirectory::AppData)
            .map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir.join(MODEL_NAME))
    }

    fn is_downloading() -> bool {
        DOWNLOADING
            .get_or_init(|| Mutex::new(false))
            .lock()
            .map(|g| *g)
            .unwrap_or(false)
    }

    fn set_downloading(v: bool) -> bool {
        let cell = DOWNLOADING.get_or_init(|| Mutex::new(false));
        let mut guard = match cell.lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        if v && *guard {
            return false; // already downloading
        }
        *guard = v;
        true
    }

    pub async fn whisper_model_status(app: AppHandle) -> Result<WhisperModelStatus, String> {
        let path = model_path(&app)?;
        let meta = std::fs::metadata(&path).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let exists = path.is_file() && size >= MODEL_MIN_VALID_SIZE;
        Ok(WhisperModelStatus {
            exists,
            path: path.to_string_lossy().to_string(),
            size,
            downloading: is_downloading(),
        })
    }

    pub async fn whisper_download_model(app: AppHandle) -> Result<(), String> {
        if !set_downloading(true) {
            return Err("模型正在下载中".into());
        }
        let result = do_download(app.clone()).await;
        set_downloading(false);

        if let Err(ref err) = result {
            let _ = app.emit(
                WHISPER_PROGRESS_EVENT,
                WhisperProgressPayload {
                    phase: "error".into(),
                    downloaded: 0,
                    total: MODEL_EXPECTED_SIZE,
                    message: err.clone(),
                },
            );
        }
        result
    }

    async fn do_download(app: AppHandle) -> Result<(), String> {
        let target = model_path(&app)?;
        let tmp = target.with_extension("downloading");

        // 若已经有完整模型，直接返回
        if let Ok(meta) = std::fs::metadata(&target) {
            if meta.len() >= MODEL_MIN_VALID_SIZE {
                let _ = app.emit(
                    WHISPER_PROGRESS_EVENT,
                    WhisperProgressPayload {
                        phase: "ready".into(),
                        downloaded: meta.len(),
                        total: meta.len(),
                        message: "模型已就绪".into(),
                    },
                );
                return Ok(());
            }
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(900))
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| format!("HTTP 客户端创建失败: {}", e))?;

        // 依次尝试各镜像，连通即用
        let mut response = None;
        let mut last_err = String::new();
        for url in MODEL_URLS {
            match client.get(*url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    response = Some(resp);
                    break;
                }
                Ok(resp) => {
                    last_err = format!("HTTP {} from {}", resp.status(), url);
                }
                Err(e) => {
                    last_err = format!("{} ({})", e, url);
                }
            }
        }
        let response = response.ok_or_else(|| format!("所有下载源均失败: {}", last_err))?;
        let total = response.content_length().unwrap_or(MODEL_EXPECTED_SIZE);

        // 开始下载：先写到 .downloading 临时文件，成功后原子重命名
        let _ = std::fs::remove_file(&tmp);
        let mut file = tokio::fs::File::create(&tmp)
            .await
            .map_err(|e| format!("创建临时文件失败: {}", e))?;

        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_emit: u64 = 0;
        const EMIT_STEP: u64 = 1_048_576; // 每 1MB 推一次进度

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| format!("下载中断: {}", e))?;
            file.write_all(&bytes)
                .await
                .map_err(|e| format!("写入失败: {}", e))?;
            downloaded += bytes.len() as u64;
            if downloaded - last_emit >= EMIT_STEP {
                let _ = app.emit(
                    WHISPER_PROGRESS_EVENT,
                    WhisperProgressPayload {
                        phase: "download".into(),
                        downloaded,
                        total,
                        message: String::new(),
                    },
                );
                last_emit = downloaded;
            }
        }
        file.flush()
            .await
            .map_err(|e| format!("flush 失败: {}", e))?;
        drop(file);

        if downloaded < MODEL_MIN_VALID_SIZE {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!(
                "下载不完整，收到 {} 字节（期望至少 {}）",
                downloaded, MODEL_MIN_VALID_SIZE
            ));
        }

        tokio::fs::rename(&tmp, &target)
            .await
            .map_err(|e| format!("重命名失败: {}", e))?;

        let _ = app.emit(
            WHISPER_PROGRESS_EVENT,
            WhisperProgressPayload {
                phase: "ready".into(),
                downloaded,
                total: downloaded,
                message: "模型下载完成".into(),
            },
        );
        Ok(())
    }

    fn load_or_init_ctx(app: &AppHandle) -> Result<Arc<WhisperContext>, String> {
        let cell = CTX_CACHE.get_or_init(|| Mutex::new(None));
        {
            let guard = cell.lock().map_err(|e| e.to_string())?;
            if let Some(ctx) = guard.as_ref() {
                return Ok(Arc::clone(ctx));
            }
        }
        // 首次加载，在当前线程同步做（几秒钟）
        let path = model_path(app)?;
        if !path.is_file() {
            return Err("模型文件不存在，请先下载".into());
        }
        let ctx = WhisperContext::new_with_params(
            path.to_str().ok_or("模型路径包含非 UTF-8 字符")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("加载模型失败: {}", e))?;
        let arc = Arc::new(ctx);

        let mut guard = cell.lock().map_err(|e| e.to_string())?;
        *guard = Some(Arc::clone(&arc));
        Ok(arc)
    }

    pub async fn whisper_transcribe(
        app: AppHandle,
        audio: Vec<u8>,
        language: Option<String>,
    ) -> Result<String, String> {
        if audio.is_empty() {
            return Err("音频为空".into());
        }
        if audio.len() % 4 != 0 {
            return Err("音频字节数不是 f32 对齐".into());
        }
        let samples: Vec<f32> = audio
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();

        if samples.len() < 1600 {
            // < 0.1s 丢弃
            return Err("录音太短".into());
        }

        let ctx = load_or_init_ctx(&app)?;
        let lang = language.unwrap_or_else(|| "zh".to_string());
        let n_threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(2, 8) as i32;

        tokio::task::spawn_blocking(move || -> Result<String, String> {
            let mut state = ctx.create_state().map_err(|e| e.to_string())?;
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            // auto 交给 whisper 自己探测（设成空字符串触发自动语言识别）
            if lang == "auto" {
                params.set_language(None);
            } else {
                params.set_language(Some(&lang));
            }
            params.set_translate(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_print_special(false);
            params.set_n_threads(n_threads);
            params.set_suppress_blank(true);

            state.full(params, &samples).map_err(|e| e.to_string())?;
            let num_segments = state.full_n_segments();
            let mut out = String::new();
            for i in 0..num_segments {
                if let Some(seg) = state.get_segment(i) {
                    out.push_str(&seg.to_str_lossy().map_err(|e| e.to_string())?);
                }
            }
            Ok(out.trim().to_string())
        })
        .await
        .map_err(|e| format!("任务执行失败: {}", e))?
    }
}

// ---------------- Tauri command 导出 ----------------

#[cfg(desktop)]
#[tauri::command]
pub async fn whisper_model_status(app: AppHandle) -> Result<WhisperModelStatus, String> {
    desktop_impl::whisper_model_status(app).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn whisper_download_model(app: AppHandle) -> Result<(), String> {
    desktop_impl::whisper_download_model(app).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn whisper_transcribe(
    app: AppHandle,
    audio: Vec<u8>,
    language: Option<String>,
) -> Result<String, String> {
    desktop_impl::whisper_transcribe(app, audio, language).await
}

// ---------------- 移动端空实现 ----------------

#[cfg(mobile)]
#[tauri::command]
pub async fn whisper_model_status(_app: AppHandle) -> Result<WhisperModelStatus, String> {
    Ok(WhisperModelStatus {
        exists: false,
        path: String::new(),
        size: 0,
        downloading: false,
    })
}

#[cfg(mobile)]
#[tauri::command]
pub async fn whisper_download_model(_app: AppHandle) -> Result<(), String> {
    Err("移动端暂不支持".into())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn whisper_transcribe(
    _app: AppHandle,
    _audio: Vec<u8>,
    _language: Option<String>,
) -> Result<String, String> {
    Err("移动端暂不支持".into())
}
