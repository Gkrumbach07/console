import { useRef, useState } from 'react';
import {
  Button,
  Label,
  LabelGroup,
  MenuToggle,
  Select,
  SelectList,
  SelectOption,
  TextInputGroup,
  TextInputGroupMain,
  TextInputGroupUtilities,
} from '@patternfly/react-core';
import { TimesIcon } from '@patternfly/react-icons';

import type { Provider } from '../../types';

type ProviderSelectProps = {
  providers: Provider[];
  selected: string[];
  onToggle: (name: string, checked: boolean) => void;
  onClear: () => void;
  // What attaching a provider adds, for the line under its name.
  describe: (provider: Provider) => string | undefined;
};

// The providers to attach, chosen in one field: type to narrow the list,
// tick as many as wanted, and see the chosen ones as labels. A workspace may
// hold dozens, which a list of checkboxes does not.
const ProviderSelect: React.FC<ProviderSelectProps> = ({
  providers,
  selected,
  onToggle,
  onClear,
  describe,
}) => {
  const [isOpen, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const term = filter.trim().toLowerCase();
  const shown = providers.filter(
    (provider) =>
      !term ||
      provider.metadata.name.toLowerCase().includes(term) ||
      provider.type.toLowerCase().includes(term),
  );

  const toggle = (name: string) => {
    onToggle(name, !selected.includes(name));
    inputRef.current?.focus();
  };

  return (
    <Select
      role="menu"
      id="sandbox-providers-select"
      isOpen={isOpen}
      selected={selected}
      onSelect={(_event, value) => toggle(String(value))}
      onOpenChange={setOpen}
      // Over the page, not inside the wizard's scrolling body, which clips it.
      popperProps={{ appendTo: () => document.body }}
      toggle={(ref) => (
        <MenuToggle
          ref={ref}
          variant="typeahead"
          onClick={() => setOpen((open) => !open)}
          isExpanded={isOpen}
          isFullWidth
          data-testid="sandbox-providers-toggle"
        >
          <TextInputGroup isPlain>
            <TextInputGroupMain
              value={filter}
              // The typeahead toggle listens on its caret only.
              onClick={() => setOpen(true)}
              onChange={(_event, value) => {
                setFilter(value);
                setOpen(true);
              }}
              placeholder={
                selected.length === 0 ? 'Choose providers to attach' : ''
              }
              innerRef={inputRef}
              role="combobox"
              isExpanded={isOpen}
              aria-controls="sandbox-providers-listbox"
              inputProps={{
                'aria-label': 'Providers',
                'data-testid': 'sandbox-providers-input',
              }}
            >
              {selected.length > 0 && (
                <LabelGroup aria-label="Chosen providers">
                  {selected.map((name) => (
                    <Label
                      key={name}
                      variant="outline"
                      onClose={(event) => {
                        event.stopPropagation();
                        onToggle(name, false);
                      }}
                      closeBtnAriaLabel={`Remove ${name}`}
                      data-testid={`sandbox-provider-chip-${name}`}
                    >
                      {name}
                    </Label>
                  ))}
                </LabelGroup>
              )}
            </TextInputGroupMain>
            {(selected.length > 0 || filter) && (
              <TextInputGroupUtilities>
                <Button
                  variant="plain"
                  icon={<TimesIcon />}
                  aria-label="Clear the providers"
                  onClick={(event) => {
                    event.stopPropagation();
                    setFilter('');
                    onClear();
                  }}
                />
              </TextInputGroupUtilities>
            )}
          </TextInputGroup>
        </MenuToggle>
      )}
    >
      <SelectList isAriaMultiselectable id="sandbox-providers-listbox">
        {shown.length === 0 ? (
          <SelectOption isDisabled value="">
            No provider matches “{filter}”
          </SelectOption>
        ) : (
          shown.map((provider) => (
            <SelectOption
              key={provider.metadata.name}
              value={provider.metadata.name}
              hasCheckbox
              isSelected={selected.includes(provider.metadata.name)}
              description={describe(provider)}
              data-testid={`sandbox-provider-${provider.metadata.name}`}
            >
              {provider.metadata.name} ({provider.type})
            </SelectOption>
          ))
        )}
      </SelectList>
    </Select>
  );
};

export default ProviderSelect;
