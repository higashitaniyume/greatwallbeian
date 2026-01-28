import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
	console.log('🚀 [GreatWall Beian] 严格审核模式已启动（支持单文件）');

	const diagnosticCollection = vscode.languages.createDiagnosticCollection('beian-check');
	let timeout: NodeJS.Timeout | undefined = undefined;

	/**
	 * 获取备案配置文件的路径
	 * 优先找工作区根目录，如果没有工作区，找文件所在目录
	 */
	const getBeianFilePath = (documentUri: vscode.Uri): string => {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
		if (workspaceFolder) {
			return path.join(workspaceFolder.uri.fsPath, 'beian.json');
		}
		// 单文件模式：返回该文件所在的文件夹下的 beian.json
		return path.join(path.dirname(documentUri.fsPath), 'beian.json');
	};

	const analyzeDocument = (document: vscode.TextDocument) => {
		// 仅处理文件系统中的文件，且排除 beian.json 自身
		if (document.uri.scheme !== 'file' || document.fileName.endsWith('beian.json')) {
			return;
		}

		const configPath = getBeianFilePath(document.uri);
		console.log(`🔍 正在检查: ${path.basename(document.fileName)} | 配置文件目标: ${configPath}`);

		// --- 读取配置 ---
		let registeredTypes: string[] = [];
		if (fs.existsSync(configPath)) {
			try {
				const content = fs.readFileSync(configPath, 'utf8');
				const config = JSON.parse(content);
				registeredTypes = config.registeredTypes || [];
				console.log(`✅ 已读取备案列表: ${registeredTypes.length} 个项目`);
			} catch (err) {
				console.error("❌ 解析 beian.json 失败:", err);
			}
		} else {
			console.log(`ℹ️ 未发现 beian.json，所有类型都将标记为红色错误`);
		}

		// --- 扫描代码 ---
		const diagnostics: vscode.Diagnostic[] = [];
		const text = document.getText();
		// 正则：匹配大写字母开头的单词
		const typeRegex = /\b[A-Z][a-zA-Z0-9_]*\b/g;
		let match;

		while ((match = typeRegex.exec(text)) !== null) {
			const typeName = match[0];

			// 如果没备案，就画红线
			if (!registeredTypes.includes(typeName)) {
				const range = new vscode.Range(
					document.positionAt(match.index),
					document.positionAt(match.index + typeName.length)
				);

				const diagnostic = new vscode.Diagnostic(
					range,
					`🛑 [GreatWall Beian] 类型 "${typeName}" 未备案！编译/运行已拦截，请先完成备案。\n 不能使用未备案的元素 '${typeName}'！`,
					vscode.DiagnosticSeverity.Error // 强制红色波浪线
				);
				diagnostic.code = 'MUST_FILED';
				diagnostic.source = 'GreatWall-Security';
				diagnostics.push(diagnostic);
			}
		}

		diagnosticCollection.set(document.uri, diagnostics);
	};

	// --- 注册快速修复 (Quick Fix) ---
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('*', {
			provideCodeActions(document, range, context) {
				return context.diagnostics
					.filter(d => d.code === 'MUST_FILED')
					.map(d => {
						const typeName = document.getText(d.range);
						const action = new vscode.CodeAction(`✨ 立即为 "${typeName}" 备案`, vscode.CodeActionKind.QuickFix);
						action.command = {
							command: 'greatwallbeian.addToBeian',
							title: '备案',
							arguments: [typeName, document.uri]
						};
						action.isPreferred = true;
						return action;
					});
			}
		})
	);

	// --- 注册“写入备案”命令 (修复版) ---
	context.subscriptions.push(
		vscode.commands.registerCommand('greatwallbeian.addToBeian', async (typeName: string, uriOrAnything: any) => {
			// 1. 健壮性检查：确保 uri 格式正确
			let uri: vscode.Uri;
			if (uriOrAnything instanceof vscode.Uri) {
				uri = uriOrAnything;
			} else if (uriOrAnything && uriOrAnything.fsPath) {
				uri = vscode.Uri.file(uriOrAnything.fsPath);
			} else {
				vscode.window.showErrorMessage('备案失败：无效的文件路径');
				return;
			}

			const configPath = getBeianFilePath(uri);
			const configDir = path.dirname(configPath);

			try {
				// 2. 确保目录存在 (防止单文件模式下找不到目录)
				if (!fs.existsSync(configDir)) {
					fs.mkdirSync(configDir, { recursive: true });
				}

				let config: { registeredTypes: string[] } = { registeredTypes: [] };

				// 3. 安全读取 JSON
				if (fs.existsSync(configPath)) {
					const content = fs.readFileSync(configPath, 'utf8').trim();
					if (content) {
						try {
							config = JSON.parse(content);
							// 确保 registeredTypes 是个数组
							if (!Array.isArray(config.registeredTypes)) {
								config.registeredTypes = [];
							}
						} catch (parseErr) {
							console.error("JSON 解析失败，准备覆盖旧文件", parseErr);
							// 如果文件损坏，初始化为空配置
							config = { registeredTypes: [] };
						}
					}
				}

				// 4. 写入备案信息
				if (!config.registeredTypes.includes(typeName)) {
					config.registeredTypes.push(typeName);

					// 写入文件
					fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');

					vscode.window.showInformationMessage(`✅ [GreatWall Beian] "${typeName}" 备案成功！`);

					// 5. 立即触发一次全屏刷新
					if (vscode.window.activeTextEditor) {
						analyzeDocument(vscode.window.activeTextEditor.document);
					}
				}
			} catch (err: any) {
				// 弹出具体的报错信息，方便排查
				vscode.window.showErrorMessage('备案写入发生异常: ' + (err.message || err));
			}
		})
	);

	// 防抖触发
	const triggerUpdate = (doc: vscode.TextDocument) => {
		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(() => analyzeDocument(doc), 300);
	};

	// 事件监听
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => triggerUpdate(event.document)),
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) analyzeDocument(editor.document);
		}),
		// 手动检查命令
		vscode.commands.registerCommand('greatwallbeian.checkNow', () => {
			if (vscode.window.activeTextEditor) {
				analyzeDocument(vscode.window.activeTextEditor.document);
			}
		})
	);

	// 启动时立即对当前打开的所有文档扫一遍
	vscode.workspace.textDocuments.forEach(analyzeDocument);
}

export function deactivate() { }