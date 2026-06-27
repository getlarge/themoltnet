const { join } = require('node:path');
const { VersionActions } = require('nx/release');

function readText(tree, path) {
  const value = tree.read(path, 'utf-8');
  if (typeof value === 'string') {
    return value;
  }
  return value ? value.toString('utf-8') : null;
}

function readGoModulePath(tree, projectRoot) {
  const goModPath = join(projectRoot, 'go.mod');
  const goMod = readText(tree, goModPath);
  const match = goMod?.match(/^module\s+(\S+)/m);
  if (!match) {
    throw new Error(`Unable to read Go module path from ${goModPath}`);
  }
  return match[1];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class GoVersionActions extends VersionActions {
  validManifestFilenames = ['go.mod'];

  async readCurrentVersionFromSourceManifest() {
    return null;
  }

  async readCurrentVersionFromRegistry() {
    return null;
  }

  async readCurrentVersionOfDependency(tree, projectGraph, dependencyProjectName) {
    const goModPath = join(this.projectGraphNode.data.root, 'go.mod');
    const goMod = readText(tree, goModPath);
    if (!goMod) {
      return { currentVersion: null, dependencyCollection: null };
    }

    const dependencyRoot = projectGraph.nodes[dependencyProjectName]?.data.root;
    if (!dependencyRoot) {
      return { currentVersion: null, dependencyCollection: null };
    }

    const modulePath = readGoModulePath(tree, dependencyRoot);
    const pattern = new RegExp(`^\\s*${escapeRegExp(modulePath)}\\s+(v\\S+)`, 'm');
    const match = goMod.match(pattern);

    return {
      currentVersion: match?.[1] ?? null,
      dependencyCollection: match ? 'require' : null,
    };
  }

  async updateProjectVersion() {
    return [
      `Go module ${this.projectGraphNode.name} is versioned by git tags; go.mod has no project version field.`,
    ];
  }

  async updateProjectDependencies(tree, projectGraph, dependenciesToUpdate) {
    const entries = Object.entries(dependenciesToUpdate);
    if (entries.length === 0) {
      return [];
    }

    const goModPath = join(this.projectGraphNode.data.root, 'go.mod');
    let goMod = readText(tree, goModPath);
    if (!goMod) {
      return [];
    }

    const updated = [];
    for (const [dependencyProjectName, rawVersion] of entries) {
      const dependencyRoot = projectGraph.nodes[dependencyProjectName]?.data.root;
      if (!dependencyRoot) {
        continue;
      }

      const modulePath = readGoModulePath(tree, dependencyRoot);
      const version = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`;
      const pattern = new RegExp(
        `^(\\s*${escapeRegExp(modulePath)}\\s+)v\\S+(.*)$`,
        'm',
      );

      if (!pattern.test(goMod)) {
        continue;
      }

      goMod = goMod.replace(pattern, `$1${version}$2`);
      updated.push(`${modulePath}@${version}`);
    }

    if (updated.length === 0) {
      return [];
    }

    tree.write(goModPath, goMod);
    return [`Updated ${updated.join(', ')} in ${goModPath}`];
  }
}

module.exports = GoVersionActions;
module.exports.default = GoVersionActions;
