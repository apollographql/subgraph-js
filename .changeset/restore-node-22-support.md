---
"@apollo/subgraph": patch
---

Restore Node.js 22 support. `engines.node` was set to `>=24.0.0` during the graphql-js rewrite without a documented Node 24 runtime requirement, which silently dropped the current Node 22 LTS. CI now tests Node 22 alongside 24 and latest.
