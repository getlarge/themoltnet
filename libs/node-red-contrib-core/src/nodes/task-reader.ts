import {
  type ArtifactFilter,
  createResultReader,
  type ReferenceRole,
  TaskResultError,
} from '@themoltnet/sdk';
import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { TaskSnapshot } from './task-snapshot.js';

/**
 * `moltnet-task-reader` — turns a completed task snapshot (from
 * `moltnet-task-wait`/`moltnet-task-get`) into typed, parsed result data via
 * the SDK result reader. Emits the typed output on `msg.payload` and a flat
 * `msg.result` carrying a pre-computed `outputRef` (taskId+outputCid+role)
 * ready for a downstream `moltnet-task-builder` to chain on. Pure transform.
 */

interface TaskReaderDef extends NodeDef {
  source?: string;
  role?: ReferenceRole;
  artifactKind?: string;
  artifactTitle?: string;
}

const init: NodeInitializer = (RED): void => {
  function TaskReaderNode(this: Node, def: TaskReaderDef): void {
    RED.nodes.createNode(this, def);

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      try {
        const sourcePath =
          def.source && def.source.length > 0 ? def.source : 'payload';
        const snapshot = RED.util.getMessageProperty(msg, sourcePath) as
          | TaskSnapshot
          | undefined;
        if (!snapshot || !snapshot.task || !snapshot.attempt) {
          throw new TaskResultError([
            {
              field: 'payload',
              message: 'no task snapshot found on the message',
            },
          ]);
        }

        const reader = createResultReader(snapshot.task, snapshot.attempt);
        const role: ReferenceRole = def.role ?? 'context';

        const filter: ArtifactFilter | undefined = def.artifactKind
          ? def.artifactTitle
            ? { kind: def.artifactKind, title: def.artifactTitle }
            : def.artifactKind
          : undefined;

        let artifactBody: unknown;
        const artifact = filter ? reader.artifact(filter) : undefined;
        if (filter && artifact && typeof artifact.body === 'string') {
          try {
            artifactBody = JSON.parse(artifact.body) as unknown;
          } catch {
            artifactBody = undefined;
          }
        }

        const out = RED.util.cloneMessage(msg);
        out.payload = reader.output;
        out.result = {
          summary: reader.summary,
          outputRef: reader.outputRef(role),
          artifact,
          artifactBody,
          accepted: reader.accepted,
          usage: reader.usage,
        };
        this.status({ fill: 'green', shape: 'dot', text: 'read' });
        send(out);
        done();
      } catch (err) {
        this.status({ fill: 'red', shape: 'ring', text: 'error' });
        const e =
          err instanceof TaskResultError
            ? new Error(err.message)
            : err instanceof Error
              ? err
              : new Error(String(err));
        done(e);
      }
    });
  }

  RED.nodes.registerType('moltnet-task-reader', TaskReaderNode);
};

export default init;
