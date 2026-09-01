import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface DirectoryPickerInput {
  readonly title: string
}

export interface DirectoryPickerResult {
  readonly path?: string
  readonly cancelled: boolean
}

/** Base64 回传路径，绕开 Windows PowerShell 5.1 管道输出代码页（GBK/UTF-8 不一致导致的乱码）。 */
export function encodePickerPath(path: string): string {
  return Buffer.from(path, 'utf8').toString('base64')
}

export function decodePickerPath(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf8')
}

export async function selectNativeDirectory(input: DirectoryPickerInput): Promise<DirectoryPickerResult> {
  if (process.platform !== 'win32') {
    throw new Error('Native directory selection is currently available on Windows only.')
  }

  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    `$dialog.Description = '${input.title.replace(/'/g, "''")}'`,
    '$dialog.ShowNewFolderButton = $true',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath))',
    '}',
  ].join('; ')

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-Command',
    script,
  ], {
    encoding: 'utf8',
    timeout: 5 * 60 * 1_000,
    windowsHide: false,
  })
  const selectedPath = stdout.trim()
  return selectedPath ? { path: decodePickerPath(selectedPath), cancelled: false } : { cancelled: true }
}
