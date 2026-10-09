import { bootstrap } from '../../../packages/platform/src/bootstrap';
import { Standalone } from '../../../packages/platform/src/Standalone';
import PeopleApp from './App';

void bootstrap((services) => <Standalone name="People" App={PeopleApp} services={services} />);
