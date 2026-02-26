import type { StepKey, StepStatus, UIAction, UIState } from './types.js';

export const initialSteps: Record<StepKey, StepStatus> = {
  keypair: 'pending',
  register: 'pending',
  githubApp: 'pending',
  gitSetup: 'pending',
  installation: 'pending',
  skills: 'pending',
  settings: 'pending',
};

export function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'step':
      return {
        ...state,
        steps: { ...state.steps, [action.key]: action.status },
      };
    case 'phase':
      return { ...state, phase: action.phase };
    case 'fingerprint':
      return { ...state, fingerprint: action.fingerprint };
    case 'appSlug':
      return { ...state, appSlug: action.appSlug };
    case 'serverStatus':
      return { ...state, serverStatus: action.status };
    case 'manifestFormUrl':
      return { ...state, manifestFormUrl: action.url };
    case 'installationUrl':
      return { ...state, installationUrl: action.url };
    case 'summary':
      return { ...state, summary: action.summary };
    case 'error':
      return { ...state, phase: 'error', errorMessage: action.message };
    default:
      return state;
  }
}
