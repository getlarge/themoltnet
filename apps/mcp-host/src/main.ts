import './styles.css';

import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';

import { readHostConfig } from './config.js';
import {
  callTool,
  connectToServer,
  mountToolUi,
  type ServerInfo,
} from './implementation.js';

const config = readHostConfig();

function requiredElement<T extends Element>(
  selector: string,
  typeName: string,
): T {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Missing required ${typeName}: ${selector}`);
  }
  return element as T;
}

document.body.innerHTML = `
  <main class="layout">
    <header class="header">
      <div>
        <p class="eyebrow">MCP Host E2E</p>
        <h1>Basic Host Fixture</h1>
      </div>
      <p id="status" class="status">idle</p>
    </header>

    <section class="panel controls">
      <label>
        <span>Server</span>
        <select id="server"></select>
      </label>
      <label>
        <span>Tool</span>
        <select id="tool"></select>
      </label>
      <label class="wide">
        <span>Arguments (JSON)</span>
        <textarea id="args" rows="10"></textarea>
      </label>
      <div class="actions">
        <button id="connect" type="button">Connect</button>
        <button id="run" type="button">Run tool</button>
      </div>
    </section>

    <section class="panel">
      <div class="section-header">
        <h2>Bridge State</h2>
        <span id="app-state" class="status">not-mounted</span>
      </div>
      <iframe id="app-frame" title="MCP app frame" hidden></iframe>
    </section>

    <section class="panel">
      <div class="section-header">
        <h2>Tool Result</h2>
      </div>
      <pre id="result"></pre>
    </section>
  </main>
`;

const statusNode = requiredElement<HTMLElement>('#status', 'status node');
const appStateNode = requiredElement<HTMLElement>(
  '#app-state',
  'app state node',
);
const serverSelect = requiredElement<HTMLSelectElement>(
  '#server',
  'server select',
);
const toolSelect = requiredElement<HTMLSelectElement>('#tool', 'tool select');
const argsInput = requiredElement<HTMLTextAreaElement>(
  '#args',
  'arguments textarea',
);
const resultNode = requiredElement<HTMLElement>('#result', 'result node');
const iframe = requiredElement<HTMLIFrameElement>('#app-frame', 'app iframe');
const connectButton = requiredElement<HTMLButtonElement>(
  '#connect',
  'connect button',
);
const runButton = requiredElement<HTMLButtonElement>('#run', 'run button');

let currentBridge: AppBridge | undefined;
let currentServer: ServerInfo | undefined;

function setStatus(value: string) {
  statusNode.textContent = value;
}

function setAppState(value: string) {
  appStateNode.textContent = value;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  if (config.clientId) {
    headers['X-Client-Id'] = config.clientId;
  }
  if (config.clientSecret) {
    headers['X-Client-Secret'] = config.clientSecret;
  }

  return headers;
}

function renderServerOptions() {
  serverSelect.innerHTML = '';
  for (const server of config.servers) {
    const option = document.createElement('option');
    option.value = server;
    option.textContent = server;
    serverSelect.append(option);
  }
}

function renderToolOptions(serverInfo: ServerInfo) {
  toolSelect.innerHTML = '';
  for (const name of Array.from(serverInfo.tools.keys()).sort()) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    toolSelect.append(option);
  }

  if (serverInfo.tools.has(config.defaultTool)) {
    toolSelect.value = config.defaultTool;
  }
}

async function connect() {
  setStatus('connecting');
  currentServer = await connectToServer(serverSelect.value, authHeaders());
  renderToolOptions(currentServer);
  setStatus(`connected:${currentServer.name}`);
}

function parsedArguments(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(argsInput.value);
  return parsed && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>)
    : {};
}

async function runSelectedTool() {
  if (!currentServer) {
    await connect();
  }
  if (!currentServer) {
    throw new Error('MCP server connection unavailable');
  }

  setStatus('running');
  setAppState('not-mounted');
  resultNode.textContent = 'Waiting for tool result...';

  if (currentBridge) {
    await currentBridge.close();
    currentBridge = undefined;
  }

  iframe.hidden = true;
  iframe.removeAttribute('src');
  iframe.style.width = '100%';
  // Start small; mountToolUi's autoResize grows it to the app's reported
  // content height. Avoids a tall white box that then collapses on first paint.
  iframe.style.height = '';

  const toolCall = callTool(currentServer, toolSelect.value, parsedArguments());
  if (toolCall.appResourcePromise) {
    iframe.hidden = false;
    currentBridge = await mountToolUi(toolCall, iframe, config.sandboxBaseUrl, {
      onStatus: setAppState,
    });
  }

  const result = await toolCall.resultPromise;
  resultNode.textContent = JSON.stringify(result, null, 2);
  setStatus('completed');
}

renderServerOptions();
argsInput.value = JSON.stringify(config.defaultArgs, null, 2);

connectButton.addEventListener('click', () => {
  void connect().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : String(error));
  });
});

runButton.addEventListener('click', () => {
  void runSelectedTool().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : String(error));
    resultNode.textContent = String(error);
  });
});

if (config.autorun) {
  void runSelectedTool().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : String(error));
    resultNode.textContent = String(error);
  });
}
