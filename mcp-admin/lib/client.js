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
		/**
		* Build the paste-ready MCP setup brief for another agent. The URL mirrors
		* the address this page was opened with (public IP, LAN IP, or loopback), so
		* the pasted config reaches the server the same way the user just did.
		*/
		function buildSetupBrief(origin, token) {
			const url = `${origin}/mcp`;
			return `# 配置远程 DeepSeek Harness 管理端点（dsh-mcp-admin）

把下面这个 MCP server 加进你的客户端配置（Streamable HTTP 类型），然后重启或重连 MCP：

\`\`\`json
{
  "mcpServers": {
    "dsh-admin": {
      "type": "http",
      "url": "${url}",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}
\`\`\`

如果你的客户端用别的配置格式，要素只有两个：
- URL：${url}
- 请求头：Authorization: Bearer ${token}

## 配置成功后你可以做什么

这是远程服务器上 DeepSeek Harness 的管理端点，提供 8 个工具：

- \`skill_list\` / \`skill_read\` / \`skill_upsert\` / \`skill_delete\` — 管理 skill（user root：~/.dsh/skills，写完即时热生效）
- \`preset_list\` / \`preset_read\` / \`preset_upsert\` / \`preset_delete\` — 管理 Agent 预设（改动对新建 session 生效；覆盖内置 preset 时先传 base 参数复制再改）

典型流程：用 skill_read / preset_read 评审当前配置 → 修改后 upsert → 开新 session 验证效果。
`;
		}
		/** The settings page component; only exported for the plugin entry. */
		function McpAdminSection({ connection }) {
			const [records, setRecords] = (0, react.useState)([]);
			const [error, setError] = (0, react.useState)();
			const [copied, setCopied] = (0, react.useState)(false);
			/** Setup brief rendered for manual copy when the clipboard API is unavailable (http:// pages). */
			const [manualCopy, setManualCopy] = (0, react.useState)();
			const [setupError, setSetupError] = (0, react.useState)();
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
			const copySetup = (0, react.useCallback)(async () => {
				setCopied(false);
				setManualCopy(void 0);
				setSetupError(void 0);
				try {
					const result = await connection.rpc.call("/mcp-admin", "setup-info", {});
					if (!result.ok) {
						setSetupError(result.error.message);
						return;
					}
					const brief = buildSetupBrief(window.location.origin, result.value.token);
					try {
						await navigator.clipboard.writeText(brief);
						setCopied(true);
					} catch {
						setManualCopy(brief);
					}
				} catch (cause) {
					setSetupError(cause instanceof Error ? cause.message : String(cause));
				}
			}, [connection]);
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: { margin: "0 0 16px" },
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => void copySetup(),
								style: {
									padding: "6px 14px",
									borderRadius: "6px",
									border: "1px solid var(--dsw-border, #ddd)",
									background: "var(--dsw-accent-soft, #e8f0fe)",
									cursor: "pointer"
								},
								children: "复制 MCP 配置说明"
							}),
							copied && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									marginLeft: "10px",
									color: "var(--dsw-success, #18794e)"
								},
								children: "已复制，直接粘贴给要配置的 Agent 即可"
							}),
							setupError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									marginLeft: "10px",
									color: "var(--dsw-error, #c00)"
								},
								children: setupError
							})
						]
					}),
					manualCopy !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: { margin: "0 0 16px" },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								margin: "0 0 6px",
								color: "var(--dsw-text-secondary, #888)"
							},
							children: "当前页面不是安全上下文（http），浏览器禁止自动复制。请全选下面文本手动复制："
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							readOnly: true,
							value: manualCopy,
							onFocus: (event) => event.target.select(),
							style: {
								width: "100%",
								height: "260px",
								boxSizing: "border-box",
								fontSize: "12px",
								fontFamily: "monospace",
								padding: "8px",
								borderRadius: "6px",
								border: "1px solid var(--dsw-border, #ddd)"
							}
						})]
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