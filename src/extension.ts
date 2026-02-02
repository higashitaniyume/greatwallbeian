/** 
 * GreatWall Beian - 代码备案合规检查工具
 * MIT 许可证
 * 
 * 版权所有 (c) 2026 Valency 和 Higashitani Yume
 * 
 * 你可以在遵守 MIT 许可证的前提下修改或者分发、复制此代码。
*/
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
	// [Log] 初始化插件
	Logger.init('GreatWall Beian');
	Logger.log('>>> GreatWall Beian 全语言合规引擎已启动');

	const diagnosticCollection = vscode.languages.createDiagnosticCollection('greatwall-beian-check');
	let timeout: NodeJS.Timeout | undefined = undefined;

	/**
	 * 计算 SHA-256 哈希
	 */
	const calculateHash = (text: string): string => {
		return crypto.createHash('sha256').update(text).digest('hex');
	};

	/**
	 * 安全获取配置
	 */
	const getSetting = <T>(key: string, defaultValue: T): T => {
		const config = vscode.workspace.getConfiguration('greatwallbeian');
		return config.get<T>(key) ?? defaultValue;
	};

	/**
	 * 获取备案配置文件的绝对路径
	 */
	const getBeianFilePath = (documentUri: vscode.Uri): string => {
		const configSubPath = getSetting('configFilePath', '.vscode/beian.json');
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);

		let finalPath: string;
		if (workspaceFolder) {
			finalPath = path.join(workspaceFolder.uri.fsPath, configSubPath);
		} else {
			const fileName = path.basename(configSubPath);
			finalPath = path.join(path.dirname(documentUri.fsPath), fileName);
		}
		return finalPath;
	};

	/**
	 * 核心分析逻辑
	 */
	const analyzeDocument = (document: vscode.TextDocument): number => {
		if (document.uri.scheme !== 'file') { return 0; }

		// [Log] 开始扫描
		Logger.log(`正在对文档进行合规性扫描: ${path.basename(document.fileName)}`);

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
			} catch (err: any) {
				// [Error] 配置文件解析失败
				Logger.error(`解析备案配置文件失败 [${configPath}]: ${err.message}`, err);
			}
		} else {
			// [Warn] 缺少备案配置文件
			Logger.warn(`未找到备案配置文件: ${configPath}`);
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

		// [Log] 扫描结果
		if (diagnostics.length > 0) {
			Logger.warn(`扫描完成: ${document.fileName}, 发现 ${diagnostics.length} 个不合规项。`);
		} else {
			Logger.log(`扫描完成: ${document.fileName}, 合规状态：通过。`);
		}

		return diagnostics.length;
	};

	// --- 拦截器逻辑 ---

	/**
	 * 拦截函数：检查当前编辑器所有文件是否合规
	 */
	const stopIfInvalid = (actionName: string): boolean => {
		const editors = vscode.window.visibleTextEditors;
		let hasError = false;

		Logger.log(`[拦截器] 正在执行 "${actionName}" 的前置合规检查...`);

		for (const editor of editors) {
			if (analyzeDocument(editor.document) > 0) {
				hasError = true;
			}
		}

		if (hasError) {
			// [Warn] 拦截动作
			Logger.warn(`[安全拦截] 操作 "${actionName}" 已被阻止，因为存在未备案的合规风险。`);

			var stopTaskMessage = getSetting('stopTaskMessage', '检测到未备案或篡改的元素，已停止当前任务以防止潜在风险。如有疑问，请联系管理员。');
			stopTaskMessage = stopTaskMessage.replace(/{actionName}/g, actionName);
			vscode.window.showErrorMessage(stopTaskMessage, { modal: true });
			return true;
		}
		return false;
	};

	// 1. 阻止调试运行 (F5 / Run)
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession((session) => {
			if (stopIfInvalid(`调试会话: ${session.name}`)) {
				Logger.log('正在强制终止调试会话...');
				vscode.debug.stopDebugging(session);
			}
		})
	);

	// 使用 DebugConfigurationProvider 在调试配置解析阶段进行前置拦截（在启动前）
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider('*', {
			resolveDebugConfiguration(folder, config) {
				const cfgName = (config && (config.name || config.program)) ? (config.name || config.program) : '调试会话';
				if (stopIfInvalid(`调试: ${cfgName}`)) {
					const msg = getSetting('stopTaskMessage', '检测到未备案或篡改的元素，已停止当前任务以防止潜在风险。');
					vscode.window.showErrorMessage(msg.replace(/{actionName}/g, `调试: ${cfgName}`), { modal: true });
					return undefined; // 返回 undefined 将取消本次调试启动
				}
				return config;
			}
		})
	);

	// 2. 阻止任务执行
	context.subscriptions.push(
		vscode.tasks.onDidStartTask((e) => {
			const taskName = e.execution.task.name;
			if (stopIfInvalid(`任务: ${taskName}`)) {
				Logger.log(`正在强制终止任务: ${taskName}`);
				e.execution.terminate();
			}
		})
	);

	// 3. 阻止保存操作
	context.subscriptions.push(
		vscode.workspace.onWillSaveTextDocument((e) => {
			if (analyzeDocument(e.document) > 0) {
				// [Warn] 保存拦截
				Logger.warn(`[合规警告] 用户尝试保存含有风险代码的文件: ${e.document.fileName}`);
				vscode.window.showErrorMessage("【合规警告】文件包含未备案元素，严禁保存/提交合规受控文件！", { modal: true });
			}
		})
	);

	// --- 注册快速修复 ---
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

	// --- 注册写入备案命令 ---
	context.subscriptions.push(
		vscode.commands.registerCommand('greatwallbeian.addToBeian', async (typeName: string, uri: vscode.Uri) => {
			if (!uri) {
				Logger.error('命令调用失败: 缺少有效的 URI 参数', null);
				return;
			}

			Logger.log(`[命令] 收到备案申请: "${typeName}"`);
			const configPath = getBeianFilePath(uri);
			const configDir = path.dirname(configPath);

			try {
				if (!fs.existsSync(configDir)) {
					Logger.log(`创建备案目录: ${configDir}`);
					fs.mkdirSync(configDir, { recursive: true });
				}

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

				// [Log] 写入成功
				Logger.log(`[成功] 元素 "${typeName}" 已成功写入备案库。`);
				vscode.window.showInformationMessage(`"${typeName}" 备案成功！`);

				// 立即刷新所有可见编辑器的诊断状态
				vscode.window.visibleTextEditors.forEach(e => analyzeDocument(e.document));
			} catch (err: any) {
				// [Error] 写入失败
				Logger.error(`备案写入失败: ${err.message}`, err);
				vscode.window.showErrorMessage('备案写入失败: ' + err.message);
			}
		})
	);

	// --- 监听事件 ---
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
		vscode.workspace.onDidOpenTextDocument(doc => {
			Logger.log(`打开文档: ${doc.fileName}`);
			analyzeDocument(doc);
		}),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('greatwallbeian')) {
				Logger.log('检测到插件配置更改，正在重新扫描...');
				vscode.window.visibleTextEditors.forEach(editor => analyzeDocument(editor.document));
			}
		}),
		vscode.commands.registerCommand('greatwallbeian.checkNow', () => {
			Logger.log('[手动触发] 执行即时合规扫描');
			if (vscode.window.activeTextEditor) {
				analyzeDocument(vscode.window.activeTextEditor.document);
			}
		})
	);

	// 初始化延迟扫描
	setTimeout(() => {
		Logger.log('初始化后台扫描任务...');
		vscode.window.visibleTextEditors.forEach(editor => analyzeDocument(editor.document));
	}, 1000);
}

export function deactivate() {
	Logger.log('GreatWall Beian 已停用');
}