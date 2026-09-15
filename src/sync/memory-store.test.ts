import { MemoryOutboxStore } from './memory-store';
import { runOutboxStoreConformance } from './outbox-conformance';

runOutboxStoreConformance('MemoryOutboxStore', async () => new MemoryOutboxStore());
