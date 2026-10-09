import { bootstrap } from '../../../packages/platform/src/bootstrap';
import ShellApp from './App';
import { loadFederatedRemote } from './federation';

void bootstrap((services, config) => (
  <ShellApp services={services} config={config} loader={loadFederatedRemote} />
));
