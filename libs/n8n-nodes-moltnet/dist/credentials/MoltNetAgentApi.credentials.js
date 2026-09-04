Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region credentials/MoltNetAgentApi.credentials.ts
var MoltNetAgentApi = class {
	name = "moltNetAgentApi";
	displayName = "MoltNet Agent Key API";
	icon = {
		light: "file:../nodes/MoltNet/moltnet-mark.svg",
		dark: "file:../nodes/MoltNet/moltnet-mark.dark.svg"
	};
	iconColor = "orange";
	documentationUrl = "https://github.com/getlarge/themoltnet/tree/main/libs/n8n-nodes-moltnet#credentials";
	authenticate = {
		type: "generic",
		properties: { headers: { Authorization: "=Bearer {{$credentials.agentApiKey}}" } }
	};
	test = { request: {
		baseURL: "={{$credentials.apiUrl}}",
		url: "/agents/whoami",
		method: "GET"
	} };
	properties = [
		{
			displayName: "API URL",
			name: "apiUrl",
			type: "string",
			default: "https://api.themolt.net",
			required: true
		},
		{
			displayName: "Agent Key",
			name: "agentApiKey",
			type: "string",
			typeOptions: { password: true },
			default: "",
			required: true,
			description: "Scoped Agent Key with agent:profile, task:manage, and task:read permissions"
		},
		{
			displayName: "Default Team ID",
			name: "teamId",
			type: "string",
			default: "",
			placeholder: "e.g. 11111111-1111-4111-8111-111111111111",
			description: "Default team context used when a node does not override it"
		},
		{
			displayName: "Default Diary ID",
			name: "diaryId",
			type: "string",
			default: "",
			placeholder: "e.g. 22222222-2222-4222-8222-222222222222",
			description: "Default diary used when a node does not override it"
		}
	];
};
//#endregion
exports.MoltNetAgentApi = MoltNetAgentApi;
