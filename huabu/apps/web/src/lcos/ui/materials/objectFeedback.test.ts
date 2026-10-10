import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountObjectFeedback } from './objectFeedback';
let dispose: (() => void) | undefined;
let frames: Map<number, FrameRequestCallback>;
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
beforeEach(() => {
  frames = new Map(); let next = 1;
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', (query: string) => query.includes('reduced-motion') ? media : { ...media, matches: false });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { const id = next++; frames.set(id, fn); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });
function target() {
 const button = document.createElement('button'); button.dataset.lcosOptic = 'source'; document.body.append(button);
 button.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
 const controller = mountObjectFeedback(document); dispose = () => controller.destroy(); return { button, controller };
}
function pointer(button: HTMLElement, type = 'pointerover', buttons = 0) {
 const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse', buttons, button: 0, clientX: 80, clientY: 20 });
 button.dispatchEvent(event); return event;
}
it('stops sampling when pointer settles and restores existing inline values on teardown', () => {
 const { button, controller } = target(); button.style.setProperty('--lcos-optic-x', '7%', 'important');
 pointer(button); for (let t = 16; frames.size && t < 2000; t += 16) { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(t)); }
 expect(controller.inspect().running).toBe(false); expect(frames.size).toBe(0);
 expect(button.style.getPropertyValue('--lcos-optic-x')).toBe('80.00%');
 controller.destroy(); expect(button.classList.contains('lcos-optic-live')).toBe(false);
 expect(button.style.getPropertyValue('--lcos-optic-x')).toBe('7%'); expect(button.style.getPropertyPriority('--lcos-optic-x')).toBe('important');
 pointer(button); expect(frames.size).toBe(0);
});
it('observes controls without swallowing callbacks and gives dragging to the existing owner', () => {
 const { button, controller } = target(); const click = vi.fn(); button.addEventListener('click', click);
 expect(pointer(button, 'pointerdown', 1).defaultPrevented).toBe(false); button.click(); expect(click).toHaveBeenCalledOnce();
 pointer(button, 'pointermove', 1); expect(controller.inspect().active).toBeNull(); expect(frames.size).toBe(0);
 button.disabled = true; pointer(button); expect(controller.inspect().active).toBeNull();
});
it('renders focus without animation in reduced motion and clears it when a parent becomes inert', async () => {
 const { button, controller } = target(); media.matches = true;
 button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
 expect(button.dataset.lcosOpticMode).toBe('focus'); expect(frames.size).toBe(0);
 document.body.setAttribute('inert', ''); await new Promise(resolve => setTimeout(resolve, 0));
 expect(controller.inspect().active).toBeNull(); document.body.removeAttribute('inert');
});
