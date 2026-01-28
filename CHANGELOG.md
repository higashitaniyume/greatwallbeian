
# Changelog

## 1.0.1 (2026.1.28)

### 🎉 Initial Release

#### ✨ Features
- **Real-time Compliance Scanning**: Automatically detects unregistered identifiers in code
- **Compile-level Blocking**: Unregistered elements trigger Error-level diagnostics (red squiggles)
- **Quick Fix Support**: One-click registration via lightbulb menu with `✨ Register "{TypeName}" immediately`
- **Flexible Audit Modes**:
    - Workspace mode: Uses `beian.json` from workspace root
    - Single-file mode: Looks for `beian.json` in the same directory
- **Auto-sync Updates**: Diagnostics instantly clear when `beian.json` is modified
- **Robust JSON Handling**: Automatic directory creation and error recovery

#### 🛠️ Commands
- `greatwallbeian.checkNow`: Manually trigger compliance scan on active document
- `greatwallbeian.addToBeian`: Register a type (invoked via Quick Fix)

#### 📋 Default Configuration
- Config file: `beian.json`
- Schema: `{ "registeredTypes": [...] }`
- Scans identifiers matching pattern: `[A-Z][a-zA-Z0-9_]*`

#### 🔒 Security & Compliance
- Excludes `beian.json` itself from scanning
- Prevents infinite self-audit loops
- Integrates with VS Code's native Diagnostic system

---
