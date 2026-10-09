import { bootstrap } from '../../../packages/platform/src/bootstrap';
import { Standalone } from '../../../packages/platform/src/Standalone';
import DeliveryApp from './App';

void bootstrap((services) => <Standalone name="Delivery" App={DeliveryApp} services={services} />);
