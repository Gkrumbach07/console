import { useState } from 'react';
import {
  Content,
  Dropdown,
  DropdownItem,
  DropdownList,
  Flex,
  FlexItem,
  MenuToggle,
  PageSection,
  Title,
} from '@patternfly/react-core';
import { useNavigate } from 'react-router-dom';

import { useWorkspaces } from '../api/workspaces';
import AllSandboxList from '../components/AllSandboxList';
import { useI18n } from '../i18n';

// The sandboxes of every workspace on the gateway: `openshell sandbox list
// --all-workspaces`, a page at a time. The gateway answers this for platform
// admins only, and its refusal is shown as it is. Each row names its
// workspace and leads to the workspace-scoped sandbox, which is where it is
// acted on. The list is the one the gateway pages (AllSandboxList), with its
// label and type filters.
//
// A sandbox is created in one workspace, so creating from here asks which.
const AllSandboxesPage: React.FC = () => {
  const { t } = useI18n('crossWorkspace');
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const [isCreateOpen, setCreateOpen] = useState(false);
  const names = (workspaces.data ?? []).map((w) => w.metadata.name);

  return (
    <>
      <PageSection>
        <Flex
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsFlexStart' }}
        >
          <FlexItem>
            <Title headingLevel="h1" className="pf-v6-u-mb-sm">
              {t('sandboxes.title')}
            </Title>
            <Content component="p">{t('sandboxes.description')}</Content>
          </FlexItem>
          <FlexItem>
            <Dropdown
              isOpen={isCreateOpen}
              onOpenChange={setCreateOpen}
              onSelect={() => setCreateOpen(false)}
              popperProps={{ position: 'right' }}
              toggle={(ref) => (
                <MenuToggle
                  ref={ref}
                  variant="primary"
                  isExpanded={isCreateOpen}
                  isDisabled={names.length === 0}
                  onClick={() => setCreateOpen((open) => !open)}
                  data-testid="all-sandboxes-create"
                >
                  Create sandbox in…
                </MenuToggle>
              )}
            >
              <DropdownList>
                {names.map((name) => (
                  <DropdownItem
                    key={name}
                    onClick={() =>
                      navigate(
                        `/workspaces/${encodeURIComponent(name)}/create-sandbox`,
                      )
                    }
                    data-testid={`all-sandboxes-create-${name}`}
                  >
                    {name}
                  </DropdownItem>
                ))}
              </DropdownList>
            </Dropdown>
          </FlexItem>
        </Flex>
      </PageSection>
      <PageSection>
        <AllSandboxList />
      </PageSection>
    </>
  );
};

export default AllSandboxesPage;
