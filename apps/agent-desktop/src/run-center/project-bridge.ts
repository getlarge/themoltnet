import type {
  AgentServerProjectLocation,
  ListNativeProjectLocationsResponse,
  SaveNativeProjectLocationData,
} from '@moltnet/agent-daemon-api-client';
import { invoke } from '@tauri-apps/api/core';

export type ProjectLocation = AgentServerProjectLocation;
export type SaveProjectLocationInput = NonNullable<
  SaveNativeProjectLocationData['body']
>;

export interface ProjectActions {
  list(): Promise<ListNativeProjectLocationsResponse>;
  save(input: SaveProjectLocationInput): Promise<ProjectLocation>;
  remove(name: string): Promise<void>;
  chooseFolder(): Promise<string | null>;
}

/** Native code owns the control grant and folder selection. */
export const projectActions: ProjectActions = {
  list: () => invoke('desktop_project_locations'),
  save: (input) => invoke('desktop_save_project_location', { input }),
  remove: (name) => invoke('desktop_remove_project_location', { name }),
  chooseFolder: () => invoke('desktop_choose_project_folder'),
};
