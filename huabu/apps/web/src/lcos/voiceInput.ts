// Composer Voice 输入助手（T5 C06；T3 voice seam 的诚实落地）。
//
// 只做"语音 → 文本预览"，不绕过 selection/permission/canonical 事务：识别结果
// 进入 Composer 草稿 prompt，用户审阅后仍走既有 ComposerController 提交流程。
// 浏览器不支持 SpeechRecognition 时返回 null（调用方如实标注不可用），
// 不伪造"正在识别"。

/** 最小 SpeechRecognition 形状（浏览器私有 API 无标准 TS lib 类型）。 */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: readonly (readonly { transcript: string }[])[] }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition;
}

export interface VoiceInputHandle {
  /** 开始识别；同一句进行中重复调用忽略。 */
  start(): void;
  /** 手动停止并取当前结果（若无结果则 onEnd 正常结束）。 */
  stop(): void;
}

export interface VoiceInputEvents {
  onResult(text: string): void;
  onEnd(): void;
  onError(code: string): void;
}

/**
 * 创建浏览器语音识别句柄；不支持时返回 null。
 * `lang` 默认 zh-CN；识别为一次性（continuous=false），结果即时交回。
 */
export function createVoiceInput(
  events: VoiceInputEvents,
  lang = 'zh-CN',
): VoiceInputHandle | null {
  const Ctor = recognitionCtor();
  if (Ctor === undefined) return null;
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  let active = false;

  recognition.onresult = (event) => {
    const result = event.results[0]?.[0];
    if (result === undefined) return;
    const text = result.transcript.trim();
    if (text !== '') events.onResult(text);
  };
  recognition.onerror = (event) => {
    active = false;
    events.onError(event.error);
  };
  recognition.onend = () => {
    active = false;
    events.onEnd();
  };

  return {
    start: () => {
      if (active) return;
      active = true;
      try {
        recognition.start();
      } catch {
        active = false;
        events.onError('not-allowed');
      }
    },
    stop: () => {
      if (!active) return;
      recognition.stop();
    },
  };
}

/** 浏览器语音可用性（供 UI 禁用/标注）。 */
export function isVoiceInputSupported(): boolean {
  return recognitionCtor() !== undefined;
}
