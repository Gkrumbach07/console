import { Form, Modal, ModalBody, ModalHeader } from '@patternfly/react-core';

import HostRuleForm from './HostRuleForm';
import type { NetworkPolicyRule } from '../../types';

type AddHostModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, rule: NetworkPolicyRule) => void;
  // A rule to change rather than a new one (HostRuleForm). Mount the dialog
  // afresh (a `key`) for each rule.
  initialRule?: NetworkPolicyRule;
  title?: string;
  submitLabel?: string;
};

// The host form in a dialog, for a page that has no room to show it in
// place: a proposal on a sandbox's Proposals tab, changed before it is
// allowed.
const AddHostModal: React.FC<AddHostModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  initialRule,
  title = 'Add a host',
  submitLabel = 'Add',
}) => (
  <Modal variant="small" isOpen={isOpen} onClose={onClose} aria-label={title}>
    <ModalHeader title={title} />
    <ModalBody>
      <Form onSubmit={(event) => event.preventDefault()}>
        {isOpen && (
          <HostRuleForm
            initialRule={initialRule}
            submitLabel={submitLabel}
            onSubmit={(name, rule) => {
              onAdd(name, rule);
              onClose();
            }}
            onCancel={onClose}
          />
        )}
      </Form>
    </ModalBody>
  </Modal>
);

export default AddHostModal;
