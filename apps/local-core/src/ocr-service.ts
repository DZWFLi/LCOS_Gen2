import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

export interface OcrLine {
  readonly text: string
  readonly score: number | null
  readonly box: readonly (readonly number[])[] | null
}

export interface OcrResult {
  readonly text: string
  readonly lines: readonly OcrLine[]
  readonly durationMs: number
  readonly engine: 'rapidocr'
}

export class OcrError extends Error {
  constructor(readonly code: 'ENGINE_MISSING' | 'ENGINE_FAILED' | 'TIMEOUT' | 'NOT_IMAGE', message: string) {
    super(message)
    this.name = 'OcrError'
  }
}

export interface OcrServiceOptions {
  readonly scriptPath: string
  readonly runtimeDir: string
  readonly pythonCommand?: string
  readonly timeoutMs?: number
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

/**
 * 本地 OCR：RapidOCR（PaddleOCR ONNX 开源版），纯 CPU 离线。
 * 只接受 Core 已知的图片文件路径（由路由通过 artifact/fileRecord 解析，不做任意路径）。
 */
export class OcrService {
  constructor(private readonly options: OcrServiceOptions) {}

  isImagePath(imagePath: string): boolean {
    const dot = imagePath.lastIndexOf('.')
    if (dot < 0) return false
    return IMAGE_EXTENSIONS.has(imagePath.slice(dot).toLowerCase())
  }

  async recognize(imagePath: string): Promise<OcrResult> {
    if (!this.isImagePath(imagePath)) {
      throw new OcrError('NOT_IMAGE', 'OCR only supports PNG/JPG/WebP/GIF/BMP images.')
    }
    if (!existsSync(imagePath)) {
      throw new OcrError('NOT_IMAGE', `Image file not found: ${imagePath}`)
    }
    const { scriptPath, runtimeDir, pythonCommand = 'python', timeoutMs = 30_000 } = this.options
    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const child = spawn(pythonCommand, [scriptPath, imagePath], {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONPATH: runtimeDir,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new OcrError('TIMEOUT', `OCR timed out after ${timeoutMs}ms.`))
      }, timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        if (error.code === 'ENOENT') {
          reject(new OcrError('ENGINE_MISSING', `Python 不可用：${pythonCommand}。请安装 Python 后重试。`))
        } else {
          reject(new OcrError('ENGINE_FAILED', `OCR 引擎启动失败：${error.message}`))
        }
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, code })
      })
    })

    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`
      throw new OcrError('ENGINE_FAILED', `OCR 引擎失败：${detail.slice(0, 400)}`)
    }
    let payload: unknown
    try {
      payload = JSON.parse(result.stdout)
    } catch {
      throw new OcrError('ENGINE_FAILED', 'OCR 引擎返回了无法解析的结果。')
    }
    if (typeof payload !== 'object' || payload === null || (payload as { ok?: boolean }).ok !== true) {
      const message = (payload as { error?: string } | null)?.error ?? 'OCR 引擎未返回成功结果'
      throw new OcrError('ENGINE_FAILED', message)
    }
    const value = payload as { text?: unknown; lines?: unknown; durationMs?: unknown }
    const lines = Array.isArray(value.lines)
      ? value.lines.flatMap((line) => {
        if (typeof line !== 'object' || line === null || typeof (line as { text?: unknown }).text !== 'string') return []
        const item = line as { text: string; score?: unknown; box?: unknown }
        return [{
          text: item.text,
          score: typeof item.score === 'number' ? item.score : null,
          box: Array.isArray(item.box)
            ? item.box.filter((entry) => Array.isArray(entry) && entry.every((n) => typeof n === 'number'))
            : null,
        }]
      })
      : []
    return {
      text: typeof value.text === 'string' ? value.text : lines.map((line) => line.text).join('\n'),
      lines,
      durationMs: typeof value.durationMs === 'number' ? value.durationMs : 0,
      engine: 'rapidocr',
    }
  }
}
