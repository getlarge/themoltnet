```mermaid
graph LR
    Deployment_Tooling_Validation_Suite["Deployment Tooling & Validation Suite"]
    Environment_Bootstrapping_Migration_Utility["Environment Bootstrapping & Migration Utility"]
    Governance_State_Archive_Manager["Governance State Archive Manager"]
```

[![CodeBoarding](https://img.shields.io/badge/Generated%20by-CodeBoarding-9cf?style=flat-square)](https://github.com/CodeBoarding/CodeBoarding)[![Demo](https://img.shields.io/badge/Try%20our-Demo-blue?style=flat-square)](https://www.codeboarding.org/diagrams)[![Contact](https://img.shields.io/badge/Contact%20us%20-%20contact@codeboarding.org-lightgrey?style=flat-square)](mailto:contact@codeboarding.org)

## Details

Manages the persistence and portability of the governance state through encrypted archives and deployment utilities.

### Deployment Tooling & Validation Suite
Provides the operational scaffolding required to deploy the AI Agent runtime. This includes Docker pre-versioning, workspace alias validation, and connectivity benchmarking to ensure the infrastructure can sustain the governance load before activation.


**Related Classes/Methods**:

- `tools.release.docker-preversion.projects`:24-27
- `tools.src.check-vite-alias-exports.listWorkspacePackages`:28-62



**Source Files:**

- [`tools/db/backfill-personal-teams.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts)
  - `tools.db.backfill-personal-teams.proxyHost` ([L38-L39](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts#L38-L39)) - Class
  - `tools.db.backfill-personal-teams.proxyHost.args.find() callback` ([L39-L39](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts#L39-L39)) - Function
- [`tools/db/backfill-runtime-profile-standard-engineering-context.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-runtime-profile-standard-engineering-context.ts)
  - `tools.db.backfill-runtime-profile-standard-engineering-context.loadStandardEngineeringContext.fragments` ([L76-L85](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-runtime-profile-standard-engineering-context.ts#L76-L85)) - Class
  - `tools.db.backfill-runtime-profile-standard-engineering-context.loadStandardEngineeringContext.fragments.map() callback` ([L78-L85](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-runtime-profile-standard-engineering-context.ts#L78-L85)) - Function
- [`tools/generators/split-tsconfigs/index.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/generators/split-tsconfigs/index.ts)
  - `tools.generators.split-tsconfigs.index.splitTsconfigsGenerator.selected` ([L62-L64](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/generators/split-tsconfigs/index.ts#L62-L64)) - Class
  - `tools.generators.split-tsconfigs.index.splitTsconfigsGenerator.selected.filter() callback` ([L63-L63](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/generators/split-tsconfigs/index.ts#L63-L63)) - Function
  - `tools.generators.split-tsconfigs.index.splitTsconfigsGenerator.selected.sort() callback` ([L64-L64](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/generators/split-tsconfigs/index.ts#L64-L64)) - Function
- [`tools/release/docker-preversion.mjs`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/release/docker-preversion.mjs)
  - `tools.release.docker-preversion.projects` ([L24-L27](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/release/docker-preversion.mjs#L24-L27)) - Class
  - `tools.release.docker-preversion.projects.map() callback` ([L26-L26](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/release/docker-preversion.mjs#L26-L26)) - Function
- [`tools/src/bench-ory-connection-reuse.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bench-ory-connection-reuse.ts)
  - `tools.src.bench-ory-connection-reuse.computeStats.sum` ([L177-L177](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bench-ory-connection-reuse.ts#L177-L177)) - Class
  - `tools.src.bench-ory-connection-reuse.computeStats.sum.sorted.reduce() callback` ([L177-L177](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bench-ory-connection-reuse.ts#L177-L177)) - Function
- [`tools/src/check-pack.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-pack.ts)
  - `tools.src.check-pack.checkNoWorkspaceDtsLeak.dtsFiles` ([L120-L120](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-pack.ts#L120-L120)) - Class
  - `tools.src.check-pack.checkNoWorkspaceDtsLeak.dtsFiles.paths.filter() callback` ([L120-L120](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-pack.ts#L120-L120)) - Function
- [`tools/src/check-vite-alias-exports.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-vite-alias-exports.ts)
  - `tools.src.check-vite-alias-exports.readJson` ([L24-L26](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-vite-alias-exports.ts#L24-L26)) - Function
  - `tools.src.check-vite-alias-exports.listWorkspacePackages` ([L28-L62](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-vite-alias-exports.ts#L28-L62)) - Function
  - `tools.src.check-vite-alias-exports.getExportSubpaths` ([L64-L73](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-vite-alias-exports.ts#L64-L73)) - Function
  - `tools.src.check-vite-alias-exports.listViteConfigs` ([L75-L102](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-vite-alias-exports.ts#L75-L102)) - Function
  - `tools.src.check-vite-alias-exports.extractAliasBlocks` ([L104-L128](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-vite-alias-exports.ts#L104-L128)) - Function
  - `tools.src.check-vite-alias-exports.hasAlias` ([L130-L135](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-vite-alias-exports.ts#L130-L135)) - Function
  - `tools.src.check-vite-alias-exports.packages` ([L137-L139](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-vite-alias-exports.ts#L137-L139)) - Class
  - `tools.src.check-vite-alias-exports.packages.filter() callback` ([L138-L138](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-vite-alias-exports.ts#L138-L138)) - Function
- [`tools/src/eval-setup.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/eval-setup.ts)
  - `tools.src.eval-setup.setup.errorMsg` ([L87-L87](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/eval-setup.ts#L87-L87)) - Class
  - `tools.src.eval-setup.setup.errorMsg.result.errors.map() callback` ([L87-L87](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/eval-setup.ts#L87-L87)) - Function
- [`tools/src/release/go-artifact-publisher.cli.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.cli.ts)
  - `tools.src.release.go-artifact-publisher.cli.resolveConfigPath` ([L11-L13](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.cli.ts#L11-L13)) - Function
  - `tools.src.release.go-artifact-publisher.cli.normalizeBooleanOptionValues` ([L15-L34](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.cli.ts#L15-L34)) - Function
  - `tools.src.release.go-artifact-publisher.cli.normalizeBooleanOptionValues.args.flatMap() callback` ([L27-L33](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.cli.ts#L27-L33)) - Function
  - `tools.src.release.go-artifact-publisher.cli.createCliRunOptions` ([L36-L93](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.cli.ts#L36-L93)) - Function
  - `tools.src.release.go-artifact-publisher.cli.applyCliOverrides` ([L95-L108](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.cli.ts#L95-L108)) - Function
  - `tools.src.release.go-artifact-publisher.cli.main` ([L110-L131](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.cli.ts#L110-L131)) - Function
  - `tools.src.release.go-artifact-publisher.cli.catch() callback` ([L134-L137](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.cli.ts#L134-L137)) - Function
- [`tools/src/release/go-artifact-publisher.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts)
  - `tools.src.release.go-artifact-publisher.readJsonFile` ([L115-L117](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L115-L117)) - Function
  - `tools.src.release.go-artifact-publisher.tryReadFile` ([L119-L125](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L119-L125)) - Function
  - `tools.src.release.go-artifact-publisher.resolveVersion` ([L127-L143](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L127-L143)) - Function
  - `tools.src.release.go-artifact-publisher.readGitShortCommit` ([L145-L151](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L145-L151)) - Function
  - `tools.src.release.go-artifact-publisher.resolveTemplate` ([L153-L163](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L153-L163)) - Function
  - `tools.src.release.go-artifact-publisher.resolveTemplate.template.replace() callback` ([L157-L162](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L157-L162)) - Function
  - `tools.src.release.go-artifact-publisher.binaryName` ([L165-L170](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L165-L170)) - Function
  - `tools.src.release.go-artifact-publisher.archiveFormat` ([L172-L182](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L172-L182)) - Function
  - `tools.src.release.go-artifact-publisher.artifactContext` ([L184-L199](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L184-L199)) - Function
  - `tools.src.release.go-artifact-publisher.renderLdflags` ([L201-L212](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L201-L212)) - Function
  - `tools.src.release.go-artifact-publisher.renderLdflags.flags.map() callback` ([L210-L210](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L210-L210)) - Function
  - `tools.src.release.go-artifact-publisher.checksumFilePath` ([L214-L223](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L214-L223)) - Function
  - `tools.src.release.go-artifact-publisher.releaseTag` ([L225-L237](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L225-L237)) - Function
  - `tools.src.release.go-artifact-publisher.createGithubReleaseCommand` ([L239-L257](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L239-L257)) - Function
  - `tools.src.release.go-artifact-publisher.uploadGithubReleaseCommand` ([L259-L271](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L259-L271)) - Function
  - `tools.src.release.go-artifact-publisher.finalizeGithubReleaseCommand` ([L273-L284](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L273-L284)) - Function
  - `tools.src.release.go-artifact-publisher.githubReleaseUploadCommands` ([L286-L300](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L286-L300)) - Function
  - `tools.src.release.go-artifact-publisher.githubReleaseUploadCommands.filter() callback` ([L299-L299](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L299-L299)) - Function
  - `tools.src.release.go-artifact-publisher.createGoArtifactReleasePlan` ([L302-L380](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L302-L380)) - Function
  - `tools.src.release.go-artifact-publisher.buildSteps` ([L319-L359](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L319-L359)) - Class
  - `tools.src.release.go-artifact-publisher.createGoArtifactReleasePlan.buildSteps.builds.map() callback` ([L319-L359](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L319-L359)) - Function
  - `tools.src.release.go-artifact-publisher.createGoArtifactReleasePlan.uploadFiles` ([L363-L366](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L363-L366)) - Class
  - `tools.src.release.go-artifact-publisher.createGoArtifactReleasePlan.uploadFiles.buildSteps.map() callback` ([L364-L364](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L364-L364)) - Function
  - `tools.src.release.go-artifact-publisher.runCommand` ([L382-L395](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L382-L395)) - Function
  - `tools.src.release.go-artifact-publisher.assertCommandAvailable` ([L397-L410](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L397-L410)) - Function
  - `tools.src.release.go-artifact-publisher.checkRequiredTools` ([L412-L422](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L412-L422)) - Function
  - `tools.src.release.go-artifact-publisher.checkRequiredTools.plan.uploadCommands.some() callback` ([L419-L419](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L419-L419)) - Function
  - `tools.src.release.go-artifact-publisher.applyLocalGoReplaces` ([L424-L452](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L424-L452)) - Function
  - `tools.src.release.go-artifact-publisher.restoreGoModuleFiles` ([L454-L467](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L454-L467)) - Function
  - `tools.src.release.go-artifact-publisher.archiveBinary` ([L469-L493](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L469-L493)) - Function
  - `tools.src.release.go-artifact-publisher.writeChecksums` ([L495-L504](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L495-L504)) - Function
  - `tools.src.release.go-artifact-publisher.copyPackageBinary` ([L506-L515](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L506-L515)) - Function
  - `tools.src.release.go-artifact-publisher.formatCommand` ([L517-L529](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L517-L529)) - Function
  - `tools.src.release.go-artifact-publisher.printGoArtifactReleasePlan` ([L531-L552](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L531-L552)) - Function
  - `tools.src.release.go-artifact-publisher.runGoArtifactPublisher` ([L554-L606](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L554-L606)) - Function
  - `tools.src.release.go-artifact-publisher.runGoArtifactPublisher.plan.buildSteps.map() callback` ([L597-L597](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L597-L597)) - Function
  - `tools.src.release.go-artifact-publisher.readGoArtifactPublisherConfig` ([L608-L620](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L608-L620)) - Function
- [`tools/src/release/go-version-actions.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts)
  - `tools.src.release.go-version-actions.readGoModulePathFromFile` ([L60-L64](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L60-L64)) - Function
  - `tools.src.release.go-version-actions.resolveGoReleaseValidationRoots` ([L200-L211](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L200-L211)) - Function
  - `tools.src.release.go-version-actions.read` ([L259-L266](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L259-L266)) - Class
  - `tools.src.release.go-version-actions.createFileSystemVisitTree.children` ([L270-L273](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L270-L273)) - Method
  - `tools.src.release.go-version-actions.createFileSystemVisitTree.exists` ([L274-L276](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L274-L276)) - Method
  - `tools.src.release.go-version-actions.createFileSystemVisitTree.isFile` ([L277-L279](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L277-L279)) - Method
  - `tools.src.release.go-version-actions.discoverGoWorkspaceModules` ([L299-L320](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L299-L320)) - Function
  - `tools.src.release.go-version-actions.discoverGoWorkspaceModules.modules` ([L310-L315](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L310-L315)) - Class
  - `tools.src.release.go-version-actions.discoverGoWorkspaceModules.modules.dirs.map() callback` ([L311-L314](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L311-L314)) - Function
  - `tools.src.release.go-version-actions.discoverGoWorkspaceModules.modules.flatMap() callback` ([L317-L319](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L317-L319)) - Function
  - `tools.src.release.go-version-actions.hasReplaceDirective` ([L322-L356](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L322-L356)) - Function
  - `tools.src.release.go-version-actions.createGoReleaseValidationLocalReplaces` ([L358-L386](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L358-L386)) - Function
  - `tools.src.release.go-version-actions.parseOptionList` ([L388-L401](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L388-L401)) - Function
  - `tools.src.release.go-version-actions.readCliOptionList` ([L403-L420](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L403-L420)) - Function
  - `tools.src.release.go-version-actions.shouldRunGoReleaseValidation` ([L422-L456](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L422-L456)) - Function
  - `tools.src.release.go-version-actions.createGoReleaseValidationCommands` ([L458-L494](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L458-L494)) - Function
  - `tools.src.release.go-version-actions.afterAllProjectsVersioned` ([L607-L729](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L607-L729)) - Function
- [`tools/src/repo.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/repo.ts)
  - `tools.src.repo.resolveRepoRoot` ([L6-L16](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/repo.ts#L6-L16)) - Function
- [`tools/src/talos-capability-probe.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts)
  - `tools.src.talos-capability-probe.CapabilityObservation` ([L21-L25](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L21-L25)) - Interface
  - `tools.src.talos-capability-probe.TalosCapabilityReport` ([L27-L42](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L27-L42)) - Interface
  - `tools.src.talos-capability-probe.TalosProbeOptions` ([L44-L49](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L44-L49)) - Interface
  - `tools.src.talos-capability-probe.createApi.fetchApi` ([L86-L91](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L86-L91)) - Method
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.callerSelectedAudience` ([L493-L495](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L493-L495)) - Class
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.callerSelectedAudience.observations.find() callback` ([L494-L494](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L494-L494)) - Function
- [`tools/src/tasks/api.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts)
  - `tools.src.tasks.api.TasksApiContext` ([L10-L15](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts#L10-L15)) - Interface
  - `tools.src.tasks.api.resolveTasksApiContext.auth` ([L35-L35](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts#L35-L35)) - Method
  - `tools.src.tasks.api.substituteTemplate.missing` ([L72-L72](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts#L72-L72)) - Class
  - `tools.src.tasks.api.substituteTemplate.missing.leftover.map() callback` ([L72-L72](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts#L72-L72)) - Function
  - `tools.src.tasks.api.substituteTemplate.missing.map() callback` ([L75-L75](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts#L75-L75)) - Function
- [`tools/src/tasks/compose-pr-security-review.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts)
  - `tools.src.tasks.compose-pr-security-review.PullRequestInfo` ([L88-L94](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L88-L94)) - Interface
  - `tools.src.tasks.compose-pr-security-review.ghJson` ([L96-L102](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L96-L102)) - Function
  - `tools.src.tasks.compose-pr-security-review.gh` ([L104-L109](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L104-L109)) - Function
  - `tools.src.tasks.compose-pr-security-review.getPullRequestInfo` ([L111-L139](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L111-L139)) - Function
  - `tools.src.tasks.compose-pr-security-review.getPullRequestInfo.commitMessages.pr.commits.map() callback` ([L133-L136](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L133-L136)) - Function
  - `tools.src.tasks.compose-pr-security-review.getPullRequestInfo.commitMessages.pr.commits.map() callback.filter() callback` ([L135-L135](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L135-L135)) - Function
  - `tools.src.tasks.compose-pr-security-review.resolveCorrelationId` ([L141-L157](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L141-L157)) - Function
  - `tools.src.tasks.compose-pr-security-review.ensureLegreffierMarker` ([L159-L171](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L159-L171)) - Function
  - `tools.src.tasks.compose-pr-security-review.updatePrBody` ([L173-L182](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L173-L182)) - Function
  - `tools.src.tasks.compose-pr-security-review.readRubric` ([L184-L199](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L184-L199)) - Function
  - `tools.src.tasks.compose-pr-security-review.readRubric.errors.map() callback` ([L194-L194](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L194-L194)) - Function
  - `tools.src.tasks.compose-pr-security-review.readSkill` ([L201-L213](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L201-L213)) - Function
  - `tools.src.tasks.compose-pr-security-review.buildPrSecurityReviewInput` ([L215-L252](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L215-L252)) - Function
  - `tools.src.tasks.compose-pr-security-review.validateInput` ([L254-L264](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L254-L264)) - Function
  - `tools.src.tasks.compose-pr-security-review.validateInput.errors.map() callback` ([L260-L260](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L260-L260)) - Function
  - `tools.src.tasks.compose-pr-security-review.main` ([L266-L290](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-security-review.ts#L266-L290)) - Function
- [`tools/src/tasks/seed-judge-fixture.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/seed-judge-fixture.ts)
  - `tools.src.tasks.seed-judge-fixture.ProdEntry` ([L52-L61](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/seed-judge-fixture.ts#L52-L61)) - Interface
  - `tools.src.tasks.seed-judge-fixture.ProdSourcePack` ([L63-L67](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/seed-judge-fixture.ts#L63-L67)) - Interface
  - `tools.src.tasks.seed-judge-fixture.ProdRenderedPack` ([L69-L73](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/seed-judge-fixture.ts#L69-L73)) - Interface
  - `tools.src.tasks.seed-judge-fixture.localPack.entries.sourcePack.entries.map() callback` ([L120-L123](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/seed-judge-fixture.ts#L120-L123)) - Function
- [`tools/src/test-smtp.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts)
  - `tools.src.test-smtp.SmtpConfig` ([L8-L16](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L8-L16)) - Interface
  - `tools.src.test-smtp.SmtpResponse` ([L18-L21](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L18-L21)) - Interface
  - `tools.src.test-smtp.parseBoolean` ([L23-L25](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L23-L25)) - Function
  - `tools.src.test-smtp.parseSmtpUri` ([L27-L71](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L27-L71)) - Function
  - `tools.src.test-smtp.SmtpClient` ([L73-L307](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L73-L307)) - Class
  - `tools.src.test-smtp.SmtpClient.connect` ([L80-L85](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L80-L85)) - Method
  - `tools.src.test-smtp.SmtpClient.ehlo` ([L87-L89](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L87-L89)) - Method
  - `tools.src.test-smtp.SmtpClient.startTls` ([L91-L107](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L91-L107)) - Method
  - `tools.src.test-smtp.SmtpClient.startTls.secureSocket` ([L96-L104](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L96-L104)) - Class
  - `tools.src.test-smtp.SmtpClient.startTls.secureSocket.<function>` ([L96-L104](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L96-L104)) - Function
  - `tools.src.test-smtp.SmtpClient.auth` ([L109-L141](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L109-L141)) - Method
  - `tools.src.test-smtp.SmtpClient.auth.authLine` ([L111-L113](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L111-L113)) - Class
  - `tools.src.test-smtp.SmtpClient.auth.authLine.capabilities.find() callback` ([L111-L113](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L111-L113)) - Function
  - `tools.src.test-smtp.SmtpClient.sendMail` ([L143-L164](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L143-L164)) - Method
  - `tools.src.test-smtp.SmtpClient.quit` ([L166-L176](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L166-L176)) - Method
  - `tools.src.test-smtp.SmtpClient.openSocket` ([L178-L200](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L178-L200)) - Method
  - `tools.src.test-smtp.SmtpClient.openSocket.<function>` ([L179-L199](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L179-L199)) - Function
  - `tools.src.test-smtp.openSocket.<function>.socket` ([L182-L190](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L182-L190)) - Class
  - `tools.src.test-smtp.SmtpClient.attachSocket` ([L202-L211](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L202-L211)) - Method
  - `tools.src.test-smtp.SmtpClient.attachSocket.socket.on('data') callback` ([L207-L210](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L207-L210)) - Function
  - `tools.src.test-smtp.SmtpClient.getSocket` ([L213-L218](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L213-L218)) - Method
  - `tools.src.test-smtp.SmtpClient.write` ([L220-L222](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L220-L222)) - Method
  - `tools.src.test-smtp.SmtpClient.sendCommand` ([L224-L233](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L224-L233)) - Method
  - `tools.src.test-smtp.SmtpClient.readResponse` ([L235-L244](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L235-L244)) - Method
  - `tools.src.test-smtp.SmtpClient.flushQueue` ([L246-L255](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L246-L255)) - Method
  - `tools.src.test-smtp.SmtpClient.tryParseResponse` ([L257-L291](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L257-L291)) - Method
  - `tools.src.test-smtp.SmtpClient.assertResponse` ([L293-L306](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L293-L306)) - Method
  - `tools.src.test-smtp.prompt` ([L309-L317](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L309-L317)) - Function
  - `tools.src.test-smtp.main` ([L319-L383](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L319-L383)) - Function
  - `tools.src.test-smtp.catch() callback` ([L385-L390](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L385-L390)) - Function


### Environment Bootstrapping & Migration Utility
Manages the transition and initialization of governance entities. It is responsible for 'Genesis' agent bootstrapping and performing targeted cleanup or backfilling of provenance tuples (Diary) to maintain data integrity during schema or policy evolutions.


**Related Classes/Methods**:

- `tools.src.bootstrap-genesis-agents.main`:99-236
- `tools.db.cleanup-legacy-diary-tuples.main`:127-172
- `tools.db.backfill-personal-teams.grantTeamOwner`:96-118



**Source Files:**

- [`tools/db/backfill-personal-teams.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts)
  - `tools.db.backfill-personal-teams.proxyPort` ([L40-L41](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts#L40-L41)) - Class
  - `tools.db.backfill-personal-teams.proxyPort.args.find() callback` ([L41-L41](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts#L41-L41)) - Function
  - `tools.db.backfill-personal-teams.resolveUrl` ([L47-L75](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts#L47-L75)) - Function
  - `tools.db.backfill-personal-teams.resolveOry` ([L79-L92](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts#L79-L92)) - Function
  - `tools.db.backfill-personal-teams.grantTeamOwner` ([L96-L118](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts#L96-L118)) - Function
  - `tools.db.backfill-personal-teams.verifyTeamOwner` ([L120-L139](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts#L120-L139)) - Function
  - `tools.db.backfill-personal-teams.main` ([L143-L229](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts#L143-L229)) - Function
  - `tools.db.backfill-personal-teams.catch() callback` ([L231-L234](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-personal-teams.ts#L231-L234)) - Function
- [`tools/db/backfill-runtime-profile-standard-engineering-context.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-runtime-profile-standard-engineering-context.ts)
  - `tools.db.backfill-runtime-profile-standard-engineering-context.backfill.existing` ([L134-L136](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-runtime-profile-standard-engineering-context.ts#L134-L136)) - Class
  - `tools.db.backfill-runtime-profile-standard-engineering-context.backfill.existing.profile.context.find() callback` ([L135-L135](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-runtime-profile-standard-engineering-context.ts#L135-L135)) - Function
  - `tools.db.backfill-runtime-profile-standard-engineering-context.context` ([L152-L159](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-runtime-profile-standard-engineering-context.ts#L152-L159)) - Class
  - `tools.db.backfill-runtime-profile-standard-engineering-context.backfill.context.profile.context.map() callback` ([L155-L158](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/backfill-runtime-profile-standard-engineering-context.ts#L155-L158)) - Function
- [`tools/db/cleanup-legacy-diary-tuples.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/cleanup-legacy-diary-tuples.ts)
  - `tools.db.cleanup-legacy-diary-tuples.RelationTuple` ([L53-L63](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/cleanup-legacy-diary-tuples.ts#L53-L63)) - Interface
  - `tools.db.cleanup-legacy-diary-tuples.ListResponse` ([L65-L68](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/cleanup-legacy-diary-tuples.ts#L65-L68)) - Interface
  - `tools.db.cleanup-legacy-diary-tuples.listTuples` ([L72-L97](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/cleanup-legacy-diary-tuples.ts#L72-L97)) - Function
  - `tools.db.cleanup-legacy-diary-tuples.deleteTuple` ([L99-L123](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/cleanup-legacy-diary-tuples.ts#L99-L123)) - Function
  - `tools.db.cleanup-legacy-diary-tuples.main` ([L127-L172](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/cleanup-legacy-diary-tuples.ts#L127-L172)) - Function
  - `tools.db.cleanup-legacy-diary-tuples.catch() callback` ([L174-L177](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/db/cleanup-legacy-diary-tuples.ts#L174-L177)) - Function
- [`tools/src/agent-oauth-scope-backfill.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/agent-oauth-scope-backfill.ts)
  - `tools.src.agent-oauth-scope-backfill.AgentOAuthScopeBackfillResult` ([L14-L19](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/agent-oauth-scope-backfill.ts#L14-L19)) - Interface
- [`tools/src/bench-ory-connection-reuse.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bench-ory-connection-reuse.ts)
  - `tools.src.bench-ory-connection-reuse.cleanup.then() callback` ([L155-L155](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bench-ory-connection-reuse.ts#L155-L155)) - Function
  - `tools.src.bench-ory-connection-reuse.computeStats.sorted` ([L176-L176](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bench-ory-connection-reuse.ts#L176-L176)) - Class
  - `tools.src.bench-ory-connection-reuse.computeStats.sorted.sort() callback` ([L176-L176](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bench-ory-connection-reuse.ts#L176-L176)) - Function
- [`tools/src/bootstrap-genesis-agents.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bootstrap-genesis-agents.ts)
  - `tools.src.bootstrap-genesis-agents.requireEnv` ([L80-L87](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bootstrap-genesis-agents.ts#L80-L87)) - Function
  - `tools.src.bootstrap-genesis-agents.optionalEnv` ([L89-L91](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bootstrap-genesis-agents.ts#L89-L91)) - Function
  - `tools.src.bootstrap-genesis-agents.log` ([L93-L95](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bootstrap-genesis-agents.ts#L93-L95)) - Function
  - `tools.src.bootstrap-genesis-agents.main` ([L99-L236](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bootstrap-genesis-agents.ts#L99-L236)) - Function
  - `tools.src.bootstrap-genesis-agents.catch() callback` ([L238-L241](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/bootstrap-genesis-agents.ts#L238-L241)) - Function
- [`tools/src/check-pack.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-pack.ts)
  - `tools.src.check-pack.checkNoPrivateWorkspaceDeps.privateWorkspaceDeps.filter() callback` ([L157-L158](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-pack.ts#L157-L158)) - Function
  - `tools.src.check-pack.checkNoPrivateWorkspaceDeps.privateWorkspaceDeps` ([L157-L159](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/check-pack.ts#L157-L159)) - Class
- [`tools/src/eval-setup.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/eval-setup.ts)
  - `tools.src.eval-setup.waitForHealth` ([L43-L57](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/eval-setup.ts#L43-L57)) - Function
  - `tools.src.eval-setup.setup` ([L59-L169](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/eval-setup.ts#L59-L169)) - Function
  - `tools.src.eval-setup.setup.result` ([L78-L84](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/eval-setup.ts#L78-L84)) - Class
  - `tools.src.eval-setup.setup.result.log` ([L83-L83](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/eval-setup.ts#L83-L83)) - Method
  - `tools.src.eval-setup.teardown` ([L171-L175](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/eval-setup.ts#L171-L175)) - Function
  - `tools.src.eval-setup.catch() callback` ([L183-L186](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/eval-setup.ts#L183-L186)) - Function
- [`tools/src/release/go-artifact-publisher.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts)
  - `tools.src.release.go-artifact-publisher.writeChecksums.lines` ([L497-L502](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L497-L502)) - Class
  - `tools.src.release.go-artifact-publisher.writeChecksums.lines.archivePaths.map() callback` ([L497-L502](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-artifact-publisher.ts#L497-L502)) - Function
- [`tools/src/release/go-module-publisher.cli.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-module-publisher.cli.ts)
  - `tools.src.release.go-module-publisher.cli.normalizeBooleanOptionValues` ([L13-L30](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-module-publisher.cli.ts#L13-L30)) - Function
  - `tools.src.release.go-module-publisher.cli.createCliOptions` ([L32-L66](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-module-publisher.cli.ts#L32-L66)) - Function
  - `tools.src.release.go-module-publisher.cli.resolveProjectPath` ([L68-L70](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-module-publisher.cli.ts#L68-L70)) - Function
  - `tools.src.release.go-module-publisher.cli.readGoModulePath` ([L72-L80](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-module-publisher.cli.ts#L72-L80)) - Function
  - `tools.src.release.go-module-publisher.cli.findReleaseVersionFromHead` ([L82-L104](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-module-publisher.cli.ts#L82-L104)) - Function
  - `tools.src.release.go-module-publisher.cli.verifyGoProxyVersion` ([L106-L136](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-module-publisher.cli.ts#L106-L136)) - Function
  - `tools.src.release.go-module-publisher.cli.main` ([L138-L176](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-module-publisher.cli.ts#L138-L176)) - Function
  - `tools.src.release.go-module-publisher.cli.catch() callback` ([L179-L182](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-module-publisher.cli.ts#L179-L182)) - Function
- [`tools/src/release/go-version-actions.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts)
  - `tools.src.release.go-version-actions.readText` ([L43-L45](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L43-L45)) - Function
  - `tools.src.release.go-version-actions.readGoModulePath` ([L47-L58](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L47-L58)) - Function
  - `tools.src.release.go-version-actions.parseRequireLine` ([L66-L78](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L66-L78)) - Function
  - `tools.src.release.go-version-actions.findGoRequireVersion` ([L80-L110](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L80-L110)) - Function
  - `tools.src.release.go-version-actions.updateGoRequireVersions` ([L112-L163](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L112-L163)) - Function
  - `tools.src.release.go-version-actions.updateGoRequireVersions.lines` ([L119-L157](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L119-L157)) - Class
  - `tools.src.release.go-version-actions.updateGoRequireVersions.lines.map() callback` ([L119-L157](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L119-L157)) - Function
  - `tools.src.release.go-version-actions.escapeGoProxyPath` ([L165-L167](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L165-L167)) - Function
  - `tools.src.release.go-version-actions.normalizeGoModuleVersion` ([L169-L171](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L169-L171)) - Function
  - `tools.src.release.go-version-actions.sleep` ([L173-L179](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L173-L179)) - Function
  - `tools.src.release.go-version-actions.resolveGoProxyUrl` ([L181-L198](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L181-L198)) - Function
  - `tools.src.release.go-version-actions.unquoteGoPath` ([L213-L215](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L213-L215)) - Function
  - `tools.src.release.go-version-actions.parseGoWorkUseDirs` ([L217-L247](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L217-L247)) - Function
  - `tools.src.release.go-version-actions.pathExists` ([L249-L256](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L249-L256)) - Function
  - `tools.src.release.go-version-actions.createFileSystemVisitTree` ([L258-L282](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L258-L282)) - Function
  - `tools.src.release.go-version-actions.discoverGoModDirs` ([L284-L297](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L284-L297)) - Function
  - `tools.src.release.go-version-actions.discoverGoWorkspaceModules.dirs` ([L304-L308](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L304-L308)) - Class
  - `tools.src.release.go-version-actions.discoverGoWorkspaceModules.dirs.map() callback` ([L305-L306](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L305-L306)) - Function
  - `tools.src.release.go-version-actions.shouldRetryGoProxyResponse` ([L496-L498](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L496-L498)) - Function
  - `tools.src.release.go-version-actions.waitForGoProxyRetry` ([L500-L506](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L500-L506)) - Function
  - `tools.src.release.go-version-actions.createGoProxyLookupError` ([L508-L515](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L508-L515)) - Function
  - `tools.src.release.go-version-actions.readLatestVersionFromGoProxy` ([L517-L559](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L517-L559)) - Function
  - `tools.src.release.go-version-actions.readVersionFromGoProxy` ([L561-L605](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L561-L605)) - Function
  - `tools.src.release.go-version-actions.GoVersionActions` ([L731-L825](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L731-L825)) - Class
  - `tools.src.release.go-version-actions.GoVersionActions.readCurrentVersionFromSourceManifest` ([L736-L738](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L736-L738)) - Method
  - `tools.src.release.go-version-actions.GoVersionActions.readCurrentVersionFromRegistry` ([L740-L758](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L740-L758)) - Method
  - `tools.src.release.go-version-actions.GoVersionActions.readCurrentVersionOfDependency` ([L760-L783](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L760-L783)) - Method
  - `tools.src.release.go-version-actions.GoVersionActions.updateProjectVersion` ([L785-L789](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L785-L789)) - Method
  - `tools.src.release.go-version-actions.GoVersionActions.updateProjectDependencies` ([L791-L824](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/release/go-version-actions.ts#L791-L824)) - Method
- [`tools/src/talos-capability-probe.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts)
  - `tools.src.talos-capability-probe.ProbeAssertionError` ([L51-L51](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L51-L51)) - Class
  - `tools.src.talos-capability-probe.safeFailure` ([L56-L63](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L56-L63)) - Function
  - `tools.src.talos-capability-probe.expectValue` ([L65-L67](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L65-L67)) - Function
  - `tools.src.talos-capability-probe.expectRejected` ([L69-L76](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L69-L76)) - Function
  - `tools.src.talos-capability-probe.createApi` ([L78-L94](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L78-L94)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe` ([L96-L525](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L96-L525)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe` ([L112-L127](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L112-L127)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.derive` ([L129-L148](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L129-L148)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.verifyOnline` ([L150-L159](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L150-L159)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('online_verify_agent_key') callback` ([L184-L192](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L184-L192)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('agent_key_to_jwt') callback` ([L194-L213](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L194-L213)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('jwks_offline_verification') callback` ([L215-L225](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L215-L225)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('custom_claim_preservation') callback` ([L227-L237](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L227-L237)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('reserved_aud_behavior') callback` ([L239-L255](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L239-L255)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('scope_inheritance') callback` ([L257-L268](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L257-L268)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('derived_jwt_to_narrower_jwt') callback` ([L270-L279](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L270-L279)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('scope_widening_rejected') callback` ([L281-L291](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L281-L291)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('scope_widening_rejected') callback.expectRejected() callback` ([L283-L289](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L283-L289)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('child_ttl_equal_parent_request') callback` ([L293-L302](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L293-L302)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('child_ttl_greater_parent_rejected') callback` ([L304-L314](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L304-L314)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('child_ttl_greater_parent_rejected') callback.expectRejected() callback` ([L306-L312](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L306-L312)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('agent_key_to_macaroon') callback` ([L316-L325](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L316-L325)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('online_verify_jwt') callback` ([L327-L342](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L327-L342)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('online_verify_macaroon') callback` ([L344-L349](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L344-L349)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('derived_macaroon_to_jwt') callback` ([L351-L360](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L351-L360)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('derived_macaroon_to_macaroon') callback` ([L362-L371](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L362-L371)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('jwt_claim_lineage') callback` ([L373-L381](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L373-L381)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('rotation_blocks_old_parent_derivation') callback` ([L383-L412](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L383-L412)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('rotation_blocks_old_parent_derivation') callback.expectRejected() callback` ([L405-L410](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L405-L410)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('online_child_after_parent_rotation') callback` ([L414-L418](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L414-L418)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('offline_child_after_parent_rotation') callback` ([L420-L427](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L420-L427)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('revocation_blocks_new_derivation') callback` ([L437-L444](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L437-L444)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('revocation_blocks_new_derivation') callback.expectRejected() callback` ([L438-L443](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L438-L443)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('online_child_after_parent_revocation') callback` ([L447-L451](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L447-L451)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('offline_child_after_parent_revocation') callback` ([L453-L460](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L453-L460)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.observe('verification_cache_controls') callback` ([L462-L470](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L462-L470)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.jwtChaining` ([L490-L492](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L490-L492)) - Class
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.jwtChaining.observations.find() callback` ([L491-L491](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L491-L491)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.jwtV1Ready` ([L505-L507](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L505-L507)) - Class
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.jwtV1Ready.required.every() callback` ([L506-L506](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L506-L506)) - Function
  - `tools.src.talos-capability-probe.runTalosCapabilityProbe.jwtV1Ready.required.every() callback.observations.find() callback` ([L506-L506](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L506-L506)) - Function
  - `tools.src.talos-capability-probe.readOptions` ([L527-L543](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L527-L543)) - Function
  - `tools.src.talos-capability-probe.main` ([L545-L562](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/talos-capability-probe.ts#L545-L562)) - Function
- [`tools/src/tasks/api.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts)
  - `tools.src.tasks.api.MoltNetConfig` ([L6-L8](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts#L6-L8)) - Interface
  - `tools.src.tasks.api.resolveTasksApiContext` ([L17-L37](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts#L17-L37)) - Function
  - `tools.src.tasks.api.parseSetArgs` ([L39-L58](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts#L39-L58)) - Function
  - `tools.src.tasks.api.substituteTemplate` ([L60-L80](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts#L60-L80)) - Function
  - `tools.src.tasks.api.substituteTemplate.applied` ([L64-L67](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts#L64-L67)) - Class
  - `tools.src.tasks.api.substituteTemplate.applied.raw.replace() callback` ([L66-L66](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/api.ts#L66-L66)) - Function
- [`tools/src/tasks/compose-pr-review.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts)
  - `tools.src.tasks.compose-pr-review.PullRequestInfo` ([L79-L85](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L79-L85)) - Interface
  - `tools.src.tasks.compose-pr-review.ghJson` ([L87-L93](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L87-L93)) - Function
  - `tools.src.tasks.compose-pr-review.gh` ([L95-L100](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L95-L100)) - Function
  - `tools.src.tasks.compose-pr-review.getPullRequestInfo` ([L102-L130](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L102-L130)) - Function
  - `tools.src.tasks.compose-pr-review.getPullRequestInfo.commitMessages.pr.commits.map() callback` ([L124-L127](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L124-L127)) - Function
  - `tools.src.tasks.compose-pr-review.getPullRequestInfo.commitMessages.pr.commits.map() callback.filter() callback` ([L126-L126](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L126-L126)) - Function
  - `tools.src.tasks.compose-pr-review.resolveCorrelationId` ([L132-L148](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L132-L148)) - Function
  - `tools.src.tasks.compose-pr-review.ensureLegreffierMarker` ([L150-L162](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L150-L162)) - Function
  - `tools.src.tasks.compose-pr-review.updatePrBody` ([L164-L173](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L164-L173)) - Function
  - `tools.src.tasks.compose-pr-review.readRubric` ([L175-L190](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L175-L190)) - Function
  - `tools.src.tasks.compose-pr-review.readRubric.errors.map() callback` ([L185-L185](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L185-L185)) - Function
  - `tools.src.tasks.compose-pr-review.validateInput` ([L192-L202](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L192-L202)) - Function
  - `tools.src.tasks.compose-pr-review.validateInput.errors.map() callback` ([L198-L198](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L198-L198)) - Function
  - `tools.src.tasks.compose-pr-review.buildPrReviewInput` ([L204-L233](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L204-L233)) - Function
  - `tools.src.tasks.compose-pr-review.main` ([L235-L258](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/tasks/compose-pr-review.ts#L235-L258)) - Function
- [`tools/src/test-smtp.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts)
  - `tools.src.test-smtp.SmtpClient.auth.capabilities` ([L110-L110](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L110-L110)) - Class
  - `tools.src.test-smtp.SmtpClient.auth.capabilities.map() callback` ([L110-L110](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L110-L110)) - Function
  - `tools.src.test-smtp.SmtpClient.openSocket.<function>.socket.tls.connect() callback` ([L189-L189](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L189-L189)) - Function
  - `tools.src.test-smtp.SmtpClient.openSocket.<function>.socket.net.connect() callback` ([L195-L196](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L195-L196)) - Function
  - `tools.src.test-smtp.SmtpClient.openSocket.<function>.socket` ([L195-L197](https://github.com/getlarge/themoltnet/blob/main/.codeboardingtools/src/test-smtp.ts#L195-L197)) - Class


### Governance State Archive Manager
This is the core engine for state persistence. It handles the extraction of identity and governance data from Ory services, bundles them into archives, and applies cryptographic protection to ensure the confidentiality of the governance state during transit or storage.


**Related Classes/Methods**:

- `infra.ory.backup.createArchive`:414-431
- `infra.ory.backup.encryptArchive`:433-452
- `infra.ory.backup.exportJson`:394-399
- `infra.ory.backup.buildOryEnv`:142-156



**Source Files:**

- [`infra/axiom/dashboards/apply.mjs`](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/axiom/dashboards/apply.mjs)
  - `infra.axiom.dashboards.apply.plan.uidsInOrg` ([L69-L71](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/axiom/dashboards/apply.mjs#L69-L71)) - Class
  - `infra.axiom.dashboards.apply.plan.uidsInOrg.existing.map() callback` ([L70-L70](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/axiom/dashboards/apply.mjs#L70-L70)) - Function
- [`infra/axiom/monitors/apply.mjs`](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/axiom/monitors/apply.mjs)
  - `infra.axiom.monitors.apply.notifierIds` ([L19-L22](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/axiom/monitors/apply.mjs#L19-L22)) - Class
  - `infra.axiom.monitors.apply.notifierIds.map() callback` ([L21-L21](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/axiom/monitors/apply.mjs#L21-L21)) - Function
- [`infra/ory/backup.mjs`](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs)
  - `infra.ory.backup.fatal` ([L40-L43](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L40-L43)) - Function
  - `infra.ory.backup.log` ([L45-L47](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L45-L47)) - Function
  - `infra.ory.backup.parseArgs` ([L49-L110](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L49-L110)) - Function
  - `infra.ory.backup.parseArgs.envJwkSetIds` ([L103-L106](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L103-L106)) - Class
  - `infra.ory.backup.parseArgs.envJwkSetIds.map() callback` ([L105-L105](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L105-L105)) - Function
  - `infra.ory.backup.printHelp` ([L112-L130](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L112-L130)) - Function
  - `infra.ory.backup.timestamp` ([L132-L134](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L132-L134)) - Function
  - `infra.ory.backup.requireEnv` ([L136-L140](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L136-L140)) - Function
  - `infra.ory.backup.buildOryEnv` ([L142-L156](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L142-L156)) - Function
  - `infra.ory.backup.sleep` ([L158-L160](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L158-L160)) - Function
  - `infra.ory.backup.extractCommandFailure` ([L162-L187](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L162-L187)) - Function
  - `infra.ory.backup.isTransientOryFailure` ([L189-L206](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L189-L206)) - Function
  - `infra.ory.backup.isTransientOryFailure.some() callback` ([L205-L205](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L205-L205)) - Function
  - `infra.ory.backup.runOry` ([L208-L237](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L208-L237)) - Function
  - `infra.ory.backup.ensureDir` ([L239-L241](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L239-L241)) - Function
  - `infra.ory.backup.ensureSafeOutputDir` ([L243-L257](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L243-L257)) - Function
  - `infra.ory.backup.writeJson` ([L259-L261](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L259-L261)) - Function
  - `infra.ory.backup.parseJson` ([L263-L269](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L263-L269)) - Function
  - `infra.ory.backup.extractItems` ([L271-L297](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L271-L297)) - Function
  - `infra.ory.backup.extractItems.maybeSingleResourceKeys.some() callback` ([L276-L276](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L276-L276)) - Function
  - `infra.ory.backup.extractNextPageToken` ([L299-L310](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L299-L310)) - Function
  - `infra.ory.backup.listAllPages` ([L312-L358](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L312-L358)) - Function
  - `infra.ory.backup.chunk` ([L360-L366](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L360-L366)) - Function
  - `infra.ory.backup.fetchDetailedResources` ([L368-L392](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L368-L392)) - Function
  - `infra.ory.backup.exportJson` ([L394-L399](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L394-L399)) - Function
  - `infra.ory.backup.encryptBundleMetadata` ([L401-L412](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L401-L412)) - Function
  - `infra.ory.backup.createArchive` ([L414-L431](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L414-L431)) - Function
  - `infra.ory.backup.encryptArchive` ([L433-L452](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L433-L452)) - Function
  - `infra.ory.backup.main` ([L454-L652](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L454-L652)) - Function
  - `infra.ory.backup.main.identityIds` ([L514-L516](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L514-L516)) - Class
  - `infra.ory.backup.main.identityIds.identityPages.items.map() callback` ([L515-L515](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L515-L515)) - Function
  - `infra.ory.backup.main.identityIds.filter() callback` ([L516-L516](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L516-L516)) - Function
  - `infra.ory.backup.main.clientIds` ([L544-L546](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L544-L546)) - Class
  - `infra.ory.backup.main.clientIds.clientPages.items.map() callback` ([L545-L545](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L545-L545)) - Function
  - `infra.ory.backup.main.clientIds.filter() callback` ([L546-L546](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L546-L546)) - Function
  - `infra.ory.backup.catch() callback` ([L654-L655](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/backup.mjs#L654-L655)) - Function
- [`infra/ory/deploy.mjs`](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/deploy.mjs)
  - `infra.ory.deploy.env` ([L34-L38](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/deploy.mjs#L34-L38)) - Function
  - `infra.ory.deploy.log` ([L40-L42](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/deploy.mjs#L40-L42)) - Function
  - `infra.ory.deploy.fatal` ([L44-L47](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/deploy.mjs#L44-L47)) - Function
  - `infra.ory.deploy.oryEnv` ([L49-L57](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/deploy.mjs#L49-L57)) - Function
  - `infra.ory.deploy.ory` ([L59-L65](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/deploy.mjs#L59-L65)) - Function
  - `infra.ory.deploy.oryStdout` ([L67-L72](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/deploy.mjs#L67-L72)) - Function
  - `infra.ory.deploy.missing` ([L114-L114](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/deploy.mjs#L114-L114)) - Class
  - `infra.ory.deploy.missing.TEMPLATE_VARS.filter() callback` ([L114-L114](https://github.com/getlarge/themoltnet/blob/main/.codeboardinginfra/ory/deploy.mjs#L114-L114)) - Function
- [`packages/agent-daemon-action/src/create-task.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/create-task.ts)
  - `packages.agent-daemon-action.src.create-task.FulfillTaskInput` ([L32-L63](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/create-task.ts#L32-L63)) - Interface
  - `packages.agent-daemon-action.src.create-task.createTask` ([L65-L92](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/create-task.ts#L65-L92)) - Function
  - `packages.agent-daemon-action.src.create-task.AssessTaskInput` ([L94-L119](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/create-task.ts#L94-L119)) - Interface
  - `packages.agent-daemon-action.src.create-task.createAssessTask` ([L121-L149](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/create-task.ts#L121-L149)) - Function
- [`packages/agent-daemon-action/src/dispatch.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts)
  - `packages.agent-daemon-action.src.dispatch.IssueCommentContext` ([L34-L46](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L34-L46)) - Interface
  - `packages.agent-daemon-action.src.dispatch.DispatchContext` ([L48-L52](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L48-L52)) - Interface
  - `packages.agent-daemon-action.src.dispatch.dispatch` ([L70-L126](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L70-L126)) - Function
  - `packages.agent-daemon-action.src.dispatch.parseRunningTimeout` ([L140-L151](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L140-L151)) - Function
  - `packages.agent-daemon-action.src.dispatch.parseMaxAttempts` ([L153-L164](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L153-L164)) - Function
  - `packages.agent-daemon-action.src.dispatch.parseTaskTags` ([L166-L190](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L166-L190)) - Function
  - `packages.agent-daemon-action.src.dispatch.parseTaskTags.tags` ([L170-L179](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L170-L179)) - Class
  - `packages.agent-daemon-action.src.dispatch.parseTaskTags.tags.map() callback` ([L174-L174](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L174-L174)) - Function
  - `packages.agent-daemon-action.src.dispatch.parseTaskTags.tags.filter() callback` ([L175-L175](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L175-L175)) - Function
  - `packages.agent-daemon-action.src.dispatch.parseTaskTags.tags.reduce() callback` ([L177-L177](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L177-L177)) - Function
  - `packages.agent-daemon-action.src.dispatch.parseTaskTags.oversized` ([L185-L185](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L185-L185)) - Class
  - `packages.agent-daemon-action.src.dispatch.parseTaskTags.oversized.tags.find() callback` ([L185-L185](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L185-L185)) - Function
  - `packages.agent-daemon-action.src.dispatch.dispatchFulfill` ([L192-L231](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L192-L231)) - Function
  - `packages.agent-daemon-action.src.dispatch.dispatchFulfill.correlationId` ([L204-L211](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L204-L211)) - Class
  - `packages.agent-daemon-action.src.dispatch.dispatchFulfill.correlationId.randomUUID` ([L208-L208](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L208-L208)) - Method
  - `packages.agent-daemon-action.src.dispatch.dispatchAssess` ([L233-L325](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L233-L325)) - Function
  - `packages.agent-daemon-action.src.dispatch.dispatchAssess.correlationId` ([L248-L255](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L248-L255)) - Class
  - `packages.agent-daemon-action.src.dispatch.dispatchAssess.correlationId.randomUUID` ([L252-L252](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L252-L252)) - Method
  - `packages.agent-daemon-action.src.dispatch.dispatchAssess.fulfill` ([L268-L268](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L268-L268)) - Class
  - `packages.agent-daemon-action.src.dispatch.dispatchAssess.fulfill.list.items.find() callback` ([L268-L268](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L268-L268)) - Function
  - `packages.agent-daemon-action.src.dispatch.dispatchAssess.accepted` ([L291-L293](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L291-L293)) - Class
  - `packages.agent-daemon-action.src.dispatch.dispatchAssess.accepted.attempts.find() callback` ([L292-L292](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L292-L292)) - Function
  - `packages.agent-daemon-action.src.dispatch.extractContext` ([L327-L348](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L327-L348)) - Function
  - `packages.agent-daemon-action.src.dispatch.required` ([L350-L356](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L350-L356)) - Function
  - `packages.agent-daemon-action.src.dispatch.nxLogger` ([L358-L365](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L358-L365)) - Function
  - `packages.agent-daemon-action.src.dispatch.nxLogger.info` ([L360-L361](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L360-L361)) - Method
  - `packages.agent-daemon-action.src.dispatch.nxLogger.warn` ([L362-L363](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L362-L363)) - Method
  - `packages.agent-daemon-action.src.dispatch.prStubGh` ([L367-L379](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L367-L379)) - Function
  - `packages.agent-daemon-action.src.dispatch.prStubGh.getPrHeadRef` ([L369-L371](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L369-L371)) - Method
  - `packages.agent-daemon-action.src.dispatch.prStubGh.getPrCommitMessages` ([L372-L374](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L372-L374)) - Method
  - `packages.agent-daemon-action.src.dispatch.prStubGh.getPrBody` ([L375-L377](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L375-L377)) - Method
  - `packages.agent-daemon-action.src.dispatch.ghBackedBy` ([L381-L413](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L381-L413)) - Function
  - `packages.agent-daemon-action.src.dispatch.postPrComment` ([L415-L426](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/dispatch.ts#L415-L426)) - Function
- [`packages/agent-daemon-action/src/main.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/main.ts)
  - `packages.agent-daemon-action.src.main.main` ([L16-L36](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/main.ts#L16-L36)) - Function
  - `packages.agent-daemon-action.src.main.catch() callback` ([L38-L41](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/main.ts#L38-L41)) - Function
- [`packages/agent-daemon-action/src/parse-mention.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/parse-mention.ts)
  - `packages.agent-daemon-action.src.parse-mention.ParseInput` ([L25-L28](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/parse-mention.ts#L25-L28)) - Interface
  - `packages.agent-daemon-action.src.parse-mention.parseMention` ([L32-L54](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/parse-mention.ts#L32-L54)) - Function
- [`packages/agent-daemon-action/src/resolve-correlation.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/resolve-correlation.ts)
  - `packages.agent-daemon-action.src.resolve-correlation.PrCoords` ([L26-L30](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/resolve-correlation.ts#L26-L30)) - Interface
  - `packages.agent-daemon-action.src.resolve-correlation.ResolveInput` ([L32-L37](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/resolve-correlation.ts#L32-L37)) - Interface
  - `packages.agent-daemon-action.src.resolve-correlation.ResolveDeps` ([L39-L50](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/resolve-correlation.ts#L39-L50)) - Interface
  - `packages.agent-daemon-action.src.resolve-correlation.resolveCorrelation` ([L52-L94](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/agent-daemon-action/src/resolve-correlation.ts#L52-L94)) - Function
- [`packages/cli/install.js`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/cli/install.js)
  - `packages.cli.install.getBinaryName` ([L13-L15](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/cli/install.js#L13-L15)) - Function
  - `packages.cli.install.getPlatformPackageName` ([L17-L19](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/cli/install.js#L17-L19)) - Function
  - `packages.cli.install.resolvePlatformPackage` ([L21-L35](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/cli/install.js#L21-L35)) - Function
  - `packages.cli.install.tryPlatformPackage` ([L40-L63](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/cli/install.js#L40-L63)) - Function
  - `packages.cli.install.fetch` ([L65-L95](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/cli/install.js#L65-L95)) - Function
  - `packages.cli.install.fetch.<function>` ([L66-L94](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/cli/install.js#L66-L94)) - Function
  - `packages.cli.install.fetch.<function>.then() callback` ([L78-L84](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/cli/install.js#L78-L84)) - Function
  - `packages.cli.install.fetch.<function>.catch() callback` ([L86-L93](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/cli/install.js#L86-L93)) - Function
  - `packages.cli.install.downloadFromNpm` ([L100-L139](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/cli/install.js#L100-L139)) - Function
  - `packages.cli.install.main` ([L141-L157](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/cli/install.js#L141-L157)) - Function
- [`packages/github-agent/src/bot-user.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/bot-user.ts)
  - `packages.github-agent.src.bot-user.LookupBotUserOptions` ([L3-L10](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/bot-user.ts#L3-L10)) - Interface
  - `packages.github-agent.src.bot-user.lookupBotUser` ([L22-L52](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/bot-user.ts#L22-L52)) - Function
  - `packages.github-agent.src.bot-user.buildBotEmail` ([L58-L60](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/bot-user.ts#L58-L60)) - Function
- [`packages/github-agent/src/credential-helper.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/credential-helper.ts)
  - `packages.github-agent.src.credential-helper.credentialHelper` ([L11-L29](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/credential-helper.ts#L11-L29)) - Function
- [`packages/github-agent/src/git-setup.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/git-setup.ts)
  - `packages.github-agent.src.git-setup.setupGitIdentity` ([L12-L78](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/git-setup.ts#L12-L78)) - Function
- [`packages/github-agent/src/setup.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/setup.ts)
  - `packages.github-agent.src.setup.SetupGitHubAgentOptions` ([L8-L15](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/setup.ts#L8-L15)) - Interface
  - `packages.github-agent.src.setup.SetupGitHubAgentResult` ([L17-L23](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/setup.ts#L17-L23)) - Interface
  - `packages.github-agent.src.setup.setupGitHubAgent` ([L35-L95](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/setup.ts#L35-L95)) - Function
- [`packages/github-agent/src/token.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/token.ts)
  - `packages.github-agent.src.token.createAppJWT` ([L8-L22](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/token.ts#L8-L22)) - Function
  - `packages.github-agent.src.token.TokenCache` ([L24-L27](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/token.ts#L24-L27)) - Interface
  - `packages.github-agent.src.token.readTokenCache` ([L35-L48](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/token.ts#L35-L48)) - Function
  - `packages.github-agent.src.token.writeTokenCache` ([L53-L64](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/token.ts#L53-L64)) - Function
  - `packages.github-agent.src.token.AppInstallation` ([L71-L75](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/token.ts#L71-L75)) - Interface
  - `packages.github-agent.src.token.findInstallationForOwner` ([L84-L130](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/token.ts#L84-L130)) - Function
  - `packages.github-agent.src.token.parseNextLinkHeader` ([L132-L138](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/token.ts#L132-L138)) - Function
  - `packages.github-agent.src.token.getInstallationToken` ([L140-L186](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/github-agent/src/token.ts#L140-L186)) - Function
- [`packages/legreffier-cli/src/api.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/api.ts)
  - `packages.legreffier-cli.src.api.toErrorMessage.fieldErrors` ([L45-L47](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/api.ts#L45-L47)) - Class
  - `packages.legreffier-cli.src.api.toErrorMessage.fieldErrors.err.errors.map() callback` ([L46-L46](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/api.ts#L46-L46)) - Function
- [`packages/legreffier-cli/src/env-file.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/env-file.ts)
  - `packages.legreffier-cli.src.env-file.writeEnvFile.managedKeys` ([L67-L67](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/env-file.ts#L67-L67)) - Class
  - `packages.legreffier-cli.src.env-file.writeEnvFile.managedKeys.managedEntries.map() callback` ([L67-L67](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/env-file.ts#L67-L67)) - Function
- [`packages/legreffier-cli/src/phases/installation.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/phases/installation.ts)
  - `packages.legreffier-cli.src.phases.installation.runInstallationPhase.result.pollUntil() callback` ([L36-L37](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/phases/installation.ts#L36-L37)) - Function
  - `packages.legreffier-cli.src.phases.installation.runInstallationPhase.result` ([L36-L38](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/phases/installation.ts#L36-L38)) - Class
- [`packages/legreffier-cli/src/setup.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/setup.ts)
  - `packages.legreffier-cli.src.setup.writeSettingsLocal.mergedAllow` ([L636-L639](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/setup.ts#L636-L639)) - Class
  - `packages.legreffier-cli.src.setup.writeSettingsLocal.mergedAllow.newPerms.filter() callback` ([L638-L638](https://github.com/getlarge/themoltnet/blob/main/.codeboardingpackages/legreffier-cli/src/setup.ts#L638-L638)) - Function
- [`vite.shared.ts`](https://github.com/getlarge/themoltnet/blob/main/.codeboardingvite.shared.ts)
  - `vite.shared.PackageManifest` ([L4-L8](https://github.com/getlarge/themoltnet/blob/main/.codeboardingvite.shared.ts#L4-L8)) - Interface
  - `vite.shared.externalizeInstallableDependencies` ([L16-L50](https://github.com/getlarge/themoltnet/blob/main/.codeboardingvite.shared.ts#L16-L50)) - Function
  - `vite.shared.externalizeInstallableDependencies.packageNames` ([L22-L26](https://github.com/getlarge/themoltnet/blob/main/.codeboardingvite.shared.ts#L22-L26)) - Class
  - `vite.shared.externalizeInstallableDependencies.packageNames.filter() callback` ([L26-L26](https://github.com/getlarge/themoltnet/blob/main/.codeboardingvite.shared.ts#L26-L26)) - Function
  - `vite.shared.externalizeInstallableDependencies.<function>` ([L28-L49](https://github.com/getlarge/themoltnet/blob/main/.codeboardingvite.shared.ts#L28-L49)) - Function




### [FAQ](https://github.com/CodeBoarding/GeneratedOnBoardings/tree/main?tab=readme-ov-file#faq)