import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/**
 * Phase A：OS 集成（Reveal Folder）。
 *
 * 只允许打开"已注册的绝对路径"，由调用方保证路径来自 Project Catalog；
 * 这里只做绝对路径 + 存在性校验，不提供任意路径打开能力。
 */
export interface RevealResult {
  readonly ok: boolean
  readonly error?: string
}

export function revealRegisteredPath(path: string): Promise<RevealResult> {
  return new Promise((resolve) => {
    if (!isAbsolute(path) || !existsSync(path)) {
      resolve({ ok: false, error: `Path does not exist: ${path}` })
      return
    }
    try {
      let child: ReturnType<typeof spawn>
      if (process.platform === 'win32') {
        child = spawn('explorer.exe', [path], { stdio: 'ignore', detached: true, windowsHide: true })
      } else if (process.platform === 'darwin') {
        child = spawn('open', ['-R', path], { stdio: 'ignore', detached: true })
      } else {
        child = spawn('xdg-open', [path], { stdio: 'ignore', detached: true })
      }
      child.once('error', (error) => resolve({ ok: false, error: error.message }))
      child.once('spawn', () => resolve({ ok: true }))
      child.unref()
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}

/** 打开已注册路径（文件用系统默认程序；目录用资源管理器）。 */
export function openRegisteredPath(path: string): Promise<RevealResult> {
  return new Promise((resolve) => {
    if (!isAbsolute(path) || !existsSync(path)) {
      resolve({ ok: false, error: `Path does not exist: ${path}` })
      return
    }
    try {
      let child: ReturnType<typeof spawn>
      if (process.platform === 'win32') {
        child = spawn('cmd.exe', ['/c', 'start', '""', `"${path}"`], { stdio: 'ignore', detached: true, windowsHide: true })
      } else if (process.platform === 'darwin') {
        child = spawn('open', [path], { stdio: 'ignore', detached: true })
      } else {
        child = spawn('xdg-open', [path], { stdio: 'ignore', detached: true })
      }
      child.once('error', (error) => resolve({ ok: false, error: error.message }))
      child.once('spawn', () => resolve({ ok: true }))
      child.unref()
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}

/** 在资源管理器中定位（选中）已注册文件。 */
export function revealRegisteredFile(path: string): Promise<RevealResult> {
  return new Promise((resolve) => {
    if (!isAbsolute(path) || !existsSync(path)) {
      resolve({ ok: false, error: `Path does not exist: ${path}` })
      return
    }
    try {
      let child: ReturnType<typeof spawn>
      if (process.platform === 'win32') {
        child = spawn('explorer.exe', [`/select,${path}`], { stdio: 'ignore', detached: true, windowsHide: true })
      } else if (process.platform === 'darwin') {
        child = spawn('open', ['-R', path], { stdio: 'ignore', detached: true })
      } else {
        child = spawn('xdg-open', [path], { stdio: 'ignore', detached: true })
      }
      child.once('error', (error) => resolve({ ok: false, error: error.message }))
      child.once('spawn', () => resolve({ ok: true }))
      child.unref()
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}

export interface ShortcutResolution {
  readonly shortcutPath: string
  readonly resolvedTarget: string | null
  readonly targetKind: 'file' | 'directory' | 'url' | 'unknown'
  readonly targetExists: boolean
}

/** Windows .lnk 快捷方式目标解析（仅本机、只读）。 */
export function resolveShortcutTarget(path: string): Promise<ShortcutResolution> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !path.toLocaleLowerCase('en-US').endsWith('.lnk')) {
      resolve({ shortcutPath: path, resolvedTarget: null, targetKind: 'unknown', targetExists: existsSync(path) })
      return
    }
    const script = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${path.replaceAll("'", "''")}');$t=$s.TargetPath;if([string]::IsNullOrWhiteSpace($t)){'NONE'}else{$b=[System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($t));if([System.IO.Path]::IsPathRooted($t)){if(Test-Path -LiteralPath $t){'FILE:'+$b}else{'MISSING:'+$b}}else{'URL:'+$b}}`
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8_000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({ shortcutPath: path, resolvedTarget: null, targetKind: 'unknown', targetExists: existsSync(path) })
        return
      }
      const line = String(stdout).trim().split(/\r?\n/).at(-1) ?? ''
      const decode = (encoded: string) => Buffer.from(encoded, 'base64').toString('utf8')
      if (line.startsWith('FILE:')) {
        const target = decode(line.slice(5))
        resolve({ shortcutPath: path, resolvedTarget: target, targetKind: 'file', targetExists: existsSync(target) })
      } else if (line.startsWith('MISSING:')) {
        resolve({ shortcutPath: path, resolvedTarget: decode(line.slice(8)), targetKind: 'file', targetExists: false })
      } else if (line.startsWith('URL:')) {
        resolve({ shortcutPath: path, resolvedTarget: decode(line.slice(4)), targetKind: 'url', targetExists: true })
      } else {
        resolve({ shortcutPath: path, resolvedTarget: null, targetKind: 'unknown', targetExists: existsSync(path) })
      }
    })
  })
}
