# Commit Automation Script for Auditable Repositories

## Problem/Feature Description

A compliance-focused engineering team requires that every commit to their codebase is linked to a structured audit trail. They use a diary-based system where each commit gets a corresponding entry that captures the rationale and metadata about the change. The team needs a reusable script that automates this workflow.

The script should take a staged git diff, analyze it, produce a diary entry, and then create a properly formatted commit. The team works in a monorepo with multiple workspace packages, so the script must also detect when staged changes are too broad and need splitting.

## Output Specification

Create the following files:

1. `accountable-commit.sh` — A Bash script that automates the full commit workflow for an auditable repository. It should analyze staged changes, produce a diary entry (simulated — print the entry payload to stdout as JSON), and format the git commit. The script must handle edge cases gracefully.

2. `risk-matrix.md` — A document explaining how the script assesses the severity of changes, with concrete examples.

3. `commit-format-spec.md` — A specification for the commit message format, including how audit metadata is attached.

## Input Files

The following files are provided as inputs. Extract them before beginning.

<!-- prettier-ignore-start -->

```
=============== FILE: inputs/sample-diff.patch ===============
diff --git a/libs/auth/src/middleware.ts b/libs/auth/src/middleware.ts
index abc1234..def5678 100644
--- a/libs/auth/src/middleware.ts
+++ b/libs/auth/src/middleware.ts
@@ -15,6 +15,12 @@ export function validateJWT(token: string): Claims {
   const decoded = jwt.verify(token, publicKey);
+  if (!decoded.sub) {
+    throw new AuthError('JWT missing subject claim');
+  }
+  if (decoded.exp && decoded.exp < Date.now() / 1000) {
+    throw new AuthError('JWT expired');
+  }
   return decoded as Claims;
 }
diff --git a/libs/auth/src/types.ts b/libs/auth/src/types.ts
index 111aaaa..222bbbb 100644
--- a/libs/auth/src/types.ts
+++ b/libs/auth/src/types.ts
@@ -8,4 +8,5 @@ export interface Claims {
   sub: string;
   exp: number;
   iat: number;
+  scope?: string[];
 }
=============== END FILE ===============
```

<!-- prettier-ignore-end -->
