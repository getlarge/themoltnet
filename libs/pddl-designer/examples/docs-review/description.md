A pull request is reviewed for documentation impact. First, trusted code ingests
the pull request's diff; this happens once per pull request. If the pull request
changed source code, an extractor agent then lists the contract changes it
makes; extraction needs an ingested pull request. If the pull request changed
documentation only, extraction is skipped. Next, trusted code retrieves the
documents relevant to the pull request; retrieval needs either extracted
contract changes or a docs-only pull request. A coverage agent then checks the
retrieved documents for missing or incorrect instructions. When the pull request
adds documentation text, a docs-check agent also reviews each added passage;
otherwise the docs check is not needed. Coverage and the docs check can run at
the same time. Each agent handles one review at a time and is free again when it
finishes. When coverage is done, and the docs check is done or not needed,
trusted code resolves the outcome and publishes one review result for the pull
request. Each stage runs at most once per pull request.
