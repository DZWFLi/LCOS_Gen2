// voiceInput — SpeechRecognition 包装单元测试：
// 支持时 start/stop 走真实 API；识别结果/错误/结束正确回交；不支持时返回 null
// 且 isVoiceInputSupported=false（UI 如实禁用，不假装识别）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVoiceInput, isVoiceInputSupported } from './voiceInput';

class MockRecognition {
  lang = '';
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((event: { results: readonly (readonly { transcript: string }[])[] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  startCalls = 0;
  stopCalls = 0;
  started = false;
  start(): void {
    this.startCalls += 1;
    this.started = true;
  }
  stop(): void {
    this.stopCalls += 1;
    this.started = false;
  }
  abort(): void {
    this.started = false;
  }
}

let mockCtor: typeof MockRecognition | undefined = undefined;
let instances: MockRecognition[] = [];

beforeEach(() => {
  instances = [];
  mockCtor = class extends MockRecognition {
    constructor() {
      super();
      instances.push(this);
    }
  };
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = mockCtor;
});

afterEach(() => {
  mockCtor = undefined;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('voiceInput', () => {
  it('isVoiceInputSupported reflects browser support', () => {
    expect(isVoiceInputSupported()).toBe(true);
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    expect(isVoiceInputSupported()).toBe(false);
  });

  it('start() 调用真实 recognition.start 并只允许一句进行中', () => {
    const events = { onResult: () => undefined, onEnd: () => undefined, onError: () => undefined };
    const handle = createVoiceInput(events);
    expect(handle).not.toBeNull();
    handle?.start();
    handle?.start(); // 重复 start 忽略
    expect(instances[0]?.startCalls).toBe(1);
  });

  it('识别结果回交 onResult，结束回交 onEnd', () => {
    let text = '';
    let ended = false;
    const handle = createVoiceInput({
      onResult: (value) => {
        text = value;
      },
      onEnd: () => {
        ended = true;
      },
      onError: () => undefined,
    });
    handle?.start();
    instances[0]?.onresult?.({ results: [[{ transcript: '  分析当前资料  ' }]] });
    expect(text).toBe('分析当前资料');
    instances[0]?.onend?.();
    expect(ended).toBe(true);
  });

  it('错误回交 onError 且置为可再次 start', () => {
    let code = '';
    const handle = createVoiceInput({
      onResult: () => undefined,
      onEnd: () => undefined,
      onError: (value) => {
        code = value;
      },
    });
    handle?.start();
    instances[0]?.onerror?.({ error: 'not-allowed' });
    expect(code).toBe('not-allowed');
    handle?.start();
    expect(instances[0]?.startCalls).toBe(2);
  });

  it('不支持时返回 null', () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    expect(createVoiceInput({ onResult: () => undefined, onEnd: () => undefined, onError: () => undefined })).toBeNull();
  });
});
