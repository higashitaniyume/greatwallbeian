import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Logger } from './logger';

// --- 类型定义 ---
interface BeianEntry {
	name: string;
	date: string;
	hash: string;
}

interface BeianConfig {
	registeredTypes: BeianEntry[];
}

export function activate(context: vscode.ExtensionContext) {
	Logger.init('GreatWall Beian');
	Logger.log('>>> GreatWall Beian 全语言合规引擎已启动');

	const diagnosticCollection = vscode.languages.createDiagnosticCollection('greatwall-beian-check');
	let timeout: NodeJS.Timeout | undefined = undefined;

	/**
	 * 计算 SHA-256 哈希 (保留原样)
	 */
	const calculateHash = (text: string): string => {
		return crypto.createHash('sha256').update(text).digest('hex');
	};

	/**
	 * 安全获取配置 (保留原样)
	 */
	const getSetting = <T>(key: string, defaultValue: T): T => {
		const config = vscode.workspace.getConfiguration('greatwallbeian');
		return config.get<T>(key) ?? defaultValue;
	};

	/**
	 * 获取备案配置文件的绝对路径 (保留原样)
	 */
	const getBeianFilePath = (documentUri: vscode.Uri): string => {
		const configSubPath = getSetting('configFilePath', '.vscode/beian.json');
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);

		if (workspaceFolder) {
			return path.join(workspaceFolder.uri.fsPath, configSubPath);
		}
		const fileName = path.basename(configSubPath);
		return path.join(path.dirname(documentUri.fsPath), fileName);
	};

	/**
	 * 核心分析逻辑 (保留原样，但返回 diagnostics 数量供拦截器判断)
	 */
	const analyzeDocument = (document: vscode.TextDocument): number => {
		if (document.uri.scheme !== 'file') { return 0; }

		const configSubPath = getSetting('configFilePath', '.vscode/beian.json');
		if (document.fileName.endsWith(configSubPath)) {
			diagnosticCollection.delete(document.uri);
			return 0;
		}

		const configPath = getBeianFilePath(document.uri);
		let registeredEntries: BeianEntry[] = [];

		if (fs.existsSync(configPath)) {
			try {
				const content = fs.readFileSync(configPath, 'utf8');
				const config: BeianConfig = JSON.parse(content);
				registeredEntries = Array.isArray(config.registeredTypes) ? config.registeredTypes : [];
			} catch (err) { }
		}

		const diagnostics: vscode.Diagnostic[] = [];
		const text = document.getText();
		const typeRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
		let match;

		const msgNotRegistered = getSetting('errorNotRegistered', '未备案！');
		const msgTampered = getSetting('errorTampered', '哈希校验失败！');
		const ignoreKeywords = getSetting<string[]>('ignoreKeywords', []);
		const diagSource = getSetting('diagnosticSource', 'GreatWall-Security');

		while ((match = typeRegex.exec(text)) !== null) {
			const typeName = match[0];
			if (ignoreKeywords.includes(typeName)) { continue; }

			const currentHash = calculateHash(typeName);
			const entry = registeredEntries.find(e => e.name === typeName);

			let errorMessage = "";
			if (!entry) {
				errorMessage = msgNotRegistered.replace(/{typeName}/g, typeName);
			} else if (entry.hash !== currentHash) {
				errorMessage = msgTampered.replace(/{typeName}/g, typeName);
			}

			if (errorMessage) {
				const range = new vscode.Range(
					document.positionAt(match.index),
					document.positionAt(match.index + typeName.length)
				);
				const diagnostic = new vscode.Diagnostic(range, errorMessage, vscode.DiagnosticSeverity.Error);
				diagnostic.source = diagSource;
				diagnostic.code = 'MUST_FILED';
				diagnostics.push(diagnostic);
			}
		}

		diagnosticCollection.set(document.uri, diagnostics);
		return diagnostics.length;
	};

	// --- 【新增：阻止运行和生成的逻辑】 ---

	/**
	 * 拦截函数：检查当前编辑器所有文件是否合规
	 */
	const stopIfInvalid = (actionName: string): boolean => {
		const editors = vscode.window.visibleTextEditors;
		let hasError = false;
		for (const editor of editors) {
			if (analyzeDocument(editor.document) > 0) {
				hasError = true;
			}
		}
		if (hasError) {
			var stopTaskMessage = getSetting('stopTaskMessage', '检测到未备案或篡改的元素，已停止当前任务以防止潜在风险。如有疑问，请联系管理员。');
			stopTaskMessage = stopTaskMessage.replace(/{actionName}/g, actionName);
			vscode.window.showErrorMessage(stopTaskMessage, { modal: true });
			return true; // 表示有错，需要拦截
		}
		return false;
	};

	// 1. 阻止调试运行 (F5 / Run)
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession((session) => {
			if (stopIfInvalid("调试运行")) {
				vscode.debug.stopDebugging(session);
			}
		})
	);

	// 2. 阻止任务执行 (Build / Compile / npm run 等任务生成操作)
	context.subscriptions.push(
		vscode.tasks.onDidStartTask((e) => {
			if (stopIfInvalid(`任务: ${e.execution.task.name}`)) {
				e.execution.terminate();
			}
		})
	);

	// 3. 阻止保存操作 (阻止物理文件的更新生成)
	context.subscriptions.push(
		vscode.workspace.onWillSaveTextDocument((e) => {
			if (analyzeDocument(e.document) > 0) {
				// VS Code 不允许直接完全取消 Save 动作，但我们可以通过 Modal 报错警告用户
				// 并且这里再次触发扫描以确保 UI 红线显示
				vscode.window.showErrorMessage("【合规警告】文件包含未备案元素，严禁保存/提交合规受控文件！", { modal: true });
			}
		})
	);

	// --- 注册快速修复 (保留原样) ---
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider({ language: '*', scheme: 'file' }, {
			provideCodeActions(document, range, context) {
				const diagSource = getSetting('diagnosticSource', 'GreatWall-Security');
				return context.diagnostics
					.filter(d => d.source === diagSource)
					.map(d => {
						const typeName = document.getText(d.range);
						const action = new vscode.CodeAction(`为 "${typeName}" 办理备案`, vscode.CodeActionKind.QuickFix);
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

	// --- 注册写入备案命令 (保留原样) ---
	context.subscriptions.push(
		vscode.commands.registerCommand('greatwallbeian.addToBeian', async (typeName: string, uri: vscode.Uri) => {
			if (!uri) { return; }
			const configPath = getBeianFilePath(uri);
			const configDir = path.dirname(configPath);
			try {
				if (!fs.existsSync(configDir)) { fs.mkdirSync(configDir, { recursive: true }); }
				let config: BeianConfig = { registeredTypes: [] };
				if (fs.existsSync(configPath)) {
					const content = fs.readFileSync(configPath, 'utf8').trim();
					config = JSON.parse(content || '{"registeredTypes":[]}');
				}
				config.registeredTypes = (config.registeredTypes || []).filter(e => e.name !== typeName);
				config.registeredTypes.push({
					name: typeName,
					date: new Date().toLocaleString(),
					hash: calculateHash(typeName)
				});
				fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');
				vscode.window.showInformationMessage(`"${typeName}" 备案成功！`);
				vscode.window.visibleTextEditors.forEach(e => analyzeDocument(e.document));
			} catch (err: any) {
				vscode.window.showErrorMessage('备案写入失败: ' + err.message);
			}
		})
	);

	// --- 监听事件 (保留原样) ---
	const triggerUpdate = (doc: vscode.TextDocument) => {
		if (timeout) { clearTimeout(timeout); }
		timeout = setTimeout(() => analyzeDocument(doc), 400);
	};

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(e => triggerUpdate(e.document)),
		vscode.window.onDidChangeActiveTextEditor(e => {
			if (e) { analyzeDocument(e.document); }
		}),
		vscode.workspace.onDidSaveTextDocument(doc => analyzeDocument(doc)),
		vscode.workspace.onDidOpenTextDocument(doc => analyzeDocument(doc)),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('greatwallbeian')) {
				vscode.window.visibleTextEditors.forEach(editor => analyzeDocument(editor.document));
			}
		}),
		vscode.commands.registerCommand('greatwallbeian.checkNow', () => {
			if (vscode.window.activeTextEditor) { analyzeDocument(vscode.window.activeTextEditor.document); }
		})
	);

	setTimeout(() => {
		vscode.window.visibleTextEditors.forEach(editor => analyzeDocument(editor.document));
	}, 1000);
}

export function deactivate() { }