window.__ModuleLoader__.load({
	id: "dsh-builtin-browser",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/store.ts
		const DEFAULT_ADDRESS = "https://example.com";
		let surface = null;
		let state = {
			open: false,
			address: DEFAULT_ADDRESS,
			current: "",
			inShell: false
		};
		const listeners = /* @__PURE__ */ new Set();
		function emit() {
			listeners.forEach((l) => l());
		}
		const browserStore = {
			get() {
				return state;
			},
			subscribe(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			toggle() {
				state = {
					...state,
					open: !state.open
				};
				emit();
			},
			setOpen(open) {
				if (state.open === open) return;
				state = {
					...state,
					open
				};
				emit();
			},
			setAddress(address) {
				if (state.address === address) return;
				state = {
					...state,
					address
				};
				emit();
			},
			setCurrent(current) {
				if (state.current === current) return;
				state = {
					...state,
					current,
					address: current || state.address
				};
				emit();
			},
			setInShell(inShell) {
				if (state.inShell === inShell) return;
				state = {
					...state,
					inShell
				};
				emit();
			},
			/** Bind the page-surface element the controller drives. */
			setSurface(el) {
				surface = el;
			},
			/** The currently bound page-surface element (webview in the shell). */
			getSurface() {
				return surface;
			}
		};
		/**
		* The global controller the Desktop shell drives via executeJavaScript
		* (desktop/main.cjs forwards `/browser/command` here). Every method returns a
		* JSON value the shell relays back to the harness host half verbatim.
		*/
		const pageBrowserController = { async command(payload) {
			const el = browserStore.getSurface();
			if (!el) return {
				ok: false,
				error: "browser panel not mounted"
			};
			switch (payload.op) {
				case "navigate": {
					const url = String(payload.url || "");
					if (!url) return {
						ok: false,
						error: "navigate requires a url"
					};
					if (el.loadURL) try {
						await el.loadURL(url);
					} catch (err) {
						return {
							ok: false,
							error: err instanceof Error ? err.message : String(err)
						};
					}
					else el.setAttribute("src", url);
					browserStore.setAddress(url);
					return {
						ok: true,
						url,
						title: el.getTitle?.() ?? ""
					};
				}
				case "back":
					el.goBack?.();
					return {
						ok: true,
						url: el.getURL?.() ?? "",
						title: el.getTitle?.() ?? ""
					};
				case "forward":
					el.goForward?.();
					return {
						ok: true,
						url: el.getURL?.() ?? "",
						title: el.getTitle?.() ?? ""
					};
				case "reload":
					el.reload?.();
					return { ok: true };
				case "stop":
					el.stop?.();
					return { ok: true };
				case "eval": {
					const script = String(payload.script || "");
					if (!el.executeJavaScript) return {
						ok: false,
						error: "executeJavaScript unavailable outside the Electron shell"
					};
					try {
						const result = await el.executeJavaScript(script, true);
						return {
							ok: true,
							result: result === void 0 ? null : result
						};
					} catch (err) {
						return {
							ok: false,
							error: err instanceof Error ? err.message : String(err)
						};
					}
				}
				default: return {
					ok: false,
					error: `unknown browser command: ${payload.op}`
				};
			}
		} };
		//#endregion
		//#region src/client/BrowserPanel.tsx
		/**
		* The browser panel itself, rendered into the `shell.overlay` slot: a floating
		* frame-wide surface with an address bar, navigation buttons, and the actual
		* page surface.
		*
		* Page surface selection:
		*  - Inside the Electron Desktop shell (`window.desktopBridge` present and the
		*    shell opted into `webviewTag`), a real `<webview>` element is rendered —
		*    a full Chromium guest with its own session, history, and devtools. All
		*    navigation is driven by the `WebviewControl` helper below, which talks to
		*    the element's native API (`loadURL`, `goBack`, ...).
		*  - Otherwise (plain browser tab, e.g. `dsh web`), it degrades to an
		*    `<iframe>` so the UI is still usable for sites that allow framing.
		*
		* The host half reaches this same webview through the Desktop shell's HTTP
		* control endpoint (desktop/main.js) + `executeJavaScript` into this page,
		* so the agent's `browser_*` tools and the manual toolbar stay in sync.
		*
		* @module dsh-builtin-browser/client/BrowserPanel
		*/
		/** Normalize whatever the user typed into the address bar into an absolute URL. */
		function toUrl(input) {
			const trimmed = input.trim();
			if (!trimmed) return "https://example.com";
			if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
			return `https://${trimmed}`;
		}
		/**
		* The toolbar + page surface of the built-in browser.
		* @param _props - slot owner props (unused; the panel is frame-global).
		*/
		function BrowserPanel(_props) {
			const [state, setState] = (0, react.useState)(browserStore.get());
			const [addressInput, setAddressInput] = (0, react.useState)(state.address);
			const [canGoBack, setCanGoBack] = (0, react.useState)(false);
			const [canGoForward, setCanGoForward] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(false);
			const inShell = Boolean(typeof window !== "undefined" && window.desktopBridge);
			(0, react.useEffect)(() => browserStore.subscribe(() => {
				const next = browserStore.get();
				setState(next);
				setAddressInput(next.address);
			}), []);
			const bindSurface = (0, react.useCallback)((el) => {
				browserStore.setSurface(el);
			}, []);
			const refreshNavState = (0, react.useCallback)(() => {
				const wv = browserStore.getSurface();
				if (!wv) return;
				try {
					setCanGoBack(wv.canGoBack?.() ?? false);
					setCanGoForward(wv.canGoForward?.() ?? false);
					const url = wv.getURL?.() ?? "";
					if (url) browserStore.setCurrent(url);
				} catch {}
			}, []);
			const navigate = (0, react.useCallback)((input) => {
				const url = toUrl(input);
				setAddressInput(url);
				browserStore.setAddress(url);
				const wv = browserStore.getSurface();
				if (wv?.loadURL) {
					setLoading(true);
					wv.loadURL(url).catch(() => setLoading(false));
				} else if (wv) {
					wv.setAttribute("src", url);
					setLoading(true);
				}
			}, []);
			const goBack = (0, react.useCallback)(() => {
				browserStore.getSurface()?.goBack?.();
			}, []);
			const goForward = (0, react.useCallback)(() => {
				browserStore.getSurface()?.goForward?.();
			}, []);
			const reload = (0, react.useCallback)(() => {
				browserStore.getSurface()?.reload?.();
			}, []);
			const stop = (0, react.useCallback)(() => {
				browserStore.getSurface()?.stop?.();
				setLoading(false);
			}, []);
			(0, react.useEffect)(() => {
				const wv = browserStore.getSurface();
				if (!wv || !inShell) return;
				const onDidNavigate = () => refreshNavState();
				const onDidFinishLoad = () => {
					setLoading(false);
					refreshNavState();
				};
				const onDidStartLoading = () => setLoading(true);
				const onDidStopLoading = () => setLoading(false);
				wv.addEventListener("did-navigate", onDidNavigate);
				wv.addEventListener("did-navigate-in-page", onDidNavigate);
				wv.addEventListener("did-finish-load", onDidFinishLoad);
				wv.addEventListener("did-start-loading", onDidStartLoading);
				wv.addEventListener("did-stop-loading", onDidStopLoading);
				return () => {
					wv.removeEventListener("did-navigate", onDidNavigate);
					wv.removeEventListener("did-navigate-in-page", onDidNavigate);
					wv.removeEventListener("did-finish-load", onDidFinishLoad);
					wv.removeEventListener("did-start-loading", onDidStartLoading);
					wv.removeEventListener("did-stop-loading", onDidStopLoading);
				};
			}, [inShell, refreshNavState]);
			(0, react.useEffect)(() => {
				if (state.open && state.current && state.address !== state.current) {}
			}, [state.open]);
			if (!state.open) return null;
			const toolbarStyle = {
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "8px 12px",
				borderBottom: "1px solid rgba(127,127,127,0.25)",
				background: "var(--bg, #ffffff)"
			};
			const buttonStyle = {
				border: "none",
				background: "transparent",
				cursor: "pointer",
				fontSize: 14,
				padding: "4px 8px",
				borderRadius: 6,
				color: "inherit",
				opacity: .85
			};
			const inputStyle = {
				flex: 1,
				padding: "6px 10px",
				borderRadius: 8,
				border: "1px solid rgba(127,127,127,0.35)",
				background: "transparent",
				color: "inherit",
				font: "inherit"
			};
			const surfaceStyle = {
				flex: 1,
				width: "100%",
				border: "none",
				background: "#fff"
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					position: "fixed",
					inset: 0,
					zIndex: 1e3,
					display: "flex",
					flexDirection: "column",
					background: "var(--bg, #fff)",
					color: "var(--fg, #111)"
				},
				role: "dialog",
				"aria-label": "内置浏览器",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: toolbarStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							onClick: goBack,
							disabled: !canGoBack,
							title: "后退",
							"aria-label": "后退",
							children: "←"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							onClick: goForward,
							disabled: !canGoForward,
							title: "前进",
							"aria-label": "前进",
							children: "→"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							onClick: reload,
							title: "刷新",
							"aria-label": "刷新",
							children: "⟳"
						}),
						loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							onClick: stop,
							title: "停止",
							"aria-label": "停止",
							children: "✕"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: inputStyle,
							value: addressInput,
							onChange: (e) => setAddressInput(e.target.value),
							onKeyDown: (e) => {
								if (e.key === "Enter") navigate(addressInput);
							},
							placeholder: "输入网址后回车",
							"aria-label": "地址栏",
							spellCheck: false
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							onClick: () => navigate(addressInput),
							title: "前往",
							children: "前往"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							onClick: () => browserStore.setOpen(false),
							title: "关闭",
							"aria-label": "关闭浏览器",
							children: "✕"
						})
					]
				}), inShell ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("webview", {
					ref: bindSurface,
					src: state.address,
					style: surfaceStyle,
					allowpopups: true
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
					ref: bindSurface,
					src: state.address,
					style: surfaceStyle,
					onLoad: () => {
						setLoading(false);
						browserStore.setCurrent(state.address);
					},
					title: "内置浏览器",
					sandbox: "allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
				})]
			});
		}
		//#endregion
		//#region src/client/BrowserToggle.tsx
		/**
		* Sidebar-foot toggle for the built-in browser, registered into the
		* `sidebar.footer.action` slot: one small action beside Settings that opens or
		* closes the floating browser panel.
		*
		* @module dsh-builtin-browser/client/BrowserToggle
		*/
		/**
		* The sidebar action button toggling the built-in browser panel.
		* @param props - the sidebar footer action owner share.
		*/
		function BrowserToggle(props) {
			const { wide } = props;
			const [open, setOpen] = (0, react.useState)(browserStore.get().open);
			(0, react.useEffect)(() => browserStore.subscribe(() => setOpen(browserStore.get().open)), []);
			const label = open ? "关闭浏览器" : "内置浏览器";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				onClick: () => browserStore.toggle(),
				title: label,
				"aria-label": label,
				"aria-pressed": open,
				style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: 6,
					width: "100%",
					border: "none",
					background: open ? "rgba(127,127,127,0.18)" : "transparent",
					cursor: "pointer",
					padding: wide ? "6px 10px" : "6px",
					borderRadius: 8,
					color: "inherit",
					fontSize: 14
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					role: "img",
					"aria-hidden": "true",
					children: "🌐"
				}), wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services (cordis fiber inject): the slots registry. */
		const inject = ["slots"];
		/** Window slot the shell's executeJavaScript targets. */
		const CONTROLLER_KEY = "__dshBrowser";
		/**
		* Mount the built-in browser UI.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === void 0) return;
			if (globalThis.desktopBridge?.browserPort) browserStore.setInShell(true);
			const win = globalThis;
			win[CONTROLLER_KEY] = pageBrowserController;
			ctx.effect(() => () => {
				if (win[CONTROLLER_KEY] === pageBrowserController) delete win[CONTROLLER_KEY];
			});
			slots.inject("sidebar.footer.action", () => slots.register({
				name: "sidebar.footer.action",
				id: "builtin-browser",
				order: 10,
				label: () => browserStore.get().open ? "关闭浏览器" : "内置浏览器"
			}, BrowserToggle));
			slots.inject("shell.overlay", () => slots.register({
				name: "shell.overlay",
				id: "builtin-browser",
				order: 10,
				label: () => "内置浏览器"
			}, BrowserPanel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map