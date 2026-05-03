import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const WHISPER_PROGRESS_EVENT = "whisper-download-progress";

export interface WhisperModelStatus {
  exists: boolean;
  path: string;
  size: number;
  downloading: boolean;
}

export interface WhisperProgressPayload {
  phase: "download" | "ready" | "error";
  downloaded: number;
  total: number;
  message: string;
}

interface RecorderState {
  stream: MediaStream;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
  sampleRate: number;
}

let recorder: RecorderState | null = null;

export async function getWhisperModelStatus(): Promise<WhisperModelStatus> {
  return invoke<WhisperModelStatus>("whisper_model_status");
}

export async function downloadWhisperModel(): Promise<void> {
  await invoke("whisper_download_model");
}

export async function transcribeWhisper(audio: Float32Array, language = "zh"): Promise<string> {
  const bytes = new Uint8Array(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength));
  return invoke<string>("whisper_transcribe", {
    audio: Array.from(bytes),
    language,
  });
}

export async function listenWhisperProgress(
  cb: (payload: WhisperProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<WhisperProgressPayload>(WHISPER_PROGRESS_EVENT, (event) => cb(event.payload));
}

export async function startVoiceRecording(): Promise<void> {
  if (recorder) return;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  recorder = {
    stream,
    audioContext,
    source,
    processor,
    chunks,
    sampleRate: audioContext.sampleRate,
  };
}

export async function stopVoiceRecording(): Promise<Float32Array> {
  if (!recorder) return new Float32Array();

  const current = recorder;
  recorder = null;

  current.processor.disconnect();
  current.source.disconnect();
  current.stream.getTracks().forEach((track) => track.stop());
  await current.audioContext.close();

  const total = current.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of current.chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return resampleTo16k(merged, current.sampleRate);
}

export async function cancelVoiceRecording(): Promise<void> {
  if (!recorder) return;
  const current = recorder;
  recorder = null;
  current.processor.disconnect();
  current.source.disconnect();
  current.stream.getTracks().forEach((track) => track.stop());
  await current.audioContext.close();
}

function resampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  const targetRate = 16000;
  if (sourceRate === targetRate) return input;
  if (input.length === 0) return input;

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const left = Math.floor(srcIndex);
    const right = Math.min(left + 1, input.length - 1);
    const t = srcIndex - left;
    output[i] = input[left] * (1 - t) + input[right] * t;
  }
  return output;
}
