window.__ModuleLoader__.load({
	id: "dsh-mcp-admin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/McpAdminSection.tsx
		/**
		* MCP 管理 settings page — the browser half of dsh-mcp-admin. It renders the
		* audit trail of skill/preset mutations performed through the plugin's MCP
		* endpoint, polled over the dedicated `/mcp-admin` RPC channel
		* (`connection.rpc.call`). Read-only by design: edits happen through MCP
		* tools, this page only shows what changed, when, and a content preview.
		*
		* @module dsh-mcp-admin/client/board
		*/
		/** Poll cadence while the page is mounted (the audit read is cheap). */
		const POLL_INTERVAL_MS = 5e3;
		/** The settings page component; only exported for the plugin entry. */
		function McpAdminSection({ connection }) {
			const [records, setRecords] = (0, react.useState)([]);
			const [error, setError] = (0, react.useState)();
			const refresh = (0, react.useCallback)(async () => {
				try {
					const result = await connection.rpc.call("/mcp-admin", "audit.list", {});
					if (result.ok) {
						setRecords(result.value);
						setError(void 0);
					} else setError(result.error.message);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, [connection]);
			(0, react.useEffect)(() => {
				refresh();
				const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
				return () => clearInterval(timer);
			}, [refresh]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "0 4px" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: { margin: "0 0 12px" },
						children: "MCP 管理"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: "0 0 12px",
							color: "var(--dsw-text-secondary, #888)"
						},
						children: "通过 MCP 端点对 skill 与 Agent 预设的远程修改记录（最新在前，每 5 秒刷新）。"
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						style: { color: "var(--dsw-error, #c00)" },
						children: ["读取失败：", error]
					}),
					error === void 0 && records.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: { color: "var(--dsw-text-secondary, #888)" },
						children: "暂无修改记录。"
					}),
					records.map((record, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "10px 0",
							borderBottom: "1px solid var(--dsw-border, #eee)"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: "8px",
								alignItems: "baseline",
								flexWrap: "wrap"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										color: "var(--dsw-text-secondary, #888)",
										fontSize: "12px"
									},
									children: new Date(record.ts).toLocaleString()
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: "12px",
										padding: "1px 6px",
										borderRadius: "4px",
										background: record.kind === "skill" ? "var(--dsw-accent-soft, #e8f0fe)" : "var(--dsw-warn-soft, #fef3e0)"
									},
									children: record.kind === "skill" ? "Skill" : "Preset"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: record.name }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: record.action === "delete" ? "var(--dsw-error, #c00)" : "inherit" },
									children: record.action === "delete" ? "删除" : "写入"
								}),
								record.action === "upsert" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										color: "var(--dsw-text-secondary, #888)",
										fontSize: "12px"
									},
									children: [record.bytes, " B"]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										color: "var(--dsw-text-secondary, #888)",
										fontSize: "12px"
									},
									children: record.tool
								})
							]
						}), record.excerpt.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							style: {
								margin: "6px 0 0",
								padding: "8px",
								fontSize: "12px",
								whiteSpace: "pre-wrap",
								wordBreak: "break-all",
								background: "var(--dsw-surface-secondary, #f6f6f6)",
								borderRadius: "6px",
								maxHeight: "120px",
								overflow: "hidden"
							},
							children: record.excerpt
						})]
					}, `${record.ts}-${index}`))
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services (cordis fiber inject): the slots registry and the wire. */
		const inject = ["slots", "connection"];
		/**
		* Mount the MCP 管理 settings page.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const connection = ctx.get("connection");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "mcp-admin",
				order: 40,
				label: () => "MCP 管理",
				inject: () => ({ connection })
			}, McpAdminSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map