// B4（Batch B）静态禁入 guard：防止 Collaboration UX 域重新长回 raw client 依赖。
// 范围：professional / composer / collaboration / nodes（Glyth 所在）。
// 禁止：
//   1) facade 后门访问 collaboration.conversations / .runs / .continuations
//   2) 在本域内直接 new CoreRunClient / CoreContinuationClient / CoreConversationClient
// 例外：app/lcosCoreClient.ts 是通用 typed client 工厂（非 Collaboration 产品 UI 域），不在本 guard 范围。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SCANNED_DIRS = ['professional', 'composer', 'collaboration', 'nodes'] as const;

const FACADE_BACKDOOR = /collaboration\.(conversations|runs|continuations)\s*\./;
const RAW_NEW_CLIENT = /new Core(Run|Continuation|Conversation)Client\s*\(/;

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = (() => { try { return require('node:fs').statSync(full) } catch { return undefined } })();
    if (stat?.isDirectory()) out.push(...collectFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('Collaboration facade seal（Batch B B4）', () => {
  for (const dir of SCANNED_DIRS) {
    const scanDir = join(ROOT, dir);
    const files = collectFiles(scanDir).filter(
      (file) => !file.endsWith('.enforcement.test.ts'),
    );
    it(`${dir} 域不访问 facade raw subclients（collaboration.conversations/runs/continuations.*）`, () => {
      const offenders = files.filter((file) => FACADE_BACKDOOR.test(readFileSync(file, 'utf8')));
      expect(offenders).toEqual([]);
    });
    it(`${dir} 域不直接 new Core(Run|Continuation|Conversation)Client`, () => {
      const offenders = files.filter((file) => RAW_NEW_CLIENT.test(readFileSync(file, 'utf8')));
      expect(offenders).toEqual([]);
    });
  }
});