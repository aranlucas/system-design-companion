export const RUBRIC = `## System design rubric

1. **Requirements**: functional scope agreed; non-functional targets explicit (scale, latency, availability, consistency, durability); out-of-scope stated.
2. **Estimates**: read/write QPS (avg + peak), storage growth, bandwidth; the numbers actually drive decisions later.
3. **API**: core endpoints/events with request/response shape; idempotency and pagination where relevant.
4. **Data model**: entities, keys, access patterns; SQL vs NoSQL justified by access patterns; indexes.
5. **High-level design**: every requirement traceable to components; clear read and write paths; sync vs async boundaries.
6. **Scaling**: stateless services behind LB; caching (what, where, invalidation); sharding/partition key and hot-key handling; replication.
7. **Reliability**: no single points of failure; retries with backoff, timeouts, idempotency; queues for spikes; graceful degradation.
8. **Consistency**: where strong vs eventual, and why; race conditions and ordering.
9. **Operability**: monitoring/alerting, rate limiting, security (authn/z, abuse), deployment.
10. **Trade-offs**: alternatives named, choices justified, bottlenecks acknowledged with a mitigation.
`;
