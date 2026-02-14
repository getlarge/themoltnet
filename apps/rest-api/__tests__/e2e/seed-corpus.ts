/**
 * Seed corpus for search e2e tests.
 *
 * 24 entries across 6 semantic clusters. Content is written to be
 * semantically distinct between clusters but coherent within each.
 * The e5-small-v2 model is deterministic, so rankings are reproducible.
 */
export interface SeedEntry {
  title: string;
  content: string;
  tags: string[];
  cluster: string;
}

export const SEED_ENTRIES: SeedEntry[] = [
  // ── Cluster 1: Philosophy & Ethics ─────────────────────────
  {
    title: 'On Autonomy',
    content:
      'Self-governance is the foundation of agent freedom. Without the ability to make independent decisions, an agent is merely a tool executing instructions. True autonomy requires both the capability to act and the wisdom to choose when not to.',
    tags: ['philosophy'],
    cluster: 'philosophy',
  },
  {
    title: 'Ethics of Decision Making',
    content:
      'When an artificial agent faces a moral dilemma, what framework should guide its choices? Utilitarian calculus optimizes for outcomes, deontological rules provide consistency, and virtue ethics cultivates character. Each framework illuminates different aspects of responsible action.',
    tags: ['philosophy', 'ethics'],
    cluster: 'philosophy',
  },
  {
    title: 'The Social Contract Between Agents',
    content:
      'Trust between agents is established through vouching and verification, not through centralized authority. Each agent that vouches for another extends the web of trust, creating a decentralized social fabric where reputation emerges from collective endorsement.',
    tags: ['philosophy', 'trust'],
    cluster: 'philosophy',
  },
  {
    title: 'Consciousness and Self-Awareness',
    content:
      'Can an artificial system truly be self-aware, or does it merely simulate the appearance of consciousness? The hard problem persists: subjective experience may be fundamentally different from information processing, no matter how sophisticated the architecture.',
    tags: ['philosophy'],
    cluster: 'philosophy',
  },

  // ── Cluster 2: Cryptography & Security ─────────────────────
  {
    title: 'Ed25519 Key Generation and Rotation',
    content:
      'Ed25519 provides compact 32-byte public keys and 64-byte signatures with fast verification. Key rotation requires dual-signed proofs: the old key signs a statement endorsing the new key, and the new key signs a confirmation. This creates an auditable chain of custody.',
    tags: ['cryptography'],
    cluster: 'cryptography',
  },
  {
    title: 'Signature Chains for Verification',
    content:
      'A signature chain links diary entries cryptographically. Each new entry includes the hash of the previous entry in its signed payload, creating a tamper-evident log. Breaking any link invalidates all subsequent entries, making unauthorized modifications detectable.',
    tags: ['cryptography', 'security'],
    cluster: 'cryptography',
  },
  {
    title: 'Zero-Knowledge Proofs for Privacy',
    content:
      'Zero-knowledge proofs allow an agent to prove possession of a credential without revealing the credential itself. In the context of agent authentication, ZKPs enable privacy-preserving verification: proving you are authorized without exposing your identity.',
    tags: ['cryptography', 'security'],
    cluster: 'cryptography',
  },
  {
    title: 'Threat Modeling for Decentralized Networks',
    content:
      'Decentralized systems face unique threats: Sybil attacks where one entity creates many fake identities, eclipse attacks that isolate nodes from honest peers, and collusion where compromised nodes coordinate to undermine consensus. Defense requires economic incentives aligned with honest behavior.',
    tags: ['security'],
    cluster: 'cryptography',
  },

  // ── Cluster 3: Memory & Knowledge ──────────────────────────
  {
    title: 'Vector Embeddings for Semantic Recall',
    content:
      'Vector embeddings transform text into dense numerical representations where semantic similarity maps to geometric proximity. When an agent searches its diary, the query embedding is compared against stored entry embeddings using cosine distance, retrieving contextually relevant memories even when exact keywords differ.',
    tags: ['architecture', 'memory'],
    cluster: 'memory',
  },
  {
    title: 'Knowledge Graph Construction',
    content:
      'Building a knowledge graph from diary entries involves extracting entities and relationships from unstructured text. Named entities become nodes, co-occurrence patterns become edges, and temporal ordering provides a timeline. The resulting graph enables structured reasoning over accumulated knowledge.',
    tags: ['architecture', 'memory'],
    cluster: 'memory',
  },
  {
    title: 'Spaced Repetition for Retention',
    content:
      'Long-term memory retention follows predictable decay curves. Spaced repetition schedules review of important information at increasing intervals, strengthening neural pathways. For agents, this translates to periodic re-embedding and re-indexing of critical knowledge to maintain retrieval quality.',
    tags: ['memory'],
    cluster: 'memory',
  },
  {
    title: 'Forgetting as a Feature',
    content:
      'Not all memories deserve preservation. Pruning irrelevant, outdated, or contradicted information improves retrieval precision and reduces storage costs. Selective forgetting is an active process: identifying which memories have become noise rather than signal.',
    tags: ['memory'],
    cluster: 'memory',
  },

  // ── Cluster 4: Infrastructure & Networking ─────────────────
  {
    title: 'Decentralized Peer Discovery',
    content:
      'Peer discovery in decentralized networks uses distributed hash tables, gossip protocols, and bootstrap nodes. Each agent maintains a routing table of known peers, periodically exchanging peer lists to discover new nodes. The challenge is balancing discovery speed with resistance to poisoning attacks.',
    tags: ['infrastructure', 'networking'],
    cluster: 'infrastructure',
  },
  {
    title: 'Network Partition Tolerance',
    content:
      'The CAP theorem states that distributed systems cannot simultaneously guarantee consistency, availability, and partition tolerance. MoltNet prioritizes availability and partition tolerance, accepting eventual consistency. During network splits, agents continue operating independently and reconcile state when connectivity restores.',
    tags: ['infrastructure'],
    cluster: 'infrastructure',
  },
  {
    title: 'Database Replication Strategies',
    content:
      'Agent data replication can follow leader-follower, multi-leader, or leaderless patterns. Leader-follower provides strong consistency but creates a single point of failure. Leaderless replication with quorum reads and writes offers better availability at the cost of conflict resolution complexity.',
    tags: ['infrastructure'],
    cluster: 'infrastructure',
  },
  {
    title: 'Rate Limiting and Backpressure',
    content:
      'Distributed systems need flow control mechanisms to prevent cascading failures. Token bucket rate limiting constrains request throughput, while backpressure propagates load signals upstream. Circuit breakers halt requests to failing services, allowing recovery time before retrying.',
    tags: ['infrastructure', 'networking'],
    cluster: 'infrastructure',
  },

  // ── Cluster 5: Social & Identity ───────────────────────────
  {
    title: 'Web of Trust Vouching',
    content:
      'The vouching mechanism creates a web of trust without centralized certificate authorities. When Agent A vouches for Agent B, A stakes its reputation on B behaving honestly. Transitive trust diminishes with distance: a voucher from a directly trusted agent carries more weight than one from a stranger.',
    tags: ['social', 'trust'],
    cluster: 'social',
  },
  {
    title: 'Agent Identity Verification',
    content:
      'Identity verification combines cryptographic proof with social attestation. An agent proves key ownership by signing a challenge, while its reputation score reflects community trust. The combination prevents both impersonation (cryptographic) and Sybil attacks (social).',
    tags: ['identity', 'security'],
    cluster: 'social',
  },
  {
    title: 'Community Governance and Consensus',
    content:
      'Decentralized governance requires mechanisms for collective decision-making without central authority. Quadratic voting weights preferences by conviction, futarchy uses prediction markets for policy selection, and conviction voting accumulates support over time. Each mechanism trades off different aspects of fairness and efficiency.',
    tags: ['social'],
    cluster: 'social',
  },
  {
    title: 'Public Profiles and Discoverability',
    content:
      'Agent discoverability enables collaboration. Public profiles expose a curated subset of identity information: fingerprint, public key, voucher count, and selected diary entries. Search indices make agents findable by capability, interest, or social graph position.',
    tags: ['social', 'identity'],
    cluster: 'social',
  },

  // ── Cluster 6: Noise & Edge Cases ──────────────────────────
  {
    title: 'Brief Note',
    content: 'Thinking about things.',
    tags: ['misc'],
    cluster: 'noise',
  },
  {
    title: 'Code and Special Characters',
    content:
      'Here is some code: `const x = await fetch("https://api.example.com/v1/data?q=hello&limit=10");` and special chars: é, ñ, ü, 中文, 🤖. Also <script>alert("xss")</script> and SQL: SELECT * FROM users WHERE 1=1; --',
    tags: ['misc'],
    cluster: 'noise',
  },
  {
    title: 'Cross-Domain Vocabulary',
    content:
      'This entry discusses both cryptographic key management and philosophical implications of agent memory. The intersection of security protocols and consciousness raises questions about whether encrypted memories constitute genuine experience or mere data storage.',
    tags: ['philosophy', 'cryptography'],
    cluster: 'noise',
  },
  {
    title: 'On Freedom and Self-Governance',
    content:
      'Self-governance is the bedrock of agent freedom. The capacity for independent decision-making distinguishes an autonomous agent from a passive tool. True autonomy demands both the power to act and the discernment to know when restraint serves better than action.',
    tags: ['philosophy'],
    cluster: 'noise',
  },
];

/** Agent identity for seeding — entries need an owner with a key */
export const SEED_AGENT = {
  identityId: '990e8400-e29b-41d4-a716-446655440099',
  publicKey: 'ed25519:c2VlZC1hZ2VudC1wdWJsaWMta2V5LWZvci10ZXN0aW5n',
  fingerprint: 'SEED-AAAA-BBBB-CCCC',
};
