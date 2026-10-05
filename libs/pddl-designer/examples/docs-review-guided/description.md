A pull request is reviewed for documentation impact. Ingesting, retrieving and
resolving are done by trusted code and need no agent; extracting, coverage and
the docs check are each done by a dedicated agent.

Trusted code ingests a pull request once; afterwards the pull request is
ingested. A free extractor agent extracts the contract changes of an ingested
pull request that changed source code; afterwards the pull request's contract
changes are extracted and the extractor agent is free again. Trusted code
retrieves the documents of a pull request once its contract changes are
extracted, or once it is ingested if it changed documentation only; afterwards
its documents are retrieved.

A free coverage agent checks the retrieved documents of a pull request;
afterwards the pull request's coverage is done and the coverage agent is free
again. A free docs-check agent reviews the added passage of a pull request whose
documents are retrieved; afterwards that passage is reviewed and the docs-check
agent is free again. The docs check of a pull request is complete once its added
passage has been reviewed. A pull request that adds no documentation text needs
no docs check.

Trusted code publishes the review result of a pull request once its coverage is
done and its docs check is complete or not needed; afterwards the pull request
has a published review result. Each step happens at most once per pull request.
