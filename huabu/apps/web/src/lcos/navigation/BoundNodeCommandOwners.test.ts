import { buildLcosNodeCommands } from '@local-creative-os/web-gen2';
import { describe, expect, it } from 'vitest';

describe('canonical objects retain their content owner in the canvas menu', () => {
  it('keeps the Reader and canvas geometry while omitting native content conversion and native preview', () => {
    const commands = buildLcosNodeCommands({ nodeType: 'note', entityType: 'artifact', entityId: 'artifact-real',
      capabilities: [], referenced: false });
    expect(commands.find(command => command.id === 'open')?.label).toBe('在阅读器打开');
    expect(commands.map(command => command.id)).toEqual(expect.arrayContaining(['compose', 'color-pin', 'size', 'accent']));
    expect(commands.some(command => ['convert-text', 'convert-note', 'open-large', 'auto-height'].includes(command.id))).toBe(false);
  });

  it('preserves the native note conversion and large preview without a complete Core binding', () => {
    for (const identity of [{}, { entityType: 'artifact' }, { entityId: 'pending' }]) {
      const commands = buildLcosNodeCommands({ nodeType: 'note', capabilities: [], referenced: false, ...identity });
      expect(commands.map(command => command.id)).toEqual(expect.arrayContaining(['convert-text', 'open-large', 'auto-height']));
    }
  });
});
