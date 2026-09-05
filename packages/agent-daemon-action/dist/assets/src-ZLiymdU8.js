import { r as __toESM } from "../main.js";
//#region ../../libs/os-keyring/src/provider.ts
var MOLTNET_SECRET_SERVICE = "themolt.net";
var OS_KEYRING_SECRET_PROVIDER = "os-keyring";
var GO_KEYRING_BASE64_PREFIX = "go-keyring-base64:";
var SUPPORTED_PLATFORMS = new Set([
	"darwin",
	"linux",
	"win32"
]);
var OSKeyringSecretProvider = class {
	name = OS_KEYRING_SECRET_PROVIDER;
	capabilities = Object.freeze({
		read: true,
		write: true,
		delete: true
	});
	keytarPromise;
	constructor(platform = process.platform, loadKeytar = loadNativeKeytar) {
		this.platform = platform;
		this.loadKeytar = loadKeytar;
	}
	async read(key) {
		this.assertSupported();
		const value = await (await this.keytar()).getPassword(MOLTNET_SECRET_SERVICE, key);
		if (value === null || this.platform !== "darwin") return value;
		return decodeGoKeyringPassword(value);
	}
	/**
	* Store in the exact form `zalando/go-keyring` writes on each platform so
	* the Go CLI reads Node-written secrets unchanged: macOS always carries the
	* `go-keyring-base64:` prefix; Linux Secret Service and Windows Credential
	* Manager store the raw string.
	*/
	async write(key, value) {
		this.assertSupported();
		const stored = this.platform === "darwin" ? encodeGoKeyringPassword(value) : value;
		await (await this.keytar()).setPassword(MOLTNET_SECRET_SERVICE, key, stored);
	}
	async delete(key) {
		this.assertSupported();
		await (await this.keytar()).deletePassword(MOLTNET_SECRET_SERVICE, key);
	}
	async probe(key) {
		try {
			return await this.read(key) ? "present" : "absent";
		} catch {
			return "inaccessible";
		}
	}
	assertSupported() {
		if (!SUPPORTED_PLATFORMS.has(this.platform)) throw new Error(`OS keyring is not supported on ${this.platform}`);
	}
	keytar() {
		this.keytarPromise ??= this.loadKeytar();
		return this.keytarPromise;
	}
};
async function loadNativeKeytar() {
	try {
		const module = await import("./keytar-YU6njFr8.js").then((m) => /* @__PURE__ */ __toESM(m.default, 1));
		return module.default ?? module;
	} catch (error) {
		throw new Error("OS keyring native bindings are unavailable", { cause: error });
	}
}
function encodeGoKeyringPassword(value) {
	return GO_KEYRING_BASE64_PREFIX + Buffer.from(value, "utf8").toString("base64");
}
function decodeGoKeyringPassword(value) {
	if (!value.startsWith(GO_KEYRING_BASE64_PREFIX)) return value;
	return Buffer.from(value.slice(18), "base64").toString("utf8");
}
//#endregion
export { OSKeyringSecretProvider };
