import { useState } from 'react';
import {
  Button,
  Label,
  LabelGroup,
  TextInputGroup,
  TextInputGroupMain,
  TextInputGroupUtilities,
} from '@patternfly/react-core';
import { TimesIcon } from '@patternfly/react-icons';

type ListInputProps = {
  id: string;
  'data-testid': string;
  'aria-label': string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  // Why a value is not one the list takes. Such a value is still listed, in
  // red, so it can be seen and fixed.
  invalidReason?: (value: string) => string | undefined;
  isDisabled?: boolean;
  // A button that empties the list at once.
  isClearable?: boolean;
};

// Splits what was typed or pasted into the values it holds: one to a line,
// or separated by commas.
const valuesIn = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);

// A list of short values, such as paths, as labels in one field: type a
// value and press Enter (or paste several, one to a line), click a label to
// change it, and remove it with its close button. Each value is one item, so
// one that is wrong is marked on its own.
const ListInput: React.FC<ListInputProps> = ({
  id,
  'data-testid': testId,
  'aria-label': ariaLabel,
  values,
  onChange,
  placeholder,
  invalidReason,
  isDisabled,
  isClearable = true,
}) => {
  const [draft, setDraft] = useState('');

  const add = (text: string) => {
    const added = valuesIn(text);
    setDraft('');
    if (added.length > 0) {
      onChange([...new Set([...values, ...added])]);
    }
  };

  const replace = (index: number, text: string) => {
    const value = text.trim();
    const next = [...values];
    if (value) next[index] = value;
    else next.splice(index, 1);
    onChange([...new Set(next)]);
  };

  return (
    <TextInputGroup isDisabled={isDisabled} data-testid={testId}>
      <TextInputGroupMain
        value={draft}
        onChange={(_event, value) => setDraft(value)}
        onBlur={() => add(draft)}
        placeholder={values.length === 0 ? placeholder : undefined}
        inputId={id}
        inputProps={{
          'aria-label': ariaLabel,
          'data-testid': `${testId}-input`,
          onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter' || event.key === ',') {
              // Enter would otherwise submit the form the list is in.
              event.preventDefault();
              add(draft);
            } else if (
              event.key === 'Backspace' &&
              draft === '' &&
              values.length > 0
            ) {
              onChange(values.slice(0, -1));
            }
          },
          onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => {
            const text = event.clipboardData.getData('text');
            if (/[\n,]/.test(text)) {
              event.preventDefault();
              add(`${draft}${text}`);
            }
          },
        }}
      >
        {values.length > 0 && (
          <LabelGroup numLabels={12} isEditable>
            {values.map((value, index) => {
              const reason = invalidReason?.(value);
              return (
                <Label
                  key={`${value}-${index}`}
                  variant="outline"
                  color={reason ? 'red' : undefined}
                  isEditable={!isDisabled}
                  editableProps={{ 'aria-label': `Change ${value}` }}
                  onEditComplete={(_event, text) => replace(index, text)}
                  onClose={isDisabled ? undefined : () => replace(index, '')}
                  closeBtnAriaLabel={`Remove ${value}`}
                  textMaxWidth="40ch"
                  data-testid={`${testId}-item-${index}`}
                >
                  {value}
                </Label>
              );
            })}
          </LabelGroup>
        )}
      </TextInputGroupMain>
      {isClearable && values.length > 0 && !isDisabled && (
        <TextInputGroupUtilities>
          <Button
            variant="plain"
            icon={<TimesIcon />}
            aria-label={`Clear ${ariaLabel}`}
            onClick={() => onChange([])}
            data-testid={`${testId}-clear`}
          />
        </TextInputGroupUtilities>
      )}
    </TextInputGroup>
  );
};

export default ListInput;
