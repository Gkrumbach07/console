import { useGatewayCompatibility } from '../../api/gateway';

// The example provider profiles OpenShell publishes, at the release the
// gateway runs when its version is a release, else on upstream's main branch.
// The examples change between releases (binaries, L7 rules), so the ones of
// the running gateway are the ones to copy.
export const upstreamProfilesUrl = (gatewayVersion?: string): string => {
  const release = /^v?(\d+\.\d+\.\d+(?:-pre\.\d+)?)$/.exec(
    (gatewayVersion ?? '').trim(),
  );
  const ref = release ? `v${release[1]}` : 'main';
  return `https://github.com/NVIDIA/OpenShell/tree/${ref}/providers`;
};

type UpstreamProfilesLinkProps = {
  children?: React.ReactNode;
};

const UpstreamProfilesLink: React.FC<UpstreamProfilesLinkProps> = ({
  children = 'the example profiles OpenShell publishes',
}) => {
  const compatibility = useGatewayCompatibility();
  return (
    <a
      href={upstreamProfilesUrl(compatibility.data?.gatewayVersion)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="upstream-profiles-link"
    >
      {children}
    </a>
  );
};

export default UpstreamProfilesLink;
