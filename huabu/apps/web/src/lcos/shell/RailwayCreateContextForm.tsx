import { useId, type FormEvent } from 'react';

import { TextInput } from '@/components/Common/TextInput';

import { LcosButton } from '../ui/primitives/LcosButton';

export interface RailwayCreateContextFormProps {
  readonly name: string;
  readonly onNameChange: (name: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
  readonly retry: boolean;
  readonly disabled: boolean;
  readonly message?: string;
}

export function RailwayCreateContextForm({
  name,
  onNameChange,
  onSubmit,
  onCancel,
  busy,
  retry,
  disabled,
  message,
}: RailwayCreateContextFormProps): React.JSX.Element {
  const titleId = useId();
  const nameId = useId();
  const messageId = useId();
  const canSubmit = name.trim().length > 0 && !busy && !disabled;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit();
  };

  return (
    <form
      data-lcos-railway-create-context-form
      aria-labelledby={titleId}
      onSubmit={submit}
      className="flex flex-col gap-3"
    >
      <h3 id={titleId}>新建上下文现场</h3>
      <label htmlFor={nameId} className="flex flex-col gap-1">
        <span>名称</span>
        <TextInput
          id={nameId}
          autoFocus
          aria-label="上下文现场名称"
          aria-describedby={message === undefined ? undefined : messageId}
          maxLength={200}
          value={name}
          readOnly={busy || retry}
          placeholder="现场名称"
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>
      {message !== undefined && <p id={messageId} role="status">{message}</p>}
      <footer className="flex justify-end gap-2">
        <LcosButton type="button" appearance="oreo" variant="secondary" onClick={onCancel}>
          取消
        </LcosButton>
        <LcosButton type="submit" appearance="oreo" variant="primary" disabled={!canSubmit}>
          {busy ? '正在建立…' : retry ? '继续建立上下文现场' : '创建并打开'}
        </LcosButton>
      </footer>
    </form>
  );
}
