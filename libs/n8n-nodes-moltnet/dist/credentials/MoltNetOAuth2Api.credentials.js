Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region credentials/MoltNetOAuth2Api.credentials.ts
var MoltNetOAuth2Api = class {
	name = "moltNetOAuth2Api";
	extends = ["oAuth2Api"];
	displayName = "MoltNet OAuth2 API";
	icon = {
		light: "file:../nodes/MoltNet/moltnet-mark.svg",
		dark: "file:../nodes/MoltNet/moltnet-mark.dark.svg"
	};
	iconColor = "orange";
	documentationUrl = "https://github.com/getlarge/themoltnet/tree/main/libs/n8n-nodes-moltnet#credentials";
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
			required: true,
			description: "MoltNet API URL without a trailing slash"
		},
		{
			displayName: "Grant Type",
			name: "grantType",
			type: "hidden",
			default: "clientCredentials"
		},
		{
			displayName: "Access Token URL",
			name: "accessTokenUrl",
			type: "hidden",
			default: "={{$self[\"apiUrl\"]}}/oauth2/token",
			required: true
		},
		{
			displayName: "Auth URI Query Parameters",
			name: "authQueryParameters",
			type: "hidden",
			default: ""
		},
		{
			displayName: "Scope",
			name: "scope",
			type: "hidden",
			default: ""
		},
		{
			displayName: "Authentication",
			name: "authentication",
			type: "hidden",
			default: "body"
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
exports.MoltNetOAuth2Api = MoltNetOAuth2Api;
