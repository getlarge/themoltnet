import { n as __require, t as __commonJSMin } from "../main.js";
//#region ../../node_modules/.pnpm/@github+keytar@7.10.6/node_modules/@github/keytar/lib/keytar.js
var require_keytar = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	function loadNativeAddonFromPath(path) {
		try {
			return __require(path + "/keytar.node");
		} catch {}
	}
	function loadNativeAddon() {
		var prebuildDir = "prebuilds/" + process.platform + "-" + process.arch;
		var paths = [
			"../build/Release",
			"../" + prebuildDir,
			"./" + prebuildDir
		];
		for (var path of paths) {
			var keytar = loadNativeAddonFromPath(path);
			if (keytar) return keytar;
		}
		throw new Error("Failed to load keytar native addon, checked " + JSON.stringify(paths) + " on " + prebuildDir);
	}
	var keytar = loadNativeAddon();
	function checkRequired(val, name) {
		if (!val || val.length <= 0) throw new Error(name + " is required.");
	}
	module.exports = {
		getPassword: function(service, account) {
			checkRequired(service, "Service");
			checkRequired(account, "Account");
			return keytar.getPassword(service, account);
		},
		setPassword: function(service, account, password) {
			checkRequired(service, "Service");
			checkRequired(account, "Account");
			checkRequired(password, "Password");
			return keytar.setPassword(service, account, password);
		},
		deletePassword: function(service, account) {
			checkRequired(service, "Service");
			checkRequired(account, "Account");
			return keytar.deletePassword(service, account);
		},
		findPassword: function(service) {
			checkRequired(service, "Service");
			return keytar.findPassword(service);
		},
		findCredentials: function(service) {
			checkRequired(service, "Service");
			return keytar.findCredentials(service);
		}
	};
}));
//#endregion
export default require_keytar();
export {};
